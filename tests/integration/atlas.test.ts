/**
 * 工作区知识地图（atlas）：不依赖任何一本书的跨书层次归属。
 *
 * 被固定的性质：卡的 `topic` 声明缺失层级时，写卡的同一个原子单元顺带铸出
 * outline 节点——与 chapter 不同，topic 是工作区作用域，没有来源书歧义，所以
 * 单源卡、多书卡、无来源卡都能声明都能铸；已有层不动；非法路径与未接派生器
 * 仍拒绝；repath 级联卡 topic、removePaths+detach 清空回无归属；同批多张卡的
 * 层级合并成一次 atlas 写；同一操作重放幂等；list_cards 按 topic 前缀过滤。
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ATLAS_REF, ATLAS_SCOPE, AtlasRecordSchema } from '../../packages/contracts/src/atlas.ts';
import { CardRecordSchema } from '../../packages/contracts/src/cards.ts';
import type { HostContext, MutationContext } from '../../packages/contracts/src/execution.ts';
import { MaterialRecordSchema } from '../../packages/contracts/src/material-records.ts';
import type { SourceAnchor } from '../../packages/contracts/src/materials.ts';
import { PlanContentSchema } from '../../packages/contracts/src/plans.ts';
import { SkeletonRecordSchema } from '../../packages/contracts/src/skeleton.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { CardService, listCardSummaries, selectCardRows } from '../../packages/domain/src/cards/card-service.ts';
import { ChapterDeriver } from '../../packages/domain/src/organization/chapter-deriver.ts';
import { AtlasAuthoring, AtlasDeriver, AtlasService } from '../../packages/domain/src/organization/atlas.ts';
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
  const dir = await mkdtemp(join(tmpdir(), 'sf-atlas-'));
  roots.push(dir);
  const ctx = new Context();
  await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student-a', clock);
  const materials = new MaterialService(await owner.collection('material', MaterialRecordSchema), dir, clock);
  const skeletonStore = await owner.collection(SKELETON_KIND, SkeletonRecordSchema);
  const cardStore = await owner.collection('card', CardRecordSchema);
  await owner.collection('plan', PlanContentSchema);
  const atlasStore = await owner.collection('atlas', AtlasRecordSchema);
  const skeletons = new SkeletonService(skeletonStore, materials);
  const atlas = new AtlasService(atlasStore, materials);
  const cards = new CardService(cardStore, materials, skeletons, undefined,
    new ChapterDeriver(skeletonStore, skeletons, owner),
    withDeriver ? new AtlasDeriver(atlasStore, atlas, owner) : undefined);
  const authoring = new AtlasAuthoring(atlasStore, cardStore, atlas, owner);
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  const importBook = async (operationId: string, text: string, fileName = '课本.md'): Promise<Book> => {
    const view = await materials.import(create(operationId), { title: fileName, fileName, mediaType: 'text/markdown', bytes: encoded(text) });
    return { materialId: view.materialId, versionId: view.currentVersion.versionId };
  };
  return { materials, atlas, atlasStore, cardStore, cards, authoring, owner, importBook };
}

test('单源卡声明的 topic 铸出 outline 层，卡的真实来源成为层出处', async () => {
  const { cards, atlas, importBook } = await open();
  const book = await importBook('import-1', BOOK);
  const view = await cards.create(student('card-1'), {
    title: '分数加法例题', front: '1/2+1/3=?', sources: [lineAnchor(book, 4)], topic: '数学/分数',
  });
  expect(view.content.topic).toBe('数学/分数');
  const map = await atlas.read(HOST);
  expect(map.nodes).toHaveLength(1);
  expect(map.nodes[0]).toMatchObject({ path: '数学/分数', detail: 'outline' });
  expect(map.nodes[0]!.sources).toEqual([lineAnchor(book, 4)]);
});

test('多书卡同样能声明 topic 并铸层，来源跨书保留', async () => {
  const { cards, atlas, importBook } = await open();
  const a = await importBook('import-1', BOOK, '课本甲.md');
  const b = await importBook('import-2', BOOK, '课本乙.md');
  await cards.create(student('card-1'), {
    title: '跨书对比', sources: [lineAnchor(a, 4), lineAnchor(b, 4)], topic: '数学/分数',
  });
  const map = await atlas.read(HOST);
  expect(map.nodes).toHaveLength(1);
  expect(map.nodes[0]!.sources).toEqual([lineAnchor(a, 4), lineAnchor(b, 4)]);
});

test('无来源卡也能归图：铸出的层没有出处但仍是合法节点', async () => {
  const { cards, atlas } = await open();
  await cards.create(student('card-1'), { title: '心得卡', topic: '方法/费曼' });
  const map = await atlas.read(HOST);
  expect(map.nodes).toHaveLength(1);
  expect(map.nodes[0]).toMatchObject({ path: '方法/费曼', detail: 'outline' });
  expect(map.nodes[0]!.sources).toBeUndefined();
});

test('层级已存在时 atlas 不动、不重复铸节点', async () => {
  const { cards, atlas, importBook } = await open();
  const book = await importBook('import-1', BOOK);
  await cards.create(student('card-1'), { title: '甲', sources: [lineAnchor(book, 4)], topic: '数学/分数' });
  const before = await atlas.read(HOST);
  await cards.create(student('card-2'), { title: '乙', sources: [lineAnchor(book, 4)], topic: '数学/分数' });
  const after = await atlas.read(HOST);
  expect(after.revision).toBe(before.revision);
  expect(after.nodes).toHaveLength(1);
});

test('非法 topic 路径被拒，不铸节点', async () => {
  const { cards, atlas, importBook } = await open();
  const book = await importBook('import-1', BOOK);
  await expect(cards.create(student('card-1'), {
    title: '例题', sources: [lineAnchor(book, 4)], topic: '数学//分数',
  })).rejects.toMatchObject({ code: 'card_topic_invalid' });
  expect((await atlas.read(HOST)).nodes).toHaveLength(0);
});

test('未接地图派生器时任何 topic 都被拒', async () => {
  const { cards } = await open(false);
  await expect(cards.create(student('card-1'), { title: '心得卡', topic: '方法/费曼' }))
    .rejects.toMatchObject({ code: 'card_topic_missing' });
});

test('repath 整层移位时挂靠卡的 topic 原子跟走', async () => {
  const { cards, atlas, authoring, importBook } = await open();
  const book = await importBook('import-1', BOOK);
  const card = await cards.create(student('card-1'), {
    title: '例题', sources: [lineAnchor(book, 4)], topic: '数学/分数',
  });
  const map = await atlas.read(HOST);
  await authoring.save(student('repath-1', map.revision!), { repath: [{ from: '数学', to: '理科' }] });
  expect(cards.read(HOST, card.ref).content.topic).toBe('理科/分数');
  expect((await atlas.read(HOST)).nodes.map(node => node.path)).toEqual(['理科/分数']);
});

test('删层带挂靠卡时不显式解除绑定就拒绝', async () => {
  const { cards, atlas, authoring, importBook } = await open();
  const book = await importBook('import-1', BOOK);
  await cards.create(student('card-1'), { title: '例题', sources: [lineAnchor(book, 4)], topic: '数学/分数' });
  const map = await atlas.read(HOST);
  await expect(authoring.save(student('remove-1', map.revision!), { removePaths: ['数学'] }))
    .rejects.toMatchObject({ code: 'atlas_removal_has_dependents' });
  expect((await atlas.read(HOST)).nodes).toHaveLength(1);
});

test('显式解除绑定后删层，卡的 topic 清空回无归属', async () => {
  const { cards, atlas, authoring, importBook } = await open();
  const book = await importBook('import-1', BOOK);
  const card = await cards.create(student('card-1'), {
    title: '例题', sources: [lineAnchor(book, 4)], topic: '数学/分数',
  });
  const map = await atlas.read(HOST);
  await authoring.save(student('remove-1', map.revision!), { removePaths: ['数学'], detachDependents: true });
  expect(cards.read(HOST, card.ref).content.topic).toBeUndefined();
  expect((await atlas.read(HOST)).nodes).toHaveLength(0);
});

test('同批多卡不同 topic 合并成一次 atlas 写入', async () => {
  const { cards, atlas, atlasStore, cardStore, importBook, owner } = await open();
  const book = await importBook('import-1', BOOK);
  const ctx = student('batch-1');
  const contents = await Promise.all([
    cards.check(ctx, { title: '甲', topic: '数学/分数' }),
    cards.check(ctx, { title: '乙', topic: '方法/费曼' }),
  ]);
  const derived = await cards.placementPlans(ctx, contents);
  // chapter 端口接着但两张卡都没填 chapter；topic 合并成一条 atlas 变更。
  expect(derived).toHaveLength(1);
  const cardPlans = contents.map((content, index) => {
    const operationId = `${ctx.operationId}:${index}`;
    const id = 'card_' + createHash('sha256').update(`${ctx.workspaceId}:${operationId}`).digest('hex').slice(0, 24);
    return cardStore.prepareCreate({ ...ctx, operationId }, id, { content, history: [] });
  });
  await owner.atomic([...derived, ...cardPlans]);
  const map = await atlas.read(HOST);
  expect(map.nodes.map(node => node.path).sort()).toEqual(['数学/分数', '方法/费曼']);
  expect(cardStore.list(HOST)).toHaveLength(2);
});

test('同一操作重放只认一次效果，atlas 不长第二个版本', async () => {
  const { cards, atlas, atlasStore, importBook } = await open();
  const book = await importBook('import-1', BOOK);
  const input = { title: '例题', sources: [lineAnchor(book, 4)], topic: '数学/分数' };
  const first = await cards.create(student('card-1'), input);
  const second = await cards.create(student('card-1'), input);
  expect(second.ref).toBe(first.ref);
  const map = await atlas.read(HOST);
  expect(map.nodes).toHaveLength(1);
  expect(map.revision).toBe(1);
});

test('list_cards 按 topic 前缀过滤，跨书聚合', async () => {
  const { cards, cardStore, importBook } = await open();
  const a = await importBook('import-1', BOOK, '课本甲.md');
  const b = await importBook('import-2', BOOK, '课本乙.md');
  await cards.create(student('card-1'), { title: '甲书分数卡', sources: [lineAnchor(a, 4)], topic: '数学/分数' });
  await cards.create(student('card-2'), { title: '乙书分数卡', sources: [lineAnchor(b, 4)], topic: '数学/分数/加法' });
  await cards.create(student('card-3'), { title: '几何卡', sources: [lineAnchor(a, 3)], topic: '数学/几何' });
  await cards.create(student('card-4'), { title: '游离卡', sources: [lineAnchor(a, 3)] });
  const all = cardStore.list(HOST);
  const under = listCardSummaries(all, { topic: '数学/分数' }, '2026-09-12');
  expect(under.cards.map(card => card.title).sort()).toEqual(['乙书分数卡', '甲书分数卡']);
  expect(selectCardRows(all, { topic: '数学' }, '2026-09-12')).toHaveLength(3);
  expect(selectCardRows(all, { topic: '方法' }, '2026-09-12')).toHaveLength(0);
});

test('铸出的层是普通节点：removePaths 与 repath 语义与手写一致', async () => {
  const { cards, atlas, authoring, importBook } = await open();
  const book = await importBook('import-1', BOOK);
  await cards.create(student('card-1'), { title: '甲', sources: [lineAnchor(book, 4)], topic: '数学/分数' });
  await cards.create(student('card-2'), { title: '乙', sources: [lineAnchor(book, 4)], topic: '数学/几何' });
  const map = await atlas.read(HOST);
  const preview = await authoring.preview(HOST, map.revision!, { repath: [{ from: '数学/几何', to: '数学/平面几何' }] });
  expect(preview.impact.cards).toHaveLength(1);
  await authoring.save(student('repath-1', map.revision!), { repath: [{ from: '数学/几何', to: '数学/平面几何' }] });
  expect((await atlas.read(HOST)).nodes.map(node => node.path).sort()).toEqual(['数学/分数', '数学/平面几何']);
});
