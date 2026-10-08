import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { ContextHistoryClient, BATCH_BUDGET, createHistoryPrefixHasher } from './context-history-client.js';
import { NotaraContextHistory, nativeHistoryBinding } from './context-history.js';
import { prepareNativeEventRecord } from './context-history-record.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'notara-history-adversarial-')), ctx = new Context();
  const fibers = [await ctx.plugin(SessionStore), await ctx.plugin(SessionQueryEngine)], detaches = [];
  fibers.push(await ctx.plugin(NotaraContextHistory, { path: join(dir, 'private.sqlite') }));
  const history = ctx.get('notaraHistory');
  t.after(async () => {
    await history.close(); for (const detach of detaches.reverse()) detach();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    const target = resolve(dir), remainder = relative(resolve(tmpdir()), target);
    assert.ok(remainder && !remainder.startsWith('..'));
    await rm(target, { recursive: true, force: true });
  });
  return { ctx, history, session(id = `synthetic-adversarial-${crypto.randomUUID()}`, options = {}) {
    const owner = ctx.sessions.prepare(SessionId(id), { meta: { cwd: dir, ...options.meta }, ...options });
    const detach = ctx.sessions.enter(owner); detaches.push(detach); ctx.sessions.announce(owner);
    return { owner, detach };
  } };
}
const add = (owner, text) => owner.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }), { surfaceOp: 'append' });
async function snapshot(ctx, owner) {
  const cut = await ctx.sessionQuery.observeSession(owner.id, { projectionMode: 'none' });
  try { return structuredClone(cut.events); } finally { cut[Symbol.dispose](); }
}
async function body(history, owner, seq) {
  let afterPart = -1; const chunks = [];
  for (;;) {
    const page = await history.page(owner, { seq, afterPart }); chunks.push(...page.rows.map(row => row.body));
    if (page.done) return JSON.parse(chunks.join('')).blocks[0].text;
    afterPart = page.rows.at(-1).part;
  }
}

test('cancellation after finish commit recovers watermark without rewriting the completed event', { concurrency: false }, async t => {
  const f = await fixture(t), { owner } = f.session(), text = 'committed_finish_marker_12398 原始字节。'.repeat(1000), event = add(owner, text);
  assert.ok((await prepareNativeEventRecord(event)).metadata.chars > BATCH_BUDGET.shortRecordChars);
  const controller = new AbortController(), originalFinish = ContextHistoryClient.prototype.finishEvent;
  const originalBegin = ContextHistoryClient.prototype.beginEvent; let committed = false, starts = 0;
  ContextHistoryClient.prototype.finishEvent = async function (...args) {
    const receipt = await originalFinish.apply(this, args);
    if (!committed && args[2] === event.seq) { committed = true; controller.abort(); }
    return receipt;
  };
  ContextHistoryClient.prototype.beginEvent = async function (...args) {
    if (args[2].seq === event.seq) starts++; return originalBegin.apply(this, args);
  };
  t.after(() => { ContextHistoryClient.prototype.finishEvent = originalFinish; ContextHistoryClient.prototype.beginEvent = originalBegin; });
  await assert.rejects(f.history.ensure(owner, { signal: controller.signal }));
  assert.ok(committed); assert.equal(starts, 1);
  assert.equal((await f.history.ensure(owner)).nextSeq, owner.seq);
  assert.equal(starts, 1, 'bootstrap trusts the verified completed prefix after lost acknowledgment');
  assert.equal(await body(f.history, owner, event.seq), text);
});

test('same-id replay with a changed interrupted tail retires prior pending bytes before resuming', { concurrency: false }, async t => {
  const f = await fixture(t), first = f.session(), oldText = 'old_pending_marker_98231 ' + '中文😀 '.repeat(18000);
  const event = add(first.owner, oldText), seed = await snapshot(f.ctx, first.owner), meta = first.owner.header;
  assert.ok((await prepareNativeEventRecord(event)).metadata.chars > BATCH_BUDGET.shortRecordChars);
  const controller = new AbortController(), original = ContextHistoryClient.prototype.appendChunks;
  let interrupted = false;
  ContextHistoryClient.prototype.appendChunks = async function (...args) {
    const receipt = await original.apply(this, args);
    if (!interrupted && args[2] === event.seq) { interrupted = true; controller.abort(); }
    return receipt;
  };
  t.after(() => { ContextHistoryClient.prototype.appendChunks = original; });
  await assert.rejects(f.history.ensure(first.owner, { signal: controller.signal }));
  const state = f.history.active.get(first.owner.id), oldScope = state.scope;
  assert.equal((await f.history.archive.inspect(oldScope)).nextSeq, event.seq);
  assert.ok((await f.history.archive.inspectEvent(oldScope, state.generation, event.seq)).receipt.offset > 0);
  first.detach();
  const changedText = 'new_pending_marker_98231 ' + '中文😀 '.repeat(18000);
  seed[event.seq].data.content[0].text = changedText;
  const replacement = f.session(first.owner.id, { seed, meta }).owner;
  const bound = await f.history.ensure(replacement);
  assert.notEqual(bound.scope, oldScope);
  assert.equal((await f.history.archive.inspect(oldScope)).state, 'deleted');
  assert.equal(await body(f.history, replacement, event.seq), changedText);
  assert.deepEqual((await f.history.search(replacement, { query: 'old_pending_marker_98231' })).results, []);
});

test('short mixed batch cancellation after commit recovers a complete native prefix exactly once', { concurrency: false }, async t => {
  const f = await fixture(t), { owner } = f.session(), events = [];
  for (let index = 0; index < 17; index++) events.push(index % 3 === 0 ? add(owner, `short_batch_original_${index} 中文😀`)
    : owner.append('notara/adversarial-omitted', { syntheticIndex: index }));
  const controller = new AbortController(), original = ContextHistoryClient.prototype.appendEventBatch;
  let calls = 0, committed = false;
  ContextHistoryClient.prototype.appendEventBatch = async function (...args) {
    calls++; const receipt = await original.apply(this, args);
    if (!committed) { committed = true; controller.abort(); }
    return receipt;
  };
  t.after(() => { ContextHistoryClient.prototype.appendEventBatch = original; });
  await assert.rejects(f.history.ensure(owner, { signal: controller.signal }));
  assert.ok(committed); assert.equal(calls, 1);
  const state = f.history.active.get(owner.id);
  assert.equal((await f.history.archive.inspect(state.scope)).nextSeq, events.length);
  assert.equal(state.nextSeq, 0, 'the Host did not publish the lost acknowledgment');
  const recovered = await f.history.ensure(owner);
  assert.equal(recovered.nextSeq, events.length); assert.equal(calls, 1, 'no committed row was replayed');
  const expected = createHistoryPrefixHasher();
  for (const event of events) {
    const record = await prepareNativeEventRecord(event);
    expected.append(record.kind === 'skip' ? { ...record, state: 'omitted' } : record.metadata);
    if (record.kind === 'record') assert.equal(await body(f.history, owner, event.seq), event.data.content[0].text);
  }
  assert.deepEqual(await f.history.archive.inspectPrefix(recovered.scope, recovered.generation), { generation: recovered.generation, ...expected.digest() });
});

for (const appended of [false, true]) test(`bootstrap resumes same-policy short stream ${appended ? 'after append commit' : 'after begin commit'} without batching the pending event`, { concurrency: false }, async t => {
  const f = await fixture(t), { owner } = f.session(), events = [add(owner, 'legacy_short_prefix_12039'), add(owner, 'legacy_short_pending_12039 中文😀'), add(owner, 'new_short_batch_tail_12039')];
  const archive = await f.history.client(), bound = await archive.bindSession(owner.id, nativeHistoryBinding(owner.header, owner.inheritedEventCount));
  const records = await Promise.all(events.map(event => prepareNativeEventRecord(event)));
  assert.ok(records.every(record => record.metadata.chars <= BATCH_BUDGET.shortRecordChars));
  const projections = records.map(record => [...record.searchChunks()]);
  const encoded = projections.map(chunks => chunks.map(chunk => chunk.body).join(''));
  await archive.beginEvent(bound.scope, bound.generation, records[0].metadata);
  await archive.appendChunks(bound.scope, bound.generation, events[0].seq, 0, projections[0]);
  await archive.finishEvent(bound.scope, bound.generation, events[0].seq, 1);
  await archive.beginEvent(bound.scope, bound.generation, records[1].metadata);
  if (appended) await archive.appendChunks(bound.scope, bound.generation, events[1].seq, 0, projections[1]);
  assert.equal((await archive.inspect(bound.scope)).nextSeq, events[1].seq);
  const originalBatch = ContextHistoryClient.prototype.appendEventBatch, originalBegin = ContextHistoryClient.prototype.beginEvent;
  const originalFinish = ContextHistoryClient.prototype.finishEvent, originalAppend = ContextHistoryClient.prototype.appendChunks;
  let resumedOffset, pendingAppends = 0, pendingFinishes = 0, newTailBatched = false;
  ContextHistoryClient.prototype.appendEventBatch = async function (...args) {
    assert.ok(args[3].every(item => (item.metadata?.seq ?? item.seq) !== events[1].seq));
    if (args[3].some(item => item.metadata?.seq === events[2].seq)) newTailBatched = true;
    return originalBatch.apply(this, args);
  };
  ContextHistoryClient.prototype.beginEvent = async function (...args) {
    const receipt = await originalBegin.apply(this, args); if (args[2].seq === events[1].seq) resumedOffset = receipt.offset; return receipt;
  };
  ContextHistoryClient.prototype.appendChunks = async function (...args) {
    if (args[2] === events[1].seq) pendingAppends++; return originalAppend.apply(this, args);
  };
  ContextHistoryClient.prototype.finishEvent = async function (...args) {
    if (args[2] === events[1].seq) pendingFinishes++; return originalFinish.apply(this, args);
  };
  t.after(() => {
    ContextHistoryClient.prototype.appendEventBatch = originalBatch; ContextHistoryClient.prototype.beginEvent = originalBegin;
    ContextHistoryClient.prototype.finishEvent = originalFinish; ContextHistoryClient.prototype.appendChunks = originalAppend;
  });
  const recovered = await f.history.ensure(owner);
  assert.equal(recovered.scope, bound.scope); assert.equal(recovered.generation, bound.generation);
  assert.equal(resumedOffset, appended ? encoded[1].length : 0); assert.equal(pendingAppends, appended ? 0 : 1);
  assert.equal(pendingFinishes, 1); assert.ok(newTailBatched);
  assert.equal(await body(f.history, owner, events[1].seq), events[1].data.content[0].text);
  const expected = createHistoryPrefixHasher(); records.forEach(record => expected.append(record.metadata));
  assert.deepEqual(await archive.inspectPrefix(bound.scope, bound.generation), { generation: bound.generation, ...expected.digest() });
});

test('closing while lazy worker startup is pending waits for worker exit and rejects further owners', async t => {
  const f = await fixture(t), { owner } = f.session();
  const starting = f.history.client();
  await f.history.close(); const archive = await starting;
  assert.equal(await archive.exitPromise, 0); assert.equal(archive.pending.size, 0);
  assert.ok(archive.dead, 'shutdown did not leave the worker alive');
  await assert.rejects(f.history.ensure(owner), { code: 'HISTORY_CLOSED' });
  await f.history.close();
});
