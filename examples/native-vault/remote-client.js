/**
 * Client-side scope wrapper for the `notaraVault` Remote.
 *
 * Every Vault read/write is scoped to one real workspace, and the Host resolves
 * that workspace from the session a request carries (`notaraTeaching.editorFor`).
 * A request without a session falls back to the Host's own registered startup
 * workspace — never to a client-chosen path. So if the asset page asked without a
 * session while the model wrote through the session's workspace, the student
 * would see "保存成功但资产页没有": two different roots over one real Vault.
 *
 * This wrapper pins one real sessionId and attaches it to every request, so
 * 资产/图谱/卡片/路线/教学设置 and the 模板 (templates/createFromTemplate) and
 * 任务 (tasks/toggleTask) seams all resolve the same root as the model. It is a
 * thin pass-through otherwise: the Remote's own `{ ok, value }` envelope is
 * returned unchanged, so callers keep their existing error handling.
 */

/** Every method the wrapper mirrors, in protocol order (see the Remote marker). */
export const VAULT_REMOTE_METHODS = Object.freeze([
  'pdfAnnotations', 'updatePdfAnnotations',
  'board', 'mutateBoard', 'mutateBoardInteraction',
  'list', 'read', 'readAsset', 'save', 'saveAsset', 'search', 'query', 'links', 'graph', 'templates', 'createFromTemplate', 'tasks', 'toggleTask',
  // 回收站: one file at a time, always recoverable. Delete proves the revision it
  // saw; restore refuses any name that already exists.
  'trashFile', 'listTrash', 'restoreFile',
  'teachingSettings', 'updateTeachingSettings', 'routes', 'createRoute', 'openRouteLesson', 'lessonLog', 'requestLessonSummary',
  // 教室: two roles, the background 解题者's tasks and its own model route. All
  // three answer with the same classroom value, so one projection renders them.
  'classroom', 'configureSolver', 'cancelSolver',
  // 查看分析: the parent/child binding of one real solver task, so the bench can
  // open the native child session the backend already keeps for that receipt.
  'solverTask',
  'calendar', 'reviewQueue', 'reviewDetail', 'recordReview', 'undoReview', 'dailyNote', 'scheduleLesson',
]);

/**
 * The scope a request carries. An empty object is the honest expression of "no
 * session yet" — the Host then resolves its own startup workspace. A fabricated
 * or empty-string sessionId is never sent.
 */
export function vaultScope(sessionId) {
  return typeof sessionId === 'string' && sessionId ? { sessionId } : {};
}

/**
 * One Vault client pinned to `sessionId`. The pinned session always wins over a
 * caller-supplied one, so a component that holds a fixed `props.sessionId`
 * context cannot be steered into another lesson's root by a stale local value.
 * Pass `undefined` only where there is genuinely no session yet; a request that
 * the Host cannot scope then fails there instead of reading the wrong Vault.
 */
export function createVaultClient(ctx, sessionId) {
  const scope = vaultScope(sessionId);
  const client = { sessionId: scope.sessionId ?? null, scope };
  for (const method of VAULT_REMOTE_METHODS) {
    client[method] = (input = {}) => ctx.remote.notaraVault[method]({ ...input, ...scope });
  }
  return client;
}
