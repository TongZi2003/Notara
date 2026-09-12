/**
 * P4.1 lesson resource projection over the real stores.
 *
 * The teaching row, the card store, the material versions and the accepted
 * messages are all real; only the caller is scripted. The test pins the
 * properties this deck exists for: it is rebuilt from references instead of
 * being written when a tab opens, the lesson's own order survives, one original
 * in two places stays two rows while an identical reference collapses into one
 * row with both origins, and closing the lesson removes nothing.
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CardContentSchema, CourseMetadataSchema, type EntityRef, type MutationContext } from '../../packages/contracts/src/index.ts';
import { MaterialRecordSchema } from '../../packages/contracts/src/material-records.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { CourseMetadata } from '@studyforge/domain/courses';
import { readCourseState } from '../../packages/domain/src/courses/course-projection.ts';
import { readLessonResources, type AcceptedMessageSources } from '../../packages/domain/src/courses/lesson-resource-projection.ts';
import { projectOutputs, type OutputReader } from '../../packages/domain/src/courses/output-projection.ts';
import { MaterialService } from '../../packages/domain/src/materials/material-service.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';

const clock = createTestClock('2026-09-12T00:00:00Z', 'Asia/Shanghai');
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
const SESSION = 'lesson-a';
const encoded = (text: string) => new TextEncoder().encode(text);
const lesson = (operationId: string, expectedVersion?: number): MutationContext =>
  ({ workspaceId: 'student-a', sessionId: SESSION, actor: 'student', purpose: 'learning', operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
/** Read-only Host context for the stores; the cordis app is returned separately. */
const HOST = { workspaceId: 'student-a', sessionId: SESSION, actor: 'student' as const, purpose: 'learning' as const };

async function open(root?: string) {
  const dir = root ?? await mkdtemp(join(tmpdir(), 'sf-mixed-deck-'));
  if (!roots.includes(dir)) roots.push(dir);
  const ctx = new Context(); await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student-a', clock);
  const course = new CourseMetadata(await owner.collection('course', CourseMetadataSchema));
  const cards = await owner.collection('card', CardContentSchema);
  const materials = new MaterialService(await owner.collection('material', MaterialRecordSchema), dir, clock);
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  return { app: ctx, owner, course, cards, materials, root: dir };
}

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** The code of the error a synchronous projection refuses with, if it throws. */
function caughtCode(run: () => unknown): string | undefined {
  try { run(); return undefined; }
  catch (error) { return (error as { code?: string } | null)?.code; }
}

const textAt = (line: number, column: number, endLine: number, endColumn: number) =>
  ({ kind: 'text', start: { line, column }, end: { line: endLine, column: endColumn } }) as const;

test('the deck is rebuilt from real references, keeps order and does not merge two positions', async () => {
  const { course, cards, materials } = await open();
  const material = await materials.import(lesson('import-1'), { title: '三角函数讲义', fileName: '三角.md', mediaType: 'text/markdown', bytes: encoded('第一段\n第二段\n第三段\n第四段\n') });
  const version = material.currentVersion.versionId;
  const anchorAt = (line: number) => ({ materialId: material.materialId, versionId: version, locator: textAt(line, 0, line, 3) });

  await course.update(lesson('materials', 0), { lessonMaterials: { materials: [
    // The same original at two positions: each position is its own way back.
    { kind: 'source', source: anchorAt(1) },
    { kind: 'card', cardRef: 'card:wrong-answer' },
    { kind: 'source', source: anchorAt(4) },
    // An identical repeat of the first reference is the same row, not a second one.
    { kind: 'source', source: anchorAt(1) },
  ] } });
  const saved = await cards.create(lesson('card-out'), 'out-card', { title: '课上产出', front: '题干', presentation: 'problem' });
  expect(saved.version).toBe(1);

  const messages: readonly AcceptedMessageSources[] = [
    { messageId: 'm1', sources: [{ ...anchorAt(1), quote: '第一段' }, { ...anchorAt(4), quote: '第四段' }] },
    { messageId: 'm2', currentMaterial: { kind: 'card', cardRef: 'card:wrong-answer' } },
  ];
  const reader: OutputReader = target => {
    const found = cards.read(HOST, target);
    return { state: 'present', title: found.data.title, presentation: found.data.presentation, revision: found.version, sources: found.data.sources };
  };
  const outputs = projectOutputs({ sessionId: SESSION, changes: cards.changes(HOST, 'card:out-card'), read: reader });
  const deck = readLessonResources({ sessionId: SESSION, course: readCourseState(course, lesson('read')), messages, outputs });

  expect(deck).toMatchObject({ sessionId: SESSION, status: 'open', courseRevision: 1, anomalies: [] });
  // Course order first, then the message's own order, then the saved output.
  expect(deck.resources.map(row => [row.kind, row.tabKey, row.source?.locator?.kind ?? null, row.target])).toEqual([
    ['material', `material:${material.materialId}@${version}`, 'text', null],
    ['card', 'card:wrong-answer', null, 'card:wrong-answer'],
    ['material', `material:${material.materialId}@${version}`, 'text', null],
    ['card', 'card:out-card', null, 'card:out-card'],
  ]);
  // Two positions of one version are two rows, but one native tab.
  const positions = deck.resources.filter(row => row.kind === 'material');
  expect(new Set(positions.map(row => row.tabKey)).size).toBe(1);
  expect(positions.map(row => row.source?.locator && row.source.locator.kind === 'text' ? row.source.locator.start.line : null)).toEqual([1, 4]);
  // The repeated reference collapses into the row that already exists, with both origins.
  expect(positions[0]!.origins).toEqual([{ from: 'course' }, { from: 'message', messageId: 'm1' }]);
  expect(positions[0]!.quote).toBe('第一段');
  expect(positions[1]!.origins).toEqual([{ from: 'course' }, { from: 'message', messageId: 'm1' }]);
  expect(deck.resources.at(-1)!.origins).toEqual([{ from: 'output', operationId: 'card-out', revision: 1 }]);
});

test('an empty lesson, a pending draft and an unreadable output never invent a resource', async () => {
  const { course, cards, materials } = await open();
  const empty = readLessonResources({ sessionId: SESSION, course: readCourseState(course, lesson('read-empty')) });
  expect(empty).toMatchObject({ resources: [], anomalies: [], status: 'open', courseRevision: 0 });

  await materials.import(lesson('import-2'), { title: '讲义', fileName: '讲义.md', mediaType: 'text/markdown', bytes: encoded('正文\n') });
  await cards.create(lesson('card-live'), 'live-card', { title: 'live-card', front: '题干' });
  const reader: OutputReader = target => target === 'card:live-card'
    ? { state: 'present', title: 'live-card', presentation: 'note', revision: 1 }
    : { state: 'unknown', code: 'read_failed' };
  const outputs = projectOutputs({
    sessionId: SESSION,
    changes: [...cards.changes(HOST, 'card:live-card')],
    proposals: [{ sessionId: SESSION, proposalId: 'draft-1', kind: 'card', title: '待确认草稿', status: 'pending' }],
    read: reader,
  });
  const deck = readLessonResources({ sessionId: SESSION, course: readCourseState(course, lesson('read-again')), outputs });
  // Only the really saved object is a resource; the draft stays in the output list.
  expect(deck.resources.map(row => row.target)).toEqual(['card:live-card']);
  // A declared resource whose state could not be read is reported, never dropped silently.
  await cards.create(lesson('card-bad'), 'bad-card', { title: '待读卡', front: '题目' });
  const unreadable = projectOutputs({ sessionId: SESSION, changes: cards.changes(HOST, 'card:bad-card'), read: () => ({ state: 'unknown', code: 'read_failed' }) });
  const unknown = readLessonResources({ sessionId: SESSION, outputs: unreadable });
  expect(unknown.resources).toEqual([]);
  expect(unknown.anomalies).toEqual([{ target: 'card:bad-card', code: 'read_failed' }]);
});

test('a closed lesson keeps every material and rebuilds the same deck after a restart', async () => {
  const { owner, course, materials, root } = await open();
  const material = await materials.import(lesson('import-3'), { title: '原件', fileName: '原件.md', mediaType: 'text/markdown', bytes: encoded('第一行\n第二行\n') });
  const reference = { kind: 'source' as const, source: { materialId: material.materialId, versionId: material.currentVersion.versionId, locator: textAt(2, 0, 2, 2) } };
  const opened = await course.update(lesson('materials', 0), { lessonMaterials: { materials: [reference] } });
  const before = readLessonResources({ sessionId: SESSION, course: readCourseState(course, lesson('read-before')) });
  expect(before.status).toBe('open');

  const closure = { closedAt: '2026-09-12T02:00:00.000Z', handoffRef: 'handoff:lesson-a' };
  await course.recordClosure(lesson('close', opened.version), closure);
  const closed = readCourseState(course, lesson('read-closed'));
  const after = readLessonResources({ sessionId: SESSION, course: closed });
  expect(closed.status).toBe('closed');
  // Ending the lesson is not a materials event: same rows, same order, same positions.
  expect(after.resources).toEqual(before.resources);
  expect(after.status).toBe('closed');
  expect(after.courseRevision).toBeGreaterThan(before.courseRevision!);

  await owner.close();
  const reopened = await open(root);
  const again = readLessonResources({ sessionId: SESSION, course: readCourseState(reopened.course, lesson('read-restart')) });
  expect(again).toEqual(after);
  expect((await reopened.materials.get(lesson('read-material'), material.materialId)).currentVersion).toEqual(material.currentVersion);
});

test('a new version of one original is a different tab, and another lesson is never projected here', async () => {
  const { course, cards, materials } = await open();
  const first = await materials.import(lesson('v1'), { title: '讲义', fileName: '讲义.md', mediaType: 'text/markdown', bytes: encoded('第一版\n') });
  const second = await materials.createVersion(lesson('v2', first.revision), {
    materialId: first.materialId, title: '讲义', fileName: '讲义.md', mediaType: 'text/markdown', bytes: encoded('第二版\n'),
  });
  await materials.createVersion(lesson('v3', second.revision), {
    materialId: first.materialId, title: '讲义', fileName: '讲义.md', mediaType: 'text/markdown', bytes: encoded('第三版\n'),
  });
  const v1 = first.currentVersion.versionId, v2 = second.currentVersion.versionId;
  const deck = readLessonResources({
    sessionId: SESSION,
    course: readCourseState(course, lesson('read')),
    messages: [{ messageId: 'm', sources: [
      { materialId: first.materialId, versionId: v1, locator: textAt(1, 0, 1, 3) },
      { materialId: first.materialId, versionId: v1, locator: textAt(2, 0, 2, 3) },
    ] }],
    outputs: {
      sessionId: SESSION,
      entries: [{ target: 'card:multi', kind: 'card', title: '多来源卡', status: 'saved', deck: true, revision: 1, committedAt: '2026-09-12T01:00:00.000Z', operationId: 'multi', proposalId: null, sources: [
        { materialId: first.materialId, versionId: v2, locator: textAt(1, 0, 1, 3), quote: '第二版第一行' },
      ] }],
      anomalies: [],
    },
  });
  // Same version, two positions: one tab. A saved card's own source is a third row.
  expect(deck.resources.map(row => [row.kind, row.tabKey])).toEqual([
    ['material', `material:${first.materialId}@${v1}`],
    ['material', `material:${first.materialId}@${v1}`],
    ['card', 'card:multi'],
    ['material', `material:${first.materialId}@${v2}`],
  ]);
  // v1 and v2 are different native files and never share a tab.
  expect(new Set(deck.resources.filter(row => row.kind === 'material').map(row => row.tabKey)).size).toBe(2);
  expect(deck.resources.at(-1)).toMatchObject({ quote: '第二版第一行', origins: [{ from: 'output', operationId: 'multi', revision: 1 }] });

  // A draft is not material until it is really saved, even when it names sources.
  const pending = readLessonResources({
    sessionId: SESSION,
    outputs: {
      sessionId: SESSION,
      entries: [{
        target: 'card:draft', kind: 'card', title: '待确认稿', status: 'pending', deck: false, revision: null,
        committedAt: null, operationId: null, proposalId: 'draft-1',
        sources: [{ materialId: first.materialId, versionId: v2, locator: textAt(1, 0, 1, 3), quote: '还没确认' }],
      }],
      anomalies: [],
    },
  });
  expect(pending.resources).toEqual([]);

  // A row or a projection naming another lesson is refused, not counted here.
  expect(caughtCode(() => readLessonResources({
    sessionId: SESSION,
    course: { sessionId: 'other-lesson', revision: 1, status: 'open', closure: null, archived: false, lessonMaterials: { materials: [] }, learningSetRef: null, anomaly: null },
  }))).toBe('lesson_binding_mismatch');
  expect(caughtCode(() => readLessonResources({ sessionId: SESSION, outputs: { sessionId: 'other-lesson', entries: [], anomalies: [] } })))
    .toBe('lesson_binding_mismatch');
  void cards;
});

test('an unfiled card and a material version are both openable identity, not a copy of text', async () => {
  const { course, materials } = await open();
  const material = await materials.import(lesson('import-4'), { title: '野讲义', fileName: '野讲义.md', mediaType: 'text/markdown', bytes: encoded('内容\n') });
  const deck = readLessonResources({
    sessionId: SESSION,
    course: readCourseState(course, lesson('read')),
    messages: [{ messageId: 'm9', currentMaterial: { kind: 'source', source: { materialId: material.materialId, versionId: material.currentVersion.versionId } } }],
    outputs: {
      sessionId: SESSION,
      entries: [{ target: 'card:unfiled-card', kind: 'card', title: '未归集卡', status: 'saved', deck: true, revision: 3, committedAt: '2026-09-12T01:00:00.000Z', operationId: 'unfiled', proposalId: null, sources: [] }],
      anomalies: [],
    },
  });
  expect(deck.resources.map(row => [row.kind, row.tabKey, row.source?.versionId ?? null, row.target])).toEqual([
    ['material', `material:${material.materialId}@${material.currentVersion.versionId}`, material.currentVersion.versionId, null],
    ['card', 'card:unfiled-card', null, 'card:unfiled-card'],
  ]);
  // The row carries identity only; the title of an object is read from the object itself.
  const target: EntityRef | null = deck.resources[1]!.target;
  expect(target).toBe('card:unfiled-card');
});
