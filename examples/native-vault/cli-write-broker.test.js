import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createCliWriteBroker } from './cli-write-broker.js';
import { requestCliWrite } from './cli-write-client.js';
import { CLI_WRITE_LIMIT, CLI_WRITE_URL_ENV, CLI_WRITE_TOKEN_ENV } from './cli-write-contract.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'notara-cli-broker-test-'));
  await mkdir(join(root, 'vault/知识'), { recursive: true });
  const note = join(root, 'vault/知识/原文.md');
  await writeFile(note, '---\ntype: topic\n---\n# 原文\n唯一段落\n');
  const ctx = new Context();
  const fs = new LocalFileSystem(ctx, { cwd: root, diffBasisMaxBytes: 1024 * 1024 });
  const spec = { sandboxPolicy: { mode: 'workspace-write', workspaceRoot: root }, dshEnv: { DSH_NOTARA_WORKSPACE: root, DSH_NOTARA_WORKSPACE_ID: 'synthetic-workspace', DSH_SESSION_ID: 'synthetic-session', DSH_NOTARA_CALL_ID: 'synthetic-call' } };
  const broker = await createCliWriteBroker(spec, { withFileSystem: (_root, signal, callback) => { signal.throwIfAborted(); return callback(fs); } });
  return { root, note, fs, spec, broker, async close() { await broker.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); } };
}
const edit = { files: [{ op: 'edit', path: '知识/原文.md', oldText: '唯一段落', newText: '修改后的段落' }] };

function headers(env) {
  return { 'content-type': 'application/json', authorization: `Bearer ${env[CLI_WRITE_TOKEN_ENV]}` };
}

async function rawWrite(env, body) {
  return new Promise((resolveResponse, reject) => {
    let received = false;
    const req = request(env[CLI_WRITE_URL_ENV], { method: 'POST', agent: false,
      headers: { ...headers(env), 'content-length': Buffer.byteLength(body) } }, res => {
      received = true;
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolveResponse({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', error => { if (!received) reject(error); });
    req.end(body);
  });
}

// The default HTTP server sends 100 Continue before dispatching the request.
// Receiving it is a transport barrier: the broker has synchronously admitted
// these headers before the client can open the next slow body request.
function slowBody(env) {
  const ready = Promise.withResolvers(), closed = Promise.withResolvers();
  const req = request(env[CLI_WRITE_URL_ENV], { method: 'POST', agent: false,
    headers: { ...headers(env), expect: '100-continue', 'content-length': 128 } }, res => res.resume());
  req.once('continue', () => { req.write('{'); ready.resolve(); });
  req.on('error', error => ready.reject(error));
  req.once('close', closed.resolve);
  // Attach the rejection handler now, including when another setup fails.
  const admitted = ready.promise;
  void admitted.catch(() => {});
  req.flushHeaders();
  return { admitted, async close() { req.destroy(); await closed.promise; } };
}

test('the scoped CLI bridge keeps normal write-batch receipts, conflict detection and workspace identity', async () => {
  const f = await fixture();
  try {
    const result = await requestCliWrite('write-batch', edit, f.broker.env);
    assert.equal(result.ok, true);
    assert.equal(result.result.savedCount, 1);
    assert.match(await readFile(f.note, 'utf8'), /修改后的段落/);
    const repeated = await requestCliWrite('write-batch', edit, f.broker.env);
    assert.equal(repeated.ok, false);
    assert.equal(repeated.result.results[0].error.code, 'batch_original_mismatch');
    await assert.rejects(requestCliWrite('write-batch', { files: [{ op: 'create', path: '../outside.md', content: '# forbidden' }] }, f.broker.env), /cli_write_unavailable/);
    assert.equal(await stat(join(f.root, 'outside.md')).then(() => true, () => false), false);
  } finally { await f.close(); }
});

test('raw requests cannot change scope, use browser origins, bypass the token or reach other commands', async () => {
  const f = await fixture();
  try {
    const url = f.broker.env[CLI_WRITE_URL_ENV];
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${f.broker.env[CLI_WRITE_TOKEN_ENV]}` };
    for (const [body, extraHeaders, status] of [
      [{ command: 'write-batch', args: edit, root: f.root }, {}, 400],
      [{ command: 'skill-save', args: { scope: 'global' } }, {}, 400],
      [{ command: 'write-batch', args: edit }, { origin: 'http://127.0.0.1' }, 403],
      [{ command: 'write-batch', args: edit }, { authorization: 'Bearer wrong' }, 403],
      [{ command: 'write-batch', args: edit }, { host: 'attacker.invalid' }, 403],
    ]) {
      const code = await new Promise((resolveResponse, reject) => {
        const req = request(url, { method: 'POST', headers: { ...headers, ...extraHeaders } }, res => { res.resume(); res.on('end', () => resolveResponse(res.statusCode)); });
        req.on('error', reject); req.end(JSON.stringify(body));
      });
      assert.equal(code, status);
    }
    assert.match(await readFile(f.note, 'utf8'), /唯一段落/);
    await f.broker.close();
    await assert.rejects(requestCliWrite('write-batch', edit, f.broker.env), /cli_write_unavailable/);
  } finally { await f.close(); }
});

test('read-only and mismatched Host bindings cannot mint a writable capability', async () => {
  const f = await fixture();
  try {
    const readOnly = await createCliWriteBroker({ ...f.spec, sandboxPolicy: { ...f.spec.sandboxPolicy, mode: 'read-only' } });
    assert.equal(readOnly.env[CLI_WRITE_URL_ENV], '');
    assert.equal(readOnly.env[CLI_WRITE_TOKEN_ENV], '');
    await readOnly.close();
    await assert.rejects(createCliWriteBroker({ ...f.spec, dshEnv: { ...f.spec.dshEnv, DSH_NOTARA_WORKSPACE: tmpdir() } }), /cli_write_scope_invalid/);
    await assert.rejects(createCliWriteBroker({ ...f.spec, dshEnv: { ...f.spec.dshEnv, DSH_SESSION_ID: '' } }), /cli_context_missing/);
  } finally { await f.close(); }
});

test('revocation aborts admitted work and drains it before close resolves', async () => {
  const f = await fixture();
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let signal;
  const broker = await createCliWriteBroker(f.spec, { withFileSystem: async (_root, current, callback) => {
    signal = current; entered.resolve(); await release.promise; current.throwIfAborted(); return callback(f.fs);
  } });
  try {
    const pending = requestCliWrite('write-batch', edit, broker.env);
    await entered.promise;
    let closed = false;
    const closing = broker.close().then(() => { closed = true; });
    assert.equal(signal.aborted, true);
    await Promise.resolve(); assert.equal(closed, false);
    release.resolve();
    assert.equal((await pending).ok, false);
    await closing;
    assert.match(await readFile(f.note, 'utf8'), /唯一段落/);
  } finally { release.resolve(); await broker.close(); await f.close(); }
});

test('eight unfinished authenticated bodies occupy all slots and the ninth request is rejected', { timeout: 5000 }, async () => {
  const f = await fixture(), held = [];
  try {
    for (let i = 0; i < 8; i++) {
      const slow = slowBody(f.broker.env); held.push(slow); await slow.admitted;
    }
    const response = await rawWrite(f.broker.env, JSON.stringify({ command: 'write-batch', args: edit }));
    assert.equal(response.status, 429);
    assert.equal(response.body.error, 'cli_write_busy');
    assert.match(await readFile(f.note, 'utf8'), /唯一段落/);
  } finally {
    await Promise.all(held.map(slow => slow.close()));
    await f.close();
  }
});

test('disconnecting an unfinished body releases its slot for a subsequent valid write', { timeout: 5000 }, async () => {
  const f = await fixture(), held = [];
  try {
    for (let i = 0; i < 8; i++) {
      const slow = slowBody(f.broker.env); held.push(slow); await slow.admitted;
    }
    const body = JSON.stringify({ command: 'write-batch', args: edit });
    assert.equal((await rawWrite(f.broker.env, body)).status, 429);
    await held[0].close();
    // Client close and server-side close are distinct events. Observe the
    // released capacity through bounded HTTP responses, never a fixed sleep.
    const deadline = Date.now() + 1000;
    let response;
    do {
      response = await rawWrite(f.broker.env, body);
      if (response.status !== 429) break;
      await delay(5);
    } while (Date.now() < deadline);
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.result.savedCount, 1);
    assert.match(await readFile(f.note, 'utf8'), /修改后的段落/);
  } finally {
    await Promise.all(held.map(slow => slow.close()));
    await f.close();
  }
});

test('an oversized body is capped before execution and the rejected request releases capacity', { timeout: 5000 }, async () => {
  const f = await fixture(), held = [];
  try {
    for (let i = 0; i < 7; i++) {
      const slow = slowBody(f.broker.env); held.push(slow); await slow.admitted;
    }
    const body = JSON.stringify({ command: 'write-batch', args: { files: [{ op: 'create', path: '知识/过大.md', content: 'x'.repeat(CLI_WRITE_LIMIT) }] } });
    assert.ok(Buffer.byteLength(body) > CLI_WRITE_LIMIT);
    const response = await rawWrite(f.broker.env, body);
    assert.equal(response.status, 413);
    assert.equal(response.body.error, 'cli_stdin_too_large');
    assert.equal(await stat(join(f.root, 'vault/知识/过大.md')).then(() => true, () => false), false);
    assert.match(await readFile(f.note, 'utf8'), /唯一段落/);
    const accepted = await rawWrite(f.broker.env, JSON.stringify({ command: 'write-batch', args: edit }));
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.ok, true);
  } finally {
    await Promise.all(held.map(slow => slow.close()));
    await f.close();
  }
});
