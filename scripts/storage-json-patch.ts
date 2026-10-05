import { createHash } from 'node:crypto';

// DSH 0.2.0-rc.1 writes a complete, fsynced same-directory temp file before
// replacing workspace.json. A short-lived Windows reader can block only the
// rename. Keep that exact temp file and retry only the publish operation.
const retryRename = `async function notaraRenameAtomicWithRetry(tmp, path, renameFile = rename, platform = process.platform, pause = (ms) => new Promise((done) => setTimeout(done, ms))) {
\tconst delays = [20, 40, 80, 160, 240];
\tlet firstSharingError;
\tfor (let attempt = 0;; attempt++) {
\t\ttry {
\t\t\tawait renameFile(tmp, path);
\t\t\treturn;
\t\t} catch (error) {
\t\t\tif (platform !== "win32" || error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
\t\t\tfirstSharingError ??= error;
\t\t\tif (attempt >= delays.length) throw firstSharingError;
\t\t\tawait pause(delays[attempt]);
\t\t}
\t}
}`;

const beforeFunction = 'async function writeAtomic(path, data) {';
const beforeRename = '\t\tawait rename(tmp, path);';
const afterRename = '\t\tawait notaraRenameAtomicWithRetry(tmp, path);';
const afterFunction = `${retryRename}\n${beforeFunction}`;

/** Exact locked package artifact and the sole permitted transformation. */
export const STORAGE_JSON_PATCH = Object.freeze({
  artifact: '@deepseek-ai/dsh-storage-json/lib/index.js',
  originalSha: '0a6b75d5569db3379edd93e863570170e1f4121b6c9fabd856f5b476cffe8df4',
  patchedSha: '80d05f846065eb37902eec40d3e97f2306b609b080f1230567dad0c5e9d13080',
  retryRename,
});
const sha = (source: string): string => createHash('sha256').update(source).digest('hex');

/** Idempotent, fail-closed patch. No payload rewrite, target deletion or RPC retry. */
export function patchStorageJson(source: string): string {
  const digest = sha(source);
  if (digest === STORAGE_JSON_PATCH.patchedSha) return source;
  if (digest !== STORAGE_JSON_PATCH.originalSha) throw new Error('Unknown DSH JSON storage artifact; review atomic rename patch');
  if (source.split(beforeFunction).length !== 2 || source.split(beforeRename).length !== 2) throw new Error('DSH JSON atomic rename patch anchor changed');
  const patched = source.replace(beforeFunction, afterFunction).replace(beforeRename, afterRename);
  if (sha(patched) !== STORAGE_JSON_PATCH.patchedSha) throw new Error('DSH JSON atomic rename patch digest mismatch');
  return patched;
}
