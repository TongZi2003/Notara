import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { ContextHistoryClient, BATCH_BUDGET, createHistoryPrefixHasher } from './context-history-client.js';
import { NotaraContextHistory } from './context-history.js';
import { prepareNativeEventRecord } from './context-history-record.js';

const deferred = () => {
  let resolvePromise;
  return { promise: new Promise(resolve => { resolvePromise = resolve; }), resolve: value => resolvePromise(value) };
};
async function deadline(operation, message) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 5000); })]);
  } finally { clearTimeout(timer); }
}

// Native publication/query leases and actual worker SQLite; every destination
// is a new temporary fixture, and no Host/runtime home is constructed or read.
async function fixture(t, useDefaultPath = false) {
  const root = await mkdtemp(join(tmpdir(), 'notara-history-lifecycle-')), ctx = new Context();
  const fibers = [await ctx.plugin(SessionStore), await ctx.plugin(SessionQueryEngine)], detaches = [], unhandled = [], resolverCalls = [];
  const privateHome = join(root, 'private-home');
  const path = useDefaultPath ? join(privateHome, 'notara-history', 'history.sqlite') : join(root, 'private.sqlite');
  if (useDefaultPath) ctx.reflect.provide('dshHomePath', (...segments) => {
    resolverCalls.push(segments);
    assert.deepEqual(segments, ['notara-history', 'history.sqlite']);
    const target = join(privateHome, ...segments), remainder = relative(privateHome, target);
    assert.ok(remainder && !remainder.startsWith('..'));
    return target;
  });
  const onUnhandled = error => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  fibers.push(await ctx.plugin(NotaraContextHistory, useDefaultPath ? {} : { path }));
  const history = ctx.get('notaraHistory');
  t.after(async () => {
    try {
      await history.close();
      for (const detach of detaches.reverse()) detach();
      for (const fiber of fibers.reverse()) await fiber.dispose();
      await new Promise(resolveTurn => setImmediate(resolveTurn));
      assert.deepEqual(unhandled, [], 'background and cancelled queued actions must settle without unhandled rejections');
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
      const target = resolve(root), remainder = relative(resolve(tmpdir()), target);
      assert.ok(remainder && !remainder.startsWith('..'));
      await rm(target, { recursive: true, force: true });
    }
  });
  const owner = ctx.sessions.prepare(SessionId(`synthetic-lifecycle-${crypto.randomUUID()}`), { meta: { cwd: root } });
  detaches.push(ctx.sessions.enter(owner)); ctx.sessions.announce(owner);
  return { root, ctx, path, history, owner, resolverCalls, unhandled };
}
const add = (owner, text) => owner.append('user/message', createUserMessage({
  source: { kind: 'user' }, content: [{ type: 'text', text }],
}), { surfaceOp: 'append' });

test('startup resolves the default archive through native dshHomePath into the fixture private directory', async t => {
  const f = await fixture(t, true), event = add(f.owner, 'default_private_home_marker_39482');
  assert.equal(f.history.path, f.path);
  assert.deepEqual(f.resolverCalls, [['notara-history', 'history.sqlite']]);
  const bound = await f.history.ensure(f.owner);
  assert.equal(bound.nextSeq, f.owner.seq);
  const page = await f.history.page(f.owner, { seq: event.seq });
  assert.equal(JSON.parse(page.rows[0].body).blocks[0].text, 'default_private_home_marker_39482');
  await f.history.close();
  assert.deepEqual(await readdir(f.root), ['private-home']);
  assert.deepEqual(await readdir(join(f.root, 'private-home')), ['notara-history']);
  assert.deepEqual(await readdir(join(f.root, 'private-home', 'notara-history')), ['history.sqlite']);
  assert.equal((await readFile(f.path)).subarray(0, 16).toString(), 'SQLite format 3\0');
  assert.deepEqual(f.unhandled, []);
});

test('a cancelled foreground ensure settles while acknowledged background streaming remains gated and later finishes exactly', { concurrency: false }, async t => {
  const f = await fixture(t), bound = await f.history.ensure(f.owner), entered = deferred(), release = deferred();
  const originalAppend = ContextHistoryClient.prototype.appendChunks;
  let gated = false, acknowledged, backgroundSignal;
  ContextHistoryClient.prototype.appendChunks = async function (...args) {
    const receipt = await originalAppend.apply(this, args);
    if (!gated && args[0] === bound.scope) {
      gated = true; acknowledged = receipt; backgroundSignal = args.at(-1).signal;
      entered.resolve(); await release.promise;
    }
    return receipt;
  };
  try {
    const text = 'queued_cancel_marker_81293 "quote"\\slash 中文😀\n'.repeat(18000), event = add(f.owner, text);
    assert.ok(text.length > BATCH_BUDGET.shortRecordChars);
    await deadline(entered.promise, 'native background feed did not acknowledge a streamed chunk');
    const state = f.history.active.get(f.owner.id), background = state.chain;
    assert.equal(state.scheduled, true);
    assert.ok(acknowledged.offset > 0);
    assert.equal(acknowledged.nextSeq, event.seq, 'acknowledged partial bytes are outside the completed prefix');
    const persisted = await f.history.archive.inspectEvent(bound.scope, bound.generation, event.seq);
    assert.equal(persisted.receipt.offset, acknowledged.offset);
    assert.equal(persisted.event.state, 'pending');
    const controller = new AbortController(), reason = new Error('synthetic foreground cancellation');
    let foregroundSettled = false;
    const foreground = f.history.ensure(f.owner, { signal: controller.signal });
    const cancellation = assert.rejects(foreground, error => error === reason).then(() => { foregroundSettled = true; });
    controller.abort(reason);
    await deadline(cancellation, 'cancelled foreground ensure waited for the background gate');
    assert.equal(foregroundSettled, true);
    assert.equal(backgroundSignal.aborted, false, 'one foreground cancellation must not abort the background owner');
    assert.equal(state.scheduled, true, 'the background operation is still gated');
    assert.equal((await f.history.archive.inspectEvent(bound.scope, bound.generation, event.seq)).receipt.offset, acknowledged.offset);
    release.resolve();
    await background;
    assert.equal((await f.history.ensure(f.owner)).nextSeq, f.owner.seq);
    const chunks = []; let afterPart = -1, metadata;
    for (;;) {
      const page = await f.history.page(f.owner, { seq: event.seq, afterPart }); metadata ??= page.event;
      chunks.push(...page.rows.map(row => row.body));
      if (page.done) break;
      afterPart = page.rows.at(-1).part;
    }
    const encoded = chunks.join('');
    assert.equal(createHash('sha256').update(encoded).digest('hex'), metadata.hash);
    assert.equal(JSON.parse(encoded).blocks[0].text, text);
    assert.equal(metadata.state, 'complete');
    assert.deepEqual(f.unhandled, []);
  } finally {
    release.resolve(); ContextHistoryClient.prototype.appendChunks = originalAppend;
  }
});

test('overflowing the bounded native feed takes one fresh cut without losing events or resnapshotting later ordinary appends', async t => {
  const f = await fixture(t), query = f.ctx.get('sessionQuery'), originalObserve = query.observeSession;
  let observations = 0;
  query.observeSession = async function (id, options) {
    if (id === f.owner.id) observations++;
    return originalObserve.call(this, id, options);
  };
  try {
    const events = [add(f.owner, 'overflow_initial_marker_19384')], markers = [events[0]];
    await f.history.ensure(f.owner);
    assert.equal(observations, 1);
    for (let index = 0; index < 5000; index++) {
      const event = index === 32 || index === 2499 || index === 4999
        ? add(f.owner, `overflow_position_marker_${index}`)
        : f.owner.append('notara/history-overflow-fixture', { index });
      events.push(event);
      if (index === 32 || index === 2499 || index === 4999) markers.push(event);
    }
    const state = f.history.active.get(f.owner.id);
    assert.equal(state.dirty, true, 'synchronous publication outruns the bounded feed queue');
    assert.ok(state.queue.length - state.head <= 4096, 'overflow never retains every newly published event');
    const bound = await f.history.ensure(f.owner);
    assert.equal(bound.nextSeq, f.owner.seq);
    assert.equal(observations, 2, 'overflow recovery takes exactly one new immutable native cut');
    const expected = createHistoryPrefixHasher();
    for (const event of events) {
      const prepared = await prepareNativeEventRecord(event);
      expected.append(prepared.kind === 'skip' ? { ...prepared, state: 'omitted' } : prepared.metadata);
    }
    assert.deepEqual(await f.history.archive.inspectPrefix(bound.scope, bound.generation), { generation: bound.generation, ...expected.digest() });
    for (const marker of markers) {
      const page = await f.history.page(f.owner, { seq: marker.seq });
      assert.equal(JSON.parse(page.rows[0].body).blocks[0].text, marker.data.content[0].text);
    }
    assert.equal((await f.history.archive.inspectEvent(bound.scope, bound.generation, events[4097].seq)).event.state, 'omitted');
    const later = add(f.owner, 'overflow_later_normal_feed_marker_19384');
    assert.equal((await f.history.ensure(f.owner)).nextSeq, f.owner.seq);
    const laterPage = await f.history.page(f.owner, { seq: later.seq });
    assert.equal(JSON.parse(laterPage.rows[0].body).blocks[0].text, 'overflow_later_normal_feed_marker_19384');
    assert.equal(observations, 2, 'subsequent ordinary publication resumes incremental archival');
    assert.deepEqual(f.unhandled, []);
  } finally { query.observeSession = originalObserve; }
});
