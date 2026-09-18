/**
 * 知识地图页内编辑：菜单（改名/移动到/新建子层/删除）与画布拖拽都走
 * previewAtlas → 影响确认 → saveAtlas 的确认链；卡拖到主题层改自己的
 * topic。断言树形变化、rpc 侧卡 topic 级联、删除的 detach 闸与控制台零错误。
 */
import { test, expect, enterClassroom } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { CardView } from '@studyforge/contracts/cards';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
const value = <T,>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

test('atlas nodes can be renamed, moved, dropped onto and removed through preview+confirm', async ({ page, classroom }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const client = await connectRuntime(classroom);
  const seed = (operationId: string, content: Record<string, unknown>) => client.rpc<CardView>('studyforgeLearning/createCard', { input: { operationId, content } }).then(value);
  const cardA = await seed('edit-card-a', { title: '三角函数卡', front: '题面A', presentation: 'problem', sections: [{ heading: '解答', body: '解' }], topic: '数学/三角函数', sources: [], tags: [], links: [] });
  // AtlasDeriver 只铸精确声明的路径：'科学' 得有一张卡直接声明它才存在。
  await seed('edit-card-b', { title: '科学卡', front: '题面B', presentation: 'problem', sections: [{ heading: '解答', body: '解' }], topic: '科学', sources: [], tags: [], links: [] });
  const cardC = await seed('edit-card-c', { title: '无归属卡', front: '题面C', presentation: 'problem', sections: [{ heading: '解答', body: '解' }], sources: [], tags: [], links: [] });
  const topicOf = async (ref: string): Promise<string | undefined> =>
    value(await client.rpc<CardView[]>('studyforgeLearning/cards', {})).find(card => card.ref === ref)?.content.topic;

  await enterClassroom(page, classroom.authUrl);
  await page.getByTestId('notebook-sidebar').getByRole('button', { name: '知识地图', exact: true }).click();
  await page.getByTestId('map-view-atlas').click();
  const canvas = page.getByTestId('map-canvas');
  const node = (key: string) => canvas.locator(`.sf-mindmap-node[data-key="${key}"]`);
  const label = (title: string) => canvas.locator('.sf-mind-label', { hasText: title });
  // 铸出的层都是顶层节点（父路径没声明过就不存在中间层）。
  await expect(node('topic:数学/三角函数')).toBeVisible();
  await expect(node('topic:科学')).toBeVisible();

  // 菜单·改名：影响面板显示会移动的卡，确认后 repath 级联卡 topic。
  await node('topic:数学/三角函数').getByRole('button', { name: '改名' }).click();
  const panel = page.getByTestId('atlas-edit');
  await expect(panel).toBeVisible();
  await panel.getByTestId('atlas-edit-input').fill('恒等变形');
  await panel.getByTestId('atlas-preview-run').click();
  await expect(panel.getByTestId('atlas-impact')).toContainText('1 张卡的归属会随之调整');
  await panel.getByTestId('atlas-save-run').click();
  await expect(panel).toHaveCount(0);
  await expect(node('topic:数学/恒等变形')).toBeVisible();
  await expect.poll(() => topicOf(cardA.ref)).toBe('数学/恒等变形');

  // 画布拖拽：把「恒等变形」拖到「科学」上——预填的移动草稿仍走预览确认。
  await canvas.getByRole('button', { name: '展开科学' }).click();
  const handle = node('topic:数学/恒等变形').getByRole('button', { name: '移动恒等变形' });
  const target = await node('topic:科学').boundingBox();
  const origin = await handle.boundingBox();
  await page.mouse.move(origin!.x + origin!.width / 2, origin!.y + origin!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('atlas-edit-target')).toHaveValue('科学');
  await panel.getByTestId('atlas-preview-run').click();
  await expect(panel.getByTestId('atlas-impact')).toBeVisible();
  await panel.getByTestId('atlas-save-run').click();
  await expect(panel).toHaveCount(0);
  await expect(node('topic:科学/恒等变形')).toBeVisible();
  await expect.poll(() => topicOf(cardA.ref)).toBe('科学/恒等变形');

  // 卡叶拖到主题层：直接改卡的 topic，不经预览。「未归图」默认折叠先展开。
  await canvas.getByRole('button', { name: '展开未归图' }).click();
  const cardHandle = canvas.locator('.sf-mindmap-node[data-kind=card]', { hasText: '无归属卡' }).getByRole('button', { name: '移动无归属卡' });
  const cardBox = await cardHandle.boundingBox();
  const targetBox = await node('topic:科学').boundingBox();
  await page.mouse.move(cardBox!.x + cardBox!.width / 2, cardBox!.y + cardBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => topicOf(cardC.ref)).toBe('科学');

  // 菜单·删除：有卡挂在层上时预览要求显式 detach，确认后卡回「未归图」。
  await node('topic:科学/恒等变形').getByRole('button', { name: '删除' }).click();
  await panel.getByTestId('atlas-preview-run').click();
  await expect(panel.getByTestId('atlas-impact')).toBeVisible();
  await expect(panel.getByTestId('atlas-save-run')).toBeDisabled();
  await panel.getByTestId('atlas-detach').check();
  await panel.getByTestId('atlas-save-run').click();
  await expect(panel).toHaveCount(0);
  await expect.poll(() => topicOf(cardA.ref)).toBeUndefined();
  // 「未归图」展开态按 key 保留在 MapPage 状态里，组空了又回来仍是展开的。
  await expect(label('三角函数卡')).toBeVisible();

  // 菜单·新建子层：refined 层出现在树上。
  await node('topic:科学').getByRole('button', { name: '新建子层' }).click();
  await panel.getByTestId('atlas-edit-input').fill('波动光学');
  await panel.getByTestId('atlas-preview-run').click();
  await panel.getByTestId('atlas-save-run').click();
  await expect(panel).toHaveCount(0);
  await expect(node('topic:科学/波动光学')).toBeVisible();
  expect(errors).toEqual([]);
});
