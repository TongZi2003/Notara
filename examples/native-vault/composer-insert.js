import { currentSessionId } from './session-current.js';
/**
 * Put text at the end of one lesson's draft through the native input, the same
 * seam the board's 追问这块 uses. It never sends: the student reads and edits
 * before pressing send. Only the current lesson with a plain input accepts it.
 */
export function insertComposerText(ctx, sessionId, text) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) return false;
  const scope = ctx.sessions.scope(sessionId);
  if (!scope || currentSessionId(ctx.sessions.list.getSnapshot()) !== sessionId || ctx.conversation.blocks.storeFor(sessionId).getSnapshot()) return false;
  const current = ctx.conversation.input.for(scope).state.getSnapshot();
  if (current.phase !== 'plain') return false;
  const position = current.draft.length - current.occurrences.reduce((sum, item) => sum + item.length - 1, 0);
  const prefix = current.draft.trim() ? '\n' : '';
  return scope.bail(scope, 'slash/input-insert-text', { text: prefix + value, span: { start: position, end: position, draftRev: current.draftRev } }) === true;
}
