import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { CLI_WRITE_COMMANDS, CLI_WRITE_LIMIT, CLI_WRITE_PATH, CLI_WRITE_URL_ENV, CLI_WRITE_TOKEN_ENV, CLI_WRITE_MODE_ENV } from './cli-write-contract.js';
import { validateArgs, runCommand, describe } from './vault-cli.js';

// Serializes native CLI writes from overlapping shell calls to the same root.
// It never grants a capability: every queued request rechecks its own lifetime.
const workspaceQueues = new Map();
function serialized(root, operation) {
  const key = process.platform === 'win32' ? root.toLowerCase() : root;
  const previous = workspaceQueues.get(key) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(operation);
  const tail = result.catch(() => {});
  workspaceQueues.set(key, tail);
  void tail.finally(() => { if (workspaceQueues.get(key) === tail) workspaceQueues.delete(key); });
  return result;
}
const permitted = new Set(CLI_WRITE_COMMANDS);
const identityKeys = ['DSH_NOTARA_WORKSPACE', 'DSH_NOTARA_WORKSPACE_ID', 'DSH_SESSION_ID', 'DSH_NOTARA_CALL_ID'];
const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;

/**
 * Only the resolved native shell policy and Host-produced dshEnv authorize this
 * bridge. The request carries a command and its schema-validated arguments;
 * identity, workspace, policy and filesystem implementation are never inputs.
 */
export async function createCliWriteBroker(spec, { withFileSystem = async (root, signal, callback) => (await import('./windows-cli-fs.js')).withWindowsCliFileSystem(root, signal, callback) } = {}) {
  const mode = spec.sandboxPolicy?.mode;
  const emptyEnv = { [CLI_WRITE_URL_ENV]: '', [CLI_WRITE_TOKEN_ENV]: '', [CLI_WRITE_MODE_ENV]: mode ?? 'read-only' };
  const inert = { env: emptyEnv, revoke() {}, async close() {} };
  if (mode !== 'workspace-write') return inert;
  const injected = spec.dshEnv ?? {};
  if (!injected.DSH_NOTARA_WORKSPACE) return inert;
  if (identityKeys.some(key => typeof injected[key] !== 'string' || !injected[key])) throw new Error('cli_context_missing');
  const policyRoot = spec.sandboxPolicy.workspaceRoot;
  if (typeof policyRoot !== 'string' || !isAbsolute(policyRoot) || !isAbsolute(injected.DSH_NOTARA_WORKSPACE)) throw new Error('cli_write_scope_invalid');
  const [root, boundRoot] = await Promise.all([realpath(resolve(policyRoot)), realpath(resolve(injected.DSH_NOTARA_WORKSPACE))]);
  if (!samePath(root, boundRoot)) throw new Error('cli_write_scope_invalid');
  const env = Object.freeze(Object.fromEntries(identityKeys.map(key => [key, key === 'DSH_NOTARA_WORKSPACE' ? root : injected[key]])));
  const token = randomBytes(32).toString('hex');
  const authorization = Buffer.from(`Bearer ${token}`);
  const controller = new AbortController();
  const active = new Set();
  let alive = true, host, admitted = 0;
  const reply = (res, status, value) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', connection: 'close' });
    res.end(JSON.stringify(value));
  };
  const server = createServer((req, res) => {
    const presented = Buffer.from(req.headers.authorization ?? '');
    if (!alive || req.method !== 'POST' || req.url !== CLI_WRITE_PATH || req.headers.host !== host || req.headers.origin !== undefined || req.headers['content-type'] !== 'application/json' || presented.length !== authorization.length || !timingSafeEqual(presented, authorization)) { reply(res, 403, { error: 'cli_write_denied' }); return; }
    if (admitted >= 8) { reply(res, 429, { error: 'cli_write_busy' }); return; }
    admitted++;
    let submitted = false, released = false;
    const releaseSlot = () => { if (!released) { released = true; admitted--; } };
    const requestAbort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) requestAbort.abort(); if (!submitted) releaseSlot(); });
    const signal = AbortSignal.any([controller.signal, requestAbort.signal]);
    const chunks = []; let size = 0;
    req.setTimeout(5000, () => req.destroy());
    req.on('error', () => { requestAbort.abort(); if (!submitted) releaseSlot(); });
    req.on('data', chunk => {
      size += chunk.length;
      if (size > CLI_WRITE_LIMIT) { requestAbort.abort(); reply(res, 413, { error: 'cli_stdin_too_large' }); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      req.setTimeout(0);
      if (signal.aborted || !alive) { reply(res, 403, { error: 'cli_write_denied' }); return; }
      let command, args;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'args,command' || !permitted.has(body.command)) throw new Error('cli_write_denied');
        command = body.command;
        args = validateArgs(command, body.args);
      } catch { reply(res, 400, { error: 'cli_write_invalid' }); return; }
      submitted = true;
      const pending = serialized(root, async () => {
        signal.throwIfAborted();
        if (!alive) throw new Error('cli_write_denied');
        return withFileSystem(root, signal, fs => runCommand(command, args, { fs, root, env, signal }));
      }).then(result => reply(res, 200, { ok: command !== 'write-batch' || result.failedCount === 0, command, result }), error => reply(res, 200, { ok: false, command, error: describe(error) }));
      active.add(pending);
      void pending.finally(() => { releaseSlot(); active.delete(pending); });
    });
  });
  server.requestTimeout = 65_000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 20;
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => { server.off('error', rejectListen); resolveListen(); });
  });
  server.unref();
  host = `127.0.0.1:${server.address().port}`;
  const revoke = () => {
    if (!alive) return;
    alive = false;
    controller.abort();
    server.close();
    server.closeIdleConnections();
  };
  let closing;
  const close = () => closing ??= (async () => {
    revoke();
    await Promise.allSettled([...active]);
    server.closeAllConnections();
    spec.signal?.removeEventListener('abort', revoke);
  })();
  spec.signal?.addEventListener('abort', revoke, { once: true });
  if (spec.signal?.aborted) { await close(); spec.signal.throwIfAborted(); }
  return { env: { ...emptyEnv, [CLI_WRITE_URL_ENV]: `http://${host}${CLI_WRITE_PATH}`, [CLI_WRITE_TOKEN_ENV]: token }, revoke, close };
}
