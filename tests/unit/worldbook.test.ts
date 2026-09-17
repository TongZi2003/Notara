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
test('secondary keywords narrow triggers and role/intimacy gates scope situational entries', () => {
  const withSecondary = entry('考场', { keywords: ['数学'], secondaryKeywords: ['考试'], selective: 'and-any' });
  const books = [{ title: '教室', entries: [withSecondary] }];
  expect(selectWorldbookEntries(books, '数学课').entries).toHaveLength(0);
  expect(selectWorldbookEntries(books, '数学考试').entries).toHaveLength(1);
  const notEntry = entry('禁区', { keywords: ['数学'], secondaryKeywords: ['游戏'], selective: 'not-any' });
  expect(selectWorldbookEntries([{ title: '教室', entries: [notEntry] }], '数学笔记').entries).toHaveLength(1);
  expect(selectWorldbookEntries([{ title: '教室', entries: [notEntry] }], '数学游戏').entries).toHaveLength(0);
  const bound = entry('同桌梗', { keywords: ['笔'], role: 'peer' });
  expect(selectWorldbookEntries([{ title: '教室', entries: [bound] }], '借笔').entries).toHaveLength(0);
  expect(selectWorldbookEntries([{ title: '教室', entries: [bound] }], '借笔', undefined, { activeRoles: new Set(['peer']) }).entries).toHaveLength(1);
  const gated = entry('熟络玩笑', { keywords: ['聊'], role: 'peer', intimacyAtLeast: 60 });
  const context = { activeRoles: new Set(['peer']), intimacyOf: (r: string, t: string) => r === 'peer' && t === 'student' ? 55 : undefined };
  expect(selectWorldbookEntries([{ title: '教室', entries: [gated] }], '聊聊', undefined, context).entries).toHaveLength(0);
  expect(selectWorldbookEntries([{ title: '教室', entries: [gated] }], '聊聊', undefined, { ...context, intimacyOf: () => 70 }).entries).toHaveLength(1);
  // Scan depth: a keyword from a recent earlier message still triggers.
  expect(selectWorldbookEntries(books, '接着看', undefined, { scan: ['刚才说到数学考试'] }).entries).toHaveLength(1);
});
test('role-bound entries validate against classroom roles and gates need a role', () => {
  const classroom = { title: '教室', roles: [{ id: 'peer', name: '同桌', purpose: '陪伴', instructions: '回应。', enabled: true }], rules: [], carrySummary: false };
  expect(WorldbookDocumentSchema.safeParse({ entries: [entry('绑定', { role: 'peer' })], classroom }).success).toBe(true);
  expect(WorldbookDocumentSchema.safeParse({ entries: [entry('绑定', { role: 'ghost' })], classroom }).success).toBe(false);
  expect(WorldbookDocumentSchema.safeParse({ entries: [entry('门槛', { intimacyAtLeast: 60 })], classroom }).success).toBe(false);
  expect(WorldbookDocumentSchema.safeParse({ entries: [entry('喂给同学', { roleVisible: true })], classroom }).success).toBe(false);
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
