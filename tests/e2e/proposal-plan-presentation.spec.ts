import { test, expect, enterClassroom, sendInput } from './fixtures/classroom.ts';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { PlanView } from '@studyforge/contracts/plans';
import { connectRuntime } from '../fixtures/http-runtime.ts';

test('plan confirmations show the actual dates and reading positions before saving', async ({ page, classroom }, info) => {
  const client = await connectRuntime(classroom);
  const imported = await client.rpc<MaterialView>('studyforgeMaterials/import', { input: {
    operationId: 'plan-book', material: { title: '和差公式讲义', fileName: '公式.md', mediaType: 'text/markdown' }, base64: Buffer.from('先辨认结构\n再检查象限\n').toString('base64'),
  } });
  if (!imported.ok) throw new Error('Could not import plan fixture');
  const book = imported.value;
  const source = (line: number) => ({ materialId: book.materialId, versionId: book.currentVersion.versionId, locator: { kind: 'text', start: { line, column: 0 }, end: { line, column: 4 } } });
  await enterClassroom(page, classroom.authUrl);
  await sendInput(page, '[tools]' + JSON.stringify([
    { name: 'propose_plan', arguments: { action: 'create', content: { kind: 'book', title: '两次阅读', materialId: book.materialId, entries: [
      { date: '2026-10-01', sources: [source(1)] }, { date: '2026-10-03', sources: [source(2)] },
    ] } } },
    { name: 'propose_plan', arguments: { action: 'create', content: { kind: 'campaign', title: '指定复习日', dailyCount: 9, start: '2026-10-01', end: '2026-10-03', schedule: [{ date: '2026-10-02', cards: [] }] } } },
  ]));
  const reading = page.getByTestId('inline-proposal').filter({ hasText: '两次阅读' });
  await expect(reading).toContainText('和差公式讲义');
  await expect(reading).toContainText('2026-10-01 · 阅读选段 · 第 1 行');
  await expect(reading).toContainText('2026-10-03 · 阅读选段 · 第 2 行');
  const campaign = page.getByTestId('inline-proposal').filter({ hasText: '指定复习日' });
  await expect(campaign).toContainText('2026-10-02 · 这天不安排卡片');
  await expect(campaign).not.toContainText('每天 9 张');
  await expect(reading.getByTestId('proposal-slip')).toHaveCSS('border-top-style', 'dashed');
  await page.screenshot({ path: info.outputPath('plan-confirmations.png'), fullPage: true });
  await reading.getByTestId('proposal-confirm').click();
  await expect(reading.locator('summary')).toContainText('已经保存');
  const plans = await client.rpc<PlanView[]>('studyforgeOrganization/plans', { input: {} });
  expect(plans.ok && plans.value.map(plan => plan.content.title)).toEqual(['两次阅读']);
  await campaign.getByTestId('proposal-reject').click();
  await expect(campaign.locator('summary')).toContainText('已经取消');
});
