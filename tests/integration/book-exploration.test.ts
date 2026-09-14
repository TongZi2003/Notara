/**
 * P6.6 书籍原文、逐层脑图与列表（plan §P6.6，CONTRACTS.md §10）。
 *
 * 这里的每一本书都是真的导入进来的原件（真实 Markdown 字节，由生产版 MaterialService
 * 从自己的不可变版本目录读回），骨架行、普通卡与知识都在真实的记录里。被固定的性质：
 * 层级是读侧投影——书根、任意级骨架、卡/知识叶节点都从既有记录现读，叶节点用对象自己的
 * ref；只有真实关系才入图（无来源卡不进任何书、`publicSources` 不是书锚、知识只能通过
 * 一张真的在书的卡进来）；展开只是界面状态，读取与展开不写任何事实、不造课。
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CardContentSchema, CardRecordSchema } from '../../packages/contracts/src/cards.ts';
import { bindTaskCard } from '../../packages/host/src/teaching/book-task.ts';
import { encodeSourceFragment } from '../../packages/contracts/src/source-context.ts';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { BookStructure } from '../../packages/contracts/src/book-exploration.ts';
import { visibleNodes } from '../../packages/contracts/src/book-exploration.ts';
import type { HostContext, MutationContext } from '../../packages/contracts/src/execution.ts';
import { KnowledgeRecordSchema } from '../../packages/contracts/src/knowledge.ts';
import { MaterialRecordSchema } from '../../packages/contracts/src/material-records.ts';
import type { SourceAnchor, SourceLocator } from '../../packages/contracts/src/materials.ts';
import { SkeletonRecordSchema, type SkeletonNode } from '../../packages/contracts/src/skeleton.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { CardService, type LinkTargets } from '../../packages/domain/src/cards/card-service.ts';
import { objectRef } from '../../packages/domain/src/ids.ts';
import { KnowledgeService, type PublicSourceResolver } from '../../packages/domain/src/knowledge/knowledge-service.ts';
import { BookExploration, validateBookBreakdown } from '../../packages/domain/src/materials/book-exploration.ts';
import { MaterialService } from '../../packages/domain/src/materials/material-service.ts';
import { SKELETON_KIND, SkeletonService } from '../../packages/domain/src/materials/skeleton-service.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';

const clock = createTestClock('2026-09-12T00:00:00Z', 'Asia/Shanghai');
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
const HOST: HostContext = { workspaceId: 'student-a', sessionId: 'lesson-a', actor: 'student', purpose: 'learning' };
const READ: HostContext = { workspaceId: 'student-a', actor: 'student', purpose: 'learning' };
const CREATE = { workspaceId: 'student-a', actor: 'student' as const, purpose: 'creation' as const };
const student = (operationId: string, expectedVersion?: number): MutationContext =>
  ({ ...HOST, operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
const system = (operationId: string, expectedVersion?: number): MutationContext =>
  ({ ...HOST, actor: 'system', operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
const create = (operationId: string, expectedVersion?: number) =>
  ({ ...CREATE, operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });

const TRIG = '# 三角函数\n\n第一段一\n第二段二\n第三段三\n';
const SERIES = '# 数列\n\n通项一\n通项二\n通项三\n';
const INSTALLED = { packageId: 'pack-diagnose', entryId: 'method/scope', version: '3.1.0' } as const;
const RECEIPT = { confirmationId: 'collect-1', collectedAt: '2026-09-12T08:00:00+08:00' };
const encoded = (text: string) => new TextEncoder().encode(text);

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

interface Book { readonly materialId: string; readonly versionId: string; }
const anchor = (book: Book, locator: SourceLocator): SourceAnchor => ({ materialId: book.materialId, versionId: book.versionId, locator });
const lineAnchor = (book: Book, line: number, endLine = line): SourceAnchor =>
  anchor(book, { kind: 'text', start: { line, column: 0 }, end: { line: endLine, column: 3 } });
const node = (path: string, ...sources: SourceAnchor[]): SkeletonNode => ({ path, sources });

async function open() {
  const dir = await mkdtemp(join(tmpdir(), 'sf-book-'));
  roots.push(dir);
  const ctx = new Context();
  await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student-a', clock);
  const materials = new MaterialService(await owner.collection('material', MaterialRecordSchema), dir, clock);
  const skeletonStore = await owner.collection(SKELETON_KIND, SkeletonRecordSchema);
  const cardStore = await owner.collection('card', CardRecordSchema);
  const knowledgeStore = await owner.collection('knowledge', KnowledgeRecordSchema);
  const skeletons = new SkeletonService(skeletonStore, materials);
  const exists = (ref: string): boolean => {
    try {
      if (ref.startsWith('card:')) cardStore.read(READ, ref);
      else if (ref.startsWith('knowledge:')) knowledgeStore.read(READ, ref);
      else return false;
      return true;
    } catch { return false; }
  };
  const targets: LinkTargets = { has: (_ctx, ref) => Promise.resolve(exists(ref)) };
  const catalog: PublicSourceResolver = {
    resolve: (_ctx, ref) => Promise.resolve(
      ref.packageId === INSTALLED.packageId && ref.entryId === INSTALLED.entryId && ref.version === INSTALLED.version ? { ...ref } : null),
  };
  const cards = new CardService(cardStore, materials, skeletons, targets);
  const knowledge = new KnowledgeService(knowledgeStore, catalog, targets);
  const exploration = new BookExploration(materials, skeletons, cardStore, knowledgeStore);
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  const importBook = async (operationId: string, fileName: string, text: string): Promise<Book> => {
    const view = await materials.import(create(operationId), { title: fileName, fileName, mediaType: 'text/markdown', bytes: encoded(text) });
    return { materialId: view.materialId, versionId: view.currentVersion.versionId };
  };
  return { dir, materials, skeletons, skeletonStore, cardStore, knowledgeStore, cards, knowledge, exploration, importBook };
}

const refOf = (book: Book) => ({ materialId: book.materialId, versionId: book.versionId });
const cardTargets = (structure: BookStructure) =>
  structure.nodes.flatMap(entry => entry.kind === 'card' ? [entry.target] : []).sort();
const knowledgeTargets = (structure: BookStructure) =>
  structure.nodes.flatMap(entry => entry.kind === 'knowledge' ? [entry.target] : []).sort();
const targets = (structure: BookStructure) =>
  structure.nodes.flatMap(entry => entry.kind === 'card' || entry.kind === 'knowledge' ? [entry.target] : []);
/** 校验是纯同步函数：它拒绝时给的是哪个码。 */
function refusalCode(run: () => unknown): string {
  try { run(); } catch (error) {
    return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
  }
  return 'accepted';
}
const find = (structure: BookStructure, key: string) => {
  const node = structure.nodes.find(entry => entry.key === key);
  expect(node).toBeDefined();
  return node!;
};

test('书根 → 任意级骨架 → 普通卡叶：初始只书根，逐层展开，卡用原 ref', async () => {
  const fixture = await open();
  const book = await fixture.importBook('book-1', '三角函数.md', TRIG);
  // 骨架先有，卡才能真的挂在这一节上（chapter 必须是这本书骨架里真实存在的节点）。
  await fixture.skeletonStore.create(create('skeleton-1'), book.materialId, {
    materialId: book.materialId,
    nodes: [node('第一章', lineAnchor(book, 1)), node('第一章/第一节', lineAnchor(book, 3)), node('第一章/第二节', lineAnchor(book, 4))],
  });
  const card = await fixture.cards.create(student('card-k'), {
    title: '单调性', presentation: 'note', front: '一段话', sources: [lineAnchor(book, 3)], chapter: '第一章/第一节',
  });

  const structure = await fixture.exploration.read(READ, refOf(book));
  expect(structure).toMatchObject({ title: '三角函数.md', material: refOf(book), skeletonRevision: 1 });
  // 初次进入只有书根；展开是调用方的状态。
  expect(visibleNodes(structure, []).map(entry => entry.kind)).toEqual(['book']);
  expect(visibleNodes(structure, ['book']).map(entry => entry.key)).toEqual(['book', 'section:第一章']);
  expect(visibleNodes(structure, ['book', 'section:第一章']).map(entry => entry.key))
    .toEqual(['book', 'section:第一章', 'section:第一章/第一节', 'section:第一章/第二节']);
  const expanded = visibleNodes(structure, ['book', 'section:第一章', 'section:第一章/第一节']);
  expect(expanded.map(entry => entry.key))
    .toEqual(['book', 'section:第一章', 'section:第一章/第一节', card.ref, 'section:第一章/第二节']);

  const first = find(structure, 'section:第一章');
  expect(first).toMatchObject({ kind: 'section', path: '第一章', title: '第一章', key: 'section:第一章' });
  expect(first.parentKey).toBe('book');
  expect(first.sources).toEqual([lineAnchor(book, 1)]);
  expect(find(structure, 'section:第一章/第一节')).toMatchObject({ title: '第一节', parentKey: 'section:第一章' });
  const leaf = find(structure, card.ref);
  expect(leaf).toMatchObject({ kind: 'card', title: '单调性', target: card.ref, parentKey: 'section:第一章/第一节' });
  expect(leaf.sources).toEqual([lineAnchor(book, 3)]);
  expect(find(structure, 'book').children).toEqual(['section:第一章']);

  // 阅读、展开与再读都不写事实：卡没有 review，骨架与卡库都原样。
  const beforeCard = fixture.cardStore.read(READ, card.ref);
  const beforeSkeleton = await fixture.skeletons.read(READ, book.materialId);
  const again = await fixture.exploration.read(READ, refOf(book));
  visibleNodes(again, ['book', 'section:第一章']);
  expect(fixture.cardStore.read(READ, card.ref)).toEqual(beforeCard);
  expect(fixture.cardStore.read(READ, card.ref).data).not.toHaveProperty('review');
  expect(await fixture.skeletons.read(READ, book.materialId)).toEqual(beforeSkeleton);
  expect(fixture.cardStore.list(READ)).toHaveLength(1);
});

test('知识只在真的关联了一张在书卡时入图，公共教法来源不是书锚', async () => {
  const fixture = await open();
  const book = await fixture.importBook('book-2', '三角函数.md', TRIG);
  await fixture.skeletonStore.create(create('skeleton-2'), book.materialId, {
    materialId: book.materialId, nodes: [node('第一章', lineAnchor(book, 1)), node('第一章/第一节', lineAnchor(book, 3))],
  });
  const inBook = await fixture.cards.create(student('card-in-book'), {
    title: '单调性', front: 'x', sources: [lineAnchor(book, 3)], chapter: '第一章/第一节',
  });
  const outside = await fixture.cards.create(student('card-outside'), { title: '没入书的卡', front: 'x' });

  const related = await fixture.knowledge.note(student('kn-related'), { title: '判断的依据', body: '先看定义域。', links: [inBook.ref] });
  await fixture.knowledge.collect(system('kn-related-collect', 1), related.ref, RECEIPT);
  await fixture.knowledge.note(student('kn-outside'), { title: '别人的知识', body: 'x', links: [outside.ref] });
  await fixture.knowledge.note(student('kn-public'), { title: '公共教法', body: 'x', publicSources: [INSTALLED] });
  const viaKnowledge = await fixture.knowledge.note(student('kn-via-knowledge'), { title: '指向知识', body: 'x', links: [related.ref] });

  const structure = await fixture.exploration.read(READ, refOf(book));
  expect(knowledgeTargets(structure)).toEqual([related.ref]);
  const leaf = find(structure, related.ref);
  expect(leaf).toMatchObject({ kind: 'knowledge', title: '判断的依据', target: related.ref, via: inBook.ref, parentKey: inBook.ref, sources: [] });
  expect(find(structure, inBook.ref).children).toEqual([related.ref]);
  expect(targets(structure)).not.toContain(viaKnowledge.ref);
  // 读侧一条知识都没收录、也没复制成第二张卡。
  expect(fixture.knowledgeStore.list(READ)).toHaveLength(4);
  expect(fixture.knowledge.read(READ, related.ref).collection).toEqual(RECEIPT);
  expect(fixture.knowledge.read(READ, viaKnowledge.ref).collection).toBeUndefined();
  expect(targets(structure).filter(target => target === related.ref)).toHaveLength(1);
});

test('跨书来源保留同一个 ref，无来源卡不入书，换原件版本不偷换锚', async () => {
  const fixture = await open();
  const trig = await fixture.importBook('book-3', '三角函数.md', TRIG);
  const series = await fixture.importBook('book-4', '数列.md', SERIES);
  const both = await fixture.cards.create(student('card-both'), {
    title: '两本书都用', front: 'x', sources: [lineAnchor(trig, 3), lineAnchor(series, 3)],
  });
  const onlyTrig = await fixture.cards.create(student('card-trig'), {
    title: '只有来源的卡', front: '', sources: [lineAnchor(trig, 4)],
  });
  await fixture.cards.create(student('card-none'), { title: '无来源卡', front: 'x' });

  const trigA = await fixture.exploration.read(READ, refOf(trig));
  const seriesA = await fixture.exploration.read(READ, refOf(series));
  expect(cardTargets(trigA)).toEqual([both.ref, onlyTrig.ref].sort());
  expect(cardTargets(seriesA)).toEqual([both.ref]);
  // 跨书来源原样保留，同一个 ref 出现在两本书里；换版本也不改动锚。
  expect(find(trigA, both.ref).sources).toEqual([lineAnchor(trig, 3), lineAnchor(series, 3)]);

  const next = await fixture.materials.createVersion(create('book-3-v2', 1), {
    materialId: trig.materialId, title: '三角函数.md', fileName: '三角函数.md', mediaType: 'text/markdown', bytes: encoded(TRIG + '第四段四\n'),
  });
  const trigB = await fixture.exploration.read(READ, { materialId: trig.materialId, versionId: next.currentVersion.versionId });
  expect(cardTargets(trigB)).toEqual([both.ref, onlyTrig.ref].sort());
  expect(find(trigB, both.ref).sources).toEqual([lineAnchor(trig, 3), lineAnchor(series, 3)]);
  expect(find(trigB, onlyTrig.ref).sources).toEqual([lineAnchor(trig, 4)]);
});

test('缺版本与不存在的节点被拒；拆解校验只读，不造课也不造事实', async () => {
  const fixture = await open();
  const trig = await fixture.importBook('book-5', '三角函数.md', TRIG);
  const series = await fixture.importBook('book-6', '数列.md', SERIES);
  await fixture.skeletonStore.create(create('skeleton-5'), trig.materialId, {
    materialId: trig.materialId, nodes: [node('第一章', lineAnchor(trig, 1)), node('第一章/第一节', lineAnchor(trig, 3))],
  });

  await expect(fixture.exploration.read(READ, { materialId: trig.materialId, versionId: `ver_${'0'.repeat(20)}` }))
    .rejects.toMatchObject({ code: 'book_version_missing' });

  const structure = await fixture.exploration.read(READ, refOf(trig));
  const before = {
    cards: fixture.cardStore.list(READ).length,
    knowledge: fixture.knowledgeStore.list(READ).length,
    skeleton: await fixture.skeletons.read(READ, trig.materialId),
  };
  // 书根拆解：只需要书与版本，没有节点、没有骨架版本。
  expect(validateBookBreakdown(structure, { material: refOf(trig), sources: [] }))
    .toEqual({ material: refOf(trig), sources: [] });
  // 真实节点可以拆解，已知范围随意图一起固定。
  expect(validateBookBreakdown(structure, {
    material: refOf(trig), nodePath: '第一章/第一节', skeletonRevision: 1, sources: [lineAnchor(trig, 3)],
  })).toMatchObject({ nodePath: '第一章/第一节', skeletonRevision: 1 });

  expect(refusalCode(() => validateBookBreakdown(structure, { material: refOf(trig), nodePath: '第一章/不存在', sources: [] })))
    .toBe('book_node_missing');
  expect(refusalCode(() => validateBookBreakdown(structure, { material: refOf(trig), skeletonRevision: 9, sources: [] })))
    .toBe('book_skeleton_revision_mismatch');
  expect(refusalCode(() => validateBookBreakdown(structure, { material: { materialId: trig.materialId, versionId: `ver_${'1'.repeat(20)}` }, sources: [] })))
    .toBe('book_version_mismatch');
  expect(refusalCode(() => validateBookBreakdown(structure, { material: refOf(series), sources: [] })))
    .toBe('book_material_mismatch');
  expect(refusalCode(() => validateBookBreakdown(structure, { material: refOf(trig), sources: [lineAnchor(series, 3)] })))
    .toBe('book_source_mismatch');

  // 还没骨架的书：只允许书根，声称有骨架版本就是冲突。
  const bare = await fixture.exploration.read(READ, refOf(series));
  expect(bare.skeletonRevision).toBeUndefined();
  expect(bare.nodes.map(entry => entry.kind)).toEqual(['book']);
  expect(validateBookBreakdown(bare, { material: refOf(series), sources: [] })).toEqual({ material: refOf(series), sources: [] });
  expect(refusalCode(() => validateBookBreakdown(bare, { material: refOf(series), skeletonRevision: 1, sources: [] })))
    .toBe('book_skeleton_revision_mismatch');

  expect(fixture.cardStore.list(READ)).toHaveLength(before.cards);
  expect(fixture.knowledgeStore.list(READ)).toHaveLength(before.knowledge);
  expect(await fixture.skeletons.read(READ, trig.materialId)).toEqual(before.skeleton);
});

test('新增支路只添它自己：兄弟章的来源与卡都保全', async () => {
  const fixture = await open();
  const book = await fixture.importBook('book-7', '三角函数.md', TRIG);
  await fixture.skeletonStore.create(create('skeleton-7'), book.materialId, {
    materialId: book.materialId,
    nodes: [node('第一章', lineAnchor(book, 1)), node('第一章/第一节', lineAnchor(book, 3)), node('第一章/第二节', lineAnchor(book, 4))],
  });
  const card = await fixture.cards.create(student('card-sibling'), {
    title: '第一节的卡', front: 'x', sources: [lineAnchor(book, 3)], chapter: '第一章/第一节',
  });
  const before = await fixture.exploration.read(READ, refOf(book));
  const siblingBefore = find(before, 'section:第一章/第二节');

  // 确认保存之后的状态：骨架多了一条支路（P6.3 的写者落盘后读侧看到的就是这个）。
  const current = await fixture.skeletons.read(READ, book.materialId);
  await fixture.skeletonStore.update(create('skeleton-add', current.revision), objectRef(SKELETON_KIND, book.materialId), { path: '第一章/第三节' },
    row => ({ ...row, nodes: [...row.nodes, node('第一章/第三节', lineAnchor(book, 5))] }));

  const after = await fixture.exploration.read(READ, refOf(book));
  const siblingAfter = find(after, 'section:第一章/第二节');
  expect(siblingAfter.sources).toEqual(siblingBefore.sources);
  expect(siblingAfter.children).toEqual(siblingBefore.children);
  expect(find(after, 'section:第一章').children).toEqual(['section:第一章/第一节', 'section:第一章/第二节', 'section:第一章/第三节']);
  expect(find(after, card.ref).parentKey).toBe('section:第一章/第一节');
  expect(cardTargets(after)).toEqual(cardTargets(before));
  expect(after.skeletonRevision).toBe(before.skeletonRevision! + 1);
});

test('拆卡挂点在提案前固定；旁支改动可继续，错误章节、书籍、版本和已改范围被拒', async () => {
  const fixture = await open();
  const book = await fixture.importBook('task-book', '三角函数.md', TRIG);
  await fixture.skeletonStore.create(create('task-skeleton'), book.materialId, { materialId: book.materialId,
    nodes: [node('第一节', lineAnchor(book, 3)), node('别处', lineAnchor(book, 4))] });
  const structure = await fixture.exploration.read(READ, book);
  const task = { action: 'cards' as const, material: book, nodePath: '第一节', skeletonRevision: structure.skeletonRevision, sources: [lineAnchor(book, 3)] };
  const fragment = encodeSourceFragment({ version: 1, context: { selection: { text: '', sources: task.sources } }, titles: [], objects: [], bookTask: task });
  const events = [{ type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: fragment }] } }, { type: 'tool/call', data: { callId: 'task-call' } }];
  const execution = { callId: 'task-call', agent: { session: { snapshotEvents: () => events } } } as unknown as ToolRunContext;
  const host = { studyforgeBookExploration: fixture.exploration, studyforgeCardService: fixture.cards } as unknown as Context;
  const card = CardContentSchema.parse({ title: '本节题卡', front: '保留原题', sources: task.sources });
  await expect(bindTaskCard(host, execution, HOST, card)).resolves.toMatchObject({ chapter: '第一节', sources: task.sources });
  await expect(bindTaskCard(host, execution, HOST, { ...card, chapter: '别处' })).rejects.toThrow('不在本次所选节点下');
  for (const sources of [[], [lineAnchor({ ...book, materialId: 'other' }, 3)], [lineAnchor({ ...book, versionId: 'other' }, 3)]]) {
    await expect(bindTaskCard(host, execution, HOST, { ...card, sources })).rejects.toThrow('准确来源');
  }
  const current = await fixture.skeletons.read(READ, book.materialId);
  await fixture.skeletonStore.update(create('task-side-change', current.revision), objectRef(SKELETON_KIND, book.materialId), {},
    row => ({ ...row, nodes: [...row.nodes, node('新旁支', lineAnchor(book, 5))] }));
  await expect(bindTaskCard(host, execution, HOST, card)).resolves.toMatchObject({ chapter: '第一节' });
  const finer = await fixture.skeletons.read(READ, book.materialId);
  await fixture.skeletonStore.update(create('task-refined', finer.revision), objectRef(SKELETON_KIND, book.materialId), {},
    row => ({ ...row, nodes: [...row.nodes, node('第一节/例1', lineAnchor(book, 3))] }));
  await expect(bindTaskCard(host, execution, HOST, card)).rejects.toThrow('已有子目录');
  const bound = await bindTaskCard(host, execution, HOST, { ...card, chapter: '第一节/例1' });
  expect(bound.chapter).toBe('第一节/例1');
  // An explicitly chosen broad chapter remains valid for a cross-section card.
  await expect(bindTaskCard(host, execution, HOST, { ...card, chapter: '第一节' })).resolves.toMatchObject({ chapter: '第一节' });
  const after = await fixture.exploration.read(READ, book);
  expect(refusalCode(() => validateBookBreakdown({ ...after, nodes: after.nodes.filter(n => n.key !== 'section:第一节') }, task))).toBe('book_node_missing');
  expect(refusalCode(() => validateBookBreakdown({ ...after, nodes: after.nodes.map(n => n.key === 'section:第一节' ? { ...n, sources: [lineAnchor(book, 4)] } : n) }, task))).toBe('book_node_changed');
  const ordinary = { callId: 'ordinary', agent: { session: { snapshotEvents: () => [...events,
    { type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '现在记录另外一道题' }] } },
    { type: 'tool/call', data: { callId: 'ordinary' } }] } } } as unknown as ToolRunContext;
  await expect(bindTaskCard(host, ordinary, HOST, { ...card, sources: [], chapter: '别处' })).resolves.toMatchObject({ sources: [], chapter: '别处' });
  expect(fixture.cardStore.list(READ)).toHaveLength(0);
});
