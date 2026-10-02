import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep, join } from 'node:path';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';

const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods';
const CONFIRM_WINDOW_MS = 3 * 60 * 1000;
const STAGING_NAME = '.notara-session-deletion-staging';
const MANIFEST_NAME = 'notara-session-deletion.json';
const MANIFEST_OWNER = 'notara-vault-native';

export const SESSION_DELETION_REMOTE_METHODS = Object.freeze(['previewDeletion', 'deleteConversation']);

/** Keep cleanup usable when the deployment deliberately disables full-text search. */
export async function reconcileSessionSearchIndex(query, searchSessions = query?.searchSessions) {
  if (typeof searchSessions !== 'function') fail('session_delete_search_index_unavailable');
  try {
    await searchSessions.call(query, { query: `notara-delete-${randomUUID()}`, limit: 1 });
  } catch (error) {
    if (error?.code === 'SESSION_QUERY_SEARCH_DISABLED') return;
    throw error;
  }
}

/** AgentRegistry.create and .resume use different option names for identity. */
export function sessionCreationTargets(method, options) {
  return {
    sessionId: method === 'resume' ? options?.resumeSessionId : options?.sessionId,
    parentId: options?.parentAgent?.id ?? options?.meta?.parentSession,
  };
}

function fail(code) { throw new Error(code); }

function exactInput(value, required) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('session_delete_input_invalid');
  const allowed = new Set(required);
  if (Object.keys(value).some(key => !allowed.has(key)) || required.some(key => !Object.hasOwn(value, key))) fail('session_delete_input_invalid');
  return value;
}

function validId(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200) fail('session_delete_id_invalid');
  return value;
}

function inTree(root, target) {
  const path = relative(root, target);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** Return the transitive descendants from immutable native session headers. */
export function linkedSessionClosure(sessionId, rows) {
  const byId = new Map(rows.map(row => [row.id, row]));
  if (!byId.has(sessionId)) return [];
  const children = new Map();
  for (const row of byId.values()) {
    const parentId = row.parentSession;
    if (typeof parentId !== 'string') continue;
    const group = children.get(parentId) ?? [];
    group.push(row.id); children.set(parentId, group);
  }
  const ids = [], seen = new Set([sessionId]), pending = [...(children.get(sessionId) ?? []).sort()];
  while (pending.length) {
    const id = pending.shift();
    if (seen.has(id)) continue;
    seen.add(id); ids.push(id);
    pending.push(...(children.get(id) ?? []).sort());
  }
  return ids;
}

function titleOf(summary, id) {
  const value = summary?.title ?? summary?.projections?.values?.title ?? summary?.projectionValues?.title;
  return typeof value === 'string' && value.trim() ? value.trim() : '未命名课堂';
}

function stableSnapshot(entries) {
  return JSON.stringify(entries.map(entry => [
    entry.id, entry.parentSession ?? null, entry.version ?? null, entry.createdAt ?? null,
    entry.revision ?? null, entry.updatedAt ?? null, entry.title, entry.running === true,
  ]).sort(([left], [right]) => left.localeCompare(right)));
}

function errorCode(error) {
  return typeof error?.message === 'string' && /^session_delete_[a-z_]+$/.test(error.message) ? error.message : 'session_delete_failed';
}

/**
 * Guarded native deletion built on AgentHandle teardown and the locked DSH
 * JSONL backend's one-directory-per-session layout. DSH has no delete API, so
 * this code stages only the validated session-owned directory, then removes
 * it; workspaces, Vault files and shared attachments are never traversed.
 */
export class SessionDeletionRuntime {
  constructor(ctx) {
    this.ctx = ctx;
    this.challenges = new Map();
    this.deleting = new Set();
    this.retired = new Set();
    this.handles = new Map();
    this.creations = new Set();
    this.mutations = new Set();
    this.deletionOwners = new Map();
    this.searchSessions = ctx.sessionQuery?.searchSessions;
    this.listSessions = ctx.sessionQuery?.listSessions;
    this.ready = Promise.resolve();
  }

  install() {
    const { ctx } = this, agents = ctx.get('agents'), controller = ctx.get('sessionController');
    if (!agents || !controller || !ctx.sessionPersistence || !ctx.sessionQuery || !ctx.workspaceRegistry) throw new Error('session_delete_runtime_unavailable');

    const originalCreate = agents.create, originalResume = agents.resume;
    const track = (method, original) => async function (options) {
      await runtime.ready;
      const { sessionId, parentId } = sessionCreationTargets(method, options);
      if (runtime.isBlocked(sessionId) || runtime.isBlocked(parentId)) fail('session_delete_in_progress');
      const flight = { sessionId, parentId, promise: null };
      runtime.creations.add(flight);
      try {
        flight.promise = Promise.resolve(original.call(this, options));
        const handle = await flight.promise;
        if (handle?.agent?.id) runtime.handles.set(handle.agent.id, handle);
        return handle;
      } finally {
        runtime.creations.delete(flight);
      }
    };
    const runtime = this;
    const wrappedCreate = track('create', originalCreate), wrappedResume = track('resume', originalResume);
    agents.create = wrappedCreate;
    agents.resume = wrappedResume;
    const controllerWrappers = [];
    // The locked native controller can mutate an already-live Agent without
    // calling create/resume. Gate every such entry and let admitted operations
    // settle before checking the confirmation again. Reads and cancel remain
    // native so inspecting another classroom and stopping activity stay usable.
    for (const method of ['create', 'fork', 'prompt', 'rename', 'selectModel', 'updateQueue']) {
      const original = controller[method];
      if (typeof original !== 'function') continue;
      const wrapped = async function (request, ...rest) {
        await runtime.ready;
        const sessionId = request?.sessionId;
        if (runtime.isBlocked(sessionId)) fail('session_delete_in_progress');
        const flight = { sessionId, promise: null };
        runtime.mutations.add(flight);
        try {
          flight.promise = Promise.resolve(original.call(this, request, ...rest));
          return await flight.promise;
        } finally { runtime.mutations.delete(flight); }
      };
      controller[method] = wrapped; controllerWrappers.push([method, original, wrapped]);
    }
    const query = ctx.sessionQuery, queryWrappers = [], originalSearchSessions = query.searchSessions, originalListSessions = query.listSessions;
    this.searchSessions = originalSearchSessions;
    this.listSessions = originalListSessions;
    const queryMethods = ['observeSession', 'searchSessions', 'searchEvents', 'listSessions', 'readSession', 'filterSessions', 'readSurface', 'listEvents', 'filterEvents', 'readTitle', 'readTitleSnapshot', 'readTitleSnapshots', 'traceSession', 'traceEvent', 'readEvent'];
    for (const method of queryMethods) {
      const original = query[method];
      if (typeof original !== 'function') continue;
      const wrapped = async function (...args) {
        await runtime.ready;
        let sessionId;
        if (['observeSession', 'readSession', 'readSurface', 'listEvents', 'filterEvents', 'readTitle', 'readTitleSnapshot', 'traceSession'].includes(method)) sessionId = args[0];
        else if (method === 'readTitleSnapshots') sessionId = args[0];
        else if (['searchEvents', 'traceEvent', 'readEvent'].includes(method)) sessionId = args[0]?.sessionId;
        const blocked = Array.isArray(sessionId) ? sessionId.some(id => runtime.isBlocked(id)) : runtime.isBlocked(sessionId);
        if (blocked) fail('session_delete_in_progress');
        return original.apply(this, args);
      };
      query[method] = wrapped; queryWrappers.push([method, original, wrapped]);
    }
    const stopDisposed = ctx.on('agent/disposed', ({ agent }) => {
      if (runtime.handles.get(agent.id)?.agent === agent) runtime.handles.delete(agent.id);
    });
    const stopGate = ctx.on('agent/pre-step', ({ agent }, next) => runtime.isBlocked(agent.id) ? { kind: 'reject' } : next(), { prepend: true });

    this.ready = this.recoverStaging();
    ctx.effect(() => async () => {
      stopGate(); stopDisposed();
      if (agents.create === wrappedCreate) agents.create = originalCreate;
      if (agents.resume === wrappedResume) agents.resume = originalResume;
      for (const [method, original, wrapped] of controllerWrappers) if (controller[method] === wrapped) controller[method] = original;
      for (const [method, original, wrapped] of queryWrappers) if (query[method] === wrapped) query[method] = original;
      this.challenges.clear(); this.deleting.clear(); this.retired.clear(); this.handles.clear(); this.mutations.clear();
      await this.ready.catch(() => {});
    }, 'notara-session-deletion.lifecycle');
  }

  isBlocked(id) { return typeof id === 'string' && (this.deleting.has(id) || this.retired.has(id)); }

  async rows() {
    const [stored, live, queried, visible] = await Promise.all([
      this.ctx.sessionPersistence.list(),
      Promise.resolve(this.ctx.sessions.list()),
      this.ctx.sessionQuery.listSessions(),
      this.ctx.sessionController.list({}),
    ]);
    const records = new Map();
    for (const record of queried) records.set(record.header.id, { ...record.header, id: record.header.id, revision: record.revision, updatedAt: 0 });
    for (const snapshot of stored) records.set(snapshot.header.id, { ...records.get(snapshot.header.id), ...snapshot.header, id: snapshot.header.id, revision: snapshot.revision });
    for (const session of live) records.set(session.id, { ...records.get(session.id), ...session.header, id: session.id, running: this.ctx.get('agents')?.get(session.id)?.status === 'running' });
    const visibleById = new Map((visible?.items ?? []).map(row => [row.sessionId, row]));
    for (const [id, record] of records) {
      const summary = visibleById.get(id);
      records.set(id, { ...record, title: titleOf(summary, id), origin: summary?.origin, updatedAt: summary?.updatedAt ?? record.updatedAt ?? 0, running: record.running === true || summary?.running === true, blank: summary?.blank === true });
    }
    return [...records.values()];
  }

  async snapshot(sessionId) {
    const rows = await this.rows();
    const root = rows.find(row => row.id === sessionId);
    if (!root) fail('session_delete_not_found');
    if (root.blank) fail('session_delete_blank');
    if (root.origin === 'subagent') fail('session_delete_child_only');
    if (typeof root.cwd !== 'string' || !root.cwd) fail('session_delete_workspace_unavailable');
    const workspace = await this.ctx.workspaceRegistry.resolveByPath(root.cwd);
    if (!workspace) fail('session_delete_workspace_unavailable');
    const childIds = linkedSessionClosure(sessionId, rows), includedIds = [sessionId, ...childIds];
    const byId = new Map(rows.map(row => [row.id, row]));
    const entries = includedIds.map(id => byId.get(id));
    if (entries.some(row => !row)) fail('session_delete_linked_snapshot_unavailable');
    return { root, workspace, ids: includedIds, entries, fingerprint: stableSnapshot(entries) };
  }

  async assertInactive(snapshot) {
    for (const row of snapshot.entries) {
      if (row.running || this.ctx.get('agents')?.get(row.id)?.status === 'running') fail('session_delete_active');
      let activity;
      try { activity = await this.ctx.waterfall('workspace/session-activity', { sessionId: row.id }, () => Promise.resolve([])); }
      catch { fail('session_delete_activity_unavailable'); }
      if (activity.length) fail('session_delete_active');
    }
  }

  async previewDeletion(input) {
    exactInput(input, ['sessionId']);
    await this.ready;
    const sessionId = validId(input.sessionId);
    if (this.isBlocked(sessionId)) fail('session_delete_in_progress');
    const snapshot = await this.snapshot(sessionId);
    await this.assertInactive(snapshot);
    const token = randomUUID(), expiresAt = Date.now() + CONFIRM_WINDOW_MS;
    this.challenges.set(token, { sessionId, title: snapshot.root.title, fingerprint: snapshot.fingerprint, ids: snapshot.ids, expiresAt });
    return {
      token, title: snapshot.root.title, expiresAt,
      linkedSessions: snapshot.entries.slice(1).map(row => ({ title: row.title, worker: row.origin === 'subagent' })),
      keepsVaultMaterials: true,
    };
  }

  async deleteConversation(input) {
    exactInput(input, ['sessionId', 'token', 'typedTitle']);
    await this.ready;
    const sessionId = validId(input.sessionId);
    if (typeof input.token !== 'string' || input.token.length > 100 || typeof input.typedTitle !== 'string' || input.typedTitle.length > 300) fail('session_delete_input_invalid');
    const challenge = this.challenges.get(input.token);
    if (!challenge || challenge.sessionId !== sessionId || challenge.expiresAt < Date.now()) fail('session_delete_confirmation_expired');
    if (input.typedTitle !== challenge.title) fail('session_delete_title_mismatch');
    this.challenges.delete(input.token);
    if (challenge.ids.some(id => this.isBlocked(id))) fail('session_delete_in_progress');

    const lock = randomUUID();
    for (const id of challenge.ids) if (this.deletionOwners.has(id)) fail('session_delete_in_progress');
    // This synchronous tombstone precedes every await: all later prompts,
    // resumes, and agent steps are rejected while we prove the whole tree idle.
    for (const id of challenge.ids) this.deleting.add(id);
    for (const id of challenge.ids) this.deletionOwners.set(id, lock);
    try {
      await Promise.all([this.waitForCreations(challenge.ids), this.waitForMutations(challenge.ids)]);
      const snapshot = await this.snapshot(sessionId);
      if (snapshot.fingerprint !== challenge.fingerprint || snapshot.ids.join('\0') !== challenge.ids.join('\0')) fail('session_delete_confirmation_stale');
      await this.assertInactive(snapshot);
      return await this.removeSnapshot(snapshot, lock);
    } catch (error) {
      throw new Error(errorCode(error));
    } finally {
      for (const id of challenge.ids) this.deleting.delete(id);
      for (const id of challenge.ids) if (this.deletionOwners.get(id) === lock) this.deletionOwners.delete(id);
    }
  }

  async waitForCreations(ids) {
    const selected = [...this.creations].filter(flight => ids.includes(flight.sessionId) || ids.includes(flight.parentId));
    await Promise.all(selected.map(flight => flight.promise?.catch(() => {}) ?? Promise.resolve()));
  }

  async waitForMutations(ids) {
    const selected = [...this.mutations].filter(flight => ids.includes(flight.sessionId));
    await Promise.all(selected.map(flight => flight.promise?.catch(() => {}) ?? Promise.resolve()));
  }

  async removeSnapshot(snapshot) {
    const persistence = this.ctx.sessionPersistence, registry = this.ctx.workspaceRegistry;
    const projectionCache = this.ctx.get('sessionProjectionCache');
    const table = projectionCache?.table;
    if (!table || typeof table.delete !== 'function') fail('session_delete_cache_unavailable');
    const observationCache = this.ctx.sessionQuery?._observations?.cache;
    if (!(observationCache instanceof Map)) fail('session_delete_query_cache_unavailable');
    for (const id of snapshot.ids) if ((observationCache.get(id)?.refs ?? 0) > 0) fail('session_delete_session_reading');

    const wasArchived = new Set(registry.archivedSessionIds ?? []), wasPinned = new Set(registry.pinnedSessionIds ?? []);
    const persistedBefore = new Map((await persistence.list()).map(snapshot => [snapshot.header.id, snapshot.header]));
    const manifest = {
      owner: MANIFEST_OWNER, version: 1, state: 'staging', transactionId: randomUUID(),
      ids: snapshot.ids, archived: snapshot.ids.filter(id => wasArchived.has(id)), pinned: snapshot.ids.filter(id => wasPinned.has(id)),
      entries: snapshot.entries.map((row, index) => ({ id: row.id, header: persistedBefore.get(row.id) ?? this.headerFromRow(row), stagedName: `session-${index}` })),
    };
    if (manifest.entries.some(entry => !entry.header)) fail('session_delete_header_unavailable');
    const stageRoot = await this.ensureStageRoot(persistence.root);
    const transactionDir = join(stageRoot, manifest.transactionId);
    await mkdir(transactionDir, { recursive: false, mode: 0o700 });
    try { await this.writeManifest(transactionDir, manifest); }
    catch (error) { await rm(transactionDir, { recursive: true, force: true }).catch(() => {}); throw error; }
    const archivedNow = [], locks = [], staged = [];
    try {
      for (const id of snapshot.ids) {
        if (!wasArchived.has(id)) { await registry.archiveSession(id, { stopActivity: false }); archivedNow.push(id); }
      }
      // Dispose child Agents before parents so their native writer handles and
      // scoped subagent resources settle before the parent lifecycle closes.
      for (const row of [...snapshot.entries].reverse()) {
        const session = this.ctx.sessions.get(row.id), agent = this.ctx.get('agents')?.get(row.id);
        if (!session && !agent) continue;
        const handle = this.handles.get(row.id);
        if (!handle || handle.agent !== agent || !session || session !== agent.session) fail('session_delete_live_handle_unavailable');
        if (agent.status === 'running') fail('session_delete_active');
        await handle.dispose();
        this.handles.delete(row.id);
      }

      const stored = await persistence.list();
      const storedById = new Map(stored.map(item => [item.header.id, item]));
      manifest.entries = manifest.entries.filter(entry => storedById.has(entry.id)).map(entry => ({ ...entry, header: storedById.get(entry.id).header }));
      await this.writeManifest(transactionDir, manifest);
      for (const entry of manifest.entries) locks.push(await persistence.open(entry.id, 'write'));

      for (let index = 0; index < manifest.entries.length; index++) {
        const entry = manifest.entries[index], directory = await this.safeSessionDirectory(persistence, entry.header);
        if (!directory.exists) continue;
        const destination = join(transactionDir, entry.stagedName);
        await rename(directory.path, destination);
        staged.push({ source: directory.path, destination, entry });
      }
      await this.writeManifest(transactionDir, { ...manifest, state: 'committed' });
      manifest.state = 'committed';
      for (const id of snapshot.ids) this.retired.add(id);
      // Closing these untouched write handles releases JSONL's cross-process
      // lease while ensuring the moved log cannot be reopened from its source.
      await Promise.allSettled(locks.map(handle => handle.close())); locks.length = 0;
      const cleanupPending = await this.finalizeCommitted(manifest, transactionDir);
      return { deleted: true, linkedCount: snapshot.ids.length - 1, cleanupPending };
    } catch (error) {
      if (manifest.state !== 'committed') {
        let rollbackFailure;
        try {
          for (const item of [...staged].reverse()) await rename(item.destination, item.source);
          for (const id of archivedNow.reverse()) {
            await registry.unarchiveSession(id);
            if (wasPinned.has(id)) await registry.pinSession(id);
          }
          await rm(transactionDir, { recursive: true, force: true });
        } catch (failure) { rollbackFailure = failure; }
        if (rollbackFailure) throw new Error('session_delete_rollback_failed');
      }
      throw error;
    } finally {
      await Promise.allSettled(locks.map(handle => handle.close()));
    }
  }

  headerFromRow(row) {
    const { id, version, createdAt, cwd, parentSession, isSeeded, delegationDepth, agentPreset } = row;
    return { id, version, createdAt, ...(cwd === undefined ? {} : { cwd }), ...(parentSession === undefined ? {} : { parentSession }), ...(isSeeded === undefined ? {} : { isSeeded }), ...(delegationDepth === undefined ? {} : { delegationDepth }), ...(agentPreset === undefined ? {} : { agentPreset }) };
  }

  async ensureStageRoot(sessionRoot) {
    const parent = await realpath(dirname(resolve(sessionRoot)));
    const stageRoot = join(parent, STAGING_NAME);
    try { await mkdir(stageRoot, { recursive: false, mode: 0o700 }); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
    const info = await lstat(stageRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('session_delete_staging_unavailable');
    const actual = await realpath(stageRoot);
    if (!inTree(parent, actual)) fail('session_delete_staging_unavailable');
    return actual;
  }

  async safeSessionDirectory(persistence, header) {
    if (typeof persistence.locate !== 'function' || typeof persistence.root !== 'string') fail('session_delete_storage_unsupported');
    const location = persistence.locate(header);
    if (location?.kind !== 'jsonl' || typeof location.path !== 'string') fail('session_delete_storage_unsupported');
    const absoluteRoot = resolve(persistence.root), directory = resolve(dirname(location.path));
    if (!inTree(absoluteRoot, directory)) fail('session_delete_path_invalid');
    const rootReal = await realpath(absoluteRoot), parent = dirname(directory);
    const relativePath = relative(absoluteRoot, directory).split(/[\\/]/);
    if (relativePath.length !== 2 || relativePath.some(part => !part || part === '.' || part === '..')) fail('session_delete_path_invalid');
    let rootInfo;
    try { rootInfo = await lstat(parent); }
    catch (error) { if (error?.code === 'ENOENT') return { path: directory, exists: false }; throw error; }
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail('session_delete_path_invalid');
    const parentReal = await realpath(parent);
    if (!inTree(rootReal, parentReal)) fail('session_delete_path_invalid');
    let info;
    try { info = await lstat(directory); }
    catch (error) { if (error?.code === 'ENOENT') return { path: directory, exists: false }; throw error; }
    if (!info.isDirectory() || info.isSymbolicLink()) fail('session_delete_path_invalid');
    const directoryReal = await realpath(directory);
    if (!inTree(rootReal, directoryReal)) fail('session_delete_path_invalid');
    return { path: directory, exists: true };
  }

  async writeManifest(transactionDir, manifest) {
    const tmp = join(transactionDir, `${MANIFEST_NAME}.tmp`), target = join(transactionDir, MANIFEST_NAME);
    await writeFile(tmp, `${JSON.stringify(manifest)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, target);
  }

  async recoverStaging() {
    const persistence = this.ctx.sessionPersistence;
    const stageRoot = join(dirname(resolve(persistence.root)), STAGING_NAME);
    let rootInfo;
    try { rootInfo = await lstat(stageRoot); }
    catch (error) { if (error?.code === 'ENOENT') return; throw error; }
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail('session_delete_recovery_unavailable');
    const actualRoot = await realpath(stageRoot), expectedParent = await realpath(dirname(resolve(persistence.root)));
    if (!inTree(expectedParent, actualRoot)) fail('session_delete_recovery_unavailable');
    for (const entry of await readdir(actualRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
      const transactionDir = join(actualRoot, entry.name);
      let manifest;
      try { manifest = JSON.parse(await readFile(join(transactionDir, MANIFEST_NAME), 'utf8')); }
      catch (error) { if (error?.code === 'ENOENT') continue; throw new Error('session_delete_recovery_unavailable'); }
      if (manifest?.owner !== MANIFEST_OWNER || manifest.version !== 1 || manifest.transactionId !== entry.name || !Array.isArray(manifest.ids) || !Array.isArray(manifest.entries)) fail('session_delete_recovery_unavailable');
      if (manifest.state === 'staging') {
        for (const staged of [...manifest.entries].reverse()) {
          if (!/^session-\d+$/.test(staged.stagedName) || !staged.header || staged.header.id !== staged.id) fail('session_delete_recovery_unavailable');
          const source = await this.safeSessionDirectory(persistence, staged.header), destination = join(transactionDir, staged.stagedName);
          let stagedInfo;
          try { stagedInfo = await lstat(destination); }
          catch (error) { if (error?.code === 'ENOENT') continue; throw error; }
          if (!stagedInfo.isDirectory() || stagedInfo.isSymbolicLink() || source.exists) fail('session_delete_recovery_conflict');
          await rename(destination, source.path);
        }
        await this.restoreRegistryState(manifest);
      } else if (manifest.state === 'committed') {
        for (const id of manifest.ids) this.retired.add(validId(id));
        await this.finalizeRegistry(manifest);
        await this.clearSessionCaches(manifest.ids);
        await this.refreshWorkspaceHeaders();
        await this.reconcileSearchIndex();
        await this.verifyAbsence(manifest.ids);
      } else fail('session_delete_recovery_unavailable');
      await rm(transactionDir, { recursive: true, force: true });
    }
  }

  async restoreRegistryState(manifest) {
    const registry = this.ctx.workspaceRegistry;
    const archived = new Set(manifest.archived ?? []), pinned = new Set(manifest.pinned ?? []);
    for (const id of manifest.ids) {
      if (!archived.has(id)) await registry.unarchiveSession(id);
      if (pinned.has(id) && !archived.has(id)) await registry.pinSession(id);
    }
    await this.refreshWorkspaceHeaders();
  }

  async finalizeCommitted(manifest, transactionDir) {
    for (const id of manifest.ids) this.retired.add(id);
    let cleanupPending = false;
    try {
      await this.finalizeRegistry(manifest);
      await this.clearSessionCaches(manifest.ids);
      await this.refreshWorkspaceHeaders();
      await this.reconcileSearchIndex();
      await this.verifyAbsence(manifest.ids);
    } catch { cleanupPending = true; }
    if (!cleanupPending) {
      try { await rm(transactionDir, { recursive: true, force: false }); }
      catch { cleanupPending = true; }
    }
    return cleanupPending;
  }

  async finalizeRegistry(manifest) {
    const registry = this.ctx.workspaceRegistry;
    for (const id of manifest.ids) {
      await registry.unarchiveSession(id);
      await registry.unpinSession(id);
      for (const workspace of registry.list()) await workspace.detachSession(id);
    }
  }

  async clearSessionCaches(ids) {
    const projectionTable = this.ctx.get('sessionProjectionCache')?.table;
    const queryCache = this.ctx.sessionQuery?._observations?.cache;
    const persistence = this.ctx.sessionPersistence;
    for (const id of ids) {
      await projectionTable?.delete(id);
      queryCache?.delete(id);
      persistence.coldLogMemo?.delete(id);
      persistence.migrationPreparations?.delete(id);
    }
  }

  async refreshWorkspaceHeaders() {
    const registry = this.ctx.workspaceRegistry;
    if (typeof registry.replaceHeaderIndex !== 'function') fail('session_delete_workspace_cache_unavailable');
    await registry.replaceHeaderIndex((await this.ctx.sessionPersistence.list()).map(snapshot => snapshot.header));
  }

  async reconcileSearchIndex() {
    await reconcileSessionSearchIndex(this.ctx.sessionQuery, this.searchSessions);
  }

  async verifyAbsence(ids) {
    const [stored, live, records] = await Promise.all([
      this.ctx.sessionPersistence.list(), Promise.resolve(this.ctx.sessions.list()), this.listSessions.call(this.ctx.sessionQuery),
    ]);
    const storedIds = new Set(stored.map(item => item.header.id)), liveIds = new Set(live.map(session => session.id)), queryIds = new Set(records.map(record => record.header.id));
    if (ids.some(id => storedIds.has(id) || liveIds.has(id) || queryIds.has(id))) fail('session_delete_verification_failed');
  }
}

export function installSessionDeletion(ctx) {
  ctx.plugin({
    name: 'notara-session-deletion',
    inject: ['agents', 'sessionController', 'sessions', 'sessionPersistence', 'sessionQuery', 'sessionProjectionCache', 'workspaceRegistry'],
    apply(scope) {
      const runtime = new SessionDeletionRuntime(scope);
      runtime.install();
      class NotaraSessionRemote extends TypertRemoteService {
        constructor(context) { super(context, 'notaraSession'); }
        previewDeletion(input) { return runtime.previewDeletion(input); }
        deleteConversation(input) { return runtime.deleteConversation(input); }
      }
      Object.defineProperty(NotaraSessionRemote.prototype, REMOTE_METHOD_DESCRIPTOR, {
        configurable: true,
        value: Object.freeze({ version: 1, methods: Object.freeze(SESSION_DELETION_REMOTE_METHODS.map(method => Object.freeze({ method, invocation: Object.freeze({ kind: 'direct' }) }))) }),
      });
      scope.plugin(NotaraSessionRemote);
    },
  });
}
