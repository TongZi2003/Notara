import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MaterialRecordSchema } from '../../packages/contracts/src/material-records.ts';
import { CardRecordSchema } from '../../packages/contracts/src/cards.ts';
import { SkeletonRecordSchema } from '../../packages/contracts/src/skeleton.ts';
import { PlanContentSchema } from '../../packages/contracts/src/plans.ts';
import { MaterialService } from '../../packages/domain/src/materials/material-service.ts';
import { SkeletonService } from '../../packages/domain/src/materials/skeleton-service.ts';
import { SkeletonAuthoring } from '../../packages/domain/src/organization/skeleton-authoring.ts';
import { PlanService } from '../../packages/domain/src/organization/plan-service.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import type { SourceAnchor } from '../../packages/contracts/src/materials.ts';

const context = { workspaceId: 'w', sessionId: 'lesson', actor: 'student' as const, purpose: 'learning' as const };
const op = (operationId: string, expectedVersion?: number) => ({ ...context, operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf-planning-')), ctx = new Context(); await ctx.plugin(Storage);
  const clock = createTestClock('2026-09-12T00:00:00Z', 'Asia/Shanghai'), owner = await openWorkspaceRecords(ctx, root, 'w', clock);
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  const materials = new MaterialService(await owner.collection('material', MaterialRecordSchema), root, clock);
  const skeletons = await owner.collection('skeleton', SkeletonRecordSchema), cards = await owner.collection('card', CardRecordSchema), plans = await owner.collection('plan', PlanContentSchema);
  const reader = new SkeletonService(skeletons, materials), writer = new SkeletonAuthoring(skeletons, cards, plans, reader, owner);
  const service = new PlanService(plans, materials, reader, { hasCard: (ctx, ref) => cards.list(ctx).some(row => row.ref === ref), hasSet: () => false });
  const book = await materials.import(op('book'), { title: '函数', fileName: '函数.md', mediaType: 'text/markdown', bytes: new TextEncoder().encode('定义域\n单调性\n') });
  const source: SourceAnchor = { materialId: book.materialId, versionId: book.currentVersion.versionId, locator: { kind: 'text', start: { line: 1, column: 0 }, end: { line: 1, column: 3 } }, quote: '定义域' };
  const nodes = [{ path: '数学/定义域', sources: [source] }, { path: '数学/单调性', sources: [{ ...source, locator: { kind: 'text' as const, start: { line: 2, column: 0 }, end: { line: 2, column: 3 } }, quote: '单调性' }] }];
  await writer.save(op('outline', 0), book.materialId, { nodes });
  await cards.create(op('card'), 'one', { content: { title: '题目', chapter: '数学/定义域', sources: [source] }, history: [] });
  const plan = await service.create(op('plan'), { kind: 'book', title: '下一节', materialId: book.materialId, entries: [{ date: '2026-09-14', chapter: '数学/定义域', sources: [source] }] });
  return { ctx, owner, materials, reader, writer, cards, plans, service, book, source, nodes, plan, skeletons };
}

test('a repath changes its real card and exact book plan in one publication, preserving sources and siblings', async () => {
  const f = await fixture(), change = { repath: [{ from: '数学/定义域', to: '数学/定义范围' }] };
  const before = f.cards.read(context, 'card:one'), sibling = f.nodes[1];
  const preview = await f.writer.preview(context, f.book.materialId, 1, change);
  expect(preview.impact).toEqual({ cards: ['card:one'], plans: [f.plan.ref], removedPaths: [] });
  expect(f.cards.read(context, 'card:one')).toEqual(before);
  let publications = 0; f.ctx.on('domain/changed', () => { publications++; });
  const saved = await f.writer.save(op('repath', 1), f.book.materialId, change);
  expect(publications).toBe(1); expect(saved.nodes[1]).toEqual(sibling);
  expect(f.cards.read(context, 'card:one').data.content.chapter).toBe('数学/定义范围');
  expect(f.cards.read(context, 'card:one').data.content.sources).toEqual(before.data.content.sources);
  const plan = f.service.read(context, f.plan.ref);
  expect(plan.content).toMatchObject({ entries: [{ date: '2026-09-14', chapter: '数学/定义范围', sources: [f.source] }] });
  expect(await f.writer.save(op('repath', 1), f.book.materialId, change)).toEqual(saved); expect(publications).toBe(1);
  await expect(f.writer.save(op('stale', 1), f.book.materialId, { nodes: [] })).rejects.toThrow('version_conflict');
  expect(f.cards.read(context, 'card:one').version).toBe(2);
});

test('deletion reports real dependents; explicit detachment preserves dates, sources, card and learning history', async () => {
  const f = await fixture(), change = { removePaths: ['数学/定义域'] };
  expect((await f.writer.preview(context, f.book.materialId, 1, change)).requiresDetach).toBe(true);
  await expect(f.writer.save(op('remove', 1), f.book.materialId, change)).rejects.toThrow('skeleton_removal_has_dependents');
  expect(f.cards.read(context, 'card:one').version).toBe(1);
  await f.writer.save(op('detach', 1), f.book.materialId, { ...change, detachDependents: true });
  expect(f.cards.read(context, 'card:one').data.content.chapter).toBeUndefined();
  expect(f.cards.read(context, 'card:one').data.content.sources).toEqual([f.source]);
  expect(f.cards.read(context, 'card:one').data.history).toEqual([]);
  expect(f.service.read(context, f.plan.ref).content).toMatchObject({ entries: [{ date: '2026-09-14', sources: [f.source] }] });
  expect((await f.reader.read(context, f.book.materialId)).nodes).toEqual([f.nodes[1]]);
});

test('same-named plans remain distinct targets and an explicit campaign schedule never slides its dates', async () => {
  const f = await fixture();
  const campaign = await f.service.create(op('campaign'), { kind: 'campaign', title: '下一节', learningSetRef: null, tags: [], cards: [], dailyCount: 2,
    start: '2026-09-15', end: '2026-09-20', schedule: [{ date: '2026-09-16', cards: ['card:one'] }] });
  expect(campaign.ref).not.toBe(f.plan.ref);
  const edited = await f.service.edit(op('edit-campaign', 1), campaign.ref, { title: '固定安排' });
  expect(edited.content).toMatchObject({ schedule: [{ date: '2026-09-16', cards: ['card:one'] }] });
  expect(f.service.read(context, f.plan.ref)).toEqual(f.plan);
  await expect(f.service.edit(op('wrong-kind', 2), campaign.ref, { entries: [] })).rejects.toThrow();
  await expect(f.service.edit(op('missing-card', 2), campaign.ref, { cards: ['card:absent'] })).rejects.toThrow('plan_card_missing');
  expect(f.cards.read(context, 'card:one').data.review).toBeUndefined();
});

test('an uncertain return after atomic save retries the same complete revision', async () => {
  const f = await fixture(); let fail = true;
  const writer = new SkeletonAuthoring(f.skeletons, f.cards, f.plans, f.reader, { async atomic(plans) {
    await f.owner.atomic(plans); if (fail) { fail = false; throw new Error('lost-return'); }
  } });
  const change = { repath: [{ from: '数学/定义域', to: '数学/定义范围' }] };
  await expect(writer.save(op('unknown-return', 1), f.book.materialId, change)).rejects.toThrow('lost-return');
  expect(f.cards.read(context, 'card:one').data.content.chapter).toBe('数学/定义范围');
  const result = await writer.save(op('unknown-return', 1), f.book.materialId, change);
  expect(result.revision).toBe(2); expect(f.cards.read(context, 'card:one').version).toBe(2);
});
