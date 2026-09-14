import { expect, test } from 'vitest';
import { WorldbookDocumentSchema, WorkbenchDraftValueSchema } from '../../packages/contracts/src/plugins.ts';
import { selectWorldbookEntries } from '../../packages/host/src/plugins/worldbook-selection.ts';
import { worldbookInput } from '../../packages/host/src/plugins/worldbook-context.ts';
import type { SessionEvent } from '@deepseek-ai/dsh-session';

const entry = (title: string, options = {}) => ({ title, content: title + '内容', keywords: ['城邦'], enabled: true, always: false, ...options });
test('worldbooks only match enabled entries, normalize literal keywords and keep whole entries within budget', () => {
  const entries = [entry('背景', { always: true }), entry('命中'), entry('隐藏', { enabled: false, always: true }), entry('不匹配', { keywords: ['公民'] }), entry('空词', { keywords: [] })];
  expect(selectWorldbookEntries([{ title: '场景', entries }], '城邦').entries.map(x => x.title)).toEqual(['背景', '命中']);
  expect(selectWorldbookEntries([{ title: '场景', entries: [entry('英文', { keywords: ['Café'] })] }], 'ＣＡＦÉ').entries).toHaveLength(1);
  const result = selectWorldbookEntries([{ title: '场景', entries: Array.from({ length: 10 }, (_, i) => entry('条目' + i, { content: '字'.repeat(1500), always: true })) }], '');
  expect(result.entries.length).toBeGreaterThan(0); expect(result.entries.length).toBeLessThan(5); expect(result.omitted).toBeGreaterThan(0);
  expect(result.text.length).toBeLessThanOrEqual(6000); expect(result.entries.every(x => x.content.length === 1500)).toBe(true);
});
test('worldbook and draft contracts bound data and reject invalid keyword triggers', () => {
  expect(WorldbookDocumentSchema.safeParse({ entries: [entry('术语')] }).success).toBe(true);
  expect(WorldbookDocumentSchema.safeParse({ entries: [entry('空关键词', { keywords: [' '] })] }).success).toBe(false);
  expect(WorkbenchDraftValueSchema.safeParse({ notes: '字'.repeat(64001) }).success).toBe(false);
});
test('worldbook trigger uses claimed user text, not queued, canceled or generated messages', () => {
  const user = (id: string, text: string, kind = 'user') => ({ id, role: 'user', source: { kind }, content: [{ type: 'text', text }] });
  const events = [{ type: 'user/message', data: user('first', '水源') },
    { type: 'user/message', data: user('receipt', '贸易', 'plugin') },
    { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 0, inserted: [user('queued', '城邦')] } }];
  const read = (rows: unknown[]) => worldbookInput(rows as SessionEvent[]);
  expect(read(events)).toEqual({ id: 'first', text: '水源' });
  const claim = { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [] } };
  expect(read([...events, claim])).toEqual({ id: 'queued', text: '城邦' });
  expect(read([...events, { ...claim, data: { ...claim.data, outcome: 'canceled' } }])).toEqual({ id: 'first', text: '水源' });
  expect(read([...events, { type: 'turn/start', data: { turn: 2 } }, { type: 'user/message', data: user('notice', '已经保存', 'plugin') }])).toBeUndefined();
});
