/**
 * P7.5 原生全链：这套隔离 DSH 运行时里跑完整条链，不是领域夹具。
 *
 * 收课、课后继续说话、同日日历/日报、从选定的一版开下一节课、以及下一节课真实
 * 出站请求里带着的那一版固定小结——每一步都走真实的 Host、真实的原生会话与真实
 * 的模型请求日志（`model-requests.jsonl`）。日历的 `participation` 只有学生真的
 * 说过话才会出现，所以这一条也在验证 `NativeCalendar` 的原生 preset 过滤。
 *
 * 与 `coauthor-handoff.spec.ts` 的分工：那边验学生界面（提案卡、课后小结编辑器），
 * 这边验原生运行时本身，不经过浏览器组件。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { CalendarDay, DailyReport } from '@studyforge/contracts/calendar';
import type { CourseView } from '@studyforge/contracts/courses';
import type { HandoffView } from '@studyforge/contracts/handoffs';
import type { ProposalView } from '@studyforge/contracts/proposals';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import { enterClassroom, sendInput } from './fixtures/classroom.ts';

const ZONE = 'Asia/Shanghai';

const test = base.extend<{ dsh: IsolatedRuntime }>({
  dsh: async ({}, use, testInfo) => {
    const runtime = await startIsolated({ testModel: true });
    try { await use(runtime); }
    finally { await runtime.stop(); await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' }); }
  },
});

type Client = Awaited<ReturnType<typeof connectRuntime>>;

/** One request row the isolated test model really wrote, with its own session. */
interface RequestRow { readonly sessionId: string; readonly purpose: string; readonly messages: readonly { readonly role: string; readonly content: readonly { readonly type: string; readonly text?: string }[] }[] }

function value<T>(reply: RemoteResult<T>): T {
  if (!reply.ok) throw new Error(JSON.stringify(reply.error));
  return reply.value;
}

function localDay(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const read = (type: string): string => parts.find(part => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

/** Every request the real adapter sent, in order — the prepared prompt, not a fixture. */
async function requests(dsh: IsolatedRuntime): Promise<RequestRow[]> {
  const text = await readFile(join(dsh.root, 'model-requests.jsonl'), 'utf8').catch(() => '');
  const trimmed = text.trim();
  return trimmed === '' ? [] : trimmed.split('\n').map(line => JSON.parse(line) as RequestRow);
}

function textOf(row: RequestRow): string {
  return row.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text ?? ''] : [])).join('\n');
}

async function lessonSession(client: Client, exclude?: string): Promise<string> {
  const item = value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items
    .find(row => row.sessionId !== exclude && row.origin !== 'subagent');
  if (item === undefined) throw new Error('这一节还没有会话');
  return item.sessionId;
}

async function day(client: Client, date: string): Promise<CalendarDay> {
  return value(await client.rpc<CalendarDay>('studyforgeCalendar/day', { query: { date, timeZone: ZONE } }));
}

test('原生收课→课后输入→同日日历日报→从这版开下一节并固定 pin', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, dsh.authUrl);
  const client = await connectRuntime(dsh), date = localDay();

  // 1. 学生真的先说话，老师才可能收课。
  await sendInput(page, '老师，今天这节把单调性的判断顺序过了一遍。');
  await expect.poll(async () => (await requests(dsh)).some(row => textOf(row).includes('单调性的判断顺序')),
    { timeout: 40_000 }).toBe(true);
  const sessionId = await lessonSession(client);

  // 2. 老师用真实工具提案收课；提案不是保存。
  await sendInput(page, '[tool]' + JSON.stringify({ name: 'propose_handoff', arguments: {
    kind: 'close', title: '单调性收课小结', body: '今天把单调性的判断顺序讲完了。',
  } }));
  await expect.poll(async () => {
    const list = await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } });
    return list.ok ? list.value.length : -1;
  }, { timeout: 40_000 }).toBe(1);
  const proposal = value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } }))[0]!;
  const item = proposal.items[0]!;
  expect(value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } })).data.closure).toBeNull();

  // 3. 学生确认：小结与关闭事实同一次写入。
  value(await client.rpc<ProposalView>('studyforgeProposals/confirm', { input: {
    operationId: crypto.randomUUID(), target: proposal.ref,
    selection: { revision: proposal.version, items: [{
      itemId: item.id, draft: item.draft.revision, digest: item.draft.digest, target: item.target, baseline: item.baseline,
    }] },
  } }));
  const saved = value(await client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { sessionId } }));
  expect(saved.version).toBe(1);
  expect(value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } })).data.closure)
    .toMatchObject({ handoffRef: saved.ref, handoffVersion: 1 });

  // 4. 关课后同一节课里学生继续说话：课仍然可讨论，状态不回滚。
  await sendInput(page, '关课以后我又想到一个反例，明天想试一下。');
  await expect.poll(async () => (await requests(dsh)).some(row => row.sessionId === sessionId && textOf(row).includes('反例')),
    { timeout: 40_000 }).toBe(true);

  // 5. 同一天的日历与日报都看到这节课的真实参与，以及真的存下来的小结。
  await expect.poll(async () => (await day(client, date)).activity.some(row => row.kind === 'participation' && row.target === 'session:' + sessionId),
    { timeout: 30_000 }).toBe(true);
  const today = await day(client, date);
  expect(today.activity.some(row => row.kind === 'handoff' && row.target === saved.ref)).toBe(true);
  const report = value(await client.rpc<DailyReport>('studyforgeCalendar/report', { query: { date, timeZone: ZONE } }));
  expect(report.day.date).toBe(today.date);
  expect(report.day.activity).toEqual(today.activity);
  await testInfo.attach('calendar-day.json', { body: JSON.stringify(today, null, 2), contentType: 'application/json' });

  // 6. 从学生读到的那一版开一节真实原生课；同一次开课重试还是同一节。
  const open = (operationId: string) => client.rpc<{ sessionId: string }>('studyforgeHandoffs/openContinuation', { input: {
    operationId, ref: saved.ref, version: saved.version,
  } });
  const next = value(await open('native-next'));
  expect(next.sessionId).not.toBe(sessionId);
  expect(value(await open('native-next')).sessionId).toBe(next.sessionId);
  expect(value(await client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { sessionId: next.sessionId } })).version).toBe(1);

  // 7. 新课里真实发言：没有这句话，preset 过滤不会把它算进这一天。
  expect((await day(client, date)).activity.some(row => row.target === 'session:' + next.sessionId)).toBe(false);
  value(await client.rpc('session/prompt', { request: { requestId: crypto.randomUUID(), sessionId: next.sessionId,
    mode: 'queue', content: [{ type: 'text', text: '接着上一节，我先自己把判断过程写一遍。' }], clientTimeZone: ZONE } }));
  await expect.poll(async () => (await requests(dsh)).some(row => row.sessionId === next.sessionId), { timeout: 40_000 }).toBe(true);
  await expect.poll(async () => (await day(client, date)).activity.some(row => row.target === 'session:' + next.sessionId),
    { timeout: 30_000 }).toBe(true);

  // 8. 新课真实的 prepared request 里，系统提示带着固定下来的那一版小结。
  const prepared = (await requests(dsh)).find(row => row.sessionId === next.sessionId);
  if (prepared === undefined) throw new Error('新的一节没有发出真实请求');
  const prompt = textOf(prepared);
  expect(prompt).toContain('上一课的小结：《单调性收课小结》第 1 版');
  expect(prompt).toContain('今天把单调性的判断顺序讲完了。');
  await testInfo.attach('continuation-request.txt', { body: prompt, contentType: 'text/plain' });
  expect(errors).toEqual([]);
});
