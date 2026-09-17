/**
 * P7.5 confirmed close on the real Host wiring.
 *
 * Everything here is the real installed object graph: the workspace owner and
 * its native records, the domain close writer, the real `ProposalService` (so the
 * frozen attempt, the effect operation id and the receipt are the production
 * ones), the real `proposalExecutor`, and this task's Host module. Only the
 * session log and the two content services the module resolves titles through are
 * scripted, because a native log and a material file tree are not what this task
 * is about — the cutoff/facts *policy* is.
 *
 * What it pins: the teacher's free body is the only thing the model supplies; the
 * cutoff is the teacher's own propose call in the native log, not "now"; the facts
 * are the real lesson materials plus real applied receipts and still-pending
 * proposals; summary and closing fact land in ONE native publication; a failed
 * publication leaves the complete old state and the same operation retries to the
 * complete new one; the closed lesson keeps taking teaching additions; and the
 * next lesson stays fixed on the exact revision it received even after the summary
 * is corrected.
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CourseMetadataSchema } from '../../packages/contracts/src/courses.ts';
import { HandoffRecordSchema, HandoffViewSchema, type HandoffCloseInput, type HandoffCloseResult, type HandoffPin } from '../../packages/contracts/src/handoffs.ts';
import { ProposalEffectSchema, ProposalRecordSchema, type ProposalEffect, type ProposalSelection } from '../../packages/contracts/src/proposals.ts';
import { CardContentSchema, CardRecordSchema } from '../../packages/contracts/src/cards.ts';
import type { HostContext, MutationContext } from '../../packages/contracts/src/execution.ts';
import { createClock } from '../../packages/domain/src/clock.ts';
import { ClassCloseService } from '../../packages/domain/src/courses/class-close-service.ts';
import { CourseMetadata } from '../../packages/domain/src/courses/course-metadata.ts';
import { HandoffService } from '../../packages/domain/src/courses/handoff-service.ts';
// The packaged resolver, exactly as the real Host loads it: one domain module,
// so a definite no-write is the same ProposalEffectRejected class the service
// catches rather than a second copy from a source import.
import { ProposalService, proposalEffectDigest, stableEffectOperationId, type ProposalEffectItem } from '@studyforge/domain/proposals';
import { proposalExecutor } from '../../packages/host/src/proposal-executor.ts';
import { StudyForgeHandoffs, checkHandoffProposal, handoffFacts, handoffSnapshot, reviewBackfillProblem, type HandoffSnapshot } from '../../packages/host/src/handoff-service.ts';
import { continuationBrief, renderHandoffBrief } from '../../packages/host/src/teaching/lesson-brief.ts';
import { ProposeHandoffInput, ReadHandoffInput } from '../../packages/host/src/tools/handoff-tools.ts';
import { toolSchema } from '../../packages/host/src/tools/tool-schema.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';

let now = '2026-09-12T02:00:00.000Z';
const at = (instant: string): void => { now = instant; };
const clock = createClock('Asia/Shanghai', () => now);
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
const READ: HostContext = { workspaceId: 'student-a', sessionId: 'lesson-a', actor: 'student', purpose: 'learning' };
const CALL_ID = 'call-propose-1';
const PROPOSAL_REF = 'proposal:proposal-1';
/** The real cutoff of this summary: the event right before the teacher's propose call. */
const PRIOR_EVENT = { type: 'user/message' as const, seq: 7, time: Date.parse('2026-09-12T01:50:00.000Z') };
const NATIVE_LOG = [
  { type: 'user/message' as const, seq: 5, time: Date.parse('2026-09-12T01:20:00.000Z'), data: { source: { kind: 'user' } } },
  { ...PRIOR_EVENT, data: { source: { kind: 'user' } } },
  // The teacher's own answer and the system receipt are not student input: the
  // cutoff must stay on the last real student message, not slide onto these.
  { type: 'assistant/message' as const, seq: 8, time: Date.parse('2026-09-12T01:52:00.000Z') },
  { type: 'tool/call' as const, seq: 9, time: Date.parse('2026-09-12T01:55:00.000Z'), data: { callId: CALL_ID, name: 'propose_handoff', arguments: '{}' } },
  // Everything after the propose call was never part of what the teacher wrote.
  { type: 'user/message' as const, seq: 10, time: Date.parse('2026-09-12T02:30:00.000Z'), data: { source: { kind: 'plugin' } } },
];

const lesson = (operationId: string, sessionId = 'lesson-a', expectedVersion?: number): MutationContext =>
  ({ workspaceId: 'student-a', sessionId, actor: 'student', purpose: 'learning', operationId,
    ...(expectedVersion === undefined ? {} : { expectedVersion }) });

afterEach(async () => {
  now = '2026-09-12T02:00:00.000Z';
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** The effect the Host tool really builds: the free draft plus the Host snapshot. */
const handoff = (draft: { title: string; body: string }, snapshot: HandoffSnapshot): ProposalEffect =>
  ProposalEffectSchema.parse({ kind: 'handoff', draft, ...snapshot });

async function open() {
  const dir = await mkdtemp(join(tmpdir(), 'sf-native-close-'));
  roots.push(dir);
  const ctx = new Context();
  await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student-a', clock);
  const handoffStore = await owner.collection('handoff', HandoffRecordSchema);
  const courseStore = await owner.collection('course', CourseMetadataSchema);
  const proposalStore = await owner.collection('proposal', ProposalRecordSchema);
  const cardRecords = await owner.collection('card', CardRecordSchema);
  const handoffs = new HandoffService(handoffStore, clock);
  const courses = new CourseMetadata(courseStore);
  let proposals!: ProposalService;
  const classClose = new ClassCloseService(handoffs, courses, { read: (c, r, v) => proposals.read(c, r, v) }, owner);
  ctx.reflect.provide('studyforgeRecords', owner);
  ctx.reflect.provide('studyforgeCardRecords', cardRecords);
  ctx.reflect.provide('studyforgeCourseMetadata', courses);
  ctx.reflect.provide('studyforgeHandoffService', handoffs);
  // One provided seam with a swappable implementation: the executor always reads
  // this bridge, so a test can make the single native publication fail without
  // re-registering the service (cordis owns the lifetime of one name).
  let closer: { close(ctx: MutationContext, input: HandoffCloseInput): Promise<HandoffCloseResult> } = classClose;
  ctx.reflect.provide('studyforgeHandoffClose', { close: (c: MutationContext, i: HandoffCloseInput) => closer.close(c, i) });
  // The real native log seam, scripted to this lesson's accepted events.
  ctx.reflect.provide('sessionQuery', { async observeSession() {
    return { header: { id: 'lesson-a', createdAt: Date.parse('2026-09-12T01:00:00.000Z') }, events: NATIVE_LOG, [Symbol.dispose]() {} };
  } });
  // Title resolution only; the real services are wired by the Host index.
  ctx.reflect.provide('studyforgeMaterialService', { async get(_ctx: HostContext, materialId: string) { return { materialId, title: '三角函数.md' }; } });
  ctx.reflect.provide('studyforgeCardService', { read(_ctx: HostContext, ref: string) { return { ref, content: { title: '单调性' } }; } });
  // The real Host seam that resolves one lesson's own binding; the Remote reads it
  // for every session-scoped call. Only its shape is supplied here.
  ctx.reflect.provide('studyforgeAccess', { workspaceId: 'student-a', root: dir, async forSession(sessionId: string) {
    return { workspaceId: 'student-a', sessionId, purpose: 'learning' };
  } });
  // Native session creation and rename, scripted: the real ids come from
  // `NativeOpen`'s deterministic opening key, which is what these tests pin.
  const opened = new Set<string>();
  ctx.reflect.provide('sessionController', {
    async create({ sessionId }: { sessionId: string }) { opened.add(sessionId); return { sessionId }; },
    async rename() { /* the created lesson's own title is not what this pins */ },
  });
  proposals = new ProposalService(proposalStore, clock, proposalExecutor(ctx));
  ctx.reflect.provide('studyforgeProposalService', proposals);
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  return { ctx, owner, handoffStore, courseStore, proposalStore, cardRecords, handoffs, courses, proposals, opened,
    useCloser(next: { close(ctx: MutationContext, input: HandoffCloseInput): Promise<HandoffCloseResult> }) { closer = next; } };
}

type Fixture = Awaited<ReturnType<typeof open>>;

/** The exact record the real `propose` path writes, seeded so the plan-level
 *  attempt/effect contract is the production one and not a test invention. */
async function seedHandoffProposal(fixture: Fixture, draft: { title: string; body: string } = { title: '三角函数小结', body: '今天把单调性的判断顺序讲完了。' },
  ref = PROPOSAL_REF, sessionId = 'lesson-a', overrides: Partial<HandoffSnapshot> = {}) {
  // The snapshot the Host tool would have frozen at propose time, from the real
  // log and the real stores — not a hand-written stand-in.
  const effect = handoff(draft, { ...await handoffSnapshot(fixture.ctx, { ...READ, sessionId }, CALL_ID), ...overrides });
  const digest = proposalEffectDigest(effect);
  await fixture.proposalStore.create({ workspaceId: 'student-a', actor: 'teacher', purpose: 'creation', operationId: 'seed-' + ref },
    ref.slice('proposal:'.length), {
      title: effect.kind === 'handoff' ? effect.draft.title : '小结',
      origin: { kind: 'native', sessionId, callId: CALL_ID },
      items: [{ id: 'item-1', target: null, baseline: null, status: 'pending',
        drafts: [{ revision: 1, digest, effect, authoredBy: 'teacher', at: '2026-09-12T01:55:00.000Z' }] }],
    });
  const selection: ProposalSelection = { revision: 1, items: [{ itemId: 'item-1', draft: 1, digest, target: null, baseline: null }] };
  return { digest, selection };
}

/** The selection a client sends: the revision and digest it is actually looking at. */
function selectionOf(fixture: Fixture, ref: string, sessionId = 'lesson-a'): ProposalSelection {
  const view = fixture.proposals.read({ ...READ, sessionId }, ref);
  return { revision: view.version, items: view.items.map(item => ({ itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline })) };
}

/** A lesson whose material list already exists, so facts can name a material. */
async function seedLessonMaterial(fixture: Fixture) {
  await fixture.courses.update({ ...lesson('seed-materials'), expectedVersion: 0 },
    { lessonMaterials: { materials: [{ kind: 'source', source: { materialId: 'm1', versionId: 'v1' } }] } });
}

/** Another real proposal row of the same lesson: one written fact, one still pending. */
async function seedSiteFacts(fixture: Fixture) {
  const appliedEffect = ProposalEffectSchema.parse({ kind: 'card-create', content: { title: '单调性' } });
  const appliedDigest = proposalEffectDigest(appliedEffect);
  await fixture.proposalStore.create({ workspaceId: 'student-a', actor: 'teacher', purpose: 'creation', operationId: 'seed-applied' }, 'applied-one', {
    title: '已确认的一张卡', origin: { kind: 'native', sessionId: 'lesson-a', callId: 'call-card' },
    items: [{ id: 'item-1', target: null, baseline: null, status: 'applied',
      drafts: [{ revision: 1, digest: appliedDigest, effect: appliedEffect, authoredBy: 'teacher', at: '2026-09-12T01:30:00.000Z' }],
      attempt: { operationId: 'card-op', draft: 1, digest: appliedDigest, at: '2026-09-12T01:31:00.000Z', actor: 'student' },
      receipt: { confirmationId: 'card-op', operationId: 'card-op', at: '2026-09-12T01:31:00.000Z', target: 'card:card-1', revision: 1, title: '单调性' } }],
  });
  await fixture.proposalStore.create({ workspaceId: 'student-a', actor: 'teacher', purpose: 'creation', operationId: 'seed-pending' }, 'pending-one', {
    title: '待确认的一道题', origin: { kind: 'native', sessionId: 'lesson-a', callId: 'call-pending' },
    items: [{ id: 'item-1', target: null, baseline: null, status: 'pending',
      drafts: [{ revision: 1, digest: proposalEffectDigest(ProposalEffectSchema.parse({ kind: 'card-create', content: { title: '待确认' } })), effect: ProposalEffectSchema.parse({ kind: 'card-create', content: { title: '待确认' } }), authoredBy: 'teacher', at: '2026-09-12T01:40:00.000Z' }] }],
  });
}

test('确认后小结与关闭事实在同一次原生提交里写入，截止点与系统事实来自Host', async () => {
  const fixture = await open();
  await seedLessonMaterial(fixture);
  await seedSiteFacts(fixture);
  const { digest, selection } = await seedHandoffProposal(fixture);
  const confirmed = await fixture.proposals.confirm(lesson('confirm-1'), PROPOSAL_REF, selection);
  const item = confirmed.items[0]!;
  expect(item.status).toBe('applied');
  // The attempt the real ProposalService froze is the operation the executor ran.
  expect(item.attempt?.operationId).toBe(stableEffectOperationId(PROPOSAL_REF, 'item-1', 1));
  expect(item.attempt?.digest).toBe(digest);
  const view = fixture.handoffs.read(READ, item.receipt!.target);
  expect(HandoffViewSchema.parse(view)).toEqual(view);
  expect(view).toMatchObject({ sessionId: 'lesson-a', title: '三角函数小结', body: '今天把单调性的判断顺序讲完了。', version: 1 });
  // The cutoff is the teacher's own propose call in the native log — not "now",
  // and not the student's later confirmation.
  expect(view.cutoff).toEqual({ sessionId: 'lesson-a', sequence: PRIOR_EVENT.seq, at: '2026-09-12T01:50:00.000Z' });
  expect(view.facts).toEqual([
    { kind: 'material', title: '三角函数.md' },
    { kind: 'saved', title: '单调性', target: 'card:card-1' },
    { kind: 'pending', title: '待确认的一道题' },
  ]);
  // Receipt and closing fact name the very same revision and instant.
  expect(item.receipt).toMatchObject({ revision: 1, title: '三角函数小结' });
  expect(fixture.courses.read(READ).data.closure).toEqual({ closedAt: view.createdAt, handoffRef: item.receipt!.target, handoffVersion: 1 });
  expect(fixture.handoffStore.list(READ)).toHaveLength(1);
});

test('执行者自己认得"确定没写"才允许改稿，伪造的确认摘要按未写拒绝', async () => {
  const fixture = await open();
  const { selection } = await seedHandoffProposal(fixture);
  const forged: ProposalEffectItem = {
    proposalRef: PROPOSAL_REF, itemId: 'item-1', draftRevision: 1, digest: 'sha256:' + 'd'.repeat(64),
    effect: handoff({ title: '伪造', body: '伪造的正文' }, await handoffSnapshot(fixture.ctx, READ, CALL_ID)), target: null, baseline: null,
  };
  await expect(fixture.ctx.studyforgeHandoffClose.close(lesson('confirm-forged'), {
    draft: { title: '伪造', body: '伪造的正文' },
    cutoff: { sessionId: 'lesson-a', sequence: 1, at: '2026-09-12T01:00:00.000Z' }, facts: [],
    confirmation: { proposalRef: PROPOSAL_REF, itemId: 'item-1', draftRevision: 1, digest: forged.digest },
  })).rejects.toMatchObject({ code: 'close_requires_confirmation' });
  // The real confirmation of the real draft still closes exactly once.
  await fixture.proposals.confirm(lesson('confirm-1'), PROPOSAL_REF, selection);
  expect(fixture.handoffStore.list(READ)).toHaveLength(1);
  expect(fixture.courses.read(READ).data.closure).not.toBeNull();
});

test('同一确认重放不重复 close，发布失败留完整旧态、同操作重试补齐新态', async () => {
  const fixture = await open();
  const { selection } = await seedHandoffProposal(fixture);
  const first = await fixture.proposals.confirm(lesson('confirm-1'), PROPOSAL_REF, selection);
  at('2026-09-12T09:30:00.000Z');
  // A replay of an already-applied item changes nothing and takes no new close time.
  const again = await fixture.proposals.confirm(lesson('confirm-2'), PROPOSAL_REF, selectionOf(fixture, PROPOSAL_REF));
  expect(again.items[0]?.receipt).toEqual(first.items[0]?.receipt);
  expect(fixture.handoffStore.list(READ)).toHaveLength(1);
  expect(fixture.handoffs.read(READ, first.items[0]!.receipt!.target).createdAt).toBe('2026-09-12T02:00:00.000Z');

  // Another lesson: the publication fails before the single native update, so
  // neither row moves and the item is locked to its own operation.
  const { selection: selection2 } = await seedHandoffProposal(fixture, { title: '第二份小结', body: '这次换一节课。' }, 'proposal:proposal-2', 'lesson-c');
  fixture.useCloser({ close: async () => { throw new Error('killed_before_publish'); } });
  const failed = await fixture.proposals.confirm(lesson('confirm-3', 'lesson-c'), 'proposal:proposal-2', selection2);
  expect(failed.items[0]?.status).toBe('failed');
  expect(failed.items[0]?.failure?.commit).toBe('unknown');
  expect(fixture.handoffStore.list(READ)).toHaveLength(1);
  expect(fixture.courses.read({ ...READ, sessionId: 'lesson-c' })).toMatchObject({ version: 0, data: { closure: null } });
  // The same operation now completes the new state instead of a half one.
  fixture.useCloser(new ClassCloseService(fixture.handoffs, fixture.courses, { read: (c, r, v) => fixture.proposals.read(c, r, v) }, fixture.owner));
  // The student confirms again on a fresh view: a new confirmation operation, the
  // same frozen effect operation, so the writer replays its own effect.
  const retried = await fixture.proposals.confirm(lesson('confirm-4', 'lesson-c'), 'proposal:proposal-2', selectionOf(fixture, 'proposal:proposal-2', 'lesson-c'));
  expect(retried.items[0]?.status).toBe('applied');
  expect(fixture.handoffStore.list(READ)).toHaveLength(2);
  expect(fixture.courses.read({ ...READ, sessionId: 'lesson-c' }).data.closure).toMatchObject({ handoffVersion: 1 });
}, 20_000);

test('关课后原课仍可讨论且不能再提一份收课，接续课固定在收到的那一版', async () => {
  const fixture = await open();
  const { selection } = await seedHandoffProposal(fixture);
  const confirmed = await fixture.proposals.confirm(lesson('confirm-1'), PROPOSAL_REF, selection);
  const closed = fixture.courses.read(READ);
  // Another summary cannot close the same lesson twice; the tool refuses early.
  expect(() => checkHandoffProposal(fixture.ctx, lesson('propose-again'))).toThrow('本课已收课关闭');
  // The lesson keeps taking real teaching additions after the close.
  const later = await fixture.courses.update(lesson('after-close', 'lesson-a', closed.version), { stance: '关课后继续讨论这道题。' });
  expect(later.data.stance).toBe('关课后继续讨论这道题。');
  expect(later.data.closure).toEqual(closed.data.closure);

  // The next lesson receives one exact revision and keeps it.
  const pin: HandoffPin = { ref: confirmed.items[0]!.receipt!.target, version: 1 };
  await fixture.courses.setContinuation(lesson('open-b', 'lesson-b', 0), pin);
  const brief = continuationBrief(fixture.ctx, { ...READ, sessionId: 'lesson-b' });
  expect(brief?.pin).toEqual(pin);
  expect(brief?.text).toContain('今天把单调性的判断顺序讲完了。');
  expect(brief?.text).toContain('第 1 版');

  // Correcting the summary makes revision 2; the continuing lesson still reads 1.
  at('2026-09-13T02:00:00.000Z');
  const corrected = await fixture.handoffs.correct(lesson('correct-1', 'lesson-a', 1), pin.ref, { body: '把判断顺序写得更清楚。' });
  expect(corrected.version).toBe(2);
  expect(corrected.cutoff).toEqual(fixture.handoffs.read(READ, pin.ref, 1).cutoff);
  expect(continuationBrief(fixture.ctx, { ...READ, sessionId: 'lesson-b' })?.text).toContain('今天把单调性的判断顺序讲完了。');
  expect(renderHandoffBrief(corrected, { ref: pin.ref, version: 2 })).toContain('把判断顺序写得更清楚。');
});

test('模型工具的形状与Host事实清单都只在边界内', async () => {
  // The tool schemas have to survive the Host's structural JSON-Schema narrowing.
  expect(() => toolSchema(ProposeHandoffInput)).not.toThrow();
  expect(() => toolSchema(ReadHandoffInput)).not.toThrow();
  expect(ProposeHandoffInput.parse({ kind: 'close', title: '小结', body: '正文' })).toMatchObject({ kind: 'close' });
  expect(ProposeHandoffInput.safeParse({ kind: 'close', title: '小结', body: '正文', cutoff: {} }).success).toBe(false);

  const fixture = await open();
  await seedLessonMaterial(fixture);
  await seedSiteFacts(fixture);
  await seedHandoffProposal(fixture);
  // The pending handoff itself is never listed as one of its own facts.
  const facts = await handoffFacts(fixture.ctx, READ, { proposalRef: PROPOSAL_REF, itemId: 'item-1' });
  expect(facts.map(fact => fact.kind + ':' + fact.title)).toEqual(['material:三角函数.md', 'saved:单调性', 'pending:待确认的一道题']);
});

test('关课后新制卡不得补关课前漏记检验，已存在卡与真实新表现不受影响', async () => {
  const fixture = await open();
  const card = (title: string) => ({ content: CardContentSchema.parse({ title }), history: [] });
  at('2026-09-12T01:00:00.000Z');
  await fixture.cardRecords.create(lesson('card-before'), 'c_before', card('关课前就有'));
  // The close itself happens at 02:00, between the two cards.
  at('2026-09-12T02:00:00.000Z');
  const { selection } = await seedHandoffProposal(fixture);
  await fixture.proposals.confirm(lesson('confirm-1'), PROPOSAL_REF, selection);
  at('2026-09-12T03:00:00.000Z');
  await fixture.cardRecords.create(lesson('card-after'), 'c_after', card('关课之后才有'));
  // A card that did not exist yet can never carry a pre-close in-class check.
  expect(reviewBackfillProblem(fixture.ctx, READ, 'card:c_after', '2026-09-12T01:30:00.000Z')).toBe('review_after_close_new_card');
  // A genuinely later action is a new occurrence, not a backfill.
  expect(reviewBackfillProblem(fixture.ctx, READ, 'card:c_after', '2026-09-12T04:00:00.000Z')).toBeNull();
  // A card that already existed keeps the check it was really owed.
  expect(reviewBackfillProblem(fixture.ctx, READ, 'card:c_before', '2026-09-12T01:30:00.000Z')).toBeNull();
});

test('截止点与事实冻结在提案那一刻：改稿只换正文，换掉事实被拒', async () => {
  const fixture = await open();
  await seedLessonMaterial(fixture);
  await seedSiteFacts(fixture);
  const { selection } = await seedHandoffProposal(fixture);
  const original = fixture.proposals.read(READ, PROPOSAL_REF).items[0]!.original.effect;
  if (original.kind !== 'handoff') throw new Error('expected a handoff draft');
  // The cutoff is the last real student message; the assistant turn and the
  // system receipt before the propose call must not move it.
  expect(original.cutoff).toEqual({ sessionId: 'lesson-a', sequence: PRIOR_EVENT.seq, at: '2026-09-12T01:50:00.000Z' });

  // More system truth shows up before the student confirms. It must not displace
  // what the student is looking at.
  const late = ProposalEffectSchema.parse({ kind: 'card-create', content: { title: '后来才保存的' } });
  await fixture.proposalStore.create({ workspaceId: 'student-a', actor: 'teacher', purpose: 'creation', operationId: 'seed-late' }, 'applied-two', {
    title: '后来的写入', origin: { kind: 'native', sessionId: 'lesson-a', callId: 'call-late' },
    items: [{ id: 'item-1', target: null, baseline: null, status: 'applied',
      drafts: [{ revision: 1, digest: proposalEffectDigest(late), effect: late, authoredBy: 'teacher', at: '2026-09-12T01:58:00.000Z' }],
      attempt: { operationId: 'late-op', draft: 1, digest: proposalEffectDigest(late), at: '2026-09-12T01:58:00.000Z', actor: 'student' },
      receipt: { confirmationId: 'late-op', operationId: 'late-op', at: '2026-09-12T01:58:00.000Z', target: 'card:card-2', revision: 1, title: '后来才保存的' } }],
  });

  // The student rewrites the body; the Host snapshot rides along unchanged.
  await fixture.proposals.edit({ ...lesson('edit-1'), expectedVersion: 1 }, PROPOSAL_REF,
    { itemId: 'item-1', effect: { ...original, draft: { title: original.draft.title, body: '改过的正文。' } } });
  const confirmed = await fixture.proposals.confirm(lesson('confirm-1'), PROPOSAL_REF, selectionOf(fixture, PROPOSAL_REF));
  const saved = fixture.handoffs.read(READ, confirmed.items[0]!.receipt!.target);
  expect(saved.body).toBe('改过的正文。');
  expect(saved.cutoff).toEqual(original.cutoff);
  expect(saved.facts).toEqual([{ kind: 'material', title: '三角函数.md' },
    { kind: 'saved', title: '单调性', target: 'card:card-1' }, { kind: 'pending', title: '待确认的一道题' }]);
  expect(saved.facts.some(fact => fact.title === '后来才保存的')).toBe(false);

  // Swapping the frozen facts out is a definite no-write, not a silent save.
  // A second lesson, since a closed one can no longer be proposed for a close.
  await seedHandoffProposal(fixture, { title: '第二份', body: '第二份正文。' }, 'proposal:proposal-2', 'lesson-c');
  const secondOriginal = fixture.proposals.read({ ...READ, sessionId: 'lesson-c' }, 'proposal:proposal-2').items[0]!.original.effect;
  if (secondOriginal.kind !== 'handoff') throw new Error('expected a handoff draft');
  await fixture.proposals.edit({ ...lesson('edit-2', 'lesson-c'), expectedVersion: 1 }, 'proposal:proposal-2',
    { itemId: 'item-1', effect: { ...secondOriginal, facts: [{ kind: 'material', title: '伪造的材料' }] } });
  const forged = await fixture.proposals.confirm(lesson('confirm-2', 'lesson-c'), 'proposal:proposal-2', selectionOf(fixture, 'proposal:proposal-2', 'lesson-c'));
  expect(forged.items[0]?.status).toBe('failed');
  expect(forged.items[0]?.failure).toMatchObject({ code: 'handoff_facts_fixed', commit: 'none' });
});

test('接续只认学生明确选定的那一版，改稿不回指，自己的课读最新版', async () => {
  const fixture = await open();
  const { selection } = await seedHandoffProposal(fixture);
  const confirmed = await fixture.proposals.confirm(lesson('confirm-1'), PROPOSAL_REF, selection);
  const ref = confirmed.items[0]!.receipt!.target;
  const remote = new StudyForgeHandoffs(fixture.ctx);

  // The student continues a real second lesson from the exact version they read.
  const pinned = await remote.continue({ operationId: 'continue-1', sessionId: 'lesson-b', ref, version: 1 });
  expect(pinned.version).toBe(1);
  expect(pinned.body).toBe('今天把单调性的判断顺序讲完了。');
  expect(fixture.courses.read({ ...READ, sessionId: 'lesson-b' }).data.continuation).toEqual({ ref, version: 1 });
  // A lost answer retries the same operation: it replays its own pin instead of
  // conflicting with the revision that write just moved.
  expect((await remote.continue({ operationId: 'continue-1', sessionId: 'lesson-b', ref, version: 1 })).version).toBe(1);
  expect(fixture.courses.read({ ...READ, sessionId: 'lesson-b' }).data.continuation).toEqual({ ref, version: 1 });

  // Correcting the summary makes revision 2. Reading is split by what each lesson
  // is: the continuing lesson keeps the revision it was handed, while the lesson
  // that owns the summary reads its own newest wording — otherwise the student
  // could never see (or further correct) the text they just wrote.
  const corrected = await fixture.handoffs.correct(lesson('correct-1', 'lesson-a', 1), ref, { body: '把判断顺序写得更清楚。' });
  expect(corrected.version).toBe(2);
  expect((await remote.read({ sessionId: 'lesson-b' })).body).toBe('今天把单调性的判断顺序讲完了。');
  expect((await remote.read({ sessionId: 'lesson-b' })).version).toBe(1);
  const mine = await remote.read({ sessionId: 'lesson-a' });
  expect(mine.version).toBe(2);
  expect(mine.body).toBe('把判断顺序写得更清楚。');
  // The older revision stays readable for anyone who pinned it.
  expect((await remote.read({ sessionId: 'lesson-a', ref, version: 1 })).body).toBe('今天把单调性的判断顺序讲完了。');

  // A continuation is fixed: choosing a different version is refused, not applied.
  await expect(remote.continue({ operationId: 'continue-2', sessionId: 'lesson-b', ref, version: 2 }))
    .rejects.toThrow('continuation_fixed');
  expect(fixture.courses.read({ ...READ, sessionId: 'lesson-b' }).data.continuation).toEqual({ ref, version: 1 });
});

test('从选定的一版开真实下一节：稳定原生 id，重试同一 operation 不开第二节课', async () => {
  const fixture = await open();
  // The continued lesson really holds a teaching configuration to carry over.
  await fixture.courses.update({ ...lesson('seed-source'), expectedVersion: 0 }, { teachingRef: 'socratic' });
  const { selection } = await seedHandoffProposal(fixture);
  const confirmed = await fixture.proposals.confirm(lesson('confirm-1'), PROPOSAL_REF, selection);
  const ref = confirmed.items[0]!.receipt!.target;
  const remote = new StudyForgeHandoffs(fixture.ctx);

  const first = await remote.openContinuation({ operationId: 'open-next', ref, version: 1 });
  // The same operation answers with the lesson it really opened, and only one
  // native session was ever created for it.
  const again = await remote.openContinuation({ operationId: 'open-next', ref, version: 1 });
  expect(again.sessionId).toBe(first.sessionId);
  expect([...fixture.opened]).toEqual([first.sessionId]);
  // The new lesson is pinned to the exact version the student chose, and carries
  // the continued lesson's own teaching configuration — nothing is invented and
  // nothing is advanced by date.
  const opened = fixture.courses.read({ ...READ, sessionId: first.sessionId });
  expect(opened.data.continuation).toEqual({ ref, version: 1 });
  expect(opened.data.teachingRef).toBe('socratic');
  expect(fixture.courses.read(READ).data.closure).not.toBeNull();
});
