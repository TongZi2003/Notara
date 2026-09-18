/**
 * 卡声明层级顺带铸结构（anchored content mints structure）。
 *
 * 被固定的性质：单源卡声明的 chapter 不在骨架时，写卡的同一个原子单元顺带铸出
 * 该层的 outline 节点——锚点就是这张卡自己校验过的来源；层级已存在则骨架不动；
 * 无来源、跨多本书或非法路径仍按旧规则拒绝；铸出的节点是普通节点，repath 级联、
 * 学生编辑与重放语义与手写节点一致。
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CardRecordSchema } from '../../packages/contracts/src/cards.ts';
import type { HostContext, MutationContext } from '../../packages/contracts/src/execution.ts';
import { MaterialRecordSchema } from '../../packages/contracts/src/material-records.ts';
import type { SourceAnchor } from '../../packages/contracts/src/materials.ts';
import { PlanContentSchema } from '../../packages/contracts/src/plans.ts';
import { SkeletonRecordSchema, type SkeletonNode } from '../../packages/contracts/src/skeleton.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { CardService } from '../../packages/domain/src/cards/card-service.ts';
import { ChapterDeriver } from '../../packages/domain/src/organization/chapter-deriver.ts';
import { SkeletonAuthoring } from '../../packages/domain/src/organization/skeleton-authoring.ts';
import { MaterialService } from '../../packages/domain/src/materials/material-service.ts';
import { SKELETON_KIND, SkeletonService } from '../../packages/domain/src/materials/skeleton-service.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';

const clock = createTestClock('2026-09-12T00:00:00Z', 'Asia/Shanghai');
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
const HOST: HostContext = { workspaceId: 'student-a', sessionId: 'lesson-a', actor: 'student', purpose: 'learning' };
const CREATE = { workspaceId: 'student-a', actor: 'student' as const, purpose: 'creation' as const };
const student = (operationId: string, expectedVersion?: number): MutationContext =>
  ({ ...HOST, operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
const create = (operationId: string): MutationContext => ({ ...CREATE, operationId });

const BOOK = '# 课本\n\n第一章 引子\n第二章 分数加法\n第三章 习题\n';
const encoded = (text: string) => new TextEncoder().encode(text);

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

interface Book { readonly materialId: string; readonly versionId: string; }
const lineAnchor = (book: Book, line: number, endLine = line): SourceAnchor =>
  ({ materialId: book.materialId, versionId: book.versionId, locator: { kind: 'text', start: { line, column: 0 }, end: { line: endLine, column: 3 } } });

async function open(withDeriver = true) {
  const dir = await mkdtemp(join(tmpdir(), 'sf-chapter-'));
  roots.push(dir);
  const ctx = new Context();
  await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student-a', clock);
  const materials = new MaterialService(await owner.collection('material', MaterialRecordSchema), dir, clock);
  const skeletonStore = await owner.collection(SKELETON_KIND, SkeletonRecordSchema);
  const cardStore = await owner.collection('card', CardRecordSchema);
  const planStore = await owner.collection('plan', PlanContentSchema);
  const skeletons = new SkeletonService(skeletonStore, materials);
  const cards = new CardService(cardStore, materials, skeletons, undefined,
    withDeriver ? new ChapterDeriver(skeletonStore, skeletons, owner) : undefined);
  const authoring = new SkeletonAuthoring(skeletonStore, cardStore, planStore, skeletons, owner);
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  const importBook = async (operationId: string, text: string, fileName = '课本.md'): Promise<Book> => {
    const view = await materials.import(create(operationId), { title: fileName, fileName, mediaType: 'text/markdown', bytes: encoded(text) });
    return { materialId: view.materialId, versionId: view.currentVersion.versionId };
  };
  const seedSkeleton = async (operationId: string, book: Book, nodes: SkeletonNode[]) =>
    skeletonStore.create(create(operationId), book.materialId, { materialId: book.materialId, nodes });
  return { materials, skeletons, skeletonStore, cardStore, cards, authoring, owner, importBook, seedSkeleton };
}

test('单源卡的缺失层级在写卡的同一原子单元里铸成 outline 节点', async () => {
  const { cards, skeletons, importBook } = await open();
  const book = await importBook('import-1', BOOK);
  const view = await cards.create(student('card-1'), {
    title: '分数加法例题', front: '1/2+1/3=?', sources: [lineAnchor(book, 4)], chapter: '第二章/分数加法',
  });
  expect(view.content.chapter).toBe('第二章/分数加法');
  const skeleton = await skeletons.read(HOST, book.materialId);
  expect(skeleton.nodes).toHaveLength(1);
  expect(skeleton.nodes[0]).toMatchObject({ path: '第二章/分数加法', detail: 'outline' });
  expect(skeleton.nodes[0]!.sources).toEqual([lineAnchor(book, 4)]);
});

test('既有骨架上追加缺失层级，原有节点原样保留', async () => {
  const { cards, skeletons, importBook, seedSkeleton } = await open();
  const book = await importBook('import-1', BOOK);
  await seedSkeleton('skel-1', book, [{ path: '第一章', sources: [lineAnchor(book, 3)], detail: 'refined' }]);
  await cards.create(student('card-1'), {
    title: '例题', sources: [lineAnchor(book, 4)], chapter: '第二章/分数加法',
  });
  const skeleton = await skeletons.read(HOST, book.materialId);
  expect(skeleton.nodes.map(node => node.path)).toEqual(['第一章', '第二章/分数加法']);
  expect(skeleton.nodes[0]!.detail).toBe('refined');
});

test('层级已存在时骨架不动、不重复铸节点', async () => {
  const { cards, skeletons, skeletonStore, importBook, seedSkeleton } = await open();
  const book = await importBook('import-1', BOOK);
  const seeded = await seedSkeleton('skel-1', book, [{ path: '第二章/分数加法', sources: [lineAnchor(book, 4)], detail: 'refined' }]);
  await cards.create(student('card-1'), {
    title: '例题', sources: [lineAnchor(book, 4)], chapter: '第二章/分数加法',
  });
  const skeleton = await skeletons.read(HOST, book.materialId);
  expect(skeleton.revision).toBe(seeded.version);
  expect(skeleton.nodes).toHaveLength(1);
  expect(skeleton.nodes[0]!.detail).toBe('refined');
  expect(skeletonStore.read(HOST, `skeleton:${book.materialId}`).data.nodes).toHaveLength(1);
});

test('无来源卡不能说明层级属于哪本书，仍被拒绝', async () => {
  const { cards } = await open();
  await expect(cards.create(student('card-1'), { title: '游离卡', chapter: '第二章' }))
    .rejects.toMatchObject({ code: 'card_chapter_missing' });
});

test('跨多本书的来源卡不能判定层级归属，仍被拒绝', async () => {
  const { cards, importBook } = await open();
  const a = await importBook('import-1', BOOK, '课本甲.md');
  const b = await importBook('import-2', BOOK, '课本乙.md');
  await expect(cards.create(student('card-1'), {
    title: '跨书卡', sources: [lineAnchor(a, 4), lineAnchor(b, 4)], chapter: '第二章',
  })).rejects.toMatchObject({ code: 'card_chapter_missing' });
});

test('非法路径仍是坏 chapter，不铸节点', async () => {
  const { cards, skeletons, importBook } = await open();
  const book = await importBook('import-1', BOOK);
  await expect(cards.create(student('card-1'), {
    title: '例题', sources: [lineAnchor(book, 4)], chapter: '第二章//分数加法',
  })).rejects.toMatchObject({ code: 'card_chapter_missing' });
  expect((await skeletons.read(HOST, book.materialId)).nodes).toHaveLength(0);
});

test('未接派生器的服务保持旧的严格规则', async () => {
  const { cards, importBook } = await open(false);
  const book = await importBook('import-1', BOOK);
  await expect(cards.create(student('card-1'), {
    title: '例题', sources: [lineAnchor(book, 4)], chapter: '第二章/分数加法',
  })).rejects.toMatchObject({ code: 'card_chapter_missing' });
});

test('update_card 换到缺失层级同样顺带铸节点', async () => {
  const { cards, skeletons, importBook } = await open();
  const book = await importBook('import-1', BOOK);
  const card = await cards.create(student('card-1'), {
    title: '例题', sources: [lineAnchor(book, 4)], chapter: '第二章/分数加法',
  });
  const moved = await cards.edit(student('edit-1', card.version), card.ref, { chapter: '第二章/约分' });
  expect(moved.content.chapter).toBe('第二章/约分');
  const skeleton = await skeletons.read(HOST, book.materialId);
  expect(skeleton.nodes.map(node => node.path)).toEqual(['第二章/分数加法', '第二章/约分']);
});

test('同批多卡同书不同层级合并成一次骨架写入', async () => {
  const { cards, skeletons, cardStore, importBook, owner } = await open();
  const book = await importBook('import-1', BOOK);
  const ctx = student('batch-1');
  const contents = await Promise.all([
    cards.check(ctx, { title: '甲', sources: [lineAnchor(book, 4)], chapter: '第二章/分数加法' }),
    cards.check(ctx, { title: '乙', sources: [lineAnchor(book, 4)], chapter: '第二章/约分' }),
  ]);
  const derived = await cards.placementPlans(ctx, contents);
  expect(derived).toHaveLength(1);
  const cardPlans = contents.map((content, index) => {
    const operationId = `${ctx.operationId}:${index}`;
    const id = 'card_' + createHash('sha256').update(`${ctx.workspaceId}:${operationId}`).digest('hex').slice(0, 24);
    return cardStore.prepareCreate({ ...ctx, operationId }, id, { content, history: [] });
  });
  await owner.atomic([...derived, ...cardPlans]);
  const skeleton = await skeletons.read(HOST, book.materialId);
  expect(skeleton.nodes.map(node => node.path)).toEqual(['第二章/分数加法', '第二章/约分']);
  expect(cardStore.list(HOST)).toHaveLength(2);
});

test('同一操作重放只认一次效果，骨架不长第二个版本', async () => {
  const { cards, skeletons, cardStore, importBook } = await open();
  const book = await importBook('import-1', BOOK);
  const input = { title: '例题', sources: [lineAnchor(book, 4)], chapter: '第二章/分数加法' };
  const first = await cards.create(student('card-1'), input);
  const second = await cards.create(student('card-1'), input);
  expect(second.ref).toBe(first.ref);
  expect(second.version).toBe(first.version);
  const skeleton = await skeletons.read(HOST, book.materialId);
  expect(skeleton.nodes).toHaveLength(1);
  expect(skeleton.revision).toBe(1);
  expect(cardStore.list(HOST)).toHaveLength(1);
});

test('铸出的节点是普通节点：repath 时挂靠卡的 chapter 原子跟走', async () => {
  const { cards, skeletons, authoring, importBook } = await open();
  const book = await importBook('import-1', BOOK);
  const card = await cards.create(student('card-1'), {
    title: '例题', sources: [lineAnchor(book, 4)], chapter: '第二章/分数加法',
  });
  const skeleton = await skeletons.read(HOST, book.materialId);
  await authoring.save(student('repath-1', skeleton.revision), book.materialId, { repath: [{ from: '第二章', to: '第二篇' }] });
  const moved = cards.read(HOST, card.ref);
  expect(moved.content.chapter).toBe('第二篇/分数加法');
  const after = await skeletons.read(HOST, book.materialId);
  expect(after.nodes.map(node => node.path)).toEqual(['第二篇/分数加法']);
});
