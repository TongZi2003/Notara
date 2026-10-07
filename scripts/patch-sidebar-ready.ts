import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const before = `this.reference.ready.catch((error) => {
					console.error("Sidebar Session opening failed:", error);
				});`;
const after = `this.reference.ready.catch((error) => {
					if (!this.disposed) console.error("Sidebar Session opening failed:", error);
				});`;

/** Exact locked DSH artifact and the single permitted source change. */
export const SIDEBAR_READY_PATCH = Object.freeze({
  artifact: '@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js',
  originalSha: '1fc57829753ab75da799ceaf88a99d8793d4e14746580231ec58af09d7a1a5cf',
  patchedSha: '3a9aa72954c1c4275091ea6c223d5125b65731dd98e787ea5b0768d892b46b8d',
  before,
  after,
});

const sha = (source: string): string => createHash('sha256').update(source).digest('hex');

/** Suppress expected ready rejection after disposal, preserving live open errors. */
export function patchSidebarReady(source: string): string {
  const digest = sha(source);
  if (digest === SIDEBAR_READY_PATCH.patchedSha) return source;
  if (digest !== SIDEBAR_READY_PATCH.originalSha) throw new Error('Unknown DSH sidebar-right artifact; review ready rejection handling');
  if (source.split(before).length !== 2) throw new Error('DSH sidebar-right ready catch anchor changed');
  const patched = source.replace(before, after);
  if (sha(patched) !== SIDEBAR_READY_PATCH.patchedSha) throw new Error('DSH sidebar-right ready patch digest mismatch');
  return patched;
}

/** Apply the locked patch to the installed artifact after the build lock is held. */
export function applySidebarReadyPatch(): void {
  const file = fileURLToPath(new URL(`../node_modules/${SIDEBAR_READY_PATCH.artifact}`, import.meta.url));
  const source = readFileSync(file, 'utf8');
  const patched = patchSidebarReady(source);
  if (patched !== source) writeFileSync(file, patched);
  console.log('Verified DSH sidebar-right ready rejection patch');
}
