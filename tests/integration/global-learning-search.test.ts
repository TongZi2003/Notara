/**
 * P4.2 local learning search across the real stores.
 *
 * The materials, cards and knowledge in this test are real RecordStore rows and
 * real files on disk. The test pins what the query promises: one workspace is
 * the whole scope (nothing narrows it by learning set or subject), `query`,
 * `limit` and `focus` only rank and truncate, private learning facts are refused
 * with a reason instead of an empty corpus, an unwired corpus is reported, a
 * foreign workspace stays a caller error, and a restart rebuilds the same hits.
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CardContentSchema, KnowledgeContentSchema } from '../../packages/contracts/src/index.ts';
import { MaterialRecordSchema } from '../../packages/contracts/src/material-records.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { LearningSearch } from '../../packages/domain/src/materials/learning-search.ts';
import { MaterialService } from '../../packages/domain/src/materials/material-service.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';

const clock = createTestClock('2026-09-12T00:00:00Z', 'Asia/Shanghai');
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
const HOST = { workspaceId: 'student-a', actor: 'student' as const, purpose: 'learning' as const };
const write = (operationId: string) => ({ workspaceId: 'student-a', actor: 'student' as const, purpose: 'creation' as const, operationId });
const encoded = (text: string) => new TextEncoder().encode(text);

async function open(root?: string) {
  const dir = root ?? await mkdtemp(join(tmpdir(), 'sf-global-search-'));
  if (!roots.includes(dir)) roots.push(dir);
  const app = new Context(); await app.plugin(Storage);
  const owner = await openWorkspaceRecords(app, dir, 'student-a', clock);
  const materialStore = await owner.collection('material', MaterialRecordSchema);
  const cards = await owner.collection('card', CardContentSchema);
  const knowledge = await owner.collection('knowledge', KnowledgeContentSchema);
  const materials = new MaterialService(materialStore, dir, clock);
  const search = new LearningSearch({ materials: materialStore, resolve: materials, cards, knowledge });
  cleanups.push(async () => { await owner.close(); await app.fiber.dispose(); });
  return { app, owner, materials, cards, knowledge, search, root: dir };
}

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A lesson that holds one material, two same-named cards in different subjects, and one knowledge row. */
async function seeded() {
  const workspace = await open();
  const material = await workspace.materials.import(write('m-1'), { title: '函数讲义', fileName: '函数.md', mediaType: 'text/markdown', bytes: encoded('# 函数\n\n函数的定义\n') });
  await workspace.cards.create(write('c-1'), 'math-card', { title: '函数 数学', front: '函数的判断', tags: ['数学'] });
  await workspace.cards.create(write('c-2'), 'physics-card', { title: '函数 物理', front: '函数图像', tags: ['物理'] });
  await workspace.knowledge.create(write('k-1'), 'derivative', { title: '导数', body: '用函数研究变化率' });
  return { ...workspace, material };
}

test('one workspace is the scope: cross-subject hits rank by corpus and real position', async () => {
  const { search, material } = await seeded();
  const result = await search.search(HOST, { query: '函数' });
  expect(result.notes).toEqual([]);
  // Materials first, then cards by their own first match, then knowledge.
  expect(result.hits.map(hit => [hit.corpus, hit.ref ?? hit.source?.materialId])).toEqual([
    ['material', material.materialId],
    ['card', 'card:math-card'], ['card', 'card:physics-card'],
    ['knowledge', 'knowledge:derivative'],
  ]);
  expect(result.hits[0]).toMatchObject({
    corpus: 'material', revision: null,
    source: { materialId: material.materialId, versionId: material.currentVersion.versionId, locator: { kind: 'text' } },
  });
  // A saved object hit carries its real ref, revision and field.
  expect(result.hits[1]).toMatchObject({ corpus: 'card', ref: 'card:math-card', revision: 1 });
  // Both real card fields are reported, each with its own name.
  expect(result.hits[1]!.snippets.map(snippet => snippet.field)).toEqual(['title', 'front']);
  expect(result.hasMore).toBe(false);

  const limited = await search.search(HOST, { query: '函数', limit: 1 });
  expect(limited.hits).toHaveLength(1);
  expect(limited.hasMore).toBe(true);
  const focused = await search.search(HOST, { query: '函数', focus: { targets: ['card:physics-card'] } });
  expect(focused.hits.map(hit => hit.ref ?? hit.source?.materialId)[0]).toBe('card:physics-card');
  // Focus reorders suggestions; it neither hides nor grants anything.
  expect(focused.hits).toHaveLength(result.hits.length);
});

test('private learning facts are refused with a reason and an unwired corpus is reported', async () => {
  const { search, cards } = await seeded();
  const memoryOnly = await search.search(HOST, { query: '函数', include: ['memory'] });
  expect(memoryOnly).toEqual({ hits: [], hasMore: false, notes: [{ code: 'memory_purpose_required' }] });
  const cardsOnly = await search.search(HOST, { query: '函数', include: ['card', 'memory'] });
  expect(cardsOnly.hits.map(hit => hit.ref)).toEqual(['card:math-card', 'card:physics-card']);
  expect(cardsOnly.notes).toEqual([{ code: 'memory_purpose_required' }]);

  // A corpus the Host never connected says so instead of looking empty.
  const bare = new LearningSearch({ cards });
  const unwired = await bare.search(HOST, { query: '函数' });
  expect(unwired.notes).toEqual([
    { code: 'corpus_unavailable', corpus: 'material', detail: 'material store not connected' },
    { code: 'corpus_unavailable', corpus: 'knowledge', detail: 'knowledge store not connected' },
  ]);
  expect(unwired.hits.map(hit => hit.ref)).toEqual(['card:math-card', 'card:physics-card']);
});

test('a foreign workspace is a caller error, not a missing corpus', async () => {
  const { search } = await seeded();
  await expect(search.search({ workspaceId: 'student-b', actor: 'student', purpose: 'learning' }, { query: '函数' }))
    .rejects.toMatchObject({ code: 'workspace_mismatch' });
});

test('a restart rebuilds exactly the same hits from the same facts', async () => {
  const { search, owner, root } = await seeded();
  const before = await search.search(HOST, { query: '函数' });
  await owner.close();
  const reopened = await open(root);
  const after = await reopened.search.search(HOST, { query: '函数' });
  expect(after).toEqual(before);
});
