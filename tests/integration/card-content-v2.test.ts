/**
 * P5.1 ordinary cards against the real record store (plan §P5.1).
 *
 * Every card here lives in the production `RecordStore` under the production
 * `CardRecord` shape, and every source and chapter is checked against a real
 * imported file and a real skeleton row. The properties under test are the ones
 * the product depends on: the author's text (including sections literally named
 * 复习 / 重写) is content and the review ledger is a separate field, an omitted
 * field is never reset, only text this write rewrote is re-checked, relations
 * move by increment, and one accepted creation has one effect on retry.
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CardRecordSchema } from '../../packages/contracts/src/cards.ts';
import type { HostContext } from '../../packages/contracts/src/execution.ts';
import { KnowledgeRecordSchema } from '../../packages/contracts/src/knowledge.ts';
import { SkeletonRecordSchema } from '../../packages/contracts/src/skeleton.ts';
import { MaterialRecordSchema, type MaterialMediaType } from '../../packages/contracts/src/material-records.ts';
import type { SourceAnchor } from '../../packages/contracts/src/materials.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { CardService, type LinkTargets } from '../../packages/domain/src/cards/card-service.ts';
import { changedAuthorFields } from '../../packages/domain/src/cards/content-projection.ts';
import { MaterialService } from '../../packages/domain/src/materials/material-service.ts';
import { SKELETON_KIND, SkeletonService } from '../../packages/domain/src/materials/skeleton-service.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';

const clock = createTestClock('2026-09-12T00:00:00Z', 'Asia/Shanghai');
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
/** The lesson whose accepted operations these writes belong to. */
const HOST: HostContext = { workspaceId: 'student-a', sessionId: 'lesson-a', actor: 'student', purpose: 'learning' };
const student = (operationId: string, expectedVersion?: number) =>
  ({ ...HOST, operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
const teacher = (operationId: string, expectedVersion?: number) =>
  ({ ...HOST, actor: 'teacher' as const, operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
const encoded = (text: string) => new TextEncoder().encode(text);
const STORY = '# 三角函数\n\n第一段\n第二段\n';

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function open(root?: string, wireLinks = true) {
  const dir = root ?? await mkdtemp(join(tmpdir(), 'sf-card-'));
  if (!roots.includes(dir)) roots.push(dir);
  const ctx = new Context();
  await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student-a', clock);
  const cardStore = await owner.collection('card', CardRecordSchema);
  const knowledgeStore = await owner.collection('knowledge', KnowledgeRecordSchema);
  const skeletonStore = await owner.collection(SKELETON_KIND, SkeletonRecordSchema);
  const materials = new MaterialService(await owner.collection('material', MaterialRecordSchema), dir, clock);
  const skeletons = new SkeletonService(skeletonStore, materials);
  // The Host shape: one resolver over the real stores, so a `card:`/`knowledge:`
  // ref means an object this workspace really holds.
  const linkTargets: LinkTargets = {
    has: async (ctx, ref) => {
      try {
        if (ref.startsWith('card:')) { cardStore.read(ctx, ref); return true; }
        if (ref.startsWith('knowledge:')) { knowledgeStore.read(ctx, ref); return true; }
        return false;
      } catch { return false; }
    },
  };
  const cards = new CardService(cardStore, materials, skeletons, wireLinks ? linkTargets : undefined);
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  return { dir, owner, cardStore, knowledgeStore, skeletonStore, materials, skeletons, linkTargets, cards };
}

interface Book { readonly materialId: string; readonly versionId: string; }

async function importBook(materials: MaterialService, operationId: string, fileName: string, mediaType: MaterialMediaType, bytes: Uint8Array): Promise<Book> {
  const view = await materials.import({ ...HOST, purpose: 'creation', operationId }, { title: fileName, fileName, mediaType, bytes });
  return { materialId: view.materialId, versionId: view.currentVersion.versionId };
}

const lineAnchor = (book: Book, line: number, endColumn = 3): SourceAnchor => ({
  materialId: book.materialId, versionId: book.versionId,
  locator: { kind: 'text', start: { line, column: 0 }, end: { line, column: endColumn } },
});

test('author text is content: a 复习/重写 heading is never cut, and a metadata edit keeps it', async () => {
  const { cards, cardStore } = await open();
  const created = await cards.create(student('create-1'), {
    title: '导数与单调性', presentation: 'problem',
    front: '设 $f(x)=x^2$，求单调区间。',
    sections: [{ heading: '复习', body: '用 $f\'(x)>0$ 判断。' }, { heading: '重写', body: '先求导。' }],
    notes: '学生自己写的笔记：$\\frac{1}{2}$', tags: ['数学'],
  });
  expect(created.version).toBe(1);
  // Creating a card is not reviewing it: the ledger stays empty and separate.
  expect(created.history).toEqual([]);
  expect(created).not.toHaveProperty('review');
  expect(created.content.sections.map(section => section.heading)).toEqual(['复习', '重写']);
  expect(created.content.front).toBe('设 $f(x)=x^2$，求单调区间。');
  expect(cardStore.read(HOST, created.ref).data).toMatchObject({ history: [] });

  const edited = await cards.edit(student('tag-1', 1), created.ref, { tags: ['数学', '导数'] });
  expect(edited.version).toBe(2);
  expect(edited.content.front).toBe(created.content.front);
  expect(edited.content.sections).toEqual(created.content.sections);
  expect(edited.content.notes).toBe(created.content.notes);
  expect(changedAuthorFields(created.content, edited.content)).toEqual(['tags']);
  // The exact older revision is still readable, and the ledger never moved.
  expect(cards.read(HOST, created.ref, 1).content.tags).toEqual(['数学']);
  expect(cards.read(HOST, created.ref).version).toBe(2);
});

test('a restart keeps the same content, and the card has no second review ledger', async () => {
  const first = await open();
  const created = await first.cards.create(student('restart-1'), { title: '切线', front: '求 $y=x^2$ 在 $x=1$ 处的切线。' });
  await first.owner.close();
  const reopened = await open(first.dir);
  const read = reopened.cards.read(HOST, created.ref);
  expect(read).toMatchObject({ version: 1, content: { title: '切线' }, history: [] });
});

test('source-only and source-less cards are both legal, and an unreal source is refused before writing', async () => {
  const { cards, cardStore, materials } = await open();
  const book = await importBook(materials, 'book-1', '三角函数.md', 'text/markdown', encoded(STORY));
  const sourceOnly = await cards.create(student('source-only'), { title: '只在书里', front: '', sources: [lineAnchor(book, 1)] });
  expect(sourceOnly.content.front).toBe('');
  expect(sourceOnly.content.sources).toHaveLength(1);
  const plain = await cards.create(student('no-source'), { title: '无来源命题', front: '证明：$a^2\\ge 0$' });
  expect(plain.content.sources).toEqual([]);

  // `check` proves a draft without writing anything, so a batch can be fully
  // validated before the first row lands.
  const before = cardStore.list(HOST).length;
  expect((await cards.check(HOST, { title: '待确认', front: '$x$', sources: [lineAnchor(book, 3)] })).title).toBe('待确认');
  expect(cardStore.list(HOST)).toHaveLength(before);

  await expect(cards.create(student('bad-source'), {
    title: '坏来源', front: '', sources: [{ materialId: 'mat_0000000000000000', versionId: 'ver_0000000000000000', locator: { kind: 'text', start: { line: 1, column: 0 }, end: { line: 1, column: 1 } } }],
  })).rejects.toMatchObject({ code: 'material_missing' });
  expect(cardStore.list(HOST)).toHaveLength(before);
});

test('a chapter is a real node of one of the card own source books', async () => {
  const { cards, skeletonStore, materials } = await open();
  const book = await importBook(materials, 'book-2', '三角函数.md', 'text/markdown', encoded(STORY));
  await skeletonStore.create({ ...HOST, purpose: 'creation', operationId: 'skeleton-1' }, book.materialId, {
    materialId: book.materialId, nodes: [{ path: '三角函数/单调性', sources: [lineAnchor(book, 1)] }],
  });
  const created = await cards.create(student('chapter-ok'), { title: '挂点卡', front: 'x', sources: [lineAnchor(book, 1)], chapter: '三角函数/单调性' });
  expect(created.content.chapter).toBe('三角函数/单调性');
  await expect(cards.create(student('chapter-bad'), { title: '错挂点', front: 'x', sources: [lineAnchor(book, 1)], chapter: '三角函数/不存在' }))
    .rejects.toMatchObject({ code: 'card_chapter_missing' });
  // A chapter needs a source book to hang from; without one there is no skeleton to hold it.
  await expect(cards.create(student('chapter-orphan'), { title: '孤挂点', front: 'x', chapter: '三角函数/单调性' }))
    .rejects.toMatchObject({ code: 'card_chapter_missing' });
  // `chapter: null` is the explicit "no hook" form; an omitted chapter is untouched.
  const cleared = await cards.edit(student('chapter-clear', 1), created.ref, { chapter: null });
  expect(cleared.content).not.toHaveProperty('chapter');
});

test('only text this write rewrote is re-checked, so an old broken face cannot block a metadata edit', async () => {
  const { cards, cardStore } = await open();
  // A legacy row written straight through the store: its face is already broken.
  const legacy = await cardStore.create(student('legacy-create'), 'legacy-card', { content: { title: '旧卡', front: '闭式 $ 没有闭合' }, history: [] });
  expect(legacy.version).toBe(1);

  const edited = await cards.edit(student('legacy-tag', 1), 'card:legacy-card', { tags: ['旧'] });
  expect(edited.version).toBe(2);
  expect(edited.content.front).toBe('闭式 $ 没有闭合');

  await expect(cards.edit(student('legacy-front', 2), 'card:legacy-card', { front: '新写的 $ 还是没闭合' }))
    .rejects.toMatchObject({ code: 'card_math_invalid' });
  expect(cardStore.read(HOST, 'card:legacy-card').version).toBe(2);

  // Fenced code is not prose: the same character inside a fence is not a formula.
  const fenced = await cards.edit(student('legacy-fence', 2), 'card:legacy-card', { front: '说明\n\n```\n$\n```\n' });
  expect(fenced.version).toBe(3);
  expect(fenced.content.front).toContain('```');
});

test('a relation must name a real object, and a teacher may only add', async () => {
  const { cards, cardStore, knowledgeStore } = await open();
  await cardStore.create(student('link-other'), 'other', { content: { title: '别的卡', front: 'x' }, history: [] });
  await knowledgeStore.create(student('link-k1'), 'k-1', { content: { title: '一条知识', body: '正文' } });

  const created = await cards.create(student('links-create'), { title: '关系', front: 'x', links: ['card:other'] });
  const added = await cards.edit(teacher('links-add', 1), created.ref, { links_add: ['knowledge:k-1'] });
  expect(added.content.links).toEqual(['card:other', 'knowledge:k-1']);
  // A teacher's edit must not rewrite the list a student curates.
  await expect(cards.edit(teacher('links-remove', 2), created.ref, { links_remove: ['card:other'] }))
    .rejects.toMatchObject({ code: 'card_links_remove_forbidden' });
  const removed = await cards.edit(student('links-student-remove', 2), created.ref, { links_remove: ['card:other'] });
  expect(removed.content.links).toEqual(['knowledge:k-1']);

  // An opaque ref that names nothing never becomes a relation.
  await expect(cards.create(student('links-fake'), { title: '假关系', front: 'x', links: ['card:ghost'] }))
    .rejects.toMatchObject({ code: 'card_link_unresolved' });
  await expect(cards.edit(student('links-fake-add', 3), created.ref, { links_add: ['knowledge:ghost'] }))
    .rejects.toMatchObject({ code: 'card_link_unresolved' });
  expect(cardStore.read(HOST, created.ref).data.content.links).toEqual(['knowledge:k-1']);
});

test('a relation is proven once: a stored link is not re-checked, and an unwired resolver refuses instead of storing', async () => {
  const { cards, cardStore } = await open();
  // A row that already carries a link to an object that is gone (legacy import,
  // or the target was deleted later) must still be editable.
  await cardStore.create(student('legacy-link'), 'legacy-link', { content: { title: '旧关系', front: 'x', links: ['card:gone'] }, history: [] });
  const edited = await cards.edit(student('legacy-link-tag', 1), 'card:legacy-link', { tags: ['旧'] });
  expect(edited.content.links).toEqual(['card:gone']);

  const unwired = await open(undefined, false);
  await expect(unwired.cards.create(student('unwired-link'), { title: '没接线', front: 'x', links: ['card:other'] }))
    .rejects.toMatchObject({ code: 'card_link_unverifiable' });
  // A card with no relation needs nothing wired.
  expect((await unwired.cards.create(student('unwired-plain'), { title: '无关系', front: 'x' })).content.links).toEqual([]);
  expect(unwired.cardStore.list(HOST)).toHaveLength(1);
});

test('one accepted creation has one effect, and a stale baseline never overwrites', async () => {
  const { cards, cardStore } = await open();
  const first = await cards.create(student('retry-1'), { title: '幂等', front: 'x' });
  const again = await cards.create(student('retry-1'), { title: '幂等', front: 'x' });
  expect(again.ref).toBe(first.ref);
  expect(again.version).toBe(1);
  expect(cardStore.list(HOST)).toHaveLength(1);
  await expect(cards.create(student('retry-1'), { title: '换个内容', front: 'x' })).rejects.toMatchObject({ code: 'record_exists' });

  const results = await Promise.allSettled([
    cards.edit(student('race-a', 1), first.ref, { title: 'A' }),
    cards.edit(student('race-b', 1), first.ref, { title: 'B' }),
  ]);
  expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  await expect(cards.edit(student('no-baseline'), first.ref, { title: 'C' })).rejects.toMatchObject({ code: 'card_expected_version_required' });
});

test('a human edit and a later model edit stay on one card identity', async () => {
  const { cards } = await open();
  const created = await cards.create(student('human-create'), { title: '合作卡', front: '原文' });
  const human = await cards.edit(student('human-edit', 1), created.ref, { front: '学生改的 $x$' });
  const model = await cards.edit(teacher('model-edit', 2), created.ref, { notes: '老师补一句' });
  expect(model.ref).toBe(created.ref);
  expect(model.version).toBe(3);
  expect(model.content.front).toBe('学生改的 $x$');
  expect(model.content.notes).toBe('老师补一句');
  expect(changedAuthorFields(human.content, model.content)).toEqual(['notes']);
});

test('every anchor of one version is checked, not just the first', async () => {
  const { cards, materials } = await open();
  const book = await importBook(materials, 'book-4', '三角函数.md', 'text/markdown', encoded(STORY));
  const good = lineAnchor(book, 1);
  // Two anchors of one material version are two positions: a bad second
  // locator or a bad second quote must still be refused.
  await expect(cards.create(student('anchor-range'), {
    title: '越界', front: '',
    sources: [good, { ...good, locator: { kind: 'text', start: { line: 1, column: 0 }, end: { line: 1, column: 99 } } }],
  })).rejects.toMatchObject({ code: 'source_offset_out_of_range' });
  await expect(cards.create(student('anchor-quote'), {
    title: '引文不符', front: '', sources: [good, { ...good, quote: '书里没有这句' }],
  })).rejects.toMatchObject({ code: 'source_quote_mismatch' });
  // The same anchors are still one legal card once every position is honest.
  const whole = { ...good, locator: { kind: 'text' as const, start: { line: 1, column: 0 }, end: { line: 1, column: 6 } }, quote: '# 三角函数' };
  const fine = await cards.create(student('anchor-good'), { title: '两处来源', front: '', sources: [good, whole] });
  expect(fine.content.sources).toHaveLength(2);
});

test('a replay of an accepted edit returns its own revision after the card moved on', async () => {
  const { cards, cardStore } = await open();
  const created = await cards.create(student('replay-create'), { title: '原文', front: 'x' });
  const first = await cards.edit(student('replay-edit', 1), created.ref, { title: '第一次' });
  expect(first.version).toBe(2);
  await cards.edit(student('replay-later', 2), created.ref, { title: '第二次' });
  // The ACK for the first edit was lost, so the identical accepted operation is
  // retried with the identical baseline: the store hands back its own revision
  // and the later content is not overwritten.
  const replay = await cards.edit(student('replay-edit', 1), created.ref, { title: '第一次' });
  expect(replay).toMatchObject({ version: 2, content: { title: '第一次' } });
  expect(cardStore.read(HOST, created.ref)).toMatchObject({ version: 3, data: { content: { title: '第二次' } } });
  // A stale baseline that was never applied is still refused.
  await expect(cards.edit(student('replay-other', 1), created.ref, { title: '从未应用' }))
    .rejects.toMatchObject({ code: 'version_conflict' });
});

test('preview runs exactly the checks an edit would, and writes nothing', async () => {
  const { cards, cardStore, materials } = await open();
  const book = await importBook(materials, 'book-5', '三角函数.md', 'text/markdown', encoded(STORY));
  const created = await cards.create(student('preview-create'), { title: '预览', front: '原文 $x$', sources: [lineAnchor(book, 1)] });
  const version = cardStore.read(HOST, created.ref).version;

  const patch = { title: '改标题', tags: ['新'] };
  const preview = await cards.preview(HOST, created.ref, version, patch);
  expect(preview).toMatchObject({ title: '改标题', tags: ['新'], front: '原文 $x$' });
  // Nothing was written: the same read gives back the untouched card.
  expect(cardStore.read(HOST, created.ref)).toMatchObject({ version, data: { content: { title: '预览', tags: [] } } });
  // And the save that follows agrees with the preview it showed.
  const saved = await cards.edit(student('preview-save', version), created.ref, patch);
  expect(saved.content).toEqual(preview);

  // The same refusals an edit gives, before anything is written.
  await expect(cards.preview(HOST, created.ref, saved.version, { front: '没闭合 $ 的公式' }))
    .rejects.toMatchObject({ code: 'card_math_invalid' });
  await expect(cards.preview(HOST, created.ref, saved.version, { chapter: '三角函数/不存在' }))
    .rejects.toMatchObject({ code: 'card_chapter_missing' });
  await expect(cards.preview(HOST, created.ref, saved.version, {
    sources: [{ ...lineAnchor(book, 1), locator: { kind: 'text', start: { line: 1, column: 0 }, end: { line: 1, column: 99 } } }],
  })).rejects.toMatchObject({ code: 'source_offset_out_of_range' });
  await expect(cards.preview({ ...HOST, actor: 'teacher' }, created.ref, saved.version, { links_remove: ['card:other'] }))
    .rejects.toMatchObject({ code: 'card_links_remove_forbidden' });
  await expect(cards.preview(HOST, created.ref, saved.version + 5, { title: 'x' }))
    .rejects.toMatchObject({ code: 'version_conflict' });
  expect(cardStore.read(HOST, created.ref).version).toBe(saved.version);
});
