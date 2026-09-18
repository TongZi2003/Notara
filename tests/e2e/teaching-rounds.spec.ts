/**
 * 回合面板：学生可见的多角色教学回合。`round_open` 由课堂侧工具发起，
 * 学生在回合面板里写下自己的作答、请同伴看、再请助教勘误——各角色原话
 * 逐字呈现，参考标准与子会话身份永不出现在页面上。失败回合如实显示
 * 失败而不是空态或成功文案。断言可见行为与控制台零错误。
 */
import { test, expect, enterClassroom, sendInput } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
const value = <T,>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

const MATERIAL = { title: '三角恒等变换', text: '平方关系：sin²+cos²=1' };
const STANDARD = '化简时优先用平方关系，再按二倍角展开';

test('the rounds panel walks a round from question to student answer to correction, honestly', async ({ page, classroom }) => {
  test.setTimeout(180_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const client = await connectRuntime(classroom);
  await enterClassroom(page, classroom.authUrl);
  // 课堂会话在第一条消息时铸成；之后 round_open 走同一会话的 rpc 工具链。
  await sendInput(page, '上课');
  const sessions = async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.filter(s => !s.blank && s.origin !== 'subagent');
  await expect.poll(async () => (await sessions()).length).toBe(1);
  const sessionId = (await sessions())[0]!.sessionId;
  const idle = async () => { await expect.poll(async () => (await sessions()).find(s => s.sessionId === sessionId)?.running, { timeout: 60_000 }).toBe(false); };
  const open = (calls: { name: string; arguments: unknown }[]) =>
    client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tools]' + JSON.stringify(calls) }] } });

  // 空态：面板可见、如实说明还没有回合。
  await page.getByTestId('workspace-open-rounds').click();
  const panel = page.getByTestId('rounds-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('还没有出题回合');

  // 失败的出题如实记为失败——不出现题面、不出现成功文案。
  value(await open([{ name: 'round_open', arguments: { topic: '写不出题的回合', materials: [MATERIAL], standard: STANDARD } }]));
  await idle();
  await expect(panel.getByTestId('round-stage')).toContainText('出题失败');
  await expect(panel.getByTestId('round-actor-problem')).toContainText('未成功');
  await expect(panel.getByTestId('round-compose')).toHaveCount(0);

  // 正常一轮：命题帮手出题 → 阶段进入待作答，题面与落卡提示可见。
  value(await open([{ name: 'round_open', arguments: { topic: '[structured-problem] 平方关系', materials: [MATERIAL], standard: STANDARD } }]));
  await idle();
  await expect(panel.getByTestId('rounds-picker')).toHaveCount(1); // 两轮后下拉出现
  await expect.poll(async () => panel.getByTestId('round-stage').textContent(), { timeout: 15_000 }).toContain('待作答');
  await expect(panel.getByTestId('round-question')).toContainText('独立命题样题');
  await expect(panel.getByTestId('round-question')).toContainText('已收进卡片库');

  // 学生写下自己的作答 → 同伴评审原话出现，阶段进入待勘误。
  await panel.getByRole('textbox', { name: '写下自己的答案' }).fill('两边同除 cos 就能得到 tan，所以原式成立');
  await panel.getByTestId('round-submit').click();
  await expect(panel.getByTestId('round-stage')).toContainText('待勘误', { timeout: 60_000 });
  await expect(panel.getByTestId('round-answer')).toContainText('两边同除 cos 就能得到 tan');
  await expect(panel.getByTestId('round-actor-peer')).toContainText('已完成');
  await expect(panel.getByTestId('round-actor-peer').locator('.sf-round-actor-text')).toContainText('两边同除 cos 就能得到 tan');

  // 请助教勘误 → 三个角色全部完成，助教原话可见。
  await panel.getByTestId('round-correct').click();
  await expect(panel.getByTestId('round-stage')).toContainText('已完成', { timeout: 60_000 });
  await expect(panel.getByTestId('round-actor-assistant')).toContainText('已完成');
  await expect(panel.getByTestId('round-actor-assistant').locator('.sf-round-actor-text')).toBeVisible();

  // 子会话身份永不上屏；参考标准只可能出现在助教勘误原话里（作答早已锁定）。
  await expect(panel).not.toContainText('childId');
  expect(errors).toEqual([]);
});
