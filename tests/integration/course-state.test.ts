/**
 * P2.4 classroom state over the real teaching-metadata record.
 *
 * The lesson identity, the metadata store and the native session are the real
 * ones; only the model backend of the native turn is scripted. The test pins
 * the separation this task exists for: navigation/idle/archiving and a later
 * native prompt never end or reopen a lesson, and only the confirmed P7 close
 * writer produces the closed fact.
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZodError } from 'zod';
import { CourseMetadataSchema, type HostContext, type MutationContext } from '../../packages/contracts/src/index.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
// Imported through the package entry so the store handle and this class share
// one declaration of RecordStore (the built domain output), not two.
import { CourseMetadata } from '@studyforge/domain/courses';
import { projectCourse, readCourseState } from '../../packages/domain/src/courses/course-projection.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';
import { mountNativeAgentHarness, type NativeAgentHarness } from '../fixtures/native-agent.ts';

const clock = createTestClock('2026-09-12T00:00:00Z', 'Asia/Shanghai');
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
const harnesses: NativeAgentHarness[] = [];

type Workspace = Awaited<ReturnType<typeof open>>;
async function open(root?: string) {
  const dir = root ?? await mkdtemp(join(tmpdir(), 'sf-course-state-'));
  if (!roots.includes(dir)) roots.push(dir);
  const ctx = new Context(); await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student-a', clock);
  const metadata = new CourseMetadata(await owner.collection('course', CourseMetadataSchema));
  const workspace = { ctx, owner, metadata, root: dir };
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  return workspace;
}

function lesson(sessionId: string): HostContext {
  return { workspaceId: 'student-a', sessionId, actor: 'student', purpose: 'learning' };
}
function write(sessionId: string, operationId: string, expectedVersion: number): MutationContext {
  return { ...lesson(sessionId), operationId, expectedVersion };
}

afterEach(async () => {
  for (const harness of harnesses.splice(0).reverse()) await harness.dispose();
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

test('read-back follows the real metadata revision and only the P7 close writer ends a lesson', async () => {
  const { metadata } = await open();
  const ctx = lesson('lesson-a');
  const fresh = readCourseState(metadata, ctx);
  expect(fresh).toMatchObject({ sessionId: 'lesson-a', status: 'open', revision: 0, closure: null, archived: false, anomaly: null });
  expect(fresh.lessonMaterials).toEqual({ materials: [] });

  const materials = await metadata.update(write('lesson-a', 'materials', 0), {
    lessonMaterials: { materials: [{ kind: 'card', cardRef: 'card:one' }] },
  });
  const archived = await metadata.update(write('lesson-a', 'archive', materials.version), { archived: true });

  const state = readCourseState(metadata, ctx);
  expect(state).toMatchObject({ status: 'open', archived: true, revision: archived.version, anomaly: null });
  expect(state.lessonMaterials.materials).toEqual([{ kind: 'card', cardRef: 'card:one' }]);
  // Navigation and repeated reads are pure: same row, same state, no write.
  expect(readCourseState(metadata, ctx)).toEqual(state);
  expect(readCourseState(metadata, ctx)).toEqual(state);
  expect(projectCourse(archived)).toEqual(state);

  const closure = { closedAt: '2026-09-12T02:00:00.000Z', handoffRef: 'handoff:lesson-a' };
  const closed = await metadata.recordClosure(write('lesson-a', 'close', archived.version), closure);
  const closedState = readCourseState(metadata, ctx);
  expect(closedState).toMatchObject({ status: 'closed', revision: closed.version, closure, anomaly: null });
  await expect(metadata.recordClosure(write('lesson-a', 'close-again', closed.version), closure))
    .rejects.toMatchObject({ code: 'course_already_closed' });

  // A later metadata edit changes the row but never the close fact.
  const later = await metadata.update(write('lesson-a', 'reopen-attempt', closed.version), { archived: false });
  expect(readCourseState(metadata, ctx)).toMatchObject({ status: 'closed', revision: later.version, archived: false, closure });
});

test('a later native prompt and a Host restart keep the close fact', async () => {
  const harness = await mountNativeAgentHarness({ subagents: true });
  harnesses.push(harness);
  harness.adapter.script(null, { kind: 'text', text: '我们继续。' });
  const agent = await harness.createAgent('lesson-restart');
  await harness.turn(agent, '这题先别收课');

  const first = await open();
  const ctx = lesson('lesson-restart');
  const closure = { closedAt: '2026-09-12T02:00:00.000Z', handoffRef: 'handoff:lesson-restart' };
  const closed = await first.metadata.recordClosure(write('lesson-restart', 'close', readCourseState(first.metadata, ctx).revision), closure);
  expect(readCourseState(first.metadata, ctx).status).toBe('closed');

  // 课后学生主动输入：还是同一课、还是已结束，没有 r2 式重开。
  harness.adapter.script(null, { kind: 'text', text: '这条也算课后讨论。' });
  await harness.turn(agent, '收课之后我还想问一句');
  expect(readCourseState(first.metadata, ctx)).toMatchObject({ status: 'closed', revision: closed.version, closure });

  // Host 重启：同一学习空间重新打开，闭课事实仍在。
  const before = readCourseState(first.metadata, ctx);
  await first.owner.close();
  const reopened: Workspace = await open(first.root);
  expect(readCourseState(reopened.metadata, ctx)).toEqual(before);
});

test('an unreadable row is listed separately while a bad caller still fails', async () => {
  const { metadata } = await open();
  const ctx = lesson('lesson-broken');
  for (const [thrown, anomaly] of [['course_binding_mismatch', 'course_binding_mismatch'], ['record_corrupt', 'course_corrupt']] as const) {
    const broken = readCourseState({ read: () => { throw Object.assign(new Error(thrown), { code: thrown }); } }, ctx);
    expect(broken).toMatchObject({ sessionId: 'lesson-broken', status: 'unknown', anomaly, revision: 0, closure: null });
  }
  // A row that fails validation surfaces as a corrupt row, not as an open lesson.
  expect(readCourseState({ read: () => { throw new ZodError([]); } }, ctx)).toMatchObject({ status: 'unknown', anomaly: 'course_corrupt' });

  // 调用方错误不被吞成"未知"，也不被吞成"未结束"。
  expect(() => readCourseState(metadata, { ...ctx, purpose: 'creation' })).toThrow(/learning_session_required/);
  expect(() => readCourseState(metadata, { ...ctx, workspaceId: 'another-workspace' })).toThrow(/workspace/);
  // 真正的空课仍是 open。
  expect(readCourseState(metadata, ctx)).toMatchObject({ status: 'open', anomaly: null });
});
