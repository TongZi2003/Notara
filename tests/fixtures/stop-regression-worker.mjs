import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import lockfile from 'proper-lockfile';

const audit = globalThis.__notaraOwnedStopAudit;
assert(audit, 'Start with stop-regression-preload.mjs before the TS loader');
assert.equal(process.platform, 'win32', 'This regression specifically exercises Windows taskkill');
const base = resolve(process.argv[2]);
await mkdir(base, { recursive: true });
const root = await mkdtemp(join(base, 'persistent-stop-proof-'));
audit.root = root;
function assertOwnedRoot() {
  const path = relative(base, resolve(root));
  assert(path && !path.startsWith('..') && !isAbsolute(path), 'Fixture must remain inside its dedicated audit directory');
}
async function until(predicate, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await delay(10);
  }
}
let runtime;
let cleanupSafe = false;
const started = Date.now();
try {
  const { startVaultPersistent } = await import('../../scripts/dev-native-vault.ts');
  // One real pinned Host, synthetic adapter, random usable loopback port, and
  // only this freshly created runtime. No ngrok or account calls are involved.
  runtime = await startVaultPersistent(root, { port: 0, testModel: true });
  const record = JSON.parse(await readFile(join(root, 'launcher.json'), 'utf8'));
  audit.pid = record.pid;
  assert(Number.isInteger(audit.pid) && audit.pid > 0 && audit.pid !== process.pid);
  const sentinel = join(root, 'workspace', 'synthetic-learning-sentinel.txt');
  await writeFile(sentinel, 'Keep the synthetic learning record exactly intact.');
  audit.unlinkMode = 'always';
  const firstStop = runtime.stop();
  // Attach rejection handling immediately; the deliberate cleanup failure
  // must not create an unhandled rejection while event gates are observed.
  const firstOutcome = firstStop.then(() => ({ success: true }), error => ({ error }));
  const concurrentOutcome = runtime.stop().then(() => ({ success: true }), error => ({ error }));
  await until(() => typeof audit.killRelease === 'function', 'the completed owned taskkill callback');
  assert.equal(audit.killCalls, 1, 'Concurrent Stop must share one tree termination');
  assert.equal(audit.rmCalls.length, 0, 'Never remove the launcher before the owned taskkill callback finishes');
  assert.equal(await lockfile.check(root, { stale: 10_000 }), true, 'Runtime ownership remains held during termination');
  await readFile(join(root, 'launcher.json'));
  audit.killRelease();
  const failed = await firstOutcome;
  assert.equal(failed.error?.code, 'EBUSY', 'Persistent sharing violations must reject Stop');
  assert.equal((await concurrentOutcome).error?.code, 'EBUSY');
  assert(audit.unlinkAttempts >= 9, 'Use the real Node recursive rm retry loop before rejecting');
  assert.equal(audit.rmCalls.length, 1, 'Concurrent Stop must share the rm operation too');
  assert.deepEqual(audit.rmCalls[0].options, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  assert.equal(audit.rmCalls[0].callbackHeld, false);
  assert.equal(await lockfile.check(root, { stale: 10_000 }), true, 'Failed Stop must keep the persistent root lock');
  await assert.rejects(runtime.restart(), /already stopping/);
  // The attempted second launcher must fail at the genuine root lock, before
  // any additional Host is started. This proves the public API is closed.
  await assert.rejects(startVaultPersistent(root, { port: 0, testModel: true }), error => error.code === 'ELOCKED');
  assert.equal(await readFile(sentinel, 'utf8'), 'Keep the synthetic learning record exactly intact.');
  const previousAttempts = audit.unlinkAttempts;
  const previousBusy = audit.injectedBusy;
  audit.unlinkMode = 'once';
  await runtime.stop();
  assert.equal(audit.injectedBusy, previousBusy + 1, 'One additional transient sharing violation was injected');
  assert(audit.unlinkAttempts >= previousAttempts + 2, 'The next Stop must retry the transient error and succeed');
  assert.equal(audit.killCalls, 1, 'Never submit a new taskkill for the exited child PID');
  assert.equal(await lockfile.check(root, { stale: 10_000 }), false, 'Release persistent ownership only after cleanup succeeds');
  await assert.rejects(readFile(join(root, 'launcher.json')), { code: 'ENOENT' });
  assert.equal(await readFile(sentinel, 'utf8'), 'Keep the synthetic learning record exactly intact.');
  await assert.rejects(runtime.restart(), /already stopping/);
  cleanupSafe = true;
  console.log(JSON.stringify({ result: 'PASS', actualHostCount: 1, taskkillCalls: audit.killCalls, rmCalls: audit.rmCalls.length, injectedBusy: audit.injectedBusy, unlinkAttempts: audit.unlinkAttempts, elapsedMs: Date.now() - started }));
} finally {
  audit.holdKill = false;
  audit.unlinkMode = 'off';
  audit.killRelease?.();
  if (runtime) {
    try { await runtime.stop(); cleanupSafe = true; }
    catch (error) { console.error(`Retaining owned fixture because cleanup remains uncertain: ${root}`); throw error; }
  } else {
    cleanupSafe = !(await lockfile.check(root, { stale: 10_000 }).catch(error => { if (error.code === 'ENOENT') return false; throw error; }));
  }
  if (cleanupSafe) {
    assertOwnedRoot();
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
}
