/**
 * 知识地图页在真实 Host 上：rpc 先种下一本书的骨架和三种归属的卡——
 * 有来源且声明 topic 的、无来源但声明 topic 的、完全没归图的——页面再从
 * `studyforgeOrganization.map` 与卡列表 remote 读出两棵真实投影。
 *
 * 断言的是可见行为：按书籍的森林默认展开、Atlas 视图把卡收在铸出的主题层
 * 和「未归图」下、点卡节点真的进卡库、图/列表形态切换、控制台无异常。
 */
import { test, expect, enterClassroom } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { CardView } from '@studyforge/contracts/cards';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
const value = <T,>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

test('knowledge map shows book forest and atlas views, navigates into cards, stays clean', async ({ page, classroom }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const client = await connectRuntime(classroom);
  const book = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: {
    operationId: 'map-book', material: { title: '三角恒等变换讲义', fileName: '三角恒等变换讲义.md', mediaType: 'text/markdown' },
    base64: Buffer.from('# 三角恒等变换讲义\n观察角之间的关系。').toString('base64'),
  } }));
  const anchor = { materialId: book.materialId, versionId: book.currentVersion.versionId, locator: { kind: 'text', start: { line: 2, column: 0 }, end: { line: 2, column: 9 } } };
  value(await client.rpc('studyforgeOrganization/saveSkeleton', { input: {
    operationId: 'map-outline', materialId: book.materialId, expectedVersion: 0,
    change: { nodes: [{ path: '三角函数', sources: [anchor] }] },
  } }));
  const seed = (operationId: string, content: Record<string, unknown>) => client.rpc<CardView>('studyforgeLearning/createCard', { input: { operationId, content } }).then(value);
  await seed('map-card-a', { title: '配角公式的用法', front: '先看目标角差。', chapter: '三角函数', topic: '数学/三角函数', sources: [anchor] });
  await seed('map-card-b', { title: '换元提醒', front: '令 t = x/2。', topic: '数学/三角函数', sources: [] });
  await seed('map-card-c', { title: '还没归图的提醒', front: '先记着。', sources: [] });

  await page.setViewportSize({ width: 1154, height: 747 });
  await enterClassroom(page, classroom.authUrl);
  await page.getByTestId('notebook-sidebar').getByRole('button', { name: '知识地图', exact: true }).click();
  await expect(page.getByTestId('studyforge-page-map')).toBeVisible();
  const canvas = page.getByTestId('map-canvas');
  const label = (title: string) => canvas.locator('.sf-mind-label', { hasText: title });

  // 按书籍（默认）：书根 → 骨架节 → 挂进书里的卡，逐级展开才可见。
  await expect(label('三角恒等变换讲义')).toBeVisible();
  await canvas.getByRole('button', { name: '展开三角恒等变换讲义' }).click();
  await canvas.getByRole('button', { name: '展开三角函数' }).click();
  await expect(label('配角公式的用法')).toBeVisible();

  // 点卡节点真的离开地图进卡库；再回来切 Atlas。
  await label('配角公式的用法').click();
  await expect(page.getByTestId('card-detail-title')).toHaveText('配角公式的用法');
  await page.getByTestId('notebook-sidebar').getByRole('button', { name: '知识地图', exact: true }).click();
  await expect(canvas).toBeVisible();

  // Atlas：铸出的主题层收两张声明卡，无归属卡进「未归图」。
  await page.getByTestId('map-view-atlas').click();
  await canvas.getByRole('button', { name: '展开三角函数' }).click();
  await expect(label('配角公式的用法')).toBeVisible();
  await expect(label('换元提醒')).toBeVisible();
  await canvas.getByRole('button', { name: '展开未归图' }).click();
  await expect(label('还没归图的提醒')).toBeVisible();

  // 列表形态画同一棵树；刷新重拉 remote 不报错。
  await page.getByTestId('map-mode-list').click();
  await expect(canvas).toHaveAttribute('data-mode', 'tree');
  await expect(label('三角函数')).toBeVisible();
  await page.getByTestId('map-reload').click();
  await expect(label('三角函数')).toBeVisible();
  expect(errors).toEqual([]);
});
