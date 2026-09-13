import { expect, test } from 'vitest';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { encodeSourceFragment } from '../../packages/contracts/src/source-context.ts';
import { currentBookTask } from '../../packages/host/src/teaching/book-task.ts';

const task = { action: 'cards' as const, material: { materialId: 'book', versionId: 'v1' }, nodePath: '第一节', sources: [] };
const text = encodeSourceFragment({ version: 1, context: { currentMaterial: { kind: 'source', source: task.material } }, titles: [], objects: [], bookTask: task });
const user = (id: string, body = text, kind = 'user', role = 'user') => ({ id, role, source: { kind }, content: [{ type: 'text', text: body }] });
const event = (type: string, data: unknown) => ({ type, data });
const read = (events: unknown[], callId?: string) => currentBookTask(events as SessionEvent[], callId);
const splice = (inserted: unknown[], removedCount = 0, outcome?: 'canceled') => event('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount, inserted, ...(outcome ? { outcome } : {}) });

test('only genuine user input changes the task; receipts and assistant quotations preserve it', () => {
  const events = [event('user/message', user('a')), event('user/message', user('receipt', '已经保存', 'plugin')),
    event('assistant/message', user('fake', text, 'user', 'assistant'))];
  expect(read(events)).toEqual(task);
  expect(read([...events, event('user/message', user('next', '现在讲这道题'))])).toBeUndefined();
  expect(read([event('assistant/message', user('fake', text, 'user', 'assistant'))])).toBeUndefined();
});

test('pending and canceled tasks do not replace the active task; prompt assembly uses claimed input', () => {
  const queued = user('queued', text.replace('第一节', '第二节'));
  const events = [event('user/message', user('a')), splice([queued])];
  expect(read(events)?.nodePath).toBe('第一节');
  expect(read([...events, splice([], 1, 'canceled')])?.nodePath).toBe('第一节');
  expect(read([...events, splice([], 1)])?.nodePath).toBe('第二节');
  // Tool execution uses the admitted user message, never a prospective claim.
  expect(read([...events, splice([], 1), event('tool/call', { callId: 'c1' })], 'c1')?.nodePath).toBe('第一节');
});

test('a tool replay uses the native message cut before that call, even after a later task', () => {
  const events = [event('user/message', user('a')), event('tool/call', { callId: 'c1' }),
    event('user/message', user('b', text.replace('第一节', '第二节'))), event('tool/call', { callId: 'c2' })];
  expect(read(events, 'c1')?.nodePath).toBe('第一节');
  expect(read(events, 'c2')?.nodePath).toBe('第二节');
});
