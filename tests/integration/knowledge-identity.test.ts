/**
 * P5.2 private knowledge against the real record store (plan §P5.2).
 *
 * Knowledge here is one identity with one free body, stored in the production
 * `RecordStore` under the production `KnowledgeRecord` shape. The properties
 * under test are the ones the product depends on: writing a note is not
 * reviewing it, collecting changes the receipt and nothing else (never a second
 * card, never a review ladder), public sources are installed package entries
 * pinned to an exact version — not material versions — and only the trusted
 * confirmation writer may set the receipt.
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CardRecordSchema } from '../../packages/contracts/src/cards.ts';
import { KnowledgeRecordSchema, type PublicTeachingRef } from '../../packages/contracts/src/knowledge.ts';
import type { HostContext } from '../../packages/contracts/src/execution.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { KnowledgeService, type LinkTargets, type PublicSourceResolver } from '../../packages/domain/src/knowledge/knowledge-service.ts';
import { indexKnowledge, knowledgeContentReader } from '../../packages/domain/src/knowledge/knowledge-index.ts';
import { cardContentReader } from '../../packages/domain/src/cards/content-projection.ts';
import { LearningSearch } from '../../packages/domain/src/materials/learning-search.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';

const clock = createTestClock('2026-09-12T00:00:00Z', 'Asia/Shanghai');
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
const HOST: HostContext = { workspaceId: 'student-a', sessionId: 'lesson-a', actor: 'student', purpose: 'learning' };
const student = (operationId: string, expectedVersion?: number) =>
  ({ ...HOST, operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
const teacher = (operationId: string, expectedVersion?: number) =>
  ({ ...HOST, actor: 'teacher' as const, operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
/** The confirmed writer: the student's click is what produces this receipt. */
const system = (operationId: string, expectedVersion?: number) =>
  ({ ...HOST, actor: 'system' as const, operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
const RECEIPT = { confirmationId: 'confirm-1', collectedAt: '2026-09-12T08:00:00+08:00' };

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function open(root?: string, catalog?: PublicSourceResolver) {
  const dir = root ?? await mkdtemp(join(tmpdir(), 'sf-knowledge-'));
  if (!roots.includes(dir)) roots.push(dir);
  const ctx = new Context();
  await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student-a', clock);
  const knowledgeStore = await owner.collection('knowledge', KnowledgeRecordSchema);
  const cardStore = await owner.collection('card', CardRecordSchema);
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
  const knowledge = new KnowledgeService(knowledgeStore, catalog, linkTargets);
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  return { dir, owner, knowledgeStore, cardStore, linkTargets, knowledge };
}

/** The installed public catalog P7/P8 will wire: only the exact pinned version answers. */
function catalogOf(installed: readonly PublicTeachingRef[]): PublicSourceResolver {
  return {
    resolve: (_ctx, ref) => Promise.resolve(
      installed.some(entry => entry.packageId === ref.packageId && entry.entryId === ref.entryId && entry.version === ref.version)
        ? { ...ref } : null),
  };
}

test('a note is not a review object, and a repeat of one confirmation stays one collection', async () => {
  const { knowledge, knowledgeStore } = await open();
  const noted = await knowledge.note(student('note-1'), { title: '同除之前先分情况', body: '分母含参数时先讨论符号。' });
  expect(noted.version).toBe(1);
  expect(noted).not.toHaveProperty('collection');
  expect(noted.publicSources).toEqual([]);
  expect(knowledgeStore.read(HOST, noted.ref).data).not.toHaveProperty('review');

  // Only the trusted confirmation writer may collect.
  await expect(knowledge.collect(student('collect-student', 1), noted.ref, RECEIPT))
    .rejects.toMatchObject({ code: 'knowledge_collection_untrusted' });
  await expect(knowledge.collect(system('collect-no-baseline'), noted.ref, RECEIPT))
    .rejects.toMatchObject({ code: 'knowledge_expected_version_required' });

  const collected = await knowledge.collect(system('collect-1', 1), noted.ref, RECEIPT);
  expect(collected.version).toBe(2);
  expect(collected.ref).toBe(noted.ref);
  expect(collected.content).toEqual(noted.content);
  expect(collected.collection).toEqual(RECEIPT);
  // A second confirmation over the same record is a conflict, not a silent overwrite.
  await expect(knowledge.collect(system('collect-2', 2), noted.ref, { ...RECEIPT, confirmationId: 'confirm-2' }))
    .rejects.toMatchObject({ code: 'knowledge_already_collected' });
  expect(knowledge.read(HOST, noted.ref).collection).toEqual(RECEIPT);
  expect(knowledgeStore.list(HOST)).toHaveLength(1);
});

test('deleting knowledge keeps its linked card and fixed historical version, rejects stale deletes, and replays after restart', async () => {
  const fixture = await open();
  const card = await fixture.cardStore.create(student('linked-card'), 'linked', { content: { title: '题卡', front: '条件是什么？' }, history: [] });
  const note = await fixture.knowledge.note(student('to-delete'), { title: '知识', body: '先看条件', links: [card.ref] });
  const updated = await fixture.knowledge.revise(student('change-before-delete', note.version), note.ref, { body: '分情况看条件' });
  await expect(fixture.knowledge.remove(student('stale-delete', note.version), note.ref)).rejects.toMatchObject({ code: 'version_conflict' });
  await fixture.knowledge.remove(student('delete', updated.version), note.ref);
  await fixture.knowledge.remove(student('delete', updated.version), note.ref);
  expect(() => fixture.knowledge.read(HOST, note.ref)).toThrow('record_missing');
  expect(fixture.knowledgeStore.list(HOST)).toEqual([]);
  expect(fixture.knowledge.read(HOST, note.ref, note.version).content.body).toBe('先看条件');
  expect(fixture.cardStore.read(HOST, card.ref).data).toEqual(card.data);
  await expect(fixture.knowledge.revise(student('after-delete', updated.version), note.ref, { body: '不能复活' })).rejects.toMatchObject({ code: 'record_missing' });
  await fixture.owner.close();
  const reopened = await open(fixture.dir);
  await reopened.knowledge.remove(student('delete', updated.version), note.ref);
  expect(reopened.knowledgeStore.list(HOST)).toEqual([]);
  expect(reopened.cardStore.read(HOST, card.ref).data).toEqual(card.data);
});

test('public sources are installed package entries, never material versions', async () => {
  const installed: PublicTeachingRef[] = [{ packageId: 'pack-diagnose', entryId: 'method/scope', version: '3.1.0' }];
  const withCatalog = await open(undefined, catalogOf(installed));
  const noted = await withCatalog.knowledge.note(student('note-public'), {
    title: '范围先判', body: '先判范围再看端点。', publicSources: [...installed],
  });
  expect(noted.publicSources).toEqual(installed);

  await expect(withCatalog.knowledge.note(student('note-missing'), {
    title: '别的包', body: 'x', publicSources: [{ packageId: 'pack-other', entryId: 'method/x', version: '1.0.0' }],
  })).rejects.toMatchObject({ code: 'knowledge_public_source_missing' });

  // A public source without the installed catalog cannot be verified, so it is refused.
  const unwired = await open();
  await expect(unwired.knowledge.note(student('note-unwired'), {
    title: '没接目录', body: 'x', publicSources: [...installed],
  })).rejects.toMatchObject({ code: 'knowledge_public_source_unavailable' });
  // A note that came from nothing public simply carries the empty list.
  expect((await unwired.knowledge.note(student('note-empty'), { title: '无公共来源', body: 'x' })).publicSources).toEqual([]);
});

test('a human edit and a later model edit keep one identity, one body and the relation rules', async () => {
  const { knowledge, knowledgeStore, cardStore } = await open();
  await cardStore.create(student('k-link-card'), 'other', { content: { title: '别的卡', front: 'x' }, history: [] });
  await knowledgeStore.create(student('k-link-k2'), 'k-2', { content: { title: '另一条知识', body: '正文' } });
  const noted = await knowledge.note(student('note-2'), { title: '判别式', body: '判别式 Δ=b²-4ac', links: ['card:other'] });
  const human = await knowledge.revise(student('human-edit', 1), noted.ref, { body: '判别式 Δ=b²-4ac；先看符号。' });
  expect(human.version).toBe(2);
  const model = await knowledge.revise(teacher('model-edit', 2), noted.ref, { category: '代数', links_add: ['knowledge:k-2'] });
  expect(model.ref).toBe(noted.ref);
  expect(model.content.body).toBe('判别式 Δ=b²-4ac；先看符号。');
  expect(model.content.links).toEqual(['card:other', 'knowledge:k-2']);
  await expect(knowledge.revise(teacher('teacher-remove', 3), noted.ref, { links_remove: ['card:other'] }))
    .rejects.toMatchObject({ code: 'knowledge_links_remove_forbidden' });
  const studentEdit = await knowledge.revise(student('student-remove', 3), noted.ref, { links_remove: ['card:other'] });
  expect(studentEdit.content.links).toEqual(['knowledge:k-2']);
  // Same identity throughout: no edit produced a second row for this note
  // (`knowledge:k-2` is only the relation target created above).
  expect(knowledgeStore.list(HOST).map(row => row.ref).sort()).toEqual([noted.ref, 'knowledge:k-2'].sort());
  // An opaque ref that names nothing never becomes a relation.
  await expect(knowledge.note(student('k-fake'), { title: '假关系', body: '正文', links: ['knowledge:ghost'] }))
    .rejects.toMatchObject({ code: 'knowledge_link_unresolved' });
  await expect(knowledge.revise(student('k-fake-add', 3), noted.ref, { links_add: ['card:ghost'] }))
    .rejects.toMatchObject({ code: 'knowledge_link_unresolved' });
  expect(knowledgeStore.read(HOST, noted.ref).data.content.links).toEqual(['knowledge:k-2']);
  expect(knowledgeStore.list(HOST)).toHaveLength(2);
  await expect(knowledge.revise(student('no-baseline'), noted.ref, { title: 'x' }))
    .rejects.toMatchObject({ code: 'knowledge_expected_version_required' });
});

test('exact older revisions, restart and workspace binding', async () => {
  const first = await open();
  const noted = await first.knowledge.note(student('note-3'), { title: '切线的斜率', body: '导数即切线斜率。' });
  await first.knowledge.revise(student('note-3-edit', 1), noted.ref, { title: '切线的斜率', body: '导数即切线斜率，不是割线。' });
  expect(first.knowledge.read(HOST, noted.ref, 1).content.body).toBe('导数即切线斜率。');
  await first.owner.close();
  const reopened = await open(first.dir);
  const read = reopened.knowledge.read(HOST, noted.ref);
  expect(read).toMatchObject({ version: 2, content: { body: '导数即切线斜率，不是割线。' } });
  expect(() => reopened.knowledge.read({ ...HOST, workspaceId: 'student-b' }, noted.ref)).toThrow(/workspace/);
});

test('reading knowledge for a search sees the free body, not the receipt', async () => {
  const { knowledge, knowledgeStore, cardStore } = await open();
  await cardStore.create(student('card-1'), 'c-1', { content: { title: '函数 数学', front: '函数的判断' }, history: [] });
  const noted = await knowledge.note(student('note-4'), { title: '函数 定义', body: '函数是把输入映到输出。' });
  await knowledge.collect(system('note-4-collect', 1), noted.ref, RECEIPT);

  const rows = indexKnowledge(HOST, knowledgeStore);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ ref: noted.ref, version: 2, title: '函数 定义', collection: RECEIPT });
  expect(rows[0]!.publicSources).toEqual([]);

  // P4's search consumes both corpora through the content readers, so a
  // collected knowledge row and a card really answer together.
  const search = new LearningSearch({ cards: cardContentReader(cardStore), knowledge: knowledgeContentReader(knowledgeStore) });
  const result = await search.search(HOST, { query: '函数' });
  expect(result.hits.map(hit => [hit.corpus, hit.ref])).toEqual([['card', 'card:c-1'], ['knowledge', noted.ref]]);
});

test('a lost-ACK replay returns its own revision, and one collection is written once', async () => {
  const { knowledge, knowledgeStore } = await open();
  const noted = await knowledge.note(student('replay-note'), { title: '原文', body: '第一版正文' });
  const first = await knowledge.revise(student('replay-revise', 1), noted.ref, { body: '第二版正文' });
  expect(first.version).toBe(2);
  await knowledge.revise(student('replay-later', 2), noted.ref, { body: '第三版正文' });
  const replay = await knowledge.revise(student('replay-revise', 1), noted.ref, { body: '第二版正文' });
  expect(replay).toMatchObject({ version: 2, content: { body: '第二版正文' } });
  expect(knowledgeStore.read(HOST, noted.ref)).toMatchObject({ version: 3, data: { content: { body: '第三版正文' } } });
  await expect(knowledge.revise(student('replay-other', 1), noted.ref, { body: '从未应用' }))
    .rejects.toMatchObject({ code: 'version_conflict' });

  const collected = await knowledge.collect(system('replay-collect', 3), noted.ref, RECEIPT);
  expect(collected.version).toBe(4);
  const again = await knowledge.collect(system('replay-collect', 3), noted.ref, RECEIPT);
  expect(again.version).toBe(4);
  expect(again.collection).toEqual(RECEIPT);
  expect(knowledgeStore.read(HOST, noted.ref).version).toBe(4);
});

test('a collect replay answers with its own collection revision, not the later edit', async () => {
  const { knowledge, knowledgeStore } = await open();
  const noted = await knowledge.note(student('c-note'), { title: '收录', body: '正文' });
  const collected = await knowledge.collect(system('c-collect', 1), noted.ref, RECEIPT);
  expect(collected.version).toBe(2);
  const edited = await knowledge.revise(student('c-edit', 2), noted.ref, { body: '收录后又改的正文' });
  expect(edited.version).toBe(3);
  // Collecting is not undone by editing the note afterwards.
  expect(edited.collection).toEqual(RECEIPT);
  // Same operation, same frozen receipt: the answer is the collection's own
  // revision, even though the record has moved on.
  const replay = await knowledge.collect(system('c-collect', 1), noted.ref, RECEIPT);
  expect(replay.version).toBe(2);
  expect(replay.content.body).toBe('正文');
  expect(replay.collection).toEqual(RECEIPT);
  expect(knowledgeStore.read(HOST, noted.ref)).toMatchObject({
    version: 3, data: { content: { body: '收录后又改的正文' }, collection: RECEIPT },
  });
});

test('the same confirmation under a fresh operation is not a new effect, and a changed receipt is refused', async () => {
  const { knowledge, knowledgeStore } = await open();
  const noted = await knowledge.note(student('c2-note'), { title: '收录', body: '正文' });
  await knowledge.collect(system('c2-collect', 1), noted.ref, RECEIPT);
  // The identical frozen receipt under a fresh operation id re-states the same
  // confirmed effect: no new revision and no rewritten receipt.
  const restated = await knowledge.collect(system('c2-collect-again', 2), noted.ref, RECEIPT);
  expect(restated.version).toBe(2);
  expect(knowledgeStore.read(HOST, noted.ref).version).toBe(2);
  // A different collectedAt under the same confirmation id is a different claim.
  await expect(knowledge.collect(system('c2-collect-changed', 2), noted.ref, { ...RECEIPT, collectedAt: '2026-09-12T09:00:00+08:00' }))
    .rejects.toMatchObject({ code: 'knowledge_collection_conflict' });
  expect(knowledgeStore.read(HOST, noted.ref)).toMatchObject({ version: 2, data: { collection: RECEIPT } });
});
