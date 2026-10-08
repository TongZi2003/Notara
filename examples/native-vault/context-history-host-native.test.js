import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { ContextHistoryClient, STREAM_BUDGET } from './context-history-client.js';
import { NotaraContextHistory } from './context-history.js';

// Native Session publication and query leases, real worker SQLite, synthetic data.
// This fixture deliberately does not construct a Host or access a runtime home.
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'notara-history-native-'));
  const ctx = new Context(), fibers = [], detaches = [], histories = [], clients = [], historyFibers = new WeakMap();
  fibers.push(await ctx.plugin(SessionStore), await ctx.plugin(SessionQueryEngine));
  const path = join(dir, 'private.sqlite');
  t.after(async () => {
    for (const history of histories) { await history.close(); await historyFibers.get(history).dispose(); }
    for (const client of clients) await client.close();
    for (const detach of detaches.reverse()) detach();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    const target = resolve(dir), remainder = relative(resolve(tmpdir()), target);
    assert.ok(remainder && !remainder.startsWith('..') && !resolve(tmpdir()).includes(target));
    await rm(target, { recursive: true, force: true });
  });
  return {
    ctx, path,
    async history(context = ctx) {
      const fiber = await context.plugin(NotaraContextHistory, { path });
      const history = context.notaraHistory;
      histories.push(history); historyFibers.set(history, fiber);
      return history;
    },
    async stop(history) { await history.close(); await historyFibers.get(history).dispose(); },
    client() { const client = new ContextHistoryClient({ path }); clients.push(client); return client; },
    session(id = `history-${crypto.randomUUID()}`, options = {}) {
      const session = ctx.sessions.prepare(SessionId(id), { meta: { cwd: dir, ...options.meta }, ...options });
      const detach = ctx.sessions.enter(session); detaches.push(detach); ctx.sessions.announce(session);
      return { session, detach };
    },
  };
}
const add = (session, body) => session.append('user/message', createUserMessage({
  source: { kind: 'user' }, content: [{ type: 'text', text: body }],
}), { surfaceOp: 'append' });
async function snapshot(ctx, session) {
  const observation = await ctx.sessionQuery.observeSession(session.id, { projectionMode: 'none' });
  try { return [...observation.events]; } finally { observation[Symbol.dispose](); }
}
async function record(history, owner, seq) {
  const chunks = []; let afterPart = -1, metadata;
  for (;;) {
    const page = await history.page(owner, { seq, afterPart }); metadata ??= page.event;
    assert.ok(page.rows.length <= STREAM_BUDGET.pageChunks);
    chunks.push(...page.rows.map(row => row.body));
    if (page.done) break;
    assert.ok(page.rows.length); afterPart = page.rows.at(-1).part;
  }
  const encoded = chunks.join('');
  assert.equal(createHash('sha256').update(encoded).digest('hex'), metadata.hash);
  return JSON.parse(encoded);
}
const bodies = row => row.blocks.filter(block => block.type === 'text').map(block => block.text);
const literalHits = result => result.results.filter(row => row.hitKind === 'query-literal');
const deferred = () => {
  let resolvePromise;
  return { promise: new Promise(resolve => { resolvePromise = resolve; }), resolve: value => resolvePromise(value) };
};
const observedCut = (entered, boot) => Promise.race([entered.promise, boot.then(() => {
  throw new Error('Bootstrap completed without taking the native query observation');
})]);

test('empty native owner and omitted events retain exact sequence without exposing opaque data', async t => {
  const f = await fixture(t), history = await f.history(), { session } = f.session();
  assert.equal((await history.ensure(session)).nextSeq, 0);
  assert.deepEqual((await history.search(session, { query: 'empty_marker_86421' })).results, []);
  await assert.rejects(history.page(session, { seq: 0 }), { code: 'MISSING_EVENT_REFERENCE' });
  session.append('notara/history-fixture', { opaque: 'opaque_marker_86421' });
  const event = add(session, 'student_marker_86421 原始问题。');
  assert.equal((await history.ensure(session)).nextSeq, session.seq);
  await assert.rejects(history.page(session, { seq: 0 }), { code: 'EVENT_OMITTED' });
  assert.deepEqual((await history.search(session, { query: 'opaque_marker_86421' })).results, []);
  assert.deepEqual(bodies(await record(history, session, event.seq)), ['student_marker_86421 原始问题。']);
});

test('native boot observation captures its cut then merges committed events without repeated full reads', async t => {
  const f = await fixture(t), { session } = f.session(), before = add(session, 'before_cut_marker_86123');
  const entered = deferred(), release = deferred(), original = SessionQueryEngine.prototype.observeSession;
  let observations = 0, leasesDisposed = 0;
  SessionQueryEngine.prototype.observeSession = async function (id, options) {
    const observation = await original.call(this, id, options);
    if (id !== session.id) return observation;
    observations++; assert.equal(options.projectionMode, 'none');
    const dispose = observation[Symbol.dispose];
    observation[Symbol.dispose] = () => { leasesDisposed++; dispose(); };
    entered.resolve(observation.cursor); await release.promise; return observation;
  };
  t.after(() => { SessionQueryEngine.prototype.observeSession = original; release.resolve(); });
  const history = await f.history(), boot = history.ensure(session);
  const cursor = await observedCut(entered, boot);
  const during = add(session, 'during_boot_marker_86123'); release.resolve();
  assert.equal(cursor, before.seq);
  assert.equal((await boot).nextSeq, before.seq + 1, 'ensure promises the watermark captured when it began');
  assert.deepEqual(bodies(await record(history, session, during.seq)), ['during_boot_marker_86123']);
  const after = add(session, 'after_boot_marker_86123');
  await history.ensure(session);
  assert.deepEqual(literalHits(await history.search(session, { query: 'after_boot_marker_86123' })).map(row => row.seq), [after.seq]);
  assert.equal(observations, 1, 'normal appends consume the native event feed');
  assert.equal(leasesDisposed, 1, 'the bootstrap observation lease is always released');
});

test('same-id replay checks the entire derived prefix when the final event is unchanged', async t => {
  const f = await fixture(t), first = f.session('same-prefix-fixture'), history = await f.history();
  const early = add(first.session, 'old_prefix_marker_17384');
  add(first.session, 'identical_final_marker_17384');
  const seed = await snapshot(f.ctx, first.session), meta = first.session.header;
  await history.ensure(first.session); first.detach();
  const changed = structuredClone(seed);
  changed[early.seq].data.content[0].text = 'new_prefix_marker_17384';
  assert.deepEqual(changed.at(-1), seed.at(-1));
  const replacement = f.session(first.session.id, { seed: changed, meta }).session;
  await history.ensure(replacement);
  assert.deepEqual(bodies(await record(history, replacement, early.seq)), ['new_prefix_marker_17384']);
  assert.deepEqual(literalHits(await history.search(replacement, { query: 'old_prefix_marker_17384' })), []);
  assert.equal(literalHits(await history.search(replacement, { query: 'new_prefix_marker_17384' })).length, 1);
  await assert.rejects(history.ensure(first.session));
});

test('service restart verifies persisted originals and then extends only the live owner history', async t => {
  const f = await fixture(t), { session } = f.session(), first = await f.history();
  const initial = add(session, 'restart_prefix_marker_63219');
  await first.ensure(session); await f.stop(first);
  const later = add(session, 'restart_tail_marker_63219'), second = await f.history();
  assert.equal((await second.ensure(session)).nextSeq, session.seq);
  assert.deepEqual(bodies(await record(second, session, initial.seq)), ['restart_prefix_marker_63219']);
  assert.deepEqual(bodies(await record(second, session, later.seq)), ['restart_tail_marker_63219']);
});

test('native fork archives only its inherited cut and own tail, including after replay', async t => {
  const f = await fixture(t), { session: parent } = f.session(), history = await f.history();
  const inherited = add(parent, 'inherited_marker_51028');
  const cut = add(parent, 'fork_cut_marker_51028');
  add(parent, 'parent_after_cut_marker_51028');
  const child = f.ctx.sessions.fork(parent, cut.seq, SessionId('fork-child-fixture'));
  assert.equal(child.inheritedEventCount, cut.seq + 1);
  const own = add(child, 'child_own_marker_51028');
  add(parent, 'parent_future_marker_51028');
  await history.ensure(parent); await history.ensure(child);
  assert.deepEqual(bodies(await record(history, child, inherited.seq)), ['inherited_marker_51028']);
  assert.deepEqual(bodies(await record(history, child, own.seq)), ['child_own_marker_51028']);
  for (const query of ['parent_after_cut_marker_51028', 'parent_future_marker_51028']) {
    assert.deepEqual(literalHits(await history.search(child, { query })), []);
  }
  assert.deepEqual(literalHits(await history.search(parent, { query: 'child_own_marker_51028' })), []);
  const seed = await snapshot(f.ctx, child), meta = child.header;
  await history.close();
  // A second native store represents a new runtime and retains the exact persisted fork cut.
  const other = await fixture(t), replay = other.session(child.id, {
    seed, meta, inheritedEventCount: child.inheritedEventCount,
  }).session;
  const restarted = await f.history(other.ctx);
  await restarted.ensure(replay);
  assert.deepEqual(bodies(await record(restarted, replay, own.seq)), ['child_own_marker_51028']);
  assert.deepEqual(literalHits(await restarted.search(replay, { query: 'parent_future_marker_51028' })), []);
});

test('cancelled native streaming keeps an acknowledged prefix and resumes exact original bytes', { concurrency: false }, async t => {
  const f = await fixture(t), { session } = f.session(), history = await f.history();
  const body = 'resume_original_marker_43872 中文😀 '.repeat(16000), event = add(session, body);
  const controller = new AbortController(), append = ContextHistoryClient.prototype.appendChunks;
  const begin = ContextHistoryClient.prototype.beginEvent;
  let interrupted = false; const starts = [];
  ContextHistoryClient.prototype.appendChunks = async function (...args) {
    const receipt = await append.apply(this, args);
    if (!interrupted && args[2] === event.seq) { interrupted = true; controller.abort(); }
    return receipt;
  };
  ContextHistoryClient.prototype.beginEvent = async function (...args) {
    const receipt = await begin.apply(this, args); starts.push(receipt.offset); return receipt;
  };
  t.after(() => { ContextHistoryClient.prototype.appendChunks = append; ContextHistoryClient.prototype.beginEvent = begin; });
  await assert.rejects(history.ensure(session, { signal: controller.signal }));
  assert.ok(interrupted, 'cancellation happened after a real worker acknowledgment');
  assert.equal((await history.ensure(session)).nextSeq, session.seq);
  assert.ok(starts.some(offset => offset > 0), 'the retry resumes persisted event chunks');
  assert.deepEqual(bodies(await record(history, session, event.seq)), [body]);
});

test('session disposal preserves the archive while committed deletion removes it and persists its tombstone', async t => {
  const f = await fixture(t), active = f.session('deleted-history-fixture'), history = await f.history();
  const event = add(active.session, 'deleted_marker_93175'), meta = active.session.header;
  const seed = await snapshot(f.ctx, active.session), receipt = await history.ensure(active.session);
  active.detach();
  const client = f.client();
  assert.equal((await client.inspect(receipt.scope)).nextSeq, seed.length);
  assert.equal((await client.page(receipt.scope, receipt.generation, event.seq)).event.state, 'complete');
  const resumed = f.session(active.session.id, { seed, meta }).session;
  assert.deepEqual(bodies(await record(history, resumed, event.seq)), ['deleted_marker_93175']);
  await history.deleteSessionIds([resumed.id]);
  await assert.rejects(history.ensure(resumed));
  await assert.rejects(client.page(receipt.scope, receipt.generation, event.seq));
  assert.equal((await client.inspect(receipt.scope)).state, 'deleted');
  await f.stop(history);
  const restarted = await f.history();
  await assert.rejects(restarted.ensure(resumed));
});

test('committed deletion during native bootstrap cannot publish late captured history', async t => {
  const f = await fixture(t), { session } = f.session('deleted-inflight-fixture');
  add(session, 'late_delete_marker_65320');
  const entered = deferred(), release = deferred(), original = SessionQueryEngine.prototype.observeSession;
  SessionQueryEngine.prototype.observeSession = async function (id, options) {
    const observation = await original.call(this, id, options);
    entered.resolve(); await release.promise; return observation;
  };
  t.after(() => { SessionQueryEngine.prototype.observeSession = original; release.resolve(); });
  const history = await f.history(), boot = history.ensure(session); boot.catch(() => {});
  await observedCut(entered, boot);
  const deleted = history.deleteSessionIds([session.id]);
  release.resolve(); await deleted;
  await assert.rejects(boot);
  await assert.rejects(history.ensure(session));
  await f.stop(history);
  await assert.rejects((await f.history()).ensure(session));
});
