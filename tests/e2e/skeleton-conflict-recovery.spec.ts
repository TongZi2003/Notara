import { test as base, expect } from '@playwright/test';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { ProposalView } from '@studyforge/contracts/proposals';
import type { SkeletonView } from '@studyforge/contracts/skeleton';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import { enterClassroom, sendInput, openCards } from './fixtures/classroom.ts';
const test = base.extend<{ dsh: IsolatedRuntime }>({ dsh: async ({}, use) => {
  const runtime = await startIsolated({ testModel: true });
  try { await use(runtime); } finally { await runtime.stop(); }
} });
function value<T>(result: RemoteResult<T>): T { if (!result.ok) throw new Error(JSON.stringify(result.error)); return result.value; }

test('a stale directory proposal rechecks the current tree and waits for a new confirmation', async ({ page, dsh }, testInfo) => {
  const client = await connectRuntime(dsh);
  const book = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: 'book', material: { title: '公式', fileName: '公式.md', mediaType: 'text/markdown' }, base64: Buffer.from('公式\n').toString('base64') } }));
  const node = (path: string) => ({ path, sources: [{ materialId: book.materialId, versionId: book.currentVersion.versionId, locator: { kind: 'text', start: { line: 1, column: 0 }, end: { line: 1, column: 2 } } }] });
  await enterClassroom(page, dsh.authUrl);
  await sendInput(page, '[tools]' + JSON.stringify([{ name: 'read_skeleton', arguments: { materialId: book.materialId } }, { name: 'propose_skeleton', arguments: { materialId: book.materialId, change: { nodes: [node('和差公式/直接求值')] } } }]));
  await expect.poll(async () => value(await client.rpc<ProposalView[]>('studyforgeProposals/list', { input: {} })).length).toBe(1);
  value(await client.rpc('studyforgeOrganization/saveSkeleton', { input: { operationId: 'other-save', materialId: book.materialId, expectedVersion: 0, change: { nodes: [node('和差公式'), node('二倍角')] } } }));
  await openCards(page);
  const card = page.getByTestId('studyforge-page-studyforge.cards').getByTestId('proposal-card');
  await card.getByTestId('proposal-confirm').click();
  await expect(card.getByTestId('proposal-failure')).toContainText('目录已更新');
  await expect(card).not.toContainText('可能已经保存');
  await expect(card.getByTestId('proposal-retry')).toHaveCount(0);
  await card.getByRole('button', { name: '重新检查目录', exact: true }).click();
  await expect(card.getByTestId('proposal-notice')).toBeVisible();
  await expect(card.getByTestId('proposal-item-status'), await card.getByTestId('proposal-notice').innerText()).toHaveText('等你决定');
  await expect(card.getByTestId('skeleton-recheck-preview')).toContainText('二倍角');
  await expect(card.getByTestId('skeleton-recheck-preview')).toContainText('和差公式/直接求值');
  expect(value(await client.rpc<SkeletonView>('studyforgeMaterials/skeleton', { input: { materialId: book.materialId } })).revision).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('directory-rechecked.png'), fullPage: true });
  await card.getByTestId('proposal-confirm').click();
  await expect(card.getByTestId('proposal-item-status')).toHaveText('已经保存');
  const saved = value(await client.rpc<SkeletonView>('studyforgeMaterials/skeleton', { input: { materialId: book.materialId } }));
  expect(saved).toMatchObject({ revision: 2 });
  expect(saved.nodes.map(node => node.path)).toEqual(['和差公式', '二倍角', '和差公式/直接求值']);
});
