import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { CardContentSchema } from '../../packages/contracts/src/cards.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';

const clock = createTestClock('2026-09-12T00:00:00Z', 'Asia/Shanghai');
const ctxWrite = { workspaceId: 'student-a', sessionId: 'lesson-a', actor: 'student' as const, purpose: 'learning' as const };
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
async function setup(root?: string) {
  root ??= await mkdtemp(join(tmpdir(), 'sf-record-test-'));
  if (!roots.includes(root)) roots.push(root);
  const ctx = new Context(); await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, root, 'student-a', clock).catch(async error => { await ctx.fiber.dispose(); throw error; });
  const cards = await owner.collection('card', CardContentSchema);
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  return { ctx, owner, cards, root };
}
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test('same-card stale writers, immutable snapshots and lost-response replay', async () => {
  const { cards, owner, root, ctx } = await setup();
  let publications = 0;
  ctx.on('domain/changed', () => { publications += 1; });
  const created = await cards.create({ ...ctxWrite, operationId: 'create' }, 'one', { title: '分母', front: '原文' });
  expect(created.version).toBe(1);
  const results = await Promise.allSettled(['A', 'B'].map((front, i) => cards.update({ ...ctxWrite, operationId: `edit-${i}`, expectedVersion: 1 }, 'card:one', { front }, old => ({ ...old, front }))));
  expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
  expect(results[1]).toMatchObject({ reason: { code: 'version_conflict' } });
  const read = cards.read(ctxWrite, 'card:one'); read.data.front = 'mutated caller copy';
  expect(cards.read(ctxWrite, 'card:one').data.front).toBe('A');
  await cards.update({ ...ctxWrite, operationId: 'later', expectedVersion: 2 }, 'card:one', { front: 'later' }, old => ({ ...old, front: 'later' }));
  const beforeReplay = publications;
  const retry = await cards.update({ ...ctxWrite, operationId: 'edit-0', expectedVersion: 1 }, 'card:one', { front: 'A' }, () => { throw new Error('duplicate must not rerun'); });
  expect(publications).toBe(beforeReplay);
  expect(retry).toMatchObject({ version: 2, duplicate: true, data: { front: 'A' } });
  expect(cards.read(ctxWrite, 'card:one').version).toBe(3);
  await expect(cards.update({ ...ctxWrite, operationId: 'edit-0', expectedVersion: 1 }, 'card:one', { front: 'different' }, old => old)).rejects.toMatchObject({ code: 'operation_conflict' });
  expect(() => cards.read({ ...ctxWrite, workspaceId: 'student-b' }, 'card:one')).toThrow(/workspace/);
  expect(() => cards.read(ctxWrite, 'knowledge:one')).toThrow(/target/);
  expect(cards.changes(ctxWrite, 'card:one')).toMatchObject([{ actor: 'student', sessionId: 'lesson-a', beforeRevision: null, afterRevision: 1 }, { beforeRevision: 1, afterRevision: 2 }, { beforeRevision: 2, afterRevision: 3 }]);
  await owner.close();
  const reopened = await setup(root);
  expect(reopened.cards.read(ctxWrite, 'card:one')).toMatchObject({ version: 3, data: { front: 'later' } });
});

test('no-op and rejected content preserve actual content revisions', async () => {
  const { cards } = await setup();
  await cards.create({ ...ctxWrite, operationId: 'create' }, 'one', { title: '题目', front: 'x' });
  const noop = await cards.update({ ...ctxWrite, operationId: 'noop', expectedVersion: 1 }, 'card:one', {}, old => old);
  expect(noop.version).toBe(1);
  expect(cards.changes(ctxWrite, 'card:one')).toHaveLength(1);
  await expect(cards.update({ ...ctxWrite, operationId: 'bad', expectedVersion: 1 }, 'card:one', { title: '' }, old => ({ ...old, title: '' }))).rejects.toThrow();
  expect(cards.read(ctxWrite, 'card:one').version).toBe(1);
});

test('corrupt native single medium rejects instead of creating empty records', async () => {
  const { cards, owner, root } = await setup();
  await cards.create({ ...ctxWrite, operationId: 'create' }, 'one', { title: '保留' }); await owner.close();
  const file = join(root, '.studyforge', 'sf_card.json');
  await writeFile(file, (await readFile(file, 'utf8')).slice(0, 10));
  const ctx = new Context(); await ctx.plugin(Storage);
  const broken = await openWorkspaceRecords(ctx, root, 'student-a', clock);
  try { await expect(broken.collection('card', CardContentSchema)).rejects.toMatchObject({ code: 'malformed-medium' }); }
  finally { await broken.close(); await ctx.fiber.dispose(); }
});

test('a second real process cannot write a workspace held by the first', async () => {
  const { root } = await setup();
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('tests/fixtures/storage-child.ts'), root, 'lock'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', data => { output += data.toString(); });
  const [code] = await once(child, 'exit');
  expect(code).toBe(23); expect(output).toContain('ELOCKED');
});

for (const boundary of ['before', 'after']) test(`real process dies ${boundary} publication; retry has one effect`, async () => {
  const initial = await setup();
  await initial.cards.create({ ...ctxWrite, operationId: 'create' }, 'one', { title: '原题', front: 'before' });
  await initial.owner.close();
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('tests/fixtures/storage-child.ts'), initial.root, boundary], { stdio: ['ignore', 'pipe', 'pipe'] });
  const [code, signal] = await once(child, 'exit'); expect(code).toBeNull(); expect(signal).toBe('SIGKILL');
  let reopened: Awaited<ReturnType<typeof setup>> | undefined;
  await expect.poll(async () => { try { reopened = await setup(initial.root); return true; } catch (error) { if ((error as { code?: string }).code === 'ELOCKED') return false; throw error; } }, { timeout: 12_000, interval: 500 }).toBe(true);
  if (!reopened) throw new Error('missing reopened owner');
  expect(reopened.cards.read(ctxWrite, 'card:one').data.front).toBe(boundary === 'after' ? 'committed' : 'before');
  const retried = await reopened.cards.update({ ...ctxWrite, actor: 'teacher', operationId: 'crash-edit', expectedVersion: 1 }, 'card:one', { front: 'committed' }, old => ({ ...old, front: 'committed' }));
  expect(retried.version).toBe(2); expect(retried.duplicate).toBe(boundary === 'after');
  expect(reopened.cards.changes(ctxWrite, 'card:one')).toHaveLength(2);
}, 25_000);
