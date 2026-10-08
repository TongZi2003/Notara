import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { linkedSessionClosure, reconcileSessionSearchIndex, sessionCreationTargets, SessionDeletionRuntime } from './session-deletion-runtime.js';

const SESSION_ID = 'session-to-recover';
const STAGING_NAME = '.notara-session-deletion-staging';

test('deletion previews expire abandoned confirmations and keep a bounded live set',async()=>{
  const runtime=new SessionDeletionRuntime({});
  runtime.snapshot=async sessionId=>({root:{title:sessionId},fingerprint:'test',ids:[sessionId],entries:[{id:sessionId}]});
  runtime.assertInactive=async()=>{};
  runtime.challenges.set('expired',{expiresAt:Date.now()-1});
  const first=await runtime.previewDeletion({sessionId:'first'});
  assert.equal(runtime.challenges.has('expired'),false);
  for(let n=0;n<256;n++)await runtime.previewDeletion({sessionId:`lesson-${n}`});
  assert.equal(runtime.challenges.size,256);
  assert.equal(runtime.challenges.has(first.token),false);
  runtime.challenges.set('expired-again',{sessionId:'test',expiresAt:Date.now()-1});
  await assert.rejects(runtime.deleteConversation({sessionId:'test',token:'expired-again',typedTitle:'test'}),/session_delete_confirmation_expired/);
  assert.equal(runtime.challenges.has('expired-again'),false);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function controllerGuardFixture() {
  const root = await mkdtemp(join(tmpdir(), 'notara-session-mutation-test-'));
  const rows = new Map([
    ['class', { id: 'class', title: '待删除课堂', revision: 1 }],
    ['child', { id: 'child', title: '关联工作员', parentSession: 'class', revision: 1 }],
    ['other', { id: 'other', title: '保留课堂', revision: 1 }],
  ]);
  const calls = [], hooks = {}, disposals = [];
  const header = row => ({ id: row.id, cwd: join(root, 'workspace'), createdAt: 1, version: 4, ...(row.parentSession ? { parentSession: row.parentSession } : {}) });
  const persistence = { root: join(root, 'sessions'), async list() { return [...rows.values()].map(row => ({ header: header(row), revision: String(row.revision) })); } };
  const controller = {
    async list() { return { items: [...rows.values()].map(row => ({ sessionId: row.id, title: row.title, origin: row.parentSession ? 'subagent' : 'ordinary' })) }; },
    async cancel(request) { return { cancelled: request.sessionId }; },
  };
  for (const method of ['create', 'fork', 'prompt', 'rename', 'selectModel', 'updateQueue']) {
    controller[method] = async function (request, ...rest) {
      assert.equal(this, controller);
      calls.push({ method, sessionId: request.sessionId, rest });
      await hooks[method]?.(request);
      const row = rows.get(request.sessionId);
      row.revision++;
      if (method === 'rename') row.title = request.title;
      return { accepted: true };
    };
  }
  const originals = Object.fromEntries(Object.entries(controller));
  const agents = { async create() {}, async resume() {}, get() {} };
  const query = { async listSessions() { return []; }, async searchSessions() { return { items: [] }; } };
  const workspaceRegistry = { async resolveByPath() { return { id: 'workspace' }; } };
  const ctx = {
    sessionPersistence: persistence, sessionQuery: query, sessionController: controller, agents, workspaceRegistry, sessions: { list: () => [] },
    get(key) { return { agents, sessionController: controller }[key]; },
    async waterfall(_name, request) { await hooks.activity?.(request); return []; },
    on() { return () => {}; }, effect(dispose) { disposals.push(dispose); },
  };
  const runtime = new SessionDeletionRuntime(ctx);
  runtime.install(); await runtime.ready;
  let removals = 0;
  // Isolate admission and confirmation from filesystem teardown, which is
  // covered by recovery, SQLite integration and the browser deletion test.
  runtime.removeSnapshot = async () => { removals++; throw new Error('session_delete_rollback_failed'); };
  return { root, rows, controller, originals, calls, hooks, runtime, get removals() { return removals; }, async dispose() { for (const effect of disposals.reverse()) await effect()(); await rm(root, { recursive: true, force: true }); } };
}

async function recoveryFixture(state) {
  const root = await mkdtemp(join(tmpdir(), 'notara-session-deletion-test-'));
  const persistenceRoot = join(root, 'sessions'), projectRoot = join(persistenceRoot, 'project');
  const sessionDir = join(projectRoot, SESSION_ID), stagingRoot = join(root, STAGING_NAME), transactionId = 'd68ddcb4-1dc2-4a77-b0cd-a25e86d57c10';
  const transactionDir = join(stagingRoot, transactionId), stagedDir = join(transactionDir, 'session-0');
  const header = { id: SESSION_ID, cwd: join(root, 'workspace'), createdAt: 1, version: 4 };
  await mkdir(projectRoot, { recursive: true });
  await mkdir(stagedDir, { recursive: true });
  await writeFile(join(stagedDir, 'events.jsonl'), 'session event log');
  await writeFile(join(transactionDir, 'notara-session-deletion.json'), `${JSON.stringify({
    owner: 'notara-vault-native', version: 1, state, transactionId, ids: [SESSION_ID],
    archived: state === 'committed' ? [SESSION_ID] : [], pinned: [SESSION_ID],
    entries: [{ id: SESSION_ID, header, stagedName: 'session-0' }],
  })}\n`);

  const persistence = {
    root: persistenceRoot,
    coldLogMemo: new Map([[SESSION_ID, {}]]),
    migrationPreparations: new Map([[SESSION_ID, {}]]),
    locate(meta) { return { kind: 'jsonl', path: join(persistenceRoot, 'project', meta.id, 'events.jsonl') }; },
    async list() {
      const exists = await stat(join(sessionDir, 'events.jsonl')).then(() => true, () => false);
      return exists ? [{ header, revision: 'test-revision' }] : [];
    },
  };
  const archivedSessionIds = new Set(state === 'committed' ? [SESSION_ID] : []), pinnedSessionIds = new Set([SESSION_ID]);
  const detached = new Set(), registryIndex = [];
  const workspaceRegistry = {
    archivedSessionIds, pinnedSessionIds,
    async unarchiveSession(id) { archivedSessionIds.delete(id); },
    async pinSession(id) { pinnedSessionIds.add(id); },
    async unpinSession(id) { pinnedSessionIds.delete(id); },
    list() { return [{ async detachSession(id) { detached.add(id); } }]; },
    async replaceHeaderIndex(headers) { registryIndex.splice(0, registryIndex.length, ...headers); },
  };
  let searchCalls = 0, listCalls = 0, resumeCalls = 0, releaseSearch;
  let enterSearch;
  const searchEntered = new Promise(resolve => { enterSearch = resolve; });
  const searchGate = new Promise(resolve => { releaseSearch = resolve; });
  const queryCache = new Map([[SESSION_ID, { refs: 0 }]]), deletedProjectionIds = [];
  const query = {
    _observations: { cache: queryCache },
    async searchSessions() { searchCalls++; enterSearch(); if (state === 'committed') await searchGate; return { items: [] }; },
    async listSessions() { listCalls++; return (await persistence.list()).map(snapshot => ({ header: snapshot.header })); },
  };
  const agents = {
    async create(options) { return { agent: { id: options.sessionId } }; },
    async resume(options) { resumeCalls++; return { agent: { id: options.resumeSessionId } }; },
    get() { return undefined; },
  };
  const sessionController = { prompt: async () => ({}), list: async () => ({ items: [] }) };
  const table = { async delete(id) { deletedProjectionIds.push(id); } };
  const historyDeleteCalls = [], recoveryHooks = {}, runtimeDisposals = [];
  const notaraHistory = { async deleteSessionIds(ids) {
    historyDeleteCalls.push([...ids]);
    const manifest = JSON.parse(await readFile(join(transactionDir, 'notara-session-deletion.json'), 'utf8'));
    assert.equal(manifest.state, 'committed', 'archive cleanup must follow the durable native commit');
    await recoveryHooks.historyDelete?.(ids);
  } };
  const ctx = {
    sessionPersistence: persistence, sessionQuery: query, workspaceRegistry, sessions: { list: () => [], get: () => undefined },
    get(key) { return ({ agents, sessionController, sessionProjectionCache: { table }, notaraHistory })[key]; },
    on() { return () => {}; }, effect(dispose) { runtimeDisposals.push(dispose); },
  };
  return { root, sessionDir, transactionDir, stagedDir, header, persistence, workspaceRegistry, registryIndex, detached, query, queryCache, agents, ctx, searchEntered, releaseSearch, recoveryHooks, historyDeleteCalls,
    async disposeRuntime() { for (const dispose of runtimeDisposals.splice(0).reverse()) await dispose()(); },
    get searchCalls() { return searchCalls; }, get listCalls() { return listCalls; }, get resumeCalls() { return resumeCalls; }, deletedProjectionIds };
}

async function partialRollbackRecoveryFixture() {
  const root = await mkdtemp(join(tmpdir(), 'notara-session-deletion-partial-recovery-'));
  const persistenceRoot = join(root, 'sessions'), projectRoot = join(persistenceRoot, 'project');
  const ids = ['session-already-restored', 'session-still-staged'];
  const headers = ids.map((id, index) => ({ id, cwd: join(root, 'workspace'), createdAt: index + 1, version: 4 }));
  const sessionDirs = ids.map(id => join(projectRoot, id));
  const stagingRoot = join(root, STAGING_NAME), transactionId = 'd68ddcb4-1dc2-4a77-b0cd-a25e86d57c10';
  const transactionDir = join(stagingRoot, transactionId), stillStagedDir = join(transactionDir, 'session-1');
  await mkdir(sessionDirs[0], { recursive: true });
  await mkdir(stillStagedDir, { recursive: true });
  await writeFile(join(sessionDirs[0], 'events.jsonl'), 'already restored session log');
  await writeFile(join(stillStagedDir, 'events.jsonl'), 'still staged session log');
  await writeFile(join(transactionDir, 'notara-session-deletion.json'), `${JSON.stringify({
    owner: 'notara-vault-native', version: 1, state: 'staging', transactionId, ids,
    archived: [], pinned: ids,
    entries: headers.map((header, index) => ({ id: header.id, header, stagedName: `session-${index}` })),
  })}\n`);

  const persistence = {
    root: persistenceRoot,
    locate(meta) { return { kind: 'jsonl', path: join(persistenceRoot, 'project', meta.id, 'events.jsonl') }; },
    async list() {
      const rows = [];
      for (let index = 0; index < ids.length; index++) {
        const exists = await stat(join(sessionDirs[index], 'events.jsonl')).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error));
        if (exists) rows.push({ header: headers[index], revision: `revision-${index}` });
      }
      return rows;
    },
  };
  const archivedSessionIds = new Set(ids), pinnedSessionIds = new Set(), registryIndex = [];
  const workspaceRegistry = {
    archivedSessionIds, pinnedSessionIds,
    async unarchiveSession(id) { archivedSessionIds.delete(id); },
    async pinSession(id) { pinnedSessionIds.add(id); },
    async replaceHeaderIndex(rows) { registryIndex.splice(0, registryIndex.length, ...rows); },
  };
  const ctx = { sessionPersistence: persistence, workspaceRegistry };
  return { root, ids, headers, sessionDirs, transactionDir, stillStagedDir, persistence, workspaceRegistry, registryIndex, ctx };
}

test('linked deletion closure is transitive, deterministic, and excludes unrelated sessions', () => {
  const rows = [
    { id: 'root' },
    { id: 'worker-z', parentSession: 'root' },
    { id: 'fork-a', parentSession: 'root' },
    { id: 'fork-grandchild', parentSession: 'fork-a' },
    { id: 'unrelated-child', parentSession: 'unrelated' },
    { id: 'unrelated' },
  ];

  assert.deepEqual(linkedSessionClosure('root', rows), ['fork-a', 'worker-z', 'fork-grandchild']);
  assert.deepEqual(linkedSessionClosure('unrelated', rows), ['unrelated-child']);
  assert.deepEqual(linkedSessionClosure('missing', rows), []);
});

test('linked deletion closure terminates on malformed parent cycles without duplicating ids', () => {
  const rows = [
    { id: 'root' },
    { id: 'child', parentSession: 'root' },
    { id: 'root', parentSession: 'child' },
  ];

  assert.deepEqual(linkedSessionClosure('root', rows), ['child']);
});

test('agent creation guards use the actual create/resume id fields and follow session lineage', () => {
  assert.deepEqual(sessionCreationTargets('create', { sessionId: 'new', meta: { parentSession: 'parent' } }), { sessionId: 'new', parentId: 'parent' });
  assert.deepEqual(sessionCreationTargets('resume', { resumeSessionId: 'existing', parentAgent: { id: 'owner' }, meta: { parentSession: 'older-parent' } }), { sessionId: 'existing', parentId: 'owner' });
});

test('search cleanup reconciles enabled indexes and skips only the native disabled-index signal', async () => {
  let request;
  await reconcileSessionSearchIndex({ async searchSessions(value) { request = value; return { items: [] }; } });
  assert.match(request.query, /^notara-delete-/);
  assert.equal(request.limit, 1);

  let calls = 0;
  await reconcileSessionSearchIndex({ async searchSessions() { calls++; throw Object.assign(new Error('disabled'), { code: 'SESSION_QUERY_SEARCH_DISABLED' }); } });
  assert.equal(calls, 1);

  const unavailable = Object.assign(new Error('index failed'), { code: 'SESSION_QUERY_INDEX_FAILED' });
  await assert.rejects(reconcileSessionSearchIndex({ async searchSessions() { throw unavailable; } }), error => error === unavailable);
});

test('startup recovery rolls an interrupted staging transaction back to its original session folder', async () => {
  const fixture = await recoveryFixture('staging');
  try {
    const runtime = new SessionDeletionRuntime(fixture.ctx);
    await runtime.recoverStaging();
    assert.equal(await readFile(join(fixture.sessionDir, 'events.jsonl'), 'utf8'), 'session event log');
    assert.deepEqual(await readdir(fixture.transactionDir).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error)), []);
    assert.deepEqual(fixture.registryIndex.map(row => row.id), [SESSION_ID]);
    assert.equal(fixture.workspaceRegistry.archivedSessionIds.has(SESSION_ID), false);
    assert.equal(fixture.workspaceRegistry.pinnedSessionIds.has(SESSION_ID), true);
    assert.deepEqual(fixture.historyDeleteCalls, [], 'staging rollback preserves the derived archive');
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('startup recovery resumes a two-session rollback after one session was already restored', async () => {
  const fixture = await partialRollbackRecoveryFixture();
  try {
    const runtime = new SessionDeletionRuntime(fixture.ctx);
    await runtime.recoverStaging();

    assert.equal(await readFile(join(fixture.sessionDirs[0], 'events.jsonl'), 'utf8'), 'already restored session log');
    assert.equal(await readFile(join(fixture.sessionDirs[1], 'events.jsonl'), 'utf8'), 'still staged session log');
    assert.deepEqual(fixture.workspaceRegistry.archivedSessionIds, new Set());
    assert.deepEqual(fixture.workspaceRegistry.pinnedSessionIds, new Set(fixture.ids));
    assert.deepEqual(fixture.registryIndex.map(row => row.id).sort(), [...fixture.ids].sort());
    await assert.rejects(stat(fixture.transactionDir), error => error.code === 'ENOENT');
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('committed startup recovery retires the session before queries and agent resumes are released', async () => {
  const fixture = await recoveryFixture('committed');
  try {
    const runtime = new SessionDeletionRuntime(fixture.ctx);
    runtime.install();
    await fixture.searchEntered;
    assert.deepEqual(fixture.historyDeleteCalls, [[SESSION_ID]], 'committed cleanup retires the archive before native search reconciliation');

    const listPromise = fixture.query.listSessions();
    const resumePromise = fixture.agents.resume({ resumeSessionId: 'surviving-session' });
    await Promise.resolve();
    assert.equal(fixture.listCalls, 0);
    assert.equal(fixture.resumeCalls, 0);

    fixture.releaseSearch();
    await runtime.ready;
    assert.deepEqual(await listPromise, []);
    assert.equal((await resumePromise).agent.id, 'surviving-session');
    assert.equal(fixture.listCalls, 2); // internal verification, then the queued public list
    assert.equal(fixture.resumeCalls, 1);
    assert.equal(fixture.searchCalls, 1);
    assert.deepEqual(fixture.registryIndex, []);
    assert.deepEqual([...fixture.detached], [SESSION_ID]);
    assert.deepEqual(fixture.deletedProjectionIds, [SESSION_ID]);
    assert.equal(fixture.queryCache.has(SESSION_ID), false);
    assert.equal(fixture.persistence.coldLogMemo.has(SESSION_ID), false);
    assert.equal(fixture.persistence.migrationPreparations.has(SESSION_ID), false);
    assert.equal(runtime.retired.has(SESSION_ID), true);
    assert.deepEqual(await readdir(fixture.transactionDir).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error)), []);
  } finally { fixture.releaseSearch(); await rm(fixture.root, { recursive: true, force: true }); }
});

test('failed committed archive cleanup keeps its durable manifest and startup retries before releasing queries', async () => {
  const fixture = await recoveryFixture('committed'), cleanupEntered = deferred(), releaseCleanup = deferred();
  try {
    const manifestPath = join(fixture.transactionDir, 'notara-session-deletion.json');
    const committedManifest = await readFile(manifestPath, 'utf8');
    fixture.recoveryHooks.historyDelete = async () => { throw new Error('archive_cleanup_failed'); };
    const failedRuntime = new SessionDeletionRuntime(fixture.ctx);
    failedRuntime.install();
    await Promise.all([
      assert.rejects(failedRuntime.ready, /archive_cleanup_failed/),
      assert.rejects(fixture.query.listSessions(), /archive_cleanup_failed/),
      assert.rejects(fixture.agents.resume({ resumeSessionId: 'surviving-session' }), /archive_cleanup_failed/),
    ]);
    assert.deepEqual(fixture.historyDeleteCalls, [[SESSION_ID]]);
    assert.equal(await readFile(manifestPath, 'utf8'), committedManifest, 'failed cleanup must preserve the exact committed recovery manifest');
    assert.equal(await readFile(join(fixture.stagedDir, 'events.jsonl'), 'utf8'), 'session event log');
    assert.equal(fixture.listCalls, 0);
    assert.equal(fixture.resumeCalls, 0);
    assert.equal(fixture.searchCalls, 0);
    assert.deepEqual(fixture.deletedProjectionIds, [], 'later cache cleanup waits for archive cleanup');
    assert.equal(fixture.queryCache.has(SESSION_ID), true);
    assert.equal(failedRuntime.retired.has(SESSION_ID), true);
    await fixture.disposeRuntime();

    fixture.recoveryHooks.historyDelete = async () => { cleanupEntered.resolve(); await releaseCleanup.promise; };
    const recoveredRuntime = new SessionDeletionRuntime(fixture.ctx);
    recoveredRuntime.install();
    await cleanupEntered.promise;
    const listPromise = fixture.query.listSessions();
    const resumePromise = fixture.agents.resume({ resumeSessionId: 'surviving-session' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(fixture.historyDeleteCalls, [[SESSION_ID], [SESSION_ID]], 'the next startup retries the same durable owner ids');
    assert.equal(await readFile(manifestPath, 'utf8'), committedManifest);
    assert.equal(fixture.listCalls, 0);
    assert.equal(fixture.resumeCalls, 0);
    assert.equal(fixture.searchCalls, 0);
    releaseCleanup.resolve();
    await fixture.searchEntered;
    assert.equal(fixture.listCalls, 0, 'queries also wait for the native reconciliation after archive cleanup');
    assert.equal(fixture.resumeCalls, 0);
    fixture.releaseSearch();
    await recoveredRuntime.ready;
    assert.deepEqual(await listPromise, []);
    assert.equal((await resumePromise).agent.id, 'surviving-session');
    assert.equal(fixture.listCalls, 2);
    assert.equal(fixture.resumeCalls, 1);
    assert.deepEqual(fixture.deletedProjectionIds, [SESSION_ID]);
    assert.equal(fixture.queryCache.has(SESSION_ID), false);
    assert.equal(recoveredRuntime.retired.has(SESSION_ID), true);
    await assert.rejects(stat(fixture.transactionDir), error => error.code === 'ENOENT');
  } finally {
    releaseCleanup.resolve(); fixture.releaseSearch();
    await fixture.disposeRuntime();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('deletion blocks live-session mutations for the whole tree while reads, stopping and other classrooms remain usable', async () => {
  const fixture = await controllerGuardFixture(), entered = deferred(), release = deferred();
  let deletion;
  try {
    const { runtime, controller } = fixture;
    const preview = await runtime.previewDeletion({ sessionId: 'class' });
    fixture.hooks.activity = async () => { if (runtime.isBlocked('class')) { entered.resolve(); await release.promise; } };
    deletion = runtime.deleteConversation({ sessionId: 'class', token: preview.token, typedTitle: preview.title });
    await entered.promise;
    for (const sessionId of ['class', 'child']) {
      for (const method of ['create', 'fork', 'prompt', 'rename', 'selectModel', 'updateQueue']) {
        await assert.rejects(controller[method]({ sessionId, title: '不能落入删除中的日志' }), /session_delete_in_progress/);
      }
    }
    assert.deepEqual(fixture.calls, []);
    assert.equal(fixture.rows.get('class').title, preview.title);
    assert.equal((await controller.list()).items.length, 3);
    assert.deepEqual(await controller.cancel({ sessionId: 'class' }), { cancelled: 'class' });
    for (const method of ['create', 'fork', 'prompt', 'rename', 'selectModel', 'updateQueue']) {
      assert.deepEqual(await controller[method]({ sessionId: 'other', title: '另一课堂照常操作' }), { accepted: true });
    }
    release.resolve();
    await assert.rejects(deletion, /session_delete_rollback_failed/);
    assert.equal(fixture.removals, 1);
    assert.equal(runtime.isBlocked('class'), true);
    assert.equal(runtime.isBlocked('child'), true);
    await assert.rejects(runtime.previewDeletion({sessionId:'class'}),/session_delete_rollback_failed/);
    const signal = new AbortController().signal;
    for (const sessionId of ['class', 'child']) {
      for (const method of ['create', 'fork', 'prompt', 'rename', 'selectModel', 'updateQueue']) {
        await assert.rejects(controller[method]({ sessionId, title: '恢复完成前不允许覆盖日志' }, signal),/session_delete_in_progress/);
      }
    }
    await fixture.dispose();
    for (const [method, original] of Object.entries(fixture.originals)) assert.equal(controller[method], original);
  } finally { release.resolve(); await deletion?.catch(() => {}); await fixture.dispose(); }
});

test('deletion waits for an already-admitted rename and rejects the now-stale confirmation without removing records', async () => {
  const fixture = await controllerGuardFixture(), entered = deferred(), release = deferred();
  let rename, deletion;
  try {
    const { runtime, controller } = fixture;
    const preview = await runtime.previewDeletion({ sessionId: 'class' });
    fixture.hooks.rename = async () => { entered.resolve(); await release.promise; };
    rename = controller.rename({ sessionId: 'class', title: '确认后已修改' });
    await entered.promise;
    deletion = runtime.deleteConversation({ sessionId: 'class', token: preview.token, typedTitle: preview.title });
    await new Promise(done => setImmediate(done));
    assert.equal(runtime.isBlocked('class'), true);
    assert.equal(fixture.removals, 0);
    release.resolve();
    await rename;
    await assert.rejects(deletion, /session_delete_confirmation_stale/);
    assert.equal(fixture.removals, 0);
    assert.equal(fixture.rows.get('class').title, '确认后已修改');
    assert.equal(runtime.isBlocked('class'), false);
    assert.deepEqual(await controller.rename({ sessionId: 'class', title: '取消删除后正常改名' }), { accepted: true });
  } finally { release.resolve(); await rename?.catch(() => {}); await deletion?.catch(() => {}); await fixture.dispose(); }
});

test('an unused deletion preview leaves normal classroom editing available and becomes stale after a change', async () => {
  const fixture = await controllerGuardFixture();
  try {
    const { runtime, controller } = fixture;
    const preview = await runtime.previewDeletion({ sessionId: 'class' });
    assert.deepEqual(await controller.rename({ sessionId: 'class', title: '关闭确认窗继续学习' }), { accepted: true });
    await assert.rejects(runtime.deleteConversation({ sessionId: 'class', token: preview.token, typedTitle: preview.title }), /session_delete_confirmation_stale/);
    assert.equal(fixture.removals, 0);
    assert.equal(runtime.isBlocked('class'), false);
    assert.deepEqual(await controller.updateQueue({ sessionId: 'class' }), { accepted: true });
  } finally { await fixture.dispose(); }
});
