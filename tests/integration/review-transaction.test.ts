import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CardRecordSchema } from '../../packages/contracts/src/cards.ts';
import { DEFAULT_LADDER, type ReviewOccurrence } from '../../packages/contracts/src/reviews.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { ReviewService, reviewDigest, type ReviewInput } from '../../packages/domain/src/review/review-service.ts';
import { learningRecords, dueCards } from '../../packages/domain/src/review/learning-record-projection.ts';

const roots: string[] = [], cleanups: (() => Promise<void>)[] = [];
const context = { workspaceId: 'student', purpose: 'learning' as const, actor: 'system' as const, sessionId: 'lesson' };
const mutation = (operationId: string) => ({ ...context, operationId });
async function open(root?: string) {
  const dir = root ?? await mkdtemp(join(tmpdir(), 'sf-review-')); if (!roots.includes(dir)) roots.push(dir);
  const ctx = new Context(); await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student', createTestClock('2026-10-01T00:00:00Z', 'Asia/Shanghai'));
  const records = await owner.collection('card', CardRecordSchema);
  const service = new ReviewService(records);
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  return { records, service, owner, root: dir };
}
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});
function action(id: string, day: string): Pick<ReviewOccurrence, 'id' | 'occurredAt' | 'timeZone' | 'order'> {
  return { id, occurredAt: day + 'T01:00:00Z', timeZone: 'Asia/Shanghai', order: { sessionId: 'lesson', sequence: Number(day.slice(-2)) } };
}
const input = (occurrence: ReviewOccurrence, mark: ReviewInput['mark'] = '牢'): ReviewInput => ({ occurrence, mark, channel: '课内', note: '独立写出并解释', basis: [] });

test('late confirmation and concurrent retries publish history and schedule together, then survive restart', async () => {
  const first = await open();
  await first.records.create(mutation('create'), 'question', { content: { title: '原题' }, history: [] });
  const early = first.service.freeze(context, 'card:question', action('early', '2026-09-01'));
  const later = first.service.freeze(context, 'card:question', action('later', '2026-09-03'));
  const newer = await first.service.record(mutation('newer'), 'card:question', input(later));
  expect(newer.card.review).toEqual({ lastAccessed: '2026-09-03', nextDue: '2026-09-06', reviewCount: 1 });
  const results = await Promise.all([first.service.record(mutation('old'), 'card:question', input(early)), first.service.record(mutation('old'), 'card:question', input(early))]);
  expect(results.map(result => result.mode).sort()).toEqual(['duplicate', 'history_only']);
  const saved = first.records.read(context, 'card:question');
  expect(saved.data.history).toHaveLength(2);
  expect(saved.data.review).toEqual({ lastAccessed: '2026-09-03', nextDue: '2026-09-06', reviewCount: 2 });
  await first.owner.close();
  const second = await open(first.root);
  expect(second.records.read(context, 'card:question')).toEqual(saved);
  expect((await second.service.record(mutation('old'), 'card:question', input(early))).mode).toBe('duplicate');
  expect((await second.service.record(mutation('another-op'), 'card:question', input(early))).mode).toBe('duplicate');
  expect(second.records.read(context, 'card:question').data.history).toHaveLength(2);
  await expect(second.service.record(mutation('different-note'), 'card:question', { ...input(early), note: '换了原结论' })).rejects.toThrow('same_occurrence_requires_correction');
});

test('changed baseline initializes conservatively; initial study and policy refit do not count as tests', async () => {
  const { records, service } = await open();
  await records.create(mutation('create'), 'note', { content: { title: '概念笔记', presentation: 'note' }, history: [] });
  const evidence = service.freeze(context, 'card:note', action('first', '2026-09-01'));
  await records.update({ ...mutation('edit'), expectedVersion: 1 }, 'card:note', { title: '更正概念' }, row => ({ ...row, content: { ...row.content, title: '更正概念' } }));
  const result = await service.record(mutation('record'), 'card:note', input(evidence, '初'));
  expect(result.mode).toBe('initialize');
  expect(result.card.review).toEqual({ lastAccessed: '2026-09-01', nextDue: '2026-09-02', reviewCount: 0 });
  const refitted = await service.refit(mutation('refit'), 'card:note', [1, 2, 4, 7]);
  expect(refitted.history).toEqual(result.card.history);
  expect(refitted.review?.reviewCount).toBe(0);
  const inventory = { ...refitted, ref: 'card:inventory', history: [], review: undefined };
  const { review: _review, ...unlearned } = inventory;
  expect(learningRecords([refitted, unlearned])).toHaveLength(1);
  expect(learningRecords([refitted])[0]?.presentation).toBe('note');
  expect(dueCards([refitted, unlearned], '2026-09-02').map(card => card.ref)).toEqual(['card:note']);
  await expect(service.record(mutation('not-card'), 'knowledge:note', input(evidence))).rejects.toThrow('target_invalid');
});

test('derived writes cannot silently replace the conditional author edit API', async () => {
  const { records, service } = await open();
  await records.create(mutation('create'), 'card', { content: { title: '不变' }, history: [] });
  await expect(records.update(mutation('unguarded-edit'), 'card:card', {}, row => row)).rejects.toThrow('version_conflict');
  const accidentalBaseline = { ...mutation('bad'), expectedVersion: 1 };
  await expect(records.updateCurrent(accidentalBaseline, 'card:card', {}, row => row)).rejects.toThrow('derived_update_has_expected_version');
  const evidence = service.freeze(context, 'card:card', action('student', '2026-09-01'));
  expect(evidence.ladderVersion).toBe(reviewDigest(DEFAULT_LADDER));
  await expect(service.record({ ...mutation('wrong-channel'), actor: 'student' }, 'card:card', input(evidence))).rejects.toThrow('review_channel_forbidden');
});
