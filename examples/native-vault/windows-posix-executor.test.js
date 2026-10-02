import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WindowsPosixExecutor from './windows-posix-executor.js';

async function fixture({ mode = 'workspace-write', confineError, stderr = '' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'notara-posix-unit-'));
  const ctx = new Context();
  const confined = [], spawned = [];
  const reader = text => {
    const bytes = Buffer.from(text, 'utf8');
    return { readFrom: offset => ({ text: bytes.subarray(offset).toString('utf8'), lossy: false, nextOffset: bytes.length }) };
  };
  const processDone = Promise.withResolvers();
  Object.assign(new Service(ctx, 'subprocess'), { spawn(spec) { spawned.push(spec); return { collected: { stdout: reader(''), stderr: reader(stderr) }, done: processDone.promise, terminate() { processDone.resolve({ exitCode: 1, signal: null }); } }; } });
  Object.assign(new Service(ctx, 'sandboxPolicy'), { defaultMode: mode, resolve: () => ({ mode, workspaceRoot: root }) });
  Object.assign(new Service(ctx, 'sandbox'), { async confine(argv, policy, signal) {
    confined.push({ argv, policy, signal });
    if (confineError) throw confineError;
    return { argv: [process.execPath, ...argv], enforcement: 'fake-native-boundary', denialSignatures: [], runnerFailureRules: [] };
  } });
  const previous = process.env.NOTARA_WINDOWS_POSIX;
  process.env.NOTARA_WINDOWS_POSIX = process.execPath;
  let executor;
  try {
    const config = Object.fromEntries(Object.entries({ cwd: root, timeoutMs: 60000, maxTimeoutMs: 600000, maxOutputBytes: 64000, maxSpillBytes: 1024 * 1024, graceMs: 3000 }).map(([key, value]) => [key, { get: () => value }]));
    executor = new WindowsPosixExecutor(ctx, config);
  } finally {
    if (previous === undefined) delete process.env.NOTARA_WINDOWS_POSIX;
    else process.env.NOTARA_WINDOWS_POSIX = previous;
  }
  executor.scripts = join(root, 'scripts');
  const close = async () => { processDone.resolve({ exitCode: 0, signal: null }); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); };
  return { root, executor, confined, spawned, processDone, close };
}

for (const mode of ['read-only', 'workspace-write', 'danger-full-access']) test(`${mode} keeps native confinement, budgets and per-call environment through a private long script`, async () => {
  const f = await fixture({ mode });
  try {
    const command = "cat <<'JSON'\n中文 \"引号\" $literal\nJSON\n: " + 'x'.repeat(40000);
    const execution = await f.executor.execute(f.executor.resolve({ command, stdoutMaxBytes: 1234, env: { BB_OVERRIDE_APPLETS: 'grep sed' }, dshEnv: { DSH_NOTARA_CALL_ID: 'host-owned-call' } }));
    assert.equal(f.spawned.length, 1);
    const spawn = f.spawned[0];
    const argv = mode === 'danger-full-access' ? spawn.argv : spawn.argv.slice(1);
    assert.deepEqual(argv.slice(0, 2), [process.execPath, 'ash']);
    assert.equal(await readFile(argv[2], 'utf8'), command);
    assert.equal(spawn.env.DSH_NOTARA_CALL_ID, 'host-owned-call');
    assert.equal(spawn.env.BB_OVERRIDE_APPLETS, '');
    assert.equal(spawn.env.PYTHONUTF8, '1');
    assert.equal(spawn.stdio.stdout.maxBytes, 1234);
    assert.equal(spawn.graceMs, 3000);
    assert.equal(f.confined.length, mode === 'danger-full-access' ? 0 : 1);
    if (f.confined.length) assert.deepEqual(f.confined[0].policy, { mode, workspaceRoot: f.root });
    f.processDone.resolve({ exitCode: 0, signal: null });
    assert.equal((await execution.result()).sandbox.mode, mode);
    assert.deepEqual(await readdir(f.executor.scripts), []);
  } finally { await f.close(); }
});

test('per-call resources revoke and drain before either result or background completion settles', async () => {
  const f = await fixture();
  const revoked = Promise.withResolvers(), drained = Promise.withResolvers();
  try {
    f.executor.prepareCommand = async spec => ({ command: spec.command, env: { DSH_NOTARA_WRITE_TOKEN: 'synthetic-call-secret' }, dispose: async () => { revoked.resolve(); await drained.promise; } });
    const execution = await f.executor.execute(f.executor.resolve({ command: 'echo done', dshEnv: { DSH_NOTARA_CALL_ID: 'call-1' } }));
    assert.equal(f.spawned[0].env.DSH_NOTARA_WRITE_TOKEN, 'synthetic-call-secret');
    assert.equal(f.spawned[0].env.DSH_NOTARA_CALL_ID, 'call-1');
    let done = false, result = false;
    const completion = execution.done.then(() => { done = true; });
    const receipt = execution.result().then(() => { result = true; });
    f.processDone.resolve({ exitCode: 0, signal: null });
    await revoked.promise;
    await Promise.resolve();
    assert.equal(done, false);
    assert.equal(result, false);
    drained.resolve();
    await Promise.all([completion, receipt]);
    assert.deepEqual(await readdir(f.executor.scripts), []);
  } finally { drained.resolve(); await f.close(); }
});

test('confinement preparation failure disposes per-call resources and removes the script', async () => {
  const failure = new Error('synthetic confinement failure');
  const f = await fixture({ confineError: failure });
  let disposed = false;
  try {
    f.executor.prepareCommand = async spec => ({ command: spec.command, dispose: async () => { disposed = true; } });
    await assert.rejects(f.executor.execute(f.executor.resolve({ command: 'echo never-ran' })), error => error === failure);
    assert.equal(disposed, true);
    assert.deepEqual(await readdir(f.executor.scripts), []);
    assert.equal(f.spawned.length, 0);
  } finally { await f.close(); }
});

test('dispose failure reaches background exit facts and both native error readers without rejecting done', async () => {
  const f = await fixture({ stderr: 'native stderr\n' });
  const failure = new Error('synthetic secret that must not enter background output');
  try {
    f.executor.prepareCommand = async spec => ({ command: spec.command, dispose: async () => { throw failure; } });
    const execution = await f.executor.execute(f.executor.resolve({ command: 'echo done' }));
    const before = execution.observed.stderr.readFrom(0);
    assert.equal(before.text, 'native stderr\n');
    assert.equal(execution.readOutput().delta, '[stderr]\nnative stderr\n');
    f.processDone.resolve({ exitCode: 0, signal: null });
    await execution.done;
    assert.equal(execution.status, 'completed');
    assert.equal(execution.exitCode, 1);
    assert.equal(execution.signal, null);
    const diagnostic = execution.observed.stderr.readFrom(before.nextOffset);
    assert.match(diagnostic.text, /per-call resource cleanup failed/);
    assert.doesNotMatch(diagnostic.text, /synthetic secret/);
    assert.equal(execution.observed.stderr.readFrom(diagnostic.nextOffset).text, '');
    assert.match(execution.observed.stderr.readFrom(0).text, /^native stderr\n\nnotara-windows-posix:/);
    assert.match(execution.readOutput().delta, /^\[stderr\]\nnotara-windows-posix: per-call resource cleanup failed/);
    assert.equal(execution.readOutput().delta, '');
    await assert.rejects(execution.result(), error => error.cause === failure && /per-call resource cleanup failed/.test(error.message));
    assert.deepEqual(await readdir(f.executor.scripts), []);
  } finally { await f.close(); }
});

test('private directory cleanup failure cannot become a successful background outcome', async () => {
  const f = await fixture();
  try {
    const execution = await f.executor.execute(f.executor.resolve({ command: 'echo done' }));
    const directory = (await readdir(f.executor.scripts))[0];
    await writeFile(join(f.executor.scripts, directory, 'synthetic-leftover'), 'fixture');
    f.processDone.resolve({ exitCode: 0, signal: null });
    await execution.done;
    assert.equal(execution.exitCode, 1);
    assert.match(execution.observed.stderr.readFrom(0).text, /per-call resource cleanup failed/);
    await assert.rejects(execution.result(), /per-call resource cleanup failed/);
    assert.deepEqual(await readdir(join(f.executor.scripts, directory)), ['synthetic-leftover']);
  } finally { await f.close(); }
});

test('cleanup errors preserve an existing command failure or native signal termination', async () => {
  for (const outcome of [{ exitCode: 7, signal: null, status: 'completed' }, { exitCode: null, signal: 'SIGTERM', status: 'killed' }]) {
    const f = await fixture();
    try {
      f.executor.prepareCommand = async spec => ({ command: spec.command, dispose: async () => { throw new Error('synthetic cleanup failure'); } });
      const execution = await f.executor.execute(f.executor.resolve({ command: 'echo done' }));
      f.processDone.resolve(outcome);
      await execution.done;
      assert.equal(execution.status, outcome.status);
      assert.equal(execution.exitCode, outcome.exitCode);
      assert.equal(execution.signal, outcome.signal);
      assert.match(execution.observed.stderr.readFrom(0).text, /per-call resource cleanup failed/);
      await assert.rejects(execution.result(), /per-call resource cleanup failed/);
    } finally { await f.close(); }
  }
});
