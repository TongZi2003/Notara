import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Worker settings shared by every lesson on this machine: a worker's model,
 * reasoning, budget, reading scope and persona live next to the model
 * credentials (DSH_HOME), so a new lesson starts from them. A lesson may still
 * override one worker for itself; that override is a session event.
 */
export const workerDefaultsPath = (env = process.env) => env.DSH_HOME ? join(env.DSH_HOME, 'notara-workers.json') : null;

const EMPTY = Object.freeze({ revision: 0, presets: Object.freeze({}) });
const fail = code => { throw new Error(code); };
const windowsRenameDelays = [20, 40, 80, 160, 240];
const retryableRenameCodes = new Set(['EPERM', 'EACCES', 'EBUSY']);

function parse(text) {
  let value;
  try { value = JSON.parse(text); } catch { return EMPTY; }
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.presets || typeof value.presets !== 'object' || Array.isArray(value.presets)) return EMPTY;
  return { revision: value.revision, presets: value.presets };
}

/** Read the shared defaults; a missing or unreadable file is "nothing saved yet". */
export async function readWorkerDefaults(path) {
  if (!path) return EMPTY;
  try { return parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return EMPTY; throw error; }
}

const locks = new Map();
async function renameWorkerDefaultsWithRetry(temporary, path, { platform = process.platform, renameFile = rename, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}, beforeRetry = async () => {}) {
  let firstSharingError;
  for (let attempt = 0; ; attempt++) {
    try { await renameFile(temporary, path); return; }
    catch (error) {
      if (platform !== 'win32' || !retryableRenameCodes.has(error?.code ?? '')) throw error;
      firstSharingError ??= error;
      if (attempt >= windowsRenameDelays.length) throw firstSharingError;
      await pause(windowsRenameDelays[attempt]);
      await beforeRetry();
    }
  }
}

/**
 * Replace one preset's defaults (`null` removes them) when the file is still at
 * `expectedRevision`. The write is a rename, so a reader never sees half a file.
 * Filesystem overrides are an internal seam for deterministic rename-failure tests.
 */
export async function writeWorkerDefault(path, expectedRevision, preset, value, filesystem = {}) {
  if (!path) fail('solver_defaults_unavailable');
  const previous = locks.get(path) ?? Promise.resolve();
  const work = previous.catch(() => {}).then(async () => {
    const current = await readWorkerDefaults(path);
    if (current.revision !== expectedRevision) fail('solver_settings_conflict');
    const presets = { ...current.presets };
    if (value === null) delete presets[preset]; else presets[preset] = value;
    const next = { revision: current.revision + 1, presets };
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await renameWorkerDefaultsWithRetry(temporary, path, filesystem, async () => {
        const latest = await readWorkerDefaults(path);
        if (latest.revision !== expectedRevision) fail('solver_settings_conflict');
      });
    }
    finally { await rm(temporary, { force: true }); }
    return next;
  });
  locks.set(path, work);
  try { return await work; } finally { if (locks.get(path) === work) locks.delete(path); }
}
