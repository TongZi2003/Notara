import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CardRecordSchema } from '../../packages/contracts/src/cards.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { cardChanges, compareText, textUnits } from '../../packages/domain/src/cards/card-changes.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
test('an exact native revision pair attributes only this lesson edits and keeps a hidden back hidden', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sf-changes-')), ctx = new Context(); await ctx.plugin(Storage);
  const owner = await openWorkspaceRecords(ctx, root, 'w', createTestClock('2026-09-12T00:00:00Z', 'UTC'));
  cleanups.push(async () => { await owner.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  const records = await owner.collection('card', CardRecordSchema), base = { workspaceId: 'w', purpose: 'learning' as const, actor: 'teacher' as const };
  await records.create({ ...base, operationId: 'born' }, 'one', { content: { title: '同一卡', front: '第一行\n重复\n重复\n', sections: [{ heading: '答案', body: '隐藏原文' }] }, history: [] });
  await records.update({ ...base, sessionId: 'A', operationId: 'A1', expectedVersion: 1 }, 'card:one', { front: 'A' }, row => ({ ...row, content: { ...row.content, front: '第一行\n改一行\n重复\n' } }));
  await records.update({ ...base, sessionId: 'B', operationId: 'B1', expectedVersion: 2 }, 'card:one', { front: 'B' }, row => ({ ...row, content: { ...row.content, front: 'B课插入\n重复\n' } }));
  await records.update({ ...base, sessionId: 'A', operationId: 'A2', expectedVersion: 3 }, 'card:one', { back: 'A', topic: '数学/函数' }, row => ({ ...row, content: { ...row.content, topic: '数学/函数', sections: [{ heading: '答案', body: '秘密答案已更新' }] } }));
  await records.update({ ...base, actor: 'student', operationId: 'outside', expectedVersion: 4 }, 'card:one', { tags: ['课外'] }, row => ({ ...row, content: { ...row.content, tags: ['课外'] } }));
  const before = records.read(base, 'card:one');
  const hidden = cardChanges(records, base, 'card:one', { sessionId: 'A' });
  expect(hidden.map(row => row.operation.operationId)).toEqual(['A1', 'A2']);
  expect(hidden.map(row => [row.operation.beforeRevision, row.operation.afterRevision])).toEqual([[1, 2], [3, 4]]);
  expect(hidden[0]?.fields.find(field => field.field === 'front')?.before).toBe('第一行\n重复\n重复\n');
  expect(hidden[1]?.hiddenBackChanged).toBe(true);
  expect(hidden[1]?.metadata).toContain('topic');
  expect(JSON.stringify(hidden)).not.toContain('秘密答案'); expect(JSON.stringify(hidden)).not.toContain('隐藏原文');
  const revealed = cardChanges(records, base, 'card:one', { sessionId: 'A', showBack: true });
  expect(revealed[1]?.fields[0]?.before).toContain('隐藏原文'); expect(revealed[1]?.fields[0]?.after).toContain('秘密答案已更新');
  expect(records.read(base, 'card:one')).toEqual(before); // redline is never persisted in author text
});

test.each([
  ['重复\n中间\n重复\n', '重复\n重复\n新增\n'],
  ['$$\nx^2+1\n$$\n\n末尾', '$$\nx^2+2\n$$\n\n末尾'],
  ['旧行\n', ''], ['', '新增😀\n'], ['a\nb\n', 'b\na\n'],
])('redline reconstructs both original byte strings: %s', (before, after) => {
  const result = compareText(before, after);
  expect(result.filter(item => item.kind !== 'add').map(item => item.text).join('')).toBe(before);
  expect(result.filter(item => item.kind !== 'remove').map(item => item.text).join('')).toBe(after);
  if (before.startsWith('$$')) expect(result[0]).toEqual({ kind: 'remove', text: '$$\nx^2+1\n$$\n' });
});
test('code and math remain complete rendering units', () => {
  expect(textUnits('前\n```ts\na()\n```\n\\[\nx\n\\]\n后')).toEqual(['前\n', '```ts\na()\n```\n', '\\[\nx\n\\]\n', '后']);
});
