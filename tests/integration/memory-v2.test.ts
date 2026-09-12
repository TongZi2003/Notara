/**
 * P7.1 learner memory over the real storage medium (plan §P7.1, SIMPLIFICATION A5).
 *
 * The memory record, the workspace lock and the evidence resolver are the real
 * ones; only the accepted-message cut is scripted, exactly as the Host narrows
 * it from the native log. The test pins what this task exists for: one real
 * observation may be saved with no certification, a second observation does not
 * certify anything either, the student's own words and a real answer keep
 * different source identities, a correction appends to the same record instead
 * of erasing it, a same-named note is a new record, a stale revision is refused,
 * and the owner reads their own memory across subjects.
 */
import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryRecordSchema, MemorySearchResultSchema, MemoryViewSchema } from '../../packages/contracts/src/memory.ts';
import type { HostContext, MutationContext } from '../../packages/contracts/src/execution.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { EvidenceQuery, type EvidenceMessage } from '../../packages/domain/src/evidence/evidence-query.ts';
import { MemoryService } from '../../packages/domain/src/memory/memory-service.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';

const clock = createTestClock('2026-09-12T00:00:00Z', 'Asia/Shanghai');
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
const READ: HostContext = { workspaceId: 'student-a', actor: 'student', purpose: 'learning' };
const statement = (operationId: string, expectedVersion?: number): MutationContext =>
  ({ workspaceId: 'student-a', sessionId: 'lesson-a', actor: 'teacher', purpose: 'learning', operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });
/** A co-editing student with no lesson open: workspace-only, still their own memory. */
const noSession = (operationId: string, expectedVersion?: number): MutationContext =>
  ({ workspaceId: 'student-a', actor: 'student', purpose: 'learning', operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) });

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function open() {
  const dir = await mkdtemp(join(tmpdir(), 'sf-memory-'));
  roots.push(dir);
  const ctx = new Context();
  await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, dir, 'student-a', clock);
  const records = await owner.collection('memory', MemoryRecordSchema);
  const service = new MemoryService(records, new EvidenceQuery());
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); });
  return { owner, records, service };
}

/** One accepted cut resolved to aliases, exactly the Host-narrowed rows the native log really yields. */
const evidence = new EvidenceQuery();
const catalogue = (messages: readonly EvidenceMessage[]) => evidence.catalogue({ sessionId: 'lesson-a', messages });
const said = (messageId: string, text: string, objects?: readonly { ref: string; version: number }[]): EvidenceMessage =>
  ({ messageId, occurredAt: '2026-09-12T01:0' + messageId.slice(-1) + ':00.000Z', role: 'student', text, ...(objects === undefined ? {} : { objects }) });
const words = catalogue([said('m1', '我更喜欢先猜再验证。')]);
const work = catalogue([said('m1', '我更喜欢先猜再验证。'), said('m2', '这道单选做出来了。', [{ ref: 'card:card-1', version: 2 }]), { messageId: 'm3', occurredAt: '2026-09-12T01:03:00.000Z', role: 'assistant', text: '不错。' }]);
const draft = (body: string, evidenceRefs: string[], extra: Record<string, unknown> = {}) => ({ kind: 'ability', body, evidenceRefs, ...extra });
const keys = (value: unknown): string => JSON.stringify(value);

test('一次真实观察可存，不自动认证，也没有两对象门槛', async () => {
  const fixture = await open();
  const view = await fixture.service.note(statement('op-1'), draft('这道题里会先自己猜一个方向。', ['E1']), words);
  expect(MemoryViewSchema.parse(view)).toEqual(view);
  expect(view.revision).toBe(1);
  expect(view.history).toHaveLength(1);
  expect(view.basis.current).toEqual([{ sessionId: 'lesson-a', messageId: 'm1', occurredAt: '2026-09-12T01:01:00.000Z', source: 'student_statement', quote: '我更喜欢先猜再验证。' }]);
  expect(view.basis.prior).toEqual([]);
  // Nothing certifies or counts: a single observation is a legal, final row.
  expect(keys(view)).not.toContain('verifiedAbility');
  expect(view).not.toHaveProperty('verified');
  expect(view).not.toHaveProperty('strength');
  expect(fixture.records.list(READ)).toHaveLength(1);
  expect(MemoryRecordSchema.parse(fixture.records.read(READ, view.ref).data)).toEqual({ content: view.content, history: view.history });

  // A second observation on the same record is still not an automatic verdict.
  const revised = await fixture.service.revise(statement('op-2', 1), view.ref, draft('两节课都先自己猜。', ['E1']), words);
  expect(revised.history).toHaveLength(2);
  expect(keys(revised)).not.toContain('verifiedAbility');
  expect(revised).not.toHaveProperty('certified');
});

test('学生自述与真实作答的来源身份清楚可分辨', async () => {
  const fixture = await open();
  const spoken = await fixture.service.note(statement('op-1'), draft('愿意先说自己的想法。', ['E1']), work);
  expect(spoken.basis.current[0]).toMatchObject({ messageId: 'm1', source: 'student_statement' });
  const answered = await fixture.service.note(statement('op-2'), draft('这道单选独立做出来了。', ['E2']), work);
  expect(answered.basis.current[0]).toMatchObject({ messageId: 'm2', source: 'classroom_evidence', object: { ref: 'card:card-1', version: 2 } });
  // A system receipt or an assistant line is not the student's own basis, and a
  // made-up alias never resolves: both are refused, not silently adopted.
  await expect(fixture.service.note(statement('op-3'), draft('引用系统回执。', ['E3']), work)).rejects.toMatchObject({ code: 'evidence_alias_unknown' });
  await expect(fixture.service.note(statement('op-4'), draft('凭空引用。', ['E9']), work)).rejects.toMatchObject({ code: 'evidence_alias_unknown' });
});

test('偏好保留真实学生表达，附带卡片不改变原话身份，自定义分类不设门槛', async () => {
  const fixture = await open();
  const contextual = catalogue([said('m1', '这道题我想先自己猜，再看验证。', [{ ref: 'card:card-1', version: 2 }])]);
  const inClass = await fixture.service.note(statement('op-1'), draft('这道题想先自己猜再验证。', ['E1'], { kind: 'preference' }), contextual);
  expect(inClass.basis.current[0]!.quote).toBe('这道题我想先自己猜，再看验证。');
  expect(inClass.basis.current[0]!.source).toBe('classroom_evidence');
  const preference = await fixture.service.note(statement('op-2'), draft('喜欢先猜再验证。', ['E1'], { kind: 'preference' }), work);
  expect(preference.content.kind).toBe('preference');
  expect(preference.basis.current[0]!.source).toBe('student_statement');
  // A reasonable custom category is a legal row on its own terms.
  const custom = await fixture.service.note(statement('op-3'), draft('这道题先猜后验。', ['E2'], { kind: '关注点' }), work);
  expect(custom.content.kind).toBe('关注点');
});

test('反例更正沿原 target 保留旧内容与旧出处，陈旧版本被拒', async () => {
  const fixture = await open();
  const first = await fixture.service.note(statement('op-1'), draft('每次都直接看答案。', ['E1']), words);
  const corrected = await fixture.service.revise(statement('op-2', 1), first.ref, draft('后一道题改成一步一步来。', ['E1']), words);
  expect(corrected.ref).toBe(first.ref);
  expect(corrected.revision).toBe(2);
  expect(corrected.content.body).toBe('后一道题改成一步一步来。');
  expect(corrected.history.map(entry => entry.body)).toEqual(['每次都直接看答案。', '后一道题改成一步一步来。']);
  expect(corrected.basis.current).toHaveLength(1);
  expect(corrected.basis.prior).toHaveLength(1);
  expect(corrected.basis.prior[0]!.quote).toBe('我更喜欢先猜再验证。');
  // The same edit from the old read is refused, and an edit with no observed version never lands.
  await expect(fixture.service.revise(statement('op-stale', 1), first.ref, draft('陈旧改写。', ['E1']), words))
    .rejects.toMatchObject({ code: 'version_conflict' });
  await expect(fixture.service.revise(statement('op-noversion'), first.ref, draft('没有版本。', ['E1']), words))
    .rejects.toMatchObject({ code: 'memory_expected_version_required' });
  expect(fixture.records.read(READ, first.ref).version).toBe(2);
});

test('同名新记录不合并，同一事务重试恢复原身份', async () => {
  const fixture = await open();
  const one = await fixture.service.note(statement('op-1'), draft('同名判断。', ['E1']), words);
  const two = await fixture.service.note(statement('op-2'), draft('同名判断。', ['E1']), words);
  expect(two.ref).not.toBe(one.ref);
  expect(fixture.records.list(READ)).toHaveLength(2);
  // Replaying one accepted operation restores the same row instead of writing again.
  const replay = await fixture.service.note(statement('op-1'), draft('同名判断。', ['E1']), words);
  expect(replay.ref).toBe(one.ref);
  expect(fixture.records.list(READ)).toHaveLength(2);
});

test('本人跨科读取完整，搜索按真实字段给位置', async () => {
  const fixture = await open();
  await fixture.service.note(statement('op-1'), draft('数学里愿意先猜再验证。', ['E1'], { title: '数学起点', scope: { subjects: ['数学'] } }), words);
  await fixture.service.note(statement('op-2'), draft('物理里喜欢先画图再列式。', ['E1'], { scope: { subjects: ['物理'] } }), words);
  const all = fixture.service.list(READ);
  expect(all.map(view => view.content.scope?.subjects?.[0]).sort()).toEqual(['数学', '物理']);

  const found = fixture.service.search(READ, { query: '先猜' });
  expect(MemorySearchResultSchema.parse(found)).toEqual(found);
  expect(found.hits).toHaveLength(1);
  const hit = found.hits[0]!;
  expect(hit.title).toBe('数学起点');
  expect(hit.snippet.field).toBe('body');
  expect(hit.snippet.text.slice(hit.snippet.start!, hit.snippet.end!)).toBe('先猜');
  // An empty query lists what exists; a small limit reports truncation instead of hiding it.
  expect(fixture.service.search(READ, { query: '' }).hits).toHaveLength(2);
  expect(fixture.service.search(READ, { query: '', limit: 1 })).toMatchObject({ hasMore: true });
  expect(fixture.service.search(READ, { query: '先猜', kinds: ['preference'] }).hits).toEqual([]);
  // Searching and reading never write.
  expect(fixture.records.list(READ)).toHaveLength(2);
});

test('无 session 的学生编辑保存原采用来源，不强迫重编 E，也不变成新观察', async () => {
  const fixture = await open();
  const first = await fixture.service.note(statement('op-1'), draft('每次都直接看答案。', ['E1']), words);
  const saved = await fixture.service.edit(noSession('edit-1', 1), first.ref, {
    content: { kind: 'ability', body: '直接看答案，但会先写一步再对。' },
  });
  expect(saved.content.body).toBe('直接看答案，但会先写一步再对。');
  expect(saved.revision).toBe(2);
  // The wording moved; the observation did not: history and its adopted sources are untouched.
  expect(saved.history).toHaveLength(1);
  expect(saved.history[0]!.body).toBe('每次都直接看答案。');
  expect(saved.basis.current).toEqual(first.basis.current);
  expect(saved.basis.prior).toEqual([]);
  // An edit still needs the version it was read from.
  await expect(fixture.service.edit(noSession('edit-noversion'), first.ref, { content: { kind: 'ability', body: '没有版本。' } }))
    .rejects.toMatchObject({ code: 'memory_expected_version_required' });
});

test('explicit basis 只能取本记录真实旧版本，且仍不写成新观察', async () => {
  const fixture = await open();
  const first = await fixture.service.note(statement('op-1'), draft('第一版说法。', ['E1']), work);
  const second = await fixture.service.revise(statement('op-2', 1), first.ref, draft('第二版说法。', ['E2']), work);
  expect(second.basis.current[0]!.messageId).toBe('m2');
  expect(second.basis.prior[0]!.messageId).toBe('m1');
  // The student merges both wordings and re-points the result at the first version's real source.
  const rePointed = await fixture.service.edit(noSession('edit-1', 2), first.ref, {
    content: { kind: 'ability', body: '合并两版后的说法。' }, sources: [second.basis.prior[0]!],
  });
  expect(rePointed.content.body).toBe('合并两版后的说法。');
  expect(rePointed.history).toHaveLength(2); // an edit is not an observation
  expect(rePointed.basis.current[0]!.messageId).toBe('m1');
  expect(rePointed.basis.prior.map(ref => ref.messageId)).toEqual(['m1', 'm2']);
  // A fabricated source is refused, and a stale version never lands.
  await expect(fixture.service.edit(noSession('edit-2', 3), first.ref, {
    content: { kind: 'ability', body: '编一套依据。' },
    sources: [{ sessionId: 'lesson-a', messageId: 'm9', occurredAt: '2026-09-12T02:00:00.000Z', source: 'student_statement', quote: '并不存在。' }],
  })).rejects.toMatchObject({ code: 'memory_source_not_adopted' });
  await expect(fixture.service.edit(noSession('edit-stale', 2), first.ref, { content: { kind: 'ability', body: '陈旧编辑。' } }))
    .rejects.toMatchObject({ code: 'version_conflict' });
  expect(fixture.records.read(READ, first.ref).version).toBe(3);
});
