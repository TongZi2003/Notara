/**
 * P2.5 lesson output list over real records.
 *
 * Every candidate here comes from a real `RecordStore.changes` row produced by
 * a real create, and every title/kind/deck flag comes from reading the real
 * record back. Nothing is a hand-written UI array. The only injected failures
 * are read-dependency failures, which is exactly the boundary under test.
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CardContentSchema, KnowledgeContentSchema, type HostContext, type MutationContext } from '../../packages/contracts/src/index.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { projectOutputs, questionDeck, type OutputRead } from '../../packages/domain/src/courses/output-projection.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';

const clock = createTestClock('2026-09-12T03:00:00Z', 'Asia/Shanghai');
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];

async function open(root?: string) {
  const dir = root ?? await mkdtemp(join(tmpdir(), 'sf-outputs-'));
  if (!roots.includes(dir)) roots.push(dir);
  const ctx = new Context(); await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student-a', clock);
  const cards = await owner.collection('card', CardContentSchema);
  const knowledge = await owner.collection('knowledge', KnowledgeContentSchema);
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  return { ctx, owner, cards, knowledge, root: dir };
}

type Workspace = Awaited<ReturnType<typeof open>>;
const lesson = (sessionId = 'lesson-a'): HostContext => ({ workspaceId: 'student-a', sessionId, actor: 'student', purpose: 'learning' });
const write = (operationId: string, expectedVersion: number, sessionId = 'lesson-a'): MutationContext =>
  ({ ...lesson(sessionId), operationId, expectedVersion });
/** A real write with no lesson binding at all: study outside any classroom. */
const outOfClass = (operationId: string, expectedVersion: number): MutationContext =>
  ({ workspaceId: 'student-a', actor: 'student', purpose: 'learning', operationId, expectedVersion });

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** The real read dependency: load the record, or report why it is not there. */
function recordReader(workspace: Workspace, ctx: HostContext, fail?: (target: string) => Error | undefined) {
  return (target: string): OutputRead => {
    const failure = fail?.(target);
    if (failure) throw failure;
    try {
      if (target.startsWith('card:')) {
        const saved = workspace.cards.read(ctx, target);
        return {
          state: 'present', title: saved.data.title, presentation: saved.data.presentation,
          revision: saved.version, sources: saved.data.sources,
        };
      }
      if (target.startsWith('knowledge:')) {
        const saved = workspace.knowledge.read(ctx, target);
        return { state: 'present', title: saved.data.title, revision: saved.version };
      }
      return { state: 'unknown', code: 'unknown_target' };
    } catch (error) {
      // Structural code check: the store handle and this test may hold separate
      // module instances of the same error class.
      if ((error as { code?: unknown } | null)?.code === 'record_missing') return { state: 'gone' };
      throw error;
    }
  };
}

test('real changes become saved typed outputs in source order, and only problem cards enter the deck', async () => {
  const workspace = await open();
  const ctx = lesson();
  const created = [
    { id: 'zzz', data: { title: '第一题', presentation: 'problem' as const, front: '求 $x$' } },
    { id: 'aaa', data: { title: '一个洞见', presentation: 'insight' as const } },
    { id: 'mmm', data: { title: '第二题', presentation: 'problem' as const, front: '求 $y$' } },
  ];
  for (const [index, card] of created.entries()) await workspace.cards.create(write(`create-${index}`, 0), card.id, card.data);
  const changes = ['card:zzz', 'card:aaa', 'card:mmm'].flatMap(ref => workspace.cards.changes(ctx, ref));
  expect(changes.map(change => change.target)).toEqual(['card:zzz', 'card:aaa', 'card:mmm']);

  const projection = projectOutputs({ sessionId: 'lesson-a', changes, read: recordReader(workspace, ctx) });
  // Source order, never an alphabetical/filename order.
  expect(projection.entries.map(entry => entry.target)).toEqual(['card:zzz', 'card:aaa', 'card:mmm']);
  expect(projection.entries.map(entry => entry.title)).toEqual(['第一题', '一个洞见', '第二题']);
  expect(projection.entries.every(entry => entry.status === 'saved' && entry.revision === 1)).toBe(true);
  expect(projection.entries.map(entry => entry.deck)).toEqual([true, false, true]);
  expect(projection.entries[0]?.operationId).toBe('create-0');
  expect(projection.entries[0]?.committedAt).toBe(changes[0]?.committedAt);
  expect(projection.anomalies).toEqual([]);
  expect(questionDeck(projection).map(entry => entry.target)).toEqual(['card:zzz', 'card:mmm']);
});

test('knowledge keeps its own kind and never borrows the card shell', async () => {
  const workspace = await open();
  const ctx = lesson();
  await workspace.cards.create(write('card-create', 0), 'one', { title: '普通题', presentation: 'problem', front: 'x' });
  await workspace.knowledge.create(write('knowledge-create', 0), 'one', { title: '判别式', body: '比原式少算一步' });

  const changes = [
    ...workspace.cards.changes(ctx, 'card:one'),
    ...workspace.knowledge.changes(ctx, 'knowledge:one'),
  ];
  const projection = projectOutputs({ sessionId: 'lesson-a', changes, read: recordReader(workspace, ctx) });
  expect(projection.entries.map(entry => [entry.kind, entry.status, entry.deck])).toEqual([
    ['card', 'saved', true], ['knowledge', 'saved', false],
  ]);
  expect(questionDeck(projection).map(entry => entry.target)).toEqual(['card:one']);
});

test('an object that is gone is dropped and never resurrected by a later rebuild', async () => {
  const first = await open();
  const ctx = lesson();
  await first.cards.create(write('old-create', 0), 'old', { title: '旧卡', presentation: 'problem', front: '旧' });
  const oldChanges = first.cards.changes(ctx, 'card:old');
  await first.owner.close();
  await rm(join(first.root, '.studyforge', 'sf_card.json'), { force: true });

  const rebuilt = await open(first.root);
  // The committed change still exists, but the object does not: no output row.
  expect(projectOutputs({ sessionId: 'lesson-a', changes: oldChanges, read: recordReader(rebuilt, ctx) }).entries).toEqual([]);

  await rebuilt.cards.create(write('new-create', 0), 'new', { title: '新卡', presentation: 'problem', front: '新' });
  const after = projectOutputs({
    sessionId: 'lesson-a',
    changes: [...oldChanges, ...rebuilt.cards.changes(ctx, 'card:new')],
    read: recordReader(rebuilt, ctx),
  });
  expect(after.entries.map(entry => entry.target)).toEqual(['card:new']);
  expect(after.entries.map(entry => entry.title)).toEqual(['新卡']);
});

test('the question deck follows the real source position inside one material version', async () => {
  const workspace = await open();
  const ctx = lesson();
  const at = (page: number) => ({ materialId: 'book-1', versionId: 'v3', locator: { kind: 'pdf' as const, page } });
  // 真实建卡顺序（也是 id 顺序）与来源位置故意相反，且 id 与位置也不同序。
  await workspace.cards.create(write('c1', 0), 'aaa', { title: '第 12 页', presentation: 'problem', front: 'x', sources: [at(12)] });
  await workspace.cards.create(write('c2', 0), 'mmm', { title: '第 3 页', presentation: 'problem', front: 'x', sources: [at(3)] });
  await workspace.cards.create(write('c3', 0), 'zzz', { title: '第 7 页', presentation: 'problem', front: 'x', sources: [at(7)] });
  // 没有来源的普通题保留首提交顺序。
  await workspace.cards.create(write('c4', 0), 'no-src', { title: '无来源题', presentation: 'problem', front: 'x' });

  const changes = ['card:aaa', 'card:mmm', 'card:zzz', 'card:no-src'].flatMap(ref => workspace.cards.changes(ctx, ref));
  const projection = projectOutputs({ sessionId: 'lesson-a', changes, read: recordReader(workspace, ctx) });
  // 产出列表本身仍是提交序；只有题目 deck 按真实来源位置排。
  expect(projection.entries.map(entry => entry.target)).toEqual(['card:aaa', 'card:mmm', 'card:zzz', 'card:no-src']);
  expect(questionDeck(projection).map(entry => entry.title)).toEqual(['第 3 页', '第 7 页', '第 12 页', '无来源题']);
});

test('re-sorting one source group never moves the cards around it', async () => {
  const workspace = await open();
  const ctx = lesson();
  const at = (materialId: string, page: number) => ({ materialId, versionId: 'v3', locator: { kind: 'pdf' as const, page } });
  // 提交序：book-1@12, 无来源, book-2@5, book-1@3
  await workspace.cards.create(write('s1', 0), 'aaa', { title: 'A-12', presentation: 'problem', front: 'x', sources: [at('book-1', 12)] });
  await workspace.cards.create(write('s2', 0), 'free', { title: '无来源', presentation: 'problem', front: 'x' });
  await workspace.cards.create(write('s3', 0), 'bbb', { title: 'B-5', presentation: 'problem', front: 'x', sources: [at('book-2', 5)] });
  await workspace.cards.create(write('s4', 0), 'mmm', { title: 'A-3', presentation: 'problem', front: 'x', sources: [at('book-1', 3)] });

  const changes = ['card:aaa', 'card:free', 'card:bbb', 'card:mmm'].flatMap(ref => workspace.cards.changes(ctx, ref));
  const projection = projectOutputs({ sessionId: 'lesson-a', changes, read: recordReader(workspace, ctx) });
  // book-1 只占第 0、3 两个槽位：只在槽位内交换；无来源与 book-2 原地不动。
  expect(questionDeck(projection).map(entry => entry.title)).toEqual(['A-3', '无来源', 'B-5', 'A-12']);
});

test('DOCX offsets are only compared inside one part and block', async () => {
  const workspace = await open();
  const ctx = lesson();
  const docx = (blockId: string, start: number) => ({
    materialId: 'paper-1', versionId: 'v1',
    locator: { kind: 'docx' as const, part: 'word/document.xml', blockId, start, end: start + 10 },
  });
  // 提交序：p1@10, p2@0, p1@0 —— 跨 block 比 offset 会把 p2@0 排到 p1@10 前面。
  await workspace.cards.create(write('d1', 0), 'later', { title: '第1段后半', presentation: 'problem', front: 'x', sources: [docx('p1', 10)] });
  await workspace.cards.create(write('d2', 0), 'second', { title: '第2段开头', presentation: 'problem', front: 'x', sources: [docx('p2', 0)] });
  await workspace.cards.create(write('d3', 0), 'first', { title: '第1段开头', presentation: 'problem', front: 'x', sources: [docx('p1', 0)] });

  const changes = ['card:later', 'card:second', 'card:first'].flatMap(ref => workspace.cards.changes(ctx, ref));
  const projection = projectOutputs({ sessionId: 'lesson-a', changes, read: recordReader(workspace, ctx) });
  expect(questionDeck(projection).map(entry => entry.title)).toEqual(['第1段开头', '第2段开头', '第1段后半']);
});

test('a partial read failure turns one row unknown and leaves the rest intact', async () => {
  const workspace = await open();
  const ctx = lesson();
  await workspace.cards.create(write('create-a', 0), 'a', { title: '好卡', presentation: 'problem', front: 'a' });
  await workspace.cards.create(write('create-b', 0), 'b', { title: '读不出的卡', presentation: 'problem', front: 'b' });
  const changes = ['card:a', 'card:b'].flatMap(ref => workspace.cards.changes(ctx, ref));

  const projection = projectOutputs({
    sessionId: 'lesson-a', changes,
    read: recordReader(workspace, ctx, target => (target === 'card:b' ? Object.assign(new Error('record_corrupt'), { code: 'record_corrupt' }) : undefined)),
  });
  expect(projection.entries.map(entry => [entry.target, entry.status, entry.title, entry.deck])).toEqual([
    ['card:a', 'saved', '好卡', true],
    ['card:b', 'unknown', null, false],
  ]);
  expect(projection.anomalies).toEqual([{ target: 'card:b', code: 'record_corrupt' }]);
  expect(questionDeck(projection).map(entry => entry.target)).toEqual(['card:a']);
});

test('proposal claims stay pending or unknown and never enter the deck', async () => {
  const workspace = await open();
  const ctx = lesson();
  await workspace.cards.create(write('create-one', 0), 'one', { title: '已存题', presentation: 'problem', front: 'x' });

  const projection = projectOutputs({
    sessionId: 'lesson-a',
    changes: workspace.cards.changes(ctx, 'card:one'),
    proposals: [
      { sessionId: 'lesson-a', proposalId: 'p1', kind: 'card', title: '待确认的题', status: 'pending' },
      { sessionId: 'lesson-a', proposalId: 'p2', kind: 'memory', title: '状态未知的观察', status: 'unknown', target: 'memory:x' },
      // 别课的确认声明不是本课产出。
      { sessionId: 'lesson-b', proposalId: 'p3', kind: 'card', title: '别课待确认', status: 'pending' },
      // 已存卡的"拟修改"稿：原卡仍是一条 saved 入 deck，稿子按 proposalId 另起一行。
      { sessionId: 'lesson-a', proposalId: 'p4', kind: 'card', title: '拟修改这道题', status: 'pending', target: 'card:one' },
    ],
    read: recordReader(workspace, ctx),
  });
  expect(projection.entries.map(entry => [entry.kind, entry.status, entry.deck, entry.target, entry.proposalId])).toEqual([
    ['card', 'saved', true, 'card:one', null],
    ['card', 'pending', false, null, 'p1'],
    ['memory', 'unknown', false, 'memory:x', 'p2'],
    ['card', 'pending', false, 'card:one', 'p4'],
  ]);
  // 提案永不入题目 deck：原卡仍只有一条。
  expect(questionDeck(projection).map(entry => entry.target)).toEqual(['card:one']);
});

test('a pending draft without an object yet keeps the identity the UI navigates to', async () => {
  const workspace = await open();
  const ctx = lesson();
  await workspace.cards.create(write('create-one', 0), 'one', { title: '已存题', presentation: 'problem', front: 'x' });

  const projection = projectOutputs({
    sessionId: 'lesson-a',
    changes: workspace.cards.changes(ctx, 'card:one'),
    proposals: [{ sessionId: 'lesson-a', proposalId: 'draft-42', kind: 'card', title: '还没确认的题', status: 'pending' }],
    read: recordReader(workspace, ctx),
  });
  const draft = projection.entries.find(entry => entry.status === 'pending');
  // 对象还没创建：没有 target，但有可追溯的稿子身份，UI 才能打开待确认稿。
  expect(draft).toMatchObject({ target: null, proposalId: 'draft-42', kind: 'card', title: '还没确认的题', deck: false, revision: null, operationId: null });
  expect(projection.entries.find(entry => entry.status === 'saved')?.proposalId).toBeNull();
  expect(questionDeck(projection).map(entry => entry.proposalId)).toEqual([null]);
});

test('only this lesson own writes count, and one target is one output row', async () => {
  const workspace = await open();
  const ctx = lesson();
  // 本课：一次建卡 + 两次修改
  await workspace.cards.create(write('a-create', 0), 'shared', { title: '本课第一题', presentation: 'problem', front: 'v1' });
  await workspace.cards.update(write('a-edit-1', 1), 'card:shared', { front: 'v2' }, old => ({ ...old, front: 'v2' }));
  await workspace.cards.update(write('a-edit-2', 2), 'card:shared', { front: 'v3' }, old => ({ ...old, front: 'v3' }));
  // 别课的一张卡，以及一张完全不绑课的卡
  await workspace.cards.create(write('b-create', 0, 'lesson-b'), 'elsewhere', { title: '别课卡', presentation: 'problem', front: 'b' });
  await workspace.cards.create(outOfClass('free-create', 0), 'free', { title: '课外卡', presentation: 'problem', front: 'f' });

  const everything = ['card:shared', 'card:elsewhere', 'card:free'].flatMap(ref => workspace.cards.changes(ctx, ref));
  expect(everything.filter(change => change.sessionId === 'lesson-a')).toHaveLength(3);

  const inner = recordReader(workspace, ctx);
  const reads: string[] = [];
  const forLessonA = projectOutputs({
    sessionId: 'lesson-a', changes: everything,
    read: target => { reads.push(target); return inner(target); },
  });
  expect(forLessonA.entries.map(entry => entry.target)).toEqual(['card:shared']);
  // 三笔本课变更 → 只读一次当前对象，不会出现两次读得到不同状态。
  expect(reads).toEqual(['card:shared']);
  expect(forLessonA.entries[0]).toMatchObject({
    kind: 'card', status: 'saved', deck: true, revision: 3, title: '本课第一题',
    operationId: 'a-edit-2',
  });
  expect(questionDeck(forLessonA).map(entry => entry.target)).toEqual(['card:shared']);

  const forLessonB = projectOutputs({ sessionId: 'lesson-b', changes: everything, read: recordReader(workspace, ctx) });
  expect(forLessonB.entries.map(entry => entry.target)).toEqual(['card:elsewhere']);
  expect(questionDeck(forLessonB).map(entry => entry.title)).toEqual(['别课卡']);
});
