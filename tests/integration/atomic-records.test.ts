import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { z } from 'zod';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const context = { workspaceId: 'w', sessionId: 'lesson', actor: 'student' as const, purpose: 'learning' as const };
const op = (operationId: string, expectedVersion?: number) => ({ ...context, operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
const schema = z.object({ path: z.string().min(1) }).strict();
async function open(root?: string) {
  const ctx = new Context(); await ctx.plugin(Storage);
  const directory = root ?? await mkdtemp(join(tmpdir(), 'sf-atomic-'));
  const owner = await openWorkspaceRecords(ctx, directory, 'w', createTestClock('2026-09-12T00:00:00Z', 'UTC')).catch(async error => { await ctx.fiber.dispose(); throw error; });
  const cards = await owner.collection('card', schema), skeletons = await owner.collection('skeleton', schema);
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); if (!root) await rm(directory, { recursive: true, force: true }); });
  return { ctx, owner, cards, skeletons, directory };
}
test('two related records publish in one native event, replay no-op, and restart as one state', async () => {
  const first = await open();
  const creates = [first.cards.prepareCreate(op('card'), 'one', { path: '章/旧节' }), first.skeletons.prepareCreate(op('outline'), 'book', { path: '章/旧节' })];
  expect(first.cards.list(context)).toEqual([]); // Preparation is not persistence.
  let publications = 0; first.ctx.on('domain/changed', () => { publications++; });
  await first.owner.atomic(creates); expect(publications).toBe(1);
  const plan = () => [
    first.cards.prepareUpdate(op('repath-card', 1), 'card:one', { path: '章/新节' }, row => ({ ...row, path: '章/新节' })),
    first.skeletons.prepareUpdate(op('repath-outline', 1), 'skeleton:book', { path: '章/新节' }, row => ({ ...row, path: '章/新节' })),
  ];
  await first.owner.atomic(plan()); expect(publications).toBe(2);
  const replay = plan(); expect(replay.every(change => change.result.duplicate)).toBe(true);
  await first.owner.atomic(replay); expect(publications).toBe(2);
  await first.owner.close();
  const second = await open(first.directory);
  expect(second.cards.read(context, 'card:one')).toMatchObject({ version: 2, data: { path: '章/新节' } });
  expect(second.skeletons.read(context, 'skeleton:book')).toMatchObject({ version: 2, data: { path: '章/新节' } });
  expect(second.cards.read(context, 'card:one', 1).data.path).toBe('章/旧节');
});
test.each(['before', 'after'])('SIGKILL %s atomic publication never splits the card and its skeleton', async boundary => {
  const first = await open();
  await first.cards.create(op('card'), 'one', { path: '旧' }); await first.skeletons.create(op('outline'), 'book', { path: '旧' });
  await first.owner.close();
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('tests/fixtures/atomic-child.ts'), first.directory, boundary], { stdio: 'ignore' });
  const [code, signal] = await once(child, 'exit'); expect(code).toBeNull(); expect(signal).toBe('SIGKILL');
  let second: Awaited<ReturnType<typeof open>> | undefined;
  await expect.poll(async () => { try { second = await open(first.directory); return true; } catch (error) { if ((error as { code?: string }).code === 'ELOCKED') return false; throw error; } }, { timeout: 12_000, interval: 500 }).toBe(true);
  if (!second) throw new Error('missing reopened storage');
  expect([second.cards.read(context, 'card:one').data.path, second.skeletons.read(context, 'skeleton:book').data.path]).toEqual(boundary === 'before' ? ['旧', '旧'] : ['新', '新']);
  const plans = [second.cards.prepareUpdate(op('atomic-card', 1), 'card:one', { path: '新' }, () => ({ path: '新' })),
    second.skeletons.prepareUpdate(op('atomic-outline', 1), 'skeleton:book', { path: '新' }, () => ({ path: '新' }))];
  expect(plans.every(plan => plan.result.duplicate)).toBe(boundary === 'after');
  await second.owner.atomic(plans);
  expect(second.cards.read(context, 'card:one').version).toBe(2); expect(second.skeletons.read(context, 'skeleton:book').version).toBe(2);
}, 25_000);
test('a stale member or malformed member publishes none; a concurrent ordinary writer is retained', async () => {
  const { owner, cards, skeletons } = await open();
  await cards.create(op('card'), 'one', { path: '旧' }); await skeletons.create(op('outline'), 'book', { path: '旧' });
  const first = cards.prepareUpdate(op('card-edit', 1), 'card:one', { path: '新' }, () => ({ path: '新' }));
  expect(() => skeletons.prepareUpdate(op('invalid', 1), 'skeleton:book', { path: '' }, () => ({ path: '' }))).toThrow();
  expect(cards.read(context, 'card:one').version).toBe(1);
  const second = skeletons.prepareUpdate(op('outline-edit', 1), 'skeleton:book', { path: '新' }, () => ({ path: '新' }));
  await skeletons.update(op('other', 1), 'skeleton:book', { path: '他人改动' }, () => ({ path: '他人改动' }));
  await expect(owner.atomic([first, second])).rejects.toThrow('version_conflict');
  expect(cards.read(context, 'card:one').data.path).toBe('旧');
  expect(skeletons.read(context, 'skeleton:book').data.path).toBe('他人改动');
  await expect(owner.atomic([first, first])).rejects.toThrow('duplicate_atomic_target');
});
