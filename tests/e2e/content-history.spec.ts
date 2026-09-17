import { test, expect, enterClassroom, openRoot, openMaterial } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionCreateValue, SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { MaterialView } from '@studyforge/contracts/material-records';
import { join } from 'node:path';
const value = <T,>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

test('book coverage and classroom back-links use saved ranges and actual native turns', async ({ page, classroom }, info) => {
  const client = await connectRuntime(classroom);
  const book = value(await client.rpc<MaterialView>('studyforgeMaterials/import', { input: { operationId: 'history-book', material: { title: '函数与性质', fileName: '函数.md', mediaType: 'text/markdown' }, base64: Buffer.from('定义域\n单调性\n对称性\n').toString('base64') } }));
  const source = { materialId: book.materialId, versionId: book.currentVersion.versionId, locator: { kind: 'text', start: { line: 2, column: 0 }, end: { line: 2, column: 3 } } };
  const { sessionId } = value(await client.rpc<SessionCreateValue>('session/create', { request: { cwd: join(classroom.root, 'classroom'), agentPreset: 'studyforge-learning' } }));
  value(await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: '[tools]' + JSON.stringify([
    { name: 'load_tools', arguments: { names: ['cite_materials'] } }, { name: 'read_material', arguments: { source } }, { name: 'cite_materials', arguments: { sources: [source] } },
  ]) }] } }));
  await expect.poll(async () => value(await client.rpc<SessionListValue>('session/list', { _request: {} })).items.find(row => row.sessionId === sessionId)?.running).toBe(false);
  value(await client.rpc('session/rename', { request: { sessionId, title: '第一节：单调性' } }));
  value(await client.rpc('studyforgeOrganization/saveSkeleton', { input: { operationId: 'refine-section', materialId: book.materialId, expectedVersion: 0,
    change: { nodes: [{ path: '函数/单调性', sources: [source], detail: 'refined' }] } } }));
  await page.setViewportSize({ width: 1440, height: 950 });
  await enterClassroom(page, classroom.authUrl);
  await openRoot(page, '资料');
  await openMaterial(page, '函数与性质');
  await expect(page.getByTestId('book-workspace').getByTestId('content-history')).toHaveCount(0);
  await page.getByTestId('book-workspace').getByRole('button', { name: '学习记录', exact: true }).click();
  const history = page.getByTestId('book-workspace').getByTestId('content-history').first();
  await expect(history).toContainText('已保存细化');
  await history.getByText('第一节：单调性', { exact: false }).first().click();
  await expect(history).toContainText('本课引用');
  await page.screenshot({ path: info.outputPath('content-classroom-links.png'), fullPage: true });
  await history.getByRole('button', { name: '回到这一段 →', exact: true }).first().click();
  await expect(page).toHaveURL(/#studyforge\/classroom/);
  await expect(page.locator('[data-composer-input]')).toBeVisible();
  await expect(page.locator('[data-chat-turn]').first()).toBeVisible();
});
