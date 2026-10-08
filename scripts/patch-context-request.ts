import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const live = '\t\t\tconst live = new AssistantStreamAttempt';
const legacyAdmission = `\t\t\tconst requestCheck = await this.dispatch.waterfall("agent/request-check", { request, turn, step, signal }, () => Promise.resolve({ kind: "ready" }));
\t\t\tsignal.throwIfAborted();
\t\t\tif (requestCheck.kind === "retry") {
\t\t\t\tif (++requestCheckRetries > 4) throw new LlmError("request check retry limit", "NOTARA_CONTEXT_BUDGET_EXCEEDED");
\t\t\t\tcontinue;
\t\t\t}
\t\t\tif (requestCheck.kind !== "ready") throw new LlmError("invalid request check", "INVALID_REQUEST_CHECK");
${live}`;
export const CONTEXT_REQUEST_PATCH = Object.freeze({
  artifact: '@deepseek-ai/dsh-agent-loop/lib/index.js',
  originalSha: '00c4814d63f3d1e2754eb09144832d19b30499d6ea444730473f740b587948c2',
  patchedSha: '81773ab07b4ac4efb6918061cc77f743e29f9c64a78adb9cb985daff2810d106',
  changes: [
    { before: 'let firstAttempt = true;', after: 'let firstAttempt = true;\n\t\tlet requestCheckRetries = 0;\n\t\tlet forceRequestSeries = false;' },
    { before: 'const startsRequestSeries = firstAttempt && decision.startsRequestSeries === true;',
      after: 'const startsRequestSeries = (firstAttempt && decision.startsRequestSeries === true) || forceRequestSeries;\n\t\t\tforceRequestSeries = false;' },
    { before: live, after: `\t\t\tconst requestCheck = await this.dispatch.waterfall("agent/request-check", { request, turn, step, signal }, () => Promise.resolve({ kind: "ready" }));
\t\t\tsignal.throwIfAborted();
\t\t\tif (requestCheck.kind === "retry") {
\t\t\t\tforceRequestSeries = requestCheck.startsRequestSeries === true;
\t\t\t\tif (++requestCheckRetries > 4) throw new LlmError("request check retry limit", "NOTARA_CONTEXT_BUDGET_EXCEEDED");
\t\t\t\tcontinue;
\t\t\t}
\t\t\tif (requestCheck.kind !== "ready") throw new LlmError("invalid request check", "INVALID_REQUEST_CHECK");
${live}` },
  ],
});
const sha = (source: string): string => createHash('sha256').update(source).digest('hex');

/** Adds a bounded, read-only request admission seam before an assistant attempt or provider I/O exists. */
export function patchContextRequest(source: string): string {
  if (sha(source) === CONTEXT_REQUEST_PATCH.patchedSha) return source;
  // Upgrade the exact earlier unreleased admission patch; no arbitrary artifacts.
  if (sha(source) === 'ead610163eca9169dfb4cf81f82552b50986b750c7bf2555d78a3cf846e48e0e') {
    source = source.replace(legacyAdmission, live).replace('let firstAttempt = true;\n\t\tlet requestCheckRetries = 0;', 'let firstAttempt = true;');
  }
  if (sha(source) !== CONTEXT_REQUEST_PATCH.originalSha) throw new Error('Unknown DSH agent-loop artifact; review context request admission');
  let result = source;
  for (const { before, after } of CONTEXT_REQUEST_PATCH.changes) {
    if (result.split(before).length !== 2) throw new Error('DSH context request anchor changed');
    result = result.replace(before, after);
  }
  if (sha(result) !== CONTEXT_REQUEST_PATCH.patchedSha) throw new Error('DSH context request patch digest mismatch');
  return result;
}

export function applyContextRequestPatch(): void {
  const file = fileURLToPath(new URL(`../node_modules/${CONTEXT_REQUEST_PATCH.artifact}`, import.meta.url));
  const source = readFileSync(file, 'utf8');
  const patched = patchContextRequest(source);
  if (source !== patched) writeFileSync(file, patched);
  console.log('Verified DSH context request admission patch');
}
