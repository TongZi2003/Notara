/**
 * P7.5 收课小结的双写：老师提案、学生改写并确认、课后更正、以及接续固定。
 *
 * 小结不是种子数据：隔离测试模型真的调用 Host 的 `propose_handoff`，Host 在提案
 * 那一刻从原生日志冻结真实输入截止点，并从真实存储冻结当时的材料/写入/待确认清单。
 * 学生看到的就是提案里那一版；确认前的改写只换正文，截止点与清单不动。确认后小结
 * 与关闭事实在同一次原生提交里写入，重启后仍在。更正写出同一记录的新不可变版本，
 * 已经把课接续在旧版上的那节固定不动。
 *
 * 运行前提：client 与 host 由主 Agent 构建（隔离运行时用已构建的 lib 快照启动）。
 * `HandoffEditor` 已经挂在课的右栏，这里就按真实学生入口读、改、并从这一版开下一节。
 */
import { test as base, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { CourseView } from '@studyforge/contracts/courses';
import type { HandoffView } from '@studyforge/contracts/handoffs';
import type { ProposalView } from '@studyforge/contracts/proposals';
import type { RouteOpenResult, RouteView } from '@studyforge/contracts/routes';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import { enterClassroom, sendInput, openRoot } from './fixtures/classroom.ts';

const test = base.extend<{ dsh: IsolatedRuntime }>({
  dsh: async ({}, use, testInfo) => {
    const runtime = await startIsolated({ testModel: true });
    try { await use(runtime); }
    finally { await runtime.stop(); await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' }); }
  },
});

type Client = Awaited<ReturnType<typeof connectRuntime>>;

function value<T>(reply: RemoteResult<T>): T {
  if (!reply.ok) throw new Error(JSON.stringify(reply.error));
  return reply.value;
}

async function dismissNotices(page: Page): Promise<void> {
  for (const name of ['Continue', 'Configure later'] as const) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.count() === 0) continue;
    try { await button.click({ timeout: 2_000 }); } catch { /* it was already gone */ }
  }
}

/** The card library, where the confirmation inbox lives. */
async function openCards(page: Page): Promise<void> {
  await dismissNotices(page);
  await openRoot(page, '资料');
  await page.getByTestId('studyforge-page-studyforge.materials').getByRole('button', { name: '卡片与笔记', exact: true }).click();
  await expect(page.getByTestId('studyforge-cards')).toBeVisible();
}

async function lessonSession(client: Client): Promise<string> {
  const list = value(await client.rpc<SessionListValue>('session/list', { _request: {} }));
  const first = list.items[0];
  if (first === undefined) throw new Error('这一节还没有会话');
  return first.sessionId;
}

/** The sessions the real adapter has already sent a prepared request for. */
async function requestSessions(dsh: IsolatedRuntime): Promise<string[]> {
  const text = await readFile(join(dsh.root, 'model-requests.jsonl'), 'utf8').catch(() => '');
  const trimmed = text.trim();
  return trimmed === '' ? [] : trimmed.split('\n').map(line => (JSON.parse(line) as { sessionId: string }).sessionId);
}

/**
 * One real close proposal. A pending card proposal is proposed first so the frozen
 * fact list is not empty: the summary has to name what was really still waiting,
 * and that fact is the real proposal record, not a string this test hands in.
 */
async function proposeClose(page: Page, dsh: IsolatedRuntime, title: string, body: string): Promise<{ client: Client; sessionId: string; handoff: ProposalView }> {
  await enterClassroom(page, dsh.authUrl);
  await sendInput(page, '老师，今天这节把单调性的判断顺序过了一遍。');
  await sendInput(page, '[tools]' + JSON.stringify([
    { name: 'propose_card', arguments: { kind: 'card', title: '先看定义域', front: '求单调区间前先做什么？', presentation: 'flashcard' } },
    { name: 'propose_handoff', arguments: { kind: 'close', title, body } },
  ]));
  const client = await connectRuntime(dsh);
  await expect.poll(async () => {
    const list = await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: {} });
    return list.ok ? list.value.length : -1;
  }, { timeout: 40_000 }).toBe(2);
  const list = value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: {} }));
  const handoff = list.find(proposal => proposal.items.some(item => item.draft.effect.kind === 'handoff'));
  if (handoff === undefined) throw new Error('propose_handoff stored nothing');
  return { client, sessionId: await lessonSession(client), handoff };
}

const handoffEffect = (proposal: ProposalView) => {
  const effect = proposal.items[0]?.draft.effect;
  if (effect === undefined || effect.kind !== 'handoff') throw new Error('expected a handoff draft');
  return effect;
};

test('学生改写小结正文后确认：截止点与清单不动，小结与关闭一次写入且重启仍在', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { client, sessionId, handoff } = await proposeClose(page, dsh, '单调性收课小结', '今天把单调性的判断顺序讲完了。');
  const frozen = handoffEffect(handoff);
  expect(frozen.cutoff.sessionId).toBe(sessionId);
  expect(frozen.cutoff.sequence).toBeGreaterThan(0);

  // Proposing closes nothing: the lesson is still running until the student decides.
  expect(value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } })).data.closure).toBeNull();

  await openCards(page);
  const card = page.getByTestId('proposal-card').filter({ hasText: '单调性收课小结' });
  await expect(card.getByTestId('proposal-item-status')).toHaveText('等你决定');
  await expect(card.getByTestId('proposal-handoff-body')).toContainText('判断顺序讲完了');
  // The Host facts are the student's to read, and the frozen note says when they were taken.
  await expect(card.getByTestId('proposal-handoff-facts')).toContainText('当时还没确认');
  await expect(card.getByTestId('proposal-handoff-facts')).toContainText('先看定义域');
  await expect(card.getByTestId('proposal-handoff-frozen')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('handoff-proposal.png'), fullPage: true });

  // The student's own wording; the teacher original stays readable beside it.
  await card.getByTestId('proposal-edit').click();
  await page.getByTestId('proposal-editor-handoff-body').fill('今天把单调性的判断顺序讲完了；下次先写定义域。');
  await page.getByTestId('proposal-editor-save').click();
  await expect(card.getByTestId('proposal-handoff-body')).toContainText('下次先写定义域');
  await card.getByTestId('proposal-show-original').click();
  await expect(card.getByTestId('proposal-original')).toContainText('判断顺序讲完了');

  await card.getByTestId('proposal-confirm').click();
  await expect(card.getByTestId('proposal-item-status')).toHaveText('已经保存');
  await expect(card.getByTestId('proposal-receipt')).toContainText('已经保存');

  // One confirmation: the summary and the closing fact are both really there, and
  // the cutoff/facts are exactly the ones the student looked at.
  const course = value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }));
  expect(course.data.closure).not.toBeNull();
  const saved = value(await client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { sessionId } }));
  expect(saved.body).toBe('今天把单调性的判断顺序讲完了；下次先写定义域。');
  expect(saved.cutoff).toEqual(frozen.cutoff);
  expect(saved.facts).toEqual(frozen.facts);
  expect(course.data.closure).toMatchObject({ handoffRef: saved.ref, handoffVersion: 1 });
  await page.screenshot({ path: testInfo.outputPath('handoff-confirmed.png'), fullPage: true });

  // A fresh boot reads the Host again: still closed, still the same wording.
  await enterClassroom(page, dsh.authUrl);
  await openCards(page);
  await expect(card.getByTestId('proposal-item-status')).toHaveText('已经保存');
  expect(value(await client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { sessionId } })).body)
    .toBe('今天把单调性的判断顺序讲完了；下次先写定义域。');
  expect(errors).toEqual([]);
});

test('更正写出新的一版，接续课固定在明确选定的旧版上', async ({ page, dsh }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { client, sessionId } = await proposeClose(page, dsh, '单调性收课小结', '今天把单调性的判断顺序讲完了。');
  await openCards(page);
  const card = page.getByTestId('proposal-card').filter({ hasText: '单调性收课小结' });
  await card.getByTestId('proposal-confirm').click();
  await expect(card.getByTestId('proposal-item-status')).toHaveText('已经保存');
  const first = value(await client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { sessionId } }));

  // The student corrects the wording: a new immutable revision on the same record.
  const corrected = value(await client.rpc<HandoffView>('studyforgeHandoffs/correct', { input: {
    operationId: crypto.randomUUID(), ref: first.ref, expectedVersion: first.version, correction: { body: '把判断顺序写得更清楚。' },
  } }));
  expect(corrected.version).toBe(2);
  expect(corrected.ref).toBe(first.ref);
  // This lesson reads its own newest wording — otherwise the student could never
  // see, re-read, or correct the text they just wrote.
  const mine = value(await client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { sessionId } }));
  expect(mine.version).toBe(2);
  // The revision the student first accepted stays readable.
  const original = value(await client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { sessionId, ref: first.ref, version: 1 } }));
  expect(original.body).toBe('今天把单调性的判断顺序讲完了。');

  // A real second lesson opens, and the student continues it from version 1 — the
  // version they chose, not "the latest one".
  const day = new Date().toISOString().slice(0, 10);
  const route = value(await client.rpc<RouteView>('studyforgeOrganization/addRouteNode', { input: { operationId: 'next', node: { title: '下一节', date: day } } }));
  const node = route.nodes.find(row => row.title === '下一节');
  if (node === undefined) throw new Error('planned node missing');
  const opened = value(await client.rpc<RouteOpenResult>('studyforgeOrganization/openPlannedLesson', { input: { operationId: 'open-next', nodeId: node.id } }));
  value(await client.rpc<HandoffView>('studyforgeHandoffs/continue', { input: {
    operationId: 'continue-next', sessionId: opened.sessionId, ref: first.ref, version: 1,
  } }));
  expect(value(await client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { sessionId: opened.sessionId } })).version).toBe(1);
  // A different version is refused rather than silently re-pointing the lesson.
  const refused = await client.rpc<HandoffView>('studyforgeHandoffs/continue', { input: {
    operationId: 'continue-again', sessionId: opened.sessionId, ref: first.ref, version: 2,
  } });
  expect(refused.ok).toBe(false);
  expect(value(await client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { sessionId: opened.sessionId } })).version).toBe(1);
  expect(errors).toEqual([]);
});

test('课后小结在课上可读可改，并能从这一版真的开出一节接续课', async ({ page, dsh }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { client, sessionId } = await proposeClose(page, dsh, '单调性收课小结', '今天把单调性的判断顺序讲完了。');

  // The lesson panel is the student's own entry: its own inbox confirms the
  // summary, and the editor under it reads, rewords and continues from it. Staying
  // in the conversation is what keeps that entry reachable — the cards page has no
  // lesson header.
  await dismissNotices(page);
  const entry = page.getByTestId('open-lesson');
  if (await entry.count() > 0) await entry.click();
  else await page.getByRole('button', { name: '本课', exact: true }).first().click();
  const panel = page.getByTestId('studyforge-lesson-panel');
  await expect(panel).toBeVisible();
  const card = panel.getByTestId('proposal-card').filter({ hasText: '单调性收课小结' });
  await card.getByTestId('proposal-confirm').click();
  await expect(card.getByTestId('proposal-item-status')).toHaveText('已经保存');

  const editor = panel.getByTestId('handoff-editor');
  await expect(editor).toBeVisible();
  await expect(editor.getByTestId('handoff-version')).toHaveText('第 1 版');
  await expect(editor.getByTestId('handoff-body')).toContainText('判断顺序讲完了');
  await expect(editor.getByTestId('handoff-frozen-note')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('handoff-editor.png'), fullPage: true });
  await editor.getByTestId('handoff-edit').click();
  await editor.getByTestId('handoff-body-input').fill('今天把单调性的判断顺序讲完了；下次先写定义域。');
  await editor.getByTestId('handoff-save').click();
  await expect(editor.getByTestId('handoff-version')).toHaveText('第 2 版');

  const latest = value(await client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { sessionId } }));
  expect(latest.version).toBe(2);
  expect(latest.body).toBe('今天把单调性的判断顺序讲完了；下次先写定义域。');
  const older = value(await client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { sessionId, ref: latest.ref, version: 1 } }));
  expect(older.body).toBe('今天把单调性的判断顺序讲完了。');
  // A correction never re-opens or re-closes the lesson.
  const course = value(await client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }));
  expect(course.data.closure?.handoffVersion).toBe(1);

  // The student really starts the next lesson from this revision. The native
  // session exists the moment the Host creates it, but the pin lands in the same
  // operation — so wait for the pin the next lesson is actually taught from
  // rather than for the session list to grow.
  await editor.getByTestId('handoff-start-next').click();
  const others = async (): Promise<string[]> => value(await client.rpc<SessionListValue>('session/list', { _request: {} }))
    .items.map(item => item.sessionId).filter(id => id !== sessionId);
  await expect.poll(async () => {
    for (const id of await others()) {
      const view = await client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { sessionId: id } });
      if (view.ok) return view.value.version;
    }
    return -1;
  }, { timeout: 30_000 }).toBe(latest.version);
  const next = (await others())[0];
  if (next === undefined) throw new Error('the continuation lesson was not opened');
  const continued = value(await client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { sessionId: next } }));
  expect(continued.ref).toBe(latest.ref);
  expect(continued.version).toBe(latest.version);
  // The root's own navigation really happened, and it lands where a student can
  // actually start: the closed lesson's panel is gone, and the composer of the new
  // lesson is a live input rather than the "choose a workspace" placeholder.
  await expect(page.getByTestId('studyforge-lesson-panel')).toHaveCount(0, { timeout: 20_000 });
  const composer = page.locator('[data-composer-input]');
  await expect(composer).toBeVisible();
  await expect(composer).toHaveAttribute('contenteditable', 'true', { timeout: 20_000 });
  // Nothing has been asked of the new lesson yet, so the message below is what
  // proves the visible composer is bound to it.
  expect(await requestSessions(dsh)).not.toContain(next);
  await sendInput(page, '接着上一节，我先自己写一遍判断过程。');
  await expect.poll(async () => (await requestSessions(dsh)).includes(next), { timeout: 30_000 }).toBe(true);
  expect(errors).toEqual([]);
});

test('同一次开课重试只开一节课，也不按日期自动顺延', async ({ page, dsh }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { client, sessionId } = await proposeClose(page, dsh, '单调性收课小结', '今天把单调性的判断顺序讲完了。');
  await openCards(page);
  const card = page.getByTestId('proposal-card').filter({ hasText: '单调性收课小结' });
  await card.getByTestId('proposal-confirm').click();
  await expect(card.getByTestId('proposal-item-status')).toHaveText('已经保存');
  const saved = value(await client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { sessionId } }));
  const routeBefore = value(await client.rpc<RouteView>('studyforgeOrganization/route', {})).nodes.length;

  const open = (operationId: string) => client.rpc<{ sessionId: string }>('studyforgeHandoffs/openContinuation', { input: {
    operationId, ref: saved.ref, version: saved.version,
  } });
  const first = value(await open('same-operation'));
  const again = value(await open('same-operation'));
  expect(again.sessionId).toBe(first.sessionId);
  expect(value(await client.rpc<HandoffView>('studyforgeHandoffs/read', { input: { sessionId: first.sessionId } })).version).toBe(saved.version);
  // Nothing was advanced by date: no route node appeared and the lesson list grew once.
  expect(value(await client.rpc<RouteView>('studyforgeOrganization/route', {})).nodes.length).toBe(routeBefore);
  expect(value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.filter(item => item.sessionId === first.sessionId)).toHaveLength(1);
  expect(errors).toEqual([]);
});
