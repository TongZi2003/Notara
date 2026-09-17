import { test, expect, enterClassroom, typeInput } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
test('thought graph is editable and navigates to native conversation without exposing debug trajectory', async ({ page, classroom }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1400, height: 900 }); await enterClassroom(page, classroom.authUrl);
  await typeInput(page, '为什么能量守恒？'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByTestId('workspace-open-thoughts').click();
  await expect(page.getByTestId('classroom-thoughts')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Trajectory', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '记一个想法', exact: true }).click();
  await page.getByRole('textbox', { name: '节点标题' }).fill('先界定系统'); await page.getByRole('textbox', { name: '节点内容' }).fill('哪些物体属于同一个系统？');
  await page.getByRole('button', { name: '保存小结', exact: true }).click();
  await page.getByTestId('thought-map').getByRole('button', { name: '先界定系统 想法' }).click();
  await expect(page.locator('.sf-thought-detail')).toContainText('哪些物体属于同一个系统');
  await page.getByRole('button', { name: '放大关系图', exact: true }).click();
  await expect(page.getByTestId('thought-map')).toHaveAttribute('data-zoom', '1.25');
  await page.getByRole('button', { name: '关闭思维图', exact: true }).click();
  await page.getByTestId('workspace-open-thoughts').click();
  await expect(page.getByTestId('thought-map')).toHaveAttribute('data-zoom', '1.25');
  await expect(page.locator('.sf-thought-detail')).toContainText('哪些物体属于同一个系统');
  await page.screenshot({ path: info.outputPath('thought-workspace.png'), fullPage: true });
  await page.getByRole('button', { name: '带入对话', exact: true }).click();
  await expect(page.locator('[data-composer-chip="studyforge-thought"]')).toContainText('先界定系统');
  expect(errors).toEqual([]);
});

test('a failed turn gives student wording while its technical message stays out of the ordinary classroom', async ({ page, classroom }) => {
  await enterClassroom(page, classroom.authUrl); await typeInput(page, '[error]');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('classroom-reply-error')).toHaveText('这次没有收到回复，可以再试一次。');
  await expect(page.getByTestId('classroom-reply-error')).not.toContainText('isolated model request failure');
});

test('an explicitly advanced conversation stage is visible as a ThoughtMap frame', async ({ page, classroom }) => {
  await enterClassroom(page, classroom.authUrl);
  await typeInput(page, '[tools]' + JSON.stringify([{ name: 'advance_conversation_stage', arguments: { title: '界定问题', summary: '先确认研究对象。', nextGoal: '写出第一个判断' } }]));
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const client = await connectRuntime(classroom);
  let lesson: string | undefined;
  await expect.poll(async () => {
    const reply = await client.rpc<{ items: { sessionId: string; running?: boolean; projections?: { values?: { agentPreset?: string } } }[] }>('session/list', { _request: {} });
    lesson = reply.ok ? reply.value.items.find(item => item.projections?.values?.agentPreset === 'studyforge-learning' && item.running === false)?.sessionId : undefined;
    return lesson;
  }, { timeout: 30_000 }).toBeTruthy();
  let trace: { frames: unknown[] } | undefined;
  await expect.poll(async () => {
    const reply = await client.rpc<{ frames: unknown[] }>('studyforgeTrace/read', { input: { sessionId: lesson } });
    trace = reply.ok ? reply.value : undefined;
    return trace;
  }, { timeout: 30_000 }).toMatchObject({ frames: [{ title: '界定问题', goal: '写出第一个判断', status: 'active' }] });
  expect(trace!.frames).toHaveLength(1);
  await page.getByTestId('workspace-open-thoughts').click();
  await expect(page.getByTestId('thought-frame')).toHaveCount(1);
  await expect(page.getByTestId('thought-frame')).toContainText('写出第一个判断');
  await expect(page.getByTestId('thought-frame')).not.toContainText(/掌握|复习/);
});

test('the stage tracker projects the in-lesson roadmap above the workspace and opens the frame', async ({ page, classroom }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, classroom.authUrl);
  await expect(page.getByTestId('stage-tracker')).toHaveCount(0);
  await typeInput(page, '[tools]' + JSON.stringify([
    { name: 'advance_conversation_stage', arguments: { title: '界定问题', summary: '先确认研究对象。', nextGoal: '写出第一个判断' } },
    { name: 'advance_conversation_stage', arguments: { title: '尝试判断', summary: '第一条判断已形成。', nextGoal: '对照反例修正判断' } },
  ]));
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const tracker = page.getByTestId('stage-tracker');
  await expect(tracker).toBeVisible({ timeout: 30_000 });
  const chips = tracker.getByTestId('stage-chip');
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(0)).toContainText('界定问题');
  await expect(chips.nth(0)).toHaveAttribute('data-status', 'completed');
  await expect(chips.nth(1)).toContainText('尝试判断');
  await expect(chips.nth(1)).toHaveAttribute('data-status', 'active');
  await expect(tracker.getByTestId('stage-goal')).toContainText('对照反例修正判断');
  await chips.nth(0).click();
  await expect(page.getByTestId('thought-frames')).toBeVisible();
  await expect(page.getByTestId('thought-frame').first()).toContainText('界定问题');
  expect(errors).toEqual([]);
});
