/**
 * P7.5 confirmed close, post-class lesson and fixed continuation (plan §P7.5,
 * CONTRACTS.md §7).
 *
 * The workspace owner, the proposal record, the summary row and the course row
 * are the real ones; only the accepted-message facts are scripted, exactly as the
 * Host injects them. The test pins what this task exists for: nothing saves until
 * a real student confirmation exists, the summary and the closing fact land in
 * ONE native publication, a retry of the same operation stays idempotent with its
 * first time and cutoff, a failure leaves the complete old state, the lesson stays
 * discussable after closing, and correcting the summary makes a new immutable
 * revision without re-pointing a lesson that already continued from the old one.
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CourseMetadataSchema } from '../../packages/contracts/src/courses.ts';
import { HandoffCloseResultSchema, HandoffRecordSchema, HandoffViewSchema } from '../../packages/contracts/src/handoffs.ts';
import { ProposalEffectSchema, ProposalRecordSchema } from '../../packages/contracts/src/proposals.ts';
import type { HostContext, MutationContext } from '../../packages/contracts/src/execution.ts';
import { createClock } from '../../packages/domain/src/clock.ts';
import { ClassCloseService, type AtomicPublisher } from '../../packages/domain/src/courses/class-close-service.ts';
import { CourseMetadata, courseRecordRef } from '../../packages/domain/src/courses/course-metadata.ts';
import { HandoffService } from '../../packages/domain/src/courses/handoff-service.ts';
import { ProposalService, proposalEffectDigest } from '../../packages/domain/src/proposals/proposal-service.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';

// A real clock moves between attempts; a replay must not take a new close time.
let now = '2026-09-12T02:00:00.000Z';
const at = (instant: string): void => { now = instant; };
const clock = createClock('Asia/Shanghai', () => now);
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];

const CLOSE_OP = 'native:lesson-a:call-1:close_class';
// The frozen digest is the one the real confirm path computes from canonical content;
// a literal here would be rejected as a corrupt record by ProposalService.read.
const CONFIRMED_EFFECT = ProposalEffectSchema.parse({ kind: 'card-create', content: { title: '收课小结卡', front: '面' } });
const DIGEST = proposalEffectDigest(CONFIRMED_EFFECT);
const READ: HostContext = { workspaceId: 'student-a', sessionId: 'lesson-a', actor: 'student', purpose: 'learning' };
const write = (operationId: string) => ({ workspaceId: 'student-a', actor: 'student' as const, purpose: 'creation' as const, operationId });
const lesson = (operationId: string, expectedVersion?: number): MutationContext =>
  ({ workspaceId: 'student-a', sessionId: 'lesson-a', actor: 'student', purpose: 'learning', operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });

afterEach(async () => {
  now = '2026-09-12T02:00:00.000Z';
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function open() {
  const dir = await mkdtemp(join(tmpdir(), 'sf-close-'));
  roots.push(dir);
  const ctx = new Context();
  await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student-a', clock);
  const handoffStore = await owner.collection('handoff', HandoffRecordSchema);
  const courseStore = await owner.collection('course', CourseMetadataSchema);
  const proposalStore = await owner.collection('proposal', ProposalRecordSchema);
  const handoffs = new HandoffService(handoffStore, clock);
  const courses = new CourseMetadata(courseStore);
  // The real proposal reader; the executor is never reached in a close path.
  const decisions = new ProposalService(proposalStore, clock, { apply: async () => ({ target: 'card:stub', revision: 1, title: 'stub' }) });
  const closes = new ClassCloseService(handoffs, courses, decisions, owner);
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  return { owner, handoffStore, courseStore, proposalStore, handoffs, courses, decisions, closes };
}

/** One real proposal item with the attempt the confirm path writes before executing. */
async function seedConfirmation(fixture: Awaited<ReturnType<typeof open>>, overrides: { operationId?: string; digest?: string } = {}) {
  const operationId = overrides.operationId ?? CLOSE_OP, digest = overrides.digest ?? DIGEST;
  await fixture.proposalStore.create(write('proposal-1'), 'proposal-1', {
    title: '收课小结',
    origin: { kind: 'snapshot' },
    items: [{
      id: 'item-1', target: null, baseline: null, status: 'pending',
      drafts: [{ revision: 1, digest, effect: CONFIRMED_EFFECT, authoredBy: 'teacher', at: '2026-09-12T01:00:00.000Z' }],
      attempt: { operationId, draft: 1, digest, at: '2026-09-12T01:00:00.000Z', actor: 'student' },
    }],
  });
}

const closeInput = (overrides: { digest?: string; proposalRef?: string; cutoff?: { sessionId: string; sequence: number; at: string } } = {}) => ({
  draft: { title: '三角函数小结', body: '今天把单调性的判断顺序讲完了。' },
  cutoff: overrides.cutoff ?? { sessionId: 'lesson-a', sequence: 42, at: '2026-09-12T01:50:00.000Z' },
  facts: [
    { kind: 'material' as const, title: '三角函数.md' },
    { kind: 'saved' as const, title: '单调性', target: 'card:card-1' },
    { kind: 'pending' as const, title: '待确认的一道题' },
  ],
  confirmation: { proposalRef: overrides.proposalRef ?? 'proposal:proposal-1', itemId: 'item-1', draftRevision: 1, digest: overrides.digest ?? DIGEST },
});

test('学生确认后同一次原生提交保存小结并关闭课程', async () => {
  const fixture = await open();
  await seedConfirmation(fixture);
  const result = await fixture.closes.close(lesson(CLOSE_OP), closeInput());
  expect(HandoffCloseResultSchema.parse(result)).toEqual(result);
  const view = fixture.handoffs.read(READ, result.handoff.ref);
  expect(HandoffViewSchema.parse(view)).toEqual(view);
  expect(view).toMatchObject({ sessionId: 'lesson-a', title: '三角函数小结', body: '今天把单调性的判断顺序讲完了。', version: 1, createdAt: '2026-09-12T02:00:00.000Z' });
  // Host-injected facts stay separate from the teacher's free body.
  expect(view.cutoff).toEqual({ sessionId: 'lesson-a', sequence: 42, at: '2026-09-12T01:50:00.000Z' });
  expect(view.facts.map(fact => fact.kind)).toEqual(['material', 'saved', 'pending']);
  expect('continuation' in view).toBe(false);
  // The closing fact names the exact summary revision and the same instant.
  expect(fixture.courses.read(READ).data.closure).toEqual({ closedAt: view.createdAt, handoffRef: result.handoff.ref, handoffVersion: 1 });
  expect(fixture.handoffStore.list(READ)).toHaveLength(1);
});

test('没有真实确认 attempt 时模型直写被拒，旧态完整', async () => {
  const fixture = await open();
  await seedConfirmation(fixture);
  // A model operation that never went through the student's confirmation.
  await expect(fixture.closes.close(lesson('native:lesson-a:call-9:close_class'), closeInput()))
    .rejects.toMatchObject({ code: 'close_requires_confirmation' });
  // A confirmation whose digest is not the frozen one.
  await expect(fixture.closes.close(lesson(CLOSE_OP), closeInput({ digest: 'sha256:' + 'b'.repeat(64) })))
    .rejects.toMatchObject({ code: 'close_requires_confirmation' });
  // A confirmation that names no real proposal.
  await expect(fixture.closes.close(lesson(CLOSE_OP), closeInput({ proposalRef: 'proposal:missing' })))
    .rejects.toMatchObject({ code: 'record_missing' });
  expect(fixture.handoffStore.list(READ)).toHaveLength(0);
  expect(fixture.courses.read(READ)).toMatchObject({ version: 0, data: { closure: null } });
});

test('同一确认重放是幂等的：一份小结、一次关闭、时间与截止点不变', async () => {
  const fixture = await open();
  await seedConfirmation(fixture);
  const first = await fixture.closes.close(lesson(CLOSE_OP), closeInput());
  at('2026-09-12T09:30:00.000Z');
  // The Host re-reads its native cutoff on every attempt; a replay must keep the
  // one the first write really froze, not take the later one.
  const again = await fixture.closes.close(lesson(CLOSE_OP), closeInput({ cutoff: { sessionId: 'lesson-a', sequence: 99, at: '2026-09-12T09:00:00.000Z' } }));
  expect(again).toEqual(first);
  expect(fixture.handoffStore.list(READ)).toHaveLength(1);
  expect(fixture.handoffs.read(READ, first.handoff.ref).createdAt).toBe('2026-09-12T02:00:00.000Z');
  expect(fixture.handoffs.read(READ, first.handoff.ref).cutoff).toEqual({ sessionId: 'lesson-a', sequence: 42, at: '2026-09-12T01:50:00.000Z' });
  expect(fixture.courses.read(READ).data.closure).toMatchObject({ closedAt: '2026-09-12T02:00:00.000Z', handoffVersion: 1 });
  // The summary itself never gained a second revision from the retry.
  expect(fixture.handoffs.read(READ, first.handoff.ref).version).toBe(1);
});

test('发布失败留下完整旧态，重试补齐完整新态', async () => {
  const fixture = await open();
  await seedConfirmation(fixture);
  let killed = true;
  const flaky: AtomicPublisher = { atomic: async changes => { if (killed) throw new Error('killed_before_publish'); return fixture.owner.atomic(changes); } };
  const closes = new ClassCloseService(fixture.handoffs, fixture.courses, fixture.decisions, flaky);
  await expect(closes.close(lesson(CLOSE_OP), closeInput())).rejects.toThrow('killed_before_publish');
  // One native update, so there is no half state: neither row moved.
  expect(fixture.handoffStore.list(READ)).toHaveLength(0);
  expect(fixture.courses.read(READ)).toMatchObject({ version: 0, data: { closure: null } });
  killed = false;
  const result = await closes.close(lesson(CLOSE_OP), closeInput());
  expect(fixture.handoffStore.list(READ)).toHaveLength(1);
  const closure = fixture.courses.read(READ).data.closure;
  expect(closure).toMatchObject({ handoffRef: result.handoff.ref, handoffVersion: 1 });
  expect(fixture.handoffs.read(READ, result.handoff.ref).version).toBe(1);
});

test('关课后原课仍可讨论，closed 不回滚，另一份小结不能再关一次', async () => {
  const fixture = await open();
  await seedConfirmation(fixture);
  await fixture.closes.close(lesson(CLOSE_OP), closeInput());
  const closed = fixture.courses.read(READ);
  // The lesson keeps taking real teaching additions after the close.
  const later = await fixture.courses.update(lesson('after-close-1', closed.version), { stance: '关课后继续讨论这道题。' });
  expect(later.data.stance).toBe('关课后继续讨论这道题。');
  expect(later.data.closure).toEqual(closed.data.closure);
  // A different summary cannot close the same lesson a second time.
  await expect(fixture.courses.recordClosure(lesson('close-again', later.version), { closedAt: '2026-09-12T03:00:00.000Z', handoffRef: 'handoff:other' }))
    .rejects.toMatchObject({ code: 'course_already_closed' });
  expect(fixture.courses.read(READ).data.closure).toEqual(closed.data.closure);
});

test('已有教学字段的课也在原行上收课：追加关闭事实，同一操作重放不再写', async () => {
  const fixture = await open();
  // Real teaching additions land before the close, so the closing fact has to be
  // appended to the row this lesson already has instead of creating a new one.
  const seeded = await fixture.courses.update({ ...lesson('teach-1'), expectedVersion: 0 }, { stance: '关课前已经在上的课。' });
  expect(seeded.version).toBe(1);
  await seedConfirmation(fixture);
  const result = await fixture.closes.close(lesson(CLOSE_OP), closeInput());
  const closed = fixture.courses.read(READ);
  expect(closed.data.stance).toBe('关课前已经在上的课。');
  expect(closed.version).toBe(2);
  expect(closed.data.closure).toEqual({ closedAt: result.closure.closedAt, handoffRef: result.handoff.ref, handoffVersion: 1 });
  // The one publication already happened; a replay reads it back without a write.
  at('2026-09-12T09:30:00.000Z');
  expect(await fixture.closes.close(lesson(CLOSE_OP), closeInput())).toEqual(result);
  expect(fixture.courses.read(READ).version).toBe(2);
  expect(fixture.handoffStore.list(READ)).toHaveLength(1);
});

test('更正生成新的不可变 revision，已固定的接续版本不被追溯改绑', async () => {
  const fixture = await open();
  await seedConfirmation(fixture);
  const first = await fixture.closes.close(lesson(CLOSE_OP), closeInput());
  const original = fixture.handoffs.read(READ, first.handoff.ref);
  // Another lesson opened as a continuation fixes the exact revision it received.
  const pin = { ref: first.handoff.ref, version: 1 };
  // A brand-new continuation lesson has no teaching row yet: version 0 is the
  // established first-write form, and the pin lands on the row it creates.
  await fixture.courses.setContinuation({ ...lesson('open-continuation', 0), sessionId: 'lesson-b' }, pin);

  at('2026-09-13T02:00:00.000Z');
  const corrected = await fixture.handoffs.correct(lesson('correct-1', 1), first.handoff.ref, { body: '把判断顺序写得更清楚。' });
  expect(corrected.version).toBe(2);
  expect(corrected.title).toBe(original.title);
  expect(corrected.body).toBe('把判断顺序写得更清楚。');
  // The system facts and the first write's own time are untouched by a correction.
  expect(corrected.cutoff).toEqual(original.cutoff);
  expect(corrected.facts).toEqual(original.facts);
  expect(corrected.createdAt).toBe(original.createdAt);
  // The old revision stays readable, and the pinned continuation still reads it.
  expect(fixture.handoffs.read(READ, first.handoff.ref, 1).body).toBe('今天把单调性的判断顺序讲完了。');
  expect(fixture.handoffs.readPinned(READ, pin).body).toBe('今天把单调性的判断顺序讲完了。');
  const continued = fixture.courses.read({ ...READ, sessionId: 'lesson-b' });
  expect(continued.data.continuation).toEqual(pin);
  // The exported helper names the very row the class writes: sha256(sessionId).
  expect(fixture.courseStore.read(READ, courseRecordRef('lesson-b')).data.continuation).toEqual(pin);
  // A stale correction is refused rather than silently rewriting revision 2.
  await expect(fixture.handoffs.correct(lesson('correct-stale', 1), first.handoff.ref, { body: '陈旧更正。' }))
    .rejects.toMatchObject({ code: 'version_conflict' });
});
