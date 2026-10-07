import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_HISTORY_LIMIT, parseBoard } from './board-data.js';
import { createBoardEditing } from './board-editing-runtime.js';
import { boardObjectHash } from './board-storage.js';

test('history rotates at capacity and unchanged board polls reuse immutable commit reads', async () => {
  const sessionId = 'history-test', objects = new Map();
  let board = { sessionId, formatVersion: 2, sections: [], blocks: [], sourceNotes: {}, manualEdges: [], groups: [], historyRefs: [] };
  let revision = 'r0', reads = 0, writes = 0;
  for (let index = 0; index < BOARD_HISTORY_LIMIT; index++) {
    const entry = { kind: 'commit', id: `old-${index}`, actor: 'student', at: new Date(index).toISOString(), requestId: null, requestHash: '0'.repeat(64), created: {}, changes: [] };
    const ref = boardObjectHash(entry);
    objects.set(ref, entry);
    board.historyRefs.push(ref);
  }
  const originalRefs = [...board.historyRefs];
  const store = {
    async read(_sessionId, ref) {
      reads++;
      const value = objects.get(ref);
      if (!value) throw new Error('board_content_missing');
      return structuredClone(value);
    },
    async write(_sessionId, value) {
      writes++;
      const ref = boardObjectHash(value);
      objects.set(ref, structuredClone(value));
      return ref;
    },
    async copy(from, to, ref) { return this.write(to, await this.read(from, ref)); },
  };
  const io = {
    workspace: { id: 'workspace-history', path: '/isolated/history' },
    rootPath: '/isolated/history',
    async save(_path, content, expectedRevision) {
      if (expectedRevision !== revision) throw new Error('vault_revision_conflict');
      board = parseBoard(content, sessionId);
      revision = `r${Number(revision.slice(1)) + 1}`;
      return { revision };
    },
  };
  const agent = { session: { id: sessionId, header: {} } };
  const service = {
    ctx: {},
    async agentFor(id) { if (id !== sessionId) throw new Error('teaching_session_required'); return agent; },
    async editorFor() { return io; },
    isTeaching() { return true; },
  };
  const editing = createBoardEditing(service, {
    readState: async () => ({ revision, board: structuredClone(board) }),
    project: async (_io, state) => ({ revision: state.revision, blocks: state.board.blocks }),
    pathFor: () => 'lesson-board/history-test.md',
    objectStoreFactory: () => store,
  });

  assert.equal((await editing.contributionView({ sessionId })).length, BOARD_HISTORY_LIMIT);
  assert.equal(reads, BOARD_HISTORY_LIMIT);
  await editing.contributionView({ sessionId });
  assert.equal(reads, BOARD_HISTORY_LIMIT, 'a poll at the same revision performs no history object reads');

  const saved = await editing.commit({
    sessionId,
    expectedRevision: revision,
    ops: [{ type: 'create', ref: 'new', title: '继续写入', body: '达到原硬顶后仍可保存。', contentType: 'text' }],
  });
  assert.equal(saved.saved, true);
  assert.equal(writes, 1);
  assert.equal(board.historyRefs.length, BOARD_HISTORY_LIMIT);
  assert.deepEqual(board.historyRefs.slice(0, -1), originalRefs.slice(1));
  assert.equal(objects.get(board.historyRefs.at(-1)).id, saved.commitId);
  assert.equal(saved.contributions.length, BOARD_HISTORY_LIMIT);
  assert.equal(reads, BOARD_HISTORY_LIMIT);

  const second = await editing.commit({
    sessionId,
    expectedRevision: revision,
    ops: [{ type: 'create', ref: 'next', title: '继续写入 2', body: '保留超预算对象时仍可提交。', contentType: 'text' }],
  });
  assert.equal(second.saved, true);
  assert.equal(reads, BOARD_HISTORY_LIMIT, 'subsequent commits use cached summaries, including the prior appended entry');
  assert.equal(board.historyRefs.length, BOARD_HISTORY_LIMIT);
  assert.deepEqual(board.historyRefs.slice(0, -2), originalRefs.slice(2));
  assert.equal(objects.get(board.historyRefs.at(-2)).id, saved.commitId);
  assert.equal(objects.get(board.historyRefs.at(-1)).id, second.commitId);

  const readsBeforeNextPoll = reads;
  assert.equal((await editing.contributionView({ sessionId })).length, BOARD_HISTORY_LIMIT);
  assert.equal(reads, readsBeforeNextPoll, 'the appended commit summary is cached before the next poll');
  await editing.contributionView({ sessionId });
  assert.equal(reads, readsBeforeNextPoll);
});

test('summary cache keeps normal patches and idempotent retries from rereading over-budget full history', async () => {
  const sessionId = 'large-history-test', objects = new Map();
  let board = { sessionId, formatVersion: 2, sections: [], blocks: [], sourceNotes: {}, manualEdges: [], groups: [], historyRefs: [] };
  let revision = 'r0', reads = 0;
  for (let index = 0; index < 2; index++) {
    const entry = { kind: 'commit', id: `large-${index}`, actor: 'student', at: new Date(index).toISOString(), changes: [], retainedText: 'x'.repeat(8 * 1024 * 1024 + 1) };
    const ref = boardObjectHash(entry);objects.set(ref, entry);board.historyRefs.push(ref);
  }
  const store = {
    async read(_sessionId, ref) { reads++;return structuredClone(objects.get(ref)); },
    async write(_sessionId, value) { const ref = boardObjectHash(value);objects.set(ref, structuredClone(value));return ref; },
    async copy(from, to, ref) { return this.write(to, await this.read(from, ref)); },
  };
  const io = {
    workspace: { id: 'workspace-large', path: '/isolated/large' },
    rootPath: '/isolated/large',
    async save(_path, content, expectedRevision) {
      if (expectedRevision !== revision) throw new Error('vault_revision_conflict');
      board = parseBoard(content, sessionId);revision = 'r1';return { revision };
    },
  };
  const agent = { session: { id: sessionId, header: {} } };
  const service = { ctx: {}, async agentFor() { return agent; }, async editorFor() { return io; }, isTeaching() { return true; } };
  const editing = createBoardEditing(service, {
    readState: async () => ({ revision, board: structuredClone(board) }),
    project: async (_io, state) => ({ revision: state.revision, blocks: state.board.blocks }),
    pathFor: () => 'lesson-board/large-history-test.md',
    objectStoreFactory: () => store,
  });

  assert.equal((await editing.contributionView({ sessionId })).length, 2);
  assert.equal(reads, 2);
  await editing.contributionView({ sessionId });
  assert.equal(reads, 2, 'compact summaries keep polling free of object reads');
  const request = { sessionId, expectedRevision: revision, requestId: 'large-history-request', ops: [{ type: 'create', ref: 'new', title: '提交', body: '继续。', contentType: 'text' }] };
  const saved = await editing.commit(request);
  assert.equal(saved.saved, true);
  assert.equal(reads, 2, 'the commit precheck and receipt use compact summaries instead of rereading uncached full records');
  const duplicate = await editing.commit(request);
  assert.equal(duplicate.commitId, saved.commitId);
  assert.equal(reads, 2, 'idempotent retries use the request fields in cached summaries');
});

test('content lazily reads only target body and title originals from summarized history', async () => {
  const sessionId = 'content-history-test', blockId = 'target-block', objects = new Map(), historyRefs = [], readRefs = [];
  const block = { id: blockId, section: 's-1234abcd', kind: 'note', size: 'narrow', title: 'after title', body: 'final body', contentType: 'text' };
  const body = { kind: 'commit', id: 'body-change', actor: 'teacher', at: '2026-10-06T00:00:00.000Z', changes: [{ collection: 'blocks', id: blockId, field: 'body', before: 'before body', after: 'middle body' }] };
  const title = { kind: 'commit', id: 'title-change', actor: 'teacher', at: '2026-10-06T00:00:01.000Z', changes: [{ collection: 'blocks', id: blockId, field: 'title', before: 'before title', after: 'after title' }] };
  const undo = { kind: 'commit', id: 'body-undo', actor: 'teacher', at: '2026-10-06T00:00:02.000Z', undoOf: body.id, changes: [{ collection: 'blocks', id: blockId, field: 'body', before: 'middle body', after: 'final body' }] };
  const layout = { kind: 'commit', id: 'layout-change', actor: 'teacher', at: '2026-10-06T00:00:03.000Z', changes: [{ collection: 'blocks', id: blockId, field: 'x', before: 0, after: 20 }] };
  const add = entry => { const ref = boardObjectHash(entry);objects.set(ref, entry);historyRefs.push(ref);return ref; };
  const bodyRef = add(body), titleRef = add(title), undoRef = add(undo), layoutRef = add(layout);
  for (let index = 0; index < 24; index++) {
    add({ kind: 'commit', id: `other-${index}`, actor: 'student', at: new Date(index + 4).toISOString(), changes: [{ collection: 'blocks', id: `other-block-${index}`, field: 'body', before: 'prior', after: 'updated' }], retainedText: 'z'.repeat(1024 * 1024) });
  }
  const board = { sessionId, formatVersion: 2, sections: [{ id: block.section, title: '板书' }], blocks: [block], sourceNotes: {}, manualEdges: [], groups: [], historyRefs };
  const store = {
    async read(_sessionId, ref) { readRefs.push(ref);const value = objects.get(ref);if (!value) throw new Error('board_content_missing');return structuredClone(value); },
    async write(_sessionId, value) { const ref = boardObjectHash(value);objects.set(ref, structuredClone(value));return ref; },
    async copy(from, to, ref) { return this.write(to, await this.read(from, ref)); },
  };
  const io = { workspace: { id: 'workspace-content-history', path: '/isolated/content-history' }, rootPath: '/isolated/content-history' };
  const agent = { session: { id: sessionId, header: {} } };
  const service = { ctx: {}, async agentFor() { return agent; }, async editorFor() { return io; }, isTeaching() { return true; } };
  const editing = createBoardEditing(service, {
    readState: async () => ({ revision: 'r1', board: structuredClone(board) }),
    project: async (_io, state) => ({ revision: state.revision, blocks: state.board.blocks }),
    pathFor: () => 'lesson-board/content-history-test.md',
    objectStoreFactory: () => store,
  });

  assert.equal((await editing.contributionView({ sessionId })).length, historyRefs.length);
  assert.equal(readRefs.length, historyRefs.length, 'the initial summary pass reads each commit once');
  readRefs.length = 0;

  const result = await editing.content({ sessionId, blockId });
  assert.deepEqual(readRefs, [bodyRef, titleRef, undoRef], 'large commits for other blocks and the layout-only commit are not reread in full');
  assert.deepEqual(result.contributions.map(({ id }) => id), [body.id, title.id, undo.id, layout.id]);
  assert.deepEqual(result.contributions[0].original, [{ field: 'body', before: 'before body', after: 'middle body' }]);
  assert.equal(result.contributions[0].undone, true);
  assert.equal(result.contributions[0].canUndo, false);
  assert.deepEqual(result.contributions[1].original, [{ field: 'title', before: 'before title', after: 'after title' }]);
  assert.deepEqual(result.contributions[2].original, [{ field: 'body', before: 'middle body', after: 'final body' }]);
  assert.equal(result.contributions[2].undoOf, body.id);
  assert.deepEqual(result.contributions[3].original, []);
});

test('undo loads its one full target after summary-only preflight, including selected-scope validation', async () => {
  const sessionId = 'summary-undo-test', objects = new Map(), block = { id: 'block-1', section: 's-1234abcd', kind: 'note', size: 'narrow', title: '块', body: 'after', contentType: 'text' };
  let board = { sessionId, formatVersion: 2, sections: [{ id: block.section, title: '板书' }], blocks: [block], sourceNotes: {}, manualEdges: [], groups: [], historyRefs: [] };
  let revision = 'r0', reads = 0;
  const target = { kind: 'commit', id: 'target-commit', actor: 'teacher', at: '2026-10-06T00:00:00.000Z', requestId: null, requestHash: '0'.repeat(64), created: {}, changes: [{ collection: 'blocks', id: block.id, field: 'body', before: 'before', after: 'after' }], retainedText: 'x'.repeat(8 * 1024 * 1024 + 1) };
  const unrelated = { kind: 'commit', id: 'unrelated-commit', actor: 'student', at: '2026-10-06T00:00:01.000Z', requestId: null, requestHash: '0'.repeat(64), created: {}, changes: [], retainedText: 'y'.repeat(8 * 1024 * 1024 + 1) };
  for (const entry of [target, unrelated]) { const ref = boardObjectHash(entry);objects.set(ref, entry);board.historyRefs.push(ref); }
  const store = {
    async read(_sessionId, ref) { reads++;return structuredClone(objects.get(ref)); },
    async write(_sessionId, value) { const ref = boardObjectHash(value);objects.set(ref, structuredClone(value));return ref; },
    async copy(from, to, ref) { return this.write(to, await this.read(from, ref)); },
  };
  const io = {
    workspace: { id: 'workspace-undo', path: '/isolated/undo' }, rootPath: '/isolated/undo',
    async save(_path, content, expectedRevision) { if (expectedRevision !== revision) throw new Error('vault_revision_conflict');board = parseBoard(content, sessionId);revision = 'r1';return { revision }; },
  };
  const agent = { session: { id: sessionId, header: {} } };
  const service = { ctx: {}, async agentFor() { return agent; }, async editorFor() { return io; }, isTeaching() { return true; } };
  const editing = createBoardEditing(service, {
    readState: async () => ({ revision, board: structuredClone(board) }), project: async (_io, state) => ({ revision: state.revision, blocks: state.board.blocks }),
    pathFor: () => 'lesson-board/summary-undo.md', objectStoreFactory: () => store,
  });

  assert.equal((await editing.contributionView({ sessionId })).length, 2);
  assert.equal(reads, 2);
  await editing.bindSelection([{ blockId: block.id, elementIds: [] }], { sessionId, expectedRevision: revision });
  const saved = await editing.undo({ sessionId, commitId: target.id, expectedRevision: revision });
  assert.equal(saved.saved, true);
  assert.equal(reads, 3, 'only the selected undo target is reread as a full commit; unrelated full history stays uncached');
  assert.equal(board.blocks[0].body, 'before');
});

test('history caches evict the least recently used session after 32 active sessions', async () => {
  const sessionIds = Array.from({ length: 33 }, (_, index) => `session-${index}`), boards = new Map(), agents = new Map(), objects = new Map();
  let reads = 0;
  for (const sessionId of sessionIds) {
    const entry = { kind: 'commit', id: `commit-${sessionId}`, actor: 'student', at: '2026-10-06T00:00:00.000Z', changes: [] };
    const ref = boardObjectHash(entry);objects.set(ref, entry);
    boards.set(sessionId, { revision: 'r1', board: { sessionId, formatVersion: 2, sections: [], blocks: [], sourceNotes: {}, manualEdges: [], groups: [], historyRefs: [ref] } });
    agents.set(sessionId, { session: { id: sessionId, header: {} } });
  }
  const io = { workspace: { id: 'workspace-shared', path: '/isolated/shared' }, rootPath: '/isolated/shared' };
  const store = {
    async read(_sessionId, ref) { reads++;return structuredClone(objects.get(ref)); },
    async write(_sessionId, value) { const ref = boardObjectHash(value);objects.set(ref, structuredClone(value));return ref; },
    async copy(from, to, ref) { return this.write(to, await this.read(from, ref)); },
  };
  const service = {
    ctx: {},
    async agentFor(sessionId) { return agents.get(sessionId); },
    async editorFor() { return io; },
    isTeaching() { return true; },
  };
  const editing = createBoardEditing(service, {
    readState: async (_io, sessionId) => structuredClone(boards.get(sessionId)),
    project: async () => ({}),
    pathFor: () => 'lesson-board/session.md',
    objectStoreFactory: () => store,
  });

  for (const sessionId of sessionIds) await editing.contributionView({ sessionId });
  assert.equal(reads, sessionIds.length);
  await editing.contributionView({ sessionId: sessionIds[1] });
  await editing.contributionView({ sessionId: sessionIds[0] });
  assert.equal(reads, sessionIds.length + 1, 'the oldest session was evicted');
  await editing.contributionView({ sessionId: sessionIds[1] });
  assert.equal(reads, sessionIds.length + 1, 'a recently used session stayed cached');
});
