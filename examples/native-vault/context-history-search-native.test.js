import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import { createUserMessage, createAssistantMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm';
import { NotaraContextHistory } from './context-history.js';
import { ContextHistoryClient } from './context-history-client.js';
import { prepareNativeEventRecord } from './context-history-record.js';

// Native immutable events and fork repair, real private worker; no Host or user data.
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'notara-history-search-native-'));
  const ctx = new Context(), fibers = [], detaches = [], histories = [], clients = [];
  fibers.push(await ctx.plugin(SessionStore), await ctx.plugin(SessionQueryEngine));
  t.after(async () => {
    for (const { history, fiber } of histories) { await history.close(); await fiber.dispose(); }
    for (const client of clients) await client.close();
    for (const detach of detaches.reverse()) detach();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    const path = resolve(dir);
    assert.equal(dirname(path), resolve(tmpdir())); assert.ok(basename(path).startsWith('notara-history-search-native-'));
    await rm(path, { recursive: true, force: true });
  });
  return {
    ctx,
    client() { const client = new ContextHistoryClient({ path: join(dir, 'history.sqlite') }); clients.push(client); return client; },
    async history() {
      const fiber = await ctx.plugin(NotaraContextHistory, { path: join(dir, 'history.sqlite') });
      const history = ctx.notaraHistory; histories.push({ history, fiber }); return history;
    },
    async stop(history) { await history.close(); await histories.find(row => row.history === history).fiber.dispose(); },
    session(id = `search-${crypto.randomUUID()}`, options = {}) {
      const session = ctx.sessions.prepare(SessionId(id), { meta: { cwd: dir }, ...options });
      const detach = ctx.sessions.enter(session); detaches.push(detach); ctx.sessions.announce(session);
      return { session, detach };
    },
  };
}
const text = body => ({ type: 'text', text: body });
const user = (session, body) => session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [text(body)] }), { surfaceOp: 'append' });
const tool = (name, args, id = crypto.randomUUID()) => ({ type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args) });
const assistant = (session, turn, step, calls, body = '') => session.append('assistant/message', {
  turn, step, stream: [], message: createAssistantMessage({ source: { provider: 'synthetic-only', model: 'history-search-fixture' },
    content: [...(body ? [text(body)] : []), ...calls] }),
}, { surfaceOp: 'append' });
const call = (session, turn, step, block) => session.append('tool/call', {
  turn, step, callId: block.id, name: block.name, arguments: block.arguments,
});
const result = (session, turn, step, id, body) => session.append('tool/result', {
  turn, step, message: createToolResultMessage({ callId: ToolCallId(id), isError: false, content: [text(body)] }),
}, { surfaceOp: 'append' });
const start = (session, turn, step = 1) => {
  session.append('turn/start', { turn }); session.append('step/start', { turn, step });
};
const end = (session, turn, step = 1) => {
  session.append('step/end', { turn, step }); session.append('turn/end', { turn, reason: { kind: 'stop' } });
};
function echoCycle(session, turn, query, originalSeq, original) {
  start(session, turn);
  const search = tool('history_search', { query }), read = tool('history_read', { seq: originalSeq });
  const message = assistant(session, turn, 1, [search, read]);
  const searched = call(session, turn, 1, search);
  const searchResult = result(session, turn, 1, search.id, JSON.stringify({ query, hits: [{ seq: originalSeq, preview: original }] }));
  const readCall = call(session, turn, 1, read);
  const readResult = result(session, turn, 1, read.id, JSON.stringify({ seq: originalSeq, record: { blocks: [text(original)] } }));
  end(session, turn);
  return { message, searched, searchResult, readCall, readResult, search, read };
}
async function snapshot(ctx, owner) {
  const cut = await ctx.sessionQuery.observeSession(owner.id, { projectionMode: 'none' });
  try { return [...cut.events]; } finally { cut[Symbol.dispose](); }
}
async function raw(history, owner, seq) {
  let afterPart = -1, body = '', event;
  for (;;) {
    const page = await history.page(owner, { seq, afterPart }); event ??= page.event;
    for (const row of page.rows) { assert.equal(row.start, body.length); body += row.body; }
    if (page.done) break;
    afterPart = page.rows.at(-1).part;
  }
  assert.equal(createHash('sha256').update(body).digest('hex'), event.hash);
  assert.equal(body.length, event.chars); assert.equal(Buffer.byteLength(body), event.bytes);
  return { encoded: body, record: JSON.parse(body), metadata: event };
}
const hits = (history, owner, query) => history.search(owner, { query }).then(value => value.results);
const exact = rows => rows.filter(row => row.hitKind === 'query-literal');

test('a query absent from real content has no hits from its own history invocation or repeated receipts', async t => {
  const f = await fixture(t), { session } = f.session(), history = await f.history();
  user(session, 'Independent canonical student content.');
  const query = 'absent_history_query_972381';
  const cycle = echoCycle(session, 1, query, 0, `Echoed lookup payload ${query}`);
  assert.deepEqual(await hits(history, session, query), []);
  assert.equal((await raw(history, session, cycle.searched.seq)).record.arguments, cycle.search.arguments);
  assert.equal((await raw(history, session, cycle.readCall.seq)).record.arguments, cycle.read.arguments);
  assert.equal((await raw(history, session, cycle.message.seq)).record.blocks[0].arguments, cycle.search.arguments);
  assert.equal((await raw(history, session, cycle.searchResult.seq)).record.blocks[0].text, cycle.searchResult.data.message.content[0].text);
  assert.equal((await raw(history, session, cycle.readResult.seq)).record.blocks[0].text, cycle.readResult.data.message.content[0].text);
});

test('one long original remains a candidate after one hundred search/read echo cycles', async t => {
  const f = await fixture(t), { session } = f.session(), history = await f.history();
  const query = 'long_original_retrieval_876321';
  const original = `${'甲'.repeat(2000)} ${query} ${'乙'.repeat(2000)}`, source = user(session, original);
  await history.ensure(session);
  let last;
  for (let turn = 1; turn <= 100; turn++) last = echoCycle(session, turn, query, source.seq, original);
  const found = exact(await hits(history, session, query));
  assert.deepEqual([...new Set(found.map(row => row.seq))], [source.seq]);
  assert.equal((await raw(history, session, source.seq)).record.blocks[0].text, original);
  assert.equal((await raw(history, session, last.readResult.seq)).record.blocks[0].text, last.readResult.data.message.content[0].text);
});

test('mixed assistant prose and ordinary tools stay searchable while history arguments and paired results are masked', async t => {
  const f = await fixture(t), { session } = f.session(), history = await f.history();
  const visible = 'visible_assistant_marker_452783', hidden = 'history_arguments_only_452783';
  const ordinaryArgs = 'ordinary_arguments_marker_452783', ordinaryResult = 'ordinary_result_marker_452783';
  const unknown = 'unknown_result_marker_452783';
  start(session, 1);
  const historyCall = tool('history_search', { query: hidden }), ordinary = tool('vault_read', { path: ordinaryArgs });
  const mixed = assistant(session, 1, 1, [historyCall, ordinary], visible);
  call(session, 1, 1, historyCall); const masked = result(session, 1, 1, historyCall.id, hidden);
  const ordinaryCall = call(session, 1, 1, ordinary), ordinaryOutput = result(session, 1, 1, ordinary.id, ordinaryResult);
  const unmatched = result(session, 1, 1, 'never-issued-in-this-step', unknown);
  end(session, 1);
  assert.ok(exact(await hits(history, session, visible)).some(row => row.seq === mixed.seq));
  assert.deepEqual(await hits(history, session, hidden), []);
  assert.ok(exact(await hits(history, session, ordinaryArgs)).some(row => row.seq === ordinaryCall.seq));
  assert.ok(exact(await hits(history, session, ordinaryResult)).some(row => row.seq === ordinaryOutput.seq));
  assert.ok(exact(await hits(history, session, unknown)).some(row => row.seq === unmatched.seq));
  const read = (await raw(history, session, mixed.seq)).record;
  assert.equal(read.blocks[0].text, visible); assert.equal(read.blocks[1].arguments, historyCall.arguments);
  assert.equal(read.blocks[2].arguments, ordinary.arguments);
  assert.equal((await raw(history, session, masked.seq)).record.blocks[0].text, hidden);
});

test('the same native call id in other steps or turns cannot inherit a history-result mask', async t => {
  const f = await fixture(t), { session } = f.session(), history = await f.history(), id = 'reused-native-call';
  const hidden = 'same_scope_history_only_849273';
  start(session, 1);
  const historyCall = tool('history_read', { seq: 0 }, id);
  assistant(session, 1, 1, [historyCall]); call(session, 1, 1, historyCall); result(session, 1, 1, id, hidden);
  session.append('step/end', { turn: 1, step: 1 }); session.append('step/start', { turn: 1, step: 2 });
  const second = tool('vault_read', { path: 'ordinary.md' }, id);
  assistant(session, 1, 2, [second]); call(session, 1, 2, second);
  const stepResult = result(session, 1, 2, id, 'same_id_other_step_849273');
  end(session, 1, 2);
  start(session, 2);
  const unknownResult = result(session, 2, 1, id, 'same_id_unknown_other_turn_849273');
  end(session, 2);
  start(session, 3);
  const third = tool('vault_search', { query: 'ordinary' }, id);
  assistant(session, 3, 1, [third]); call(session, 3, 1, third);
  const turnResult = result(session, 3, 1, id, 'same_id_other_turn_849273'); end(session, 3);
  assert.deepEqual(await hits(history, session, hidden), []);
  for (const event of [stepResult, unknownResult, turnResult]) {
    const body = event.data.message.content[0].text;
    assert.ok(exact(await hits(history, session, body)).some(row => row.seq === event.seq), body);
    assert.equal((await raw(history, session, event.seq)).record.blocks[0].text, body);
  }
});

test('native unfinished fork repair classifies inherited calls without masking an ordinary synthetic result', async t => {
  const f = await fixture(t), { session: parent } = f.session(), history = await f.history();
  start(parent, 1);
  const lookup = tool('history_search', { query: 'fork_history_argument_839201' }, 'fork-history-call');
  const ordinary = tool('vault_read', { path: 'ordinary.md' }, 'fork-ordinary-call');
  assistant(parent, 1, 1, [lookup, ordinary]); call(parent, 1, 1, lookup);
  const boundary = call(parent, 1, 1, ordinary);
  const child = f.ctx.sessions.fork(parent, boundary.seq, SessionId('unfinished-history-fork'));
  const log = await snapshot(f.ctx, child);
  const repaired = log.filter(event => event.type === 'tool/result');
  const hiddenResult = repaired.find(event => event.data.message.toolCallId === lookup.id);
  const ordinaryResult = repaired.find(event => event.data.message.toolCallId === ordinary.id);
  assert.ok(hiddenResult); assert.ok(ordinaryResult);
  const ordinaryBody = ordinaryResult.data.message.content.map(block => block.text ?? '').join('');
  assert.ok(ordinaryBody.length);
  const found = exact(await hits(history, child, ordinaryBody));
  assert.ok(found.some(row => row.seq === ordinaryResult.seq));
  assert.ok(!found.some(row => row.seq === hiddenResult.seq));
  assert.deepEqual(await hits(history, child, 'fork_history_argument_839201'), []);
  for (const event of repaired) {
    assert.equal((await raw(history, child, event.seq)).record.blocks.map(block => block.text ?? '').join(''),
      event.data.message.content.map(block => block.text ?? '').join(''));
  }
});

test('replaying an unfinished native call rebuilds its pairing before a live result arrives', async t => {
  const f = await fixture(t), current = f.session('unfinished-history-replay'), history = await f.history();
  start(current.session, 1);
  const lookup = tool('history_search', { query: 'replay_history_argument_492183' }, 'replay-history-call');
  assistant(current.session, 1, 1, [lookup]); call(current.session, 1, 1, lookup);
  await history.ensure(current.session);
  const seed = await snapshot(f.ctx, current.session), meta = current.session.header;
  current.detach();
  const replay = f.session(meta.id, { seed, meta }).session;
  await history.ensure(replay);
  const completed = result(replay, 1, 1, lookup.id, 'replay_history_argument_492183'); end(replay, 1);
  assert.deepEqual(await hits(history, replay, 'replay_history_argument_492183'), []);
  assert.equal((await raw(history, replay, completed.seq)).record.blocks[0].text, 'replay_history_argument_492183');
});

test('worker restart retains byte-exact canonical history but never restores masked search echoes', async t => {
  const f = await fixture(t), { session } = f.session(), first = await f.history();
  const original = user(session, 'restart_search_original_942781 中文😀 exact original.');
  const echo = echoCycle(session, 1, 'restart_search_original_942781', original.seq, original.data.content[0].text);
  const seqs = [original, echo.message, echo.searched, echo.searchResult, echo.readCall, echo.readResult].map(event => event.seq);
  const before = new Map(); for (const seq of seqs) before.set(seq, await raw(first, session, seq));
  const previousScope = await first.ensure(session);
  assert.deepEqual([...new Set(exact(await hits(first, session, 'restart_search_original_942781')).map(row => row.seq))], [original.seq]);
  await f.stop(first); const restarted = await f.history();
  const reusedScope = await restarted.ensure(session);
  assert.equal(reusedScope.scope, previousScope.scope); assert.equal(reusedScope.generation, previousScope.generation);
  assert.deepEqual([...new Set(exact(await hits(restarted, session, 'restart_search_original_942781')).map(row => row.seq))], [original.seq]);
  for (const seq of seqs) {
    const after = await raw(restarted, session, seq);
    assert.equal(after.encoded, before.get(seq).encoded); assert.equal(after.metadata.hash, before.get(seq).metadata.hash);
  }
});

test('a legacy binding with searchable echoes is retired and rebuilt from canonical native records under the new policy', async t => {
  const f = await fixture(t), { session } = f.session(), client = f.client();
  user(session, 'An independent original without the lookup token.');
  const query = 'legacy_search_echo_714832', echo = echoCycle(session, 1, query, 0, query);
  const header = session.header;
  const oldBinding = createHash('sha256').update(JSON.stringify([
    'notara-native-history-v1', 'native-event-v1', header.version, header.id, header.createdAt, header.cwd ?? null,
    header.parentSession ?? null, header.isSeeded, header.origin ?? null, header.delegationDepth ?? null,
    header.agentPreset ?? null, session.inheritedEventCount,
  ])).digest('hex');
  const legacy = await client.bindSession(session.id, oldBinding);
  for (const event of await snapshot(f.ctx, session)) {
    const record = await prepareNativeEventRecord(event);
    if (record.kind === 'skip') {
      await client.skipEvents(legacy.scope, legacy.generation, event.seq, [{ seq: record.seq, type: record.type, reason: record.reason }]);
    } else {
      const { search: _searchPolicy, ...metadata } = record.metadata;
      let receipt = await client.beginEvent(legacy.scope, legacy.generation, metadata);
      for await (const batch of record.batches()) receipt = await client.appendChunks(legacy.scope, legacy.generation,
        event.seq, receipt.offset, batch);
      await client.finishEvent(legacy.scope, legacy.generation, event.seq, receipt.parts);
    }
  }
  assert.ok(exact((await client.search(legacy.scope, legacy.generation, query)).results).length > 0,
    'the legacy fixture reproduces the searchable tool echo');
  const oldPage = await client.page(legacy.scope, legacy.generation, echo.searchResult.seq);
  const originalBytes = oldPage.rows.map(row => row.body).join('');
  const history = await f.history(), current = await history.ensure(session);
  assert.notEqual(current.scope, legacy.scope);
  assert.equal((await client.inspect(legacy.scope)).state, 'deleted');
  await assert.rejects(client.page(legacy.scope, legacy.generation, echo.searchResult.seq));
  assert.deepEqual(await hits(history, session, query), []);
  assert.equal((await raw(history, session, echo.searchResult.seq)).encoded, originalBytes);
});
