import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createEditorVaultIO } from './agent-io.js';
import { boardPath, readBoardDocument } from './board-runtime.js';
import { renderBoard } from './board-data.js';
import { interactionPath, readInteractionDocument, saveInteractionDocument } from './interactive-runtime.js';
import { TEACHER_PRESET_ID } from './teacher-preset.js';
import { createVaultStore } from './vault.js';
import { createBoardObjectStore } from './board-storage.js';

/** Validate and enumerate each immutable scene, image and contribution entry. */
async function boardObjectGraph(store, sessionId, board) {
  const refs = [], seen = new Set();
  async function visit(ref) {
    if (!ref || seen.has(ref)) return;
    const value = await store.read(sessionId, ref);
    if (!value || !['scene', 'asset', 'commit'].includes(value.kind)) throw new Error('board_content_corrupt');
    seen.add(ref); refs.push(ref);
    if (value.kind === 'scene') {
      if (!value.scene || typeof value.scene !== 'object' || !value.scene.files || typeof value.scene.files !== 'object') throw new Error('board_content_corrupt');
      for (const file of Object.values(value.scene.files)) if (file?.assetRef) await visit(file.assetRef);
    } else if (value.kind === 'commit') {
      if (!Array.isArray(value.changes)) throw new Error('board_content_corrupt');
      for (const change of value.changes) {
        if (change.field === 'contentRef') { await visit(change.before); await visit(change.after); }
        else if (!change.field) { await visit(change.before?.contentRef); await visit(change.after?.contentRef); }
      }
    }
  }
  for (const block of board.blocks) await visit(block.contentRef);
  for (const ref of board.historyRefs ?? []) await visit(ref);
  return refs;
}

/** Capture the complete board at fork time, even when the conversation cut is older. */
export async function captureForkBoard(io, sessionId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await readBoardDocument(io, sessionId);
    if (state.revision === null) return null;
    const board = structuredClone(state.board), interactions = new Map();
    const objectRefs = await boardObjectGraph(createBoardObjectStore(io.rootPath), sessionId, board);
    for (const block of board.blocks) {
      const id = block.interactive?.interactionId;
      if (!id || interactions.has(id)) continue;
      try { interactions.set(id, await readInteractionDocument(io, sessionId, id)); }
      catch (error) {
        // Legacy missing scenes remain unavailable in both classrooms.
        if (!['interaction_missing', 'interaction_binding_invalid'].includes(error.message)) throw error;
      }
    }
    const consistent = board.blocks.every(block => !interactions.has(block.interactive?.interactionId)
      || interactions.get(block.interactive.interactionId).revision === block.interactive.revision);
    if (consistent && (await readBoardDocument(io, sessionId)).revision === state.revision) return { board, interactions, objectRefs };
  }
  throw new Error('vault_revision_conflict');
}

/** Failed setup owns only the files it created; keep their bytes recoverable. */
async function rollbackForkFiles(io, created) {
  if (!created.length) return;
  const store = createVaultStore(io.rootPath), errors = [];
  for (const file of [...created].reverse()) {
    try { await store.trashFile(file.path, file.revision, { id: randomUUID(), deletedAt: new Date().toISOString() }); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'board_fork_cleanup_failed');
}

/** Create independent files; a collision never overwrites another classroom's board. */
export async function inheritForkBoard(io, snapshot, sessionId, signal) {
  signal?.throwIfAborted();
  if (!snapshot) return [];
  const board = structuredClone(snapshot.board);
  const sourceSessionId = board.sessionId;
  board.sessionId = sessionId;
  const refs = new Map(), created = [];
  const record = receipt => { if (!created.some(file => file.path === receipt.path)) created.push(receipt); };
  try {
    const refsToCopy = snapshot.objectRefs ?? [];
    const hasObjects = refsToCopy.length || board.blocks.some(block => block.contentRef) || board.historyRefs?.length;
    if (hasObjects) {
      if (!io.rootPath) throw new Error('board_store_unavailable');
      const objects = createBoardObjectStore(io.rootPath);
      for (const ref of snapshot.objectRefs ?? await boardObjectGraph(objects, sourceSessionId, snapshot.board)) {
        signal?.throwIfAborted();
        await objects.copy(sourceSessionId, sessionId, ref);
      }
    }
    for (const [id, current] of snapshot.interactions) {
      signal?.throwIfAborted();
      const saved = await saveInteractionDocument(io, sessionId, id, current.scene, null, record);
      record({ path: interactionPath(sessionId, id), revision: saved.revision });
      signal?.throwIfAborted();
      refs.set(id, saved.ref);
    }
    for (const block of board.blocks) {
      const ref = refs.get(block.interactive?.interactionId);
      if (ref) block.interactive = ref;
    }
    signal?.throwIfAborted();
    const saved = await io.save(boardPath(sessionId), renderBoard(board), null, record);
    record({ path: boardPath(sessionId), revision: saved.revision });
    signal?.throwIfAborted();
    return created;
  } catch (error) {
    try { await rollbackForkFiles(io, created); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'board_fork_copy_failed'); }
    throw error;
  }
}

/** Install inside native creation setup, before the session is published or attached. */
export function installBoardForks(ctx, service) {
  const agents = ctx.get('agents'), original = agents.create, lifetime = new AbortController();
  const flights = new Set(); let active = true;
  const copy = async function (options) {
    const meta = options?.meta;
    const signal = options.signal ? AbortSignal.any([lifetime.signal, options.signal]) : lifetime.signal;
    signal.throwIfAborted();
    const source = await service.editorFor({ sessionId: meta.parentSession });
    if (!meta.cwd || resolve(meta.cwd) !== resolve(source.workspace.path)) throw new Error('vault_write_scope_invalid');
    const snapshot = await captureForkBoard(createEditorVaultIO(ctx, source.workspace.path, signal), meta.parentSession);
    signal.throwIfAborted();
    const originalSetup = options.setup;
    let copying, copied = [], copyIO;
    try {
      return await original.call(this, { ...options, signal, setup: async (agentCtx, agent) => {
        const setupAbort = new AbortController();
        agentCtx.effect(() => () => setupAbort.abort(), 'notara-board-fork.setup');
        const copySignal = AbortSignal.any([signal, setupAbort.signal]);
        const commit = await originalSetup?.(agentCtx, agent);
        copySignal.throwIfAborted();
        if (agent.session.id !== options.sessionId || resolve(agent.session.header.cwd ?? '') !== resolve(source.workspace.path)) throw new Error('vault_write_scope_invalid');
        // Settle each admitted atomic save and register its receipt before cancelling.
        copyIO = createEditorVaultIO(ctx, source.workspace.path);
        copying = inheritForkBoard(copyIO, snapshot, agent.session.id, copySignal);
        copied = await copying;
        copySignal.throwIfAborted();
        return commit;
      } });
    } catch (error) {
      // Native cancellation can win while setup is still unwinding its IO.
      await copying?.catch(() => {});
      if (copied.length) {
        try { await rollbackForkFiles(copyIO, copied); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'board_fork_copy_failed'); }
      }
      throw error;
    }
  };
  const wrapped = function (options) {
    const meta = options?.meta;
    if (!active || !meta?.isSeeded || !meta.parentSession || meta.origin === 'subagent' || meta.agentPreset !== TEACHER_PRESET_ID) return original.call(this, options);
    const promise = copy.call(this, options);
    flights.add(promise);
    return promise.finally(() => flights.delete(promise));
  };
  agents.create = wrapped;
  return ctx.effect(() => async () => {
    active = false;
    lifetime.abort();
    if (agents.create === wrapped) agents.create = original;
    await Promise.allSettled([...flights]);
  }, 'notara-board-fork.lifecycle');
}
