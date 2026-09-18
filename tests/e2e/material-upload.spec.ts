/**
 * 大文件分片上传在真实浏览器里：超过单片大小的资料走 begin/chunk×N/commit
 * 通道，期间学生看到收下进度；rpc 复核字节回读，确认分片拼出的就是原文件。
 */
import { test, expect, enterClassroom, openMaterial } from './fixtures/classroom.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { MaterialBytes } from '@studyforge/contracts/material-api';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
const value = <T,>(reply: RemoteResult<T>): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value; };

function markdownOf(megabytes: number, seed: string): Buffer {
  const size = megabytes * 1024 * 1024;
  const bytes = Buffer.alloc(size);
  const line = Buffer.from(`# ${seed} 章节\n\n正文内容，逐行重复直到撑满体积。\n\n`);
  let offset = 0;
  // Whole lines only: a tail sliced mid-character is invalid UTF-8, and NUL
  // padding is refused as damaged text. Fill the remainder with newlines.
  while (offset + line.length <= size) { bytes.set(line, offset); offset += line.length; }
  bytes.fill(0x0a, offset);
  return bytes;
}

test('a large material uploads through the chunked session with visible progress', async ({ page, classroom }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const big = markdownOf(9, '大讲义');

  await enterClassroom(page, classroom.authUrl);
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  // 给每片一点延迟：否则本机三片传完早于首次断言，进度提示拍不到。
  await page.route('**/api/studyforgeMaterials/uploadChunk', route =>
    setTimeout(() => { void route.continue(); }, 400));
  const notice = page.getByTestId('materials-notice');
  await page.getByTestId('material-file-input').setInputFiles({ name: '大讲义.md', mimeType: 'text/markdown', buffer: big });

  // 分片通道的进行中提示只在上传循环里出现；整份收好后换成成功文案。
  await expect(notice).toContainText('正在收下', { timeout: 30_000 });
  await expect(notice).toContainText('收好了', { timeout: 60_000 });
  const row = page.getByTestId('material-row').filter({ hasText: '大讲义' });
  await expect(row).toBeVisible();

  // rpc 复核：列表里这份资料的字节与上传的完全一致。
  const client = await connectRuntime(classroom);
  const list = value(await client.rpc<MaterialView[]>('studyforgeMaterials/list', {}));
  const material = list.find(item => item.title === '大讲义');
  expect(material, 'uploaded material must be listed').toBeDefined();
  const bytes = value(await client.rpc<MaterialBytes>('studyforgeMaterials/bytes', { input: { materialId: material!.materialId, versionId: material!.currentVersion.versionId } }));
  expect(Buffer.from(bytes.base64, 'base64')).toEqual(big);

  // 打开还能正常读——分片拼出的字节就是原文件。
  await openMaterial(page, '大讲义');
  await expect(page.getByTestId('material-reader')).toContainText('大讲义 章节');
  await expect(errors).toEqual([]);
});
