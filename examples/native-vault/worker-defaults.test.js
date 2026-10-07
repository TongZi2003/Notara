import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWorkerDefaults, writeWorkerDefault } from './worker-defaults.js';

async function settingsFile(t) {
  const directory = await mkdtemp(join(tmpdir(), 'notara-worker-defaults-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'notara-workers.json');
}

async function temporarySiblings(path) {
  const files = await readdir(join(path, '..'));
  return files.filter(name => name.startsWith(`${path.split(/[\\/]/).at(-1)}.`) && name.endsWith('.tmp'));
}

test('worker defaults retries transient Windows rename sharing errors on the same staged file', async t => {
  const path = await settingsFile(t);
  await writeWorkerDefault(path, 0, 'problem', { probe: 0 });
  const calls = [], delays = [];
  const saved = await writeWorkerDefault(path, 1, 'problem', { probe: 1 }, {
    platform: 'win32',
    async renameFile(temporary, destination) {
      calls.push([temporary, destination]);
      if (calls.length <= 2) throw Object.assign(new Error('transient sharing violation'), { code: 'EPERM' });
      await rename(temporary, destination);
    },
    async pause(milliseconds) { delays.push(milliseconds); },
  });

  assert.equal(saved.revision, 2);
  assert.deepEqual(delays, [20, 40]);
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map(([temporary]) => temporary)).size, 1, 'the exact same complete temp is retried');
  assert.equal(new Set(calls.map(([, destination]) => destination)).size, 1);
  assert.deepEqual(await readWorkerDefaults(path), { revision: 2, presets: { problem: { probe: 1 } } });
  assert.deepEqual(await temporarySiblings(path), [], 'successful publish leaves no temp sibling');
});

test('permanent Windows sharing errors stop after the bounded retry budget and preserve the old file', async t => {
  const path = await settingsFile(t);
  await writeWorkerDefault(path, 0, 'problem', { probe: 0 });
  const original = await readFile(path, 'utf8');
  const delays = [], attempts = [];
  const sharingError = Object.assign(new Error('still locked'), { code: 'EPERM' });

  await assert.rejects(writeWorkerDefault(path, 1, 'problem', { probe: 1 }, {
    platform: 'win32',
    async renameFile(temporary, destination) { attempts.push([temporary, destination]);throw sharingError; },
    async pause(milliseconds) { delays.push(milliseconds); },
  }), error => error === sharingError);

  assert.equal(attempts.length, 6, 'initial attempt plus five bounded retries');
  assert.deepEqual(delays, [20, 40, 80, 160, 240]);
  assert.equal(new Set(attempts.map(([temporary]) => temporary)).size, 1);
  assert.equal(await readFile(path, 'utf8'), original, 'failed publish never unlinks or changes the destination');
  assert.deepEqual(await temporarySiblings(path), [], 'failed publish cleans the staged sibling');
});

test('non-sharing rename failures propagate immediately without retrying', async t => {
  const path = await settingsFile(t);
  await writeWorkerDefault(path, 0, 'problem', { probe: 0 });
  const original = await readFile(path, 'utf8');
  const failure = Object.assign(new Error('disk failure'), { code: 'EIO' });
  let attempts = 0, pauses = 0;

  await assert.rejects(writeWorkerDefault(path, 1, 'problem', { probe: 1 }, {
    platform: 'win32',
    async renameFile() { attempts++;throw failure; },
    async pause() { pauses++; },
  }), error => error === failure);

  assert.equal(attempts, 1);
  assert.equal(pauses, 0);
  assert.equal(await readFile(path, 'utf8'), original);
  assert.deepEqual(await temporarySiblings(path), []);
});

test('a revision changed by another Host during backoff aborts before retrying the rename', async t => {
  const path = await settingsFile(t);
  await writeWorkerDefault(path, 0, 'problem', { probe: 'original' });
  const attempts = [], delays = [];
  const externalValue = { revision: 2, presets: { problem: { probe: 'other-host-update' } } };

  await assert.rejects(writeWorkerDefault(path, 1, 'problem', { probe: 'stale-writer' }, {
    platform: 'win32',
    async renameFile(temporary, destination) {
      attempts.push([temporary, destination]);
      throw Object.assign(new Error('transient sharing violation'), { code: 'EPERM' });
    },
    async pause(milliseconds) {
      delays.push(milliseconds);
      const staged = `${path}.external`;
      await writeFile(staged, `${JSON.stringify(externalValue)}\n`);
      await rename(staged, path);
    },
  }), /solver_settings_conflict/);

  assert.equal(attempts.length, 1, 'the stale temp is never published after another Host advances the revision');
  assert.deepEqual(delays, [20]);
  assert.deepEqual(await readWorkerDefaults(path), externalValue);
  assert.deepEqual(await temporarySiblings(path), [], 'the abandoned stale temp is cleaned');
});

test('same-process writes stay queued and the second revision check rejects a stale concurrent writer', async t => {
  const path = await settingsFile(t);
  await writeWorkerDefault(path, 0, 'problem', { probe: 0 });
  const results = await Promise.allSettled([
    writeWorkerDefault(path, 1, 'problem', { writer: 'a' }),
    writeWorkerDefault(path, 1, 'problem', { writer: 'b' }),
  ]);

  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.message, 'solver_settings_conflict');
  assert.equal((await readWorkerDefaults(path)).revision, 2);
  assert.deepEqual(await temporarySiblings(path), []);
});
