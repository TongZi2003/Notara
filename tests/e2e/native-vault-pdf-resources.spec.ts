import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';

function cjkPdf() {
  const content = 'BT /F1 24 Tf 30 100 Td <4e2d6587516c5f0f> Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 6 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /Ascent 900 /Descent -200 /CapHeight 800 /ItalicAngle 0 /StemV 80 >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const position = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test('中文 PDF 从受限资源路由读取 CMap 并在实际阅读器中绘制文字', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const runtime = await startVaultIsolated({ testModel: true });
  const errors: string[] = [], resources: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.url().includes('/notara/vault/pdf-resources/')) resources.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  try {
    const media = join(runtime.root, 'workspace', 'vault', '媒体');
    await mkdir(media, { recursive: true }); await writeFile(join(media, '中文公式.pdf'), cjkPdf());
    await writeFile(join(media, '几何解码.pdf'), await readFile(new URL('../fixtures/jpx-geometry.pdf', import.meta.url)));
    await page.goto(runtime.authUrl);
    const later = page.getByRole('button', { name: /Configure later|稍后配置/ });
    try { await later.waitFor({ timeout: 5000 }); await later.click(); } catch { /* already acknowledged */ }
    await page.getByRole('navigation', { name: '学习导航' }).getByRole('button', { name: 'Vault', exact: true }).click();
    await page.getByRole('tab', { name: '文件', exact: true }).click();
    expect(resources).toEqual([]);
    await page.getByRole('group', { name: '文件列表' }).getByRole('button', { name: /中文公式\.pdf$/ }).click();
    const canvas = page.locator('canvas[aria-label="中文公式.pdf"]');
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => {
      const context = element.getContext('2d'); if (!context || !element.width || !element.height) return 0;
      const pixels = context.getImageData(0, 0, element.width, element.height).data;
      let dark = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! < 160 && pixels[i + 3]! > 0) dark++;
      return dark;
    }), { timeout: 20_000 }).toBeGreaterThan(200);
    expect(resources.some(row => row.startsWith('200 ') && row.includes('/cmaps/UniGB-UCS2-H.bcmap'))).toBe(true);
    expect(resources.every(row => row.startsWith('200 '))).toBe(true);
    await page.getByRole('group', { name: '文件列表' }).getByRole('button', { name: /几何解码\.pdf$/ }).click();
    const geometry = page.locator('canvas[aria-label="几何解码.pdf"]');
    await expect.poll(() => geometry.evaluate((element: HTMLCanvasElement) => {
      if (!element.width || !element.height) return false;
      const context = element.getContext('2d'); if (!context) return false;
      const pixel = context.getImageData(Math.floor(element.width * .72), Math.floor(element.height * .72), 1, 1).data;
      return pixel[0]! < 10 && pixel[1]! < 10 && pixel[2]! > 240 && pixel[3]! > 0;
    }), { timeout: 20_000 }).toBe(true);
    expect(resources.some(row => row.startsWith('200 ') && row.includes('/wasm/openjpeg.wasm'))).toBe(true);
    expect(resources.every(row => row.startsWith('200 '))).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('decoded-pdf.png') });
  } finally { await testInfo.attach('pdf-resource-requests', { body: JSON.stringify(resources), contentType: 'application/json' }); await page.close(); await runtime.stop(); }
});
