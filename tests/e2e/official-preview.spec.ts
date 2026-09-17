/**
 * P3.2 on a real Host: the materials page reads originals with the shared
 * format adapter (no session, no lesson, no model message), and a lesson opens
 * the same original in the native rightbar through the native address.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import type { SessionListValue } from '@deepseek-ai/dsh-api-session-controller';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from '../fixtures/http-runtime.ts';
import { enterClassroom, sendInput } from './fixtures/classroom.ts';
import { readerImage } from '../fixtures/materials/reader-image.ts';
import { scannedPdf } from '../fixtures/materials/synthetic-pdf.ts';

const test = base.extend<{ runtime: IsolatedRuntime }>({
  runtime: async ({}, use, testInfo) => {
    const runtime = await startIsolated({ testModel: true });
    try { await use(runtime); }
    finally { await runtime.stop(); await testInfo.attach('native-host-log', { body: runtime.log(), contentType: 'text/plain' }); }
  },
});

const MARKDOWN = [
  '# 三角函数笔记',
  '',
  '正弦与余弦的和角公式：',
  '',
  '$$\\sin(a+b)=\\sin a\\cos b+\\cos a\\sin b$$',
  '',
  '| 角 | 值 |',
  '| --- | --- |',
  '| 30° | 1/2 |',
  '',
].join('\n');

/** One finished turn leaves a real Session on stage for the rightbar to resolve against. */
async function startLesson(page: Page, runtime: IsolatedRuntime): Promise<void> {
  await enterClassroom(page, runtime.authUrl);
  await sendInput(page, '请讲解一次函数');
  await expect.poll(async () => existsSync(join(runtime.root, 'model-requests.jsonl')), { timeout: 30_000 }).toBe(true);
}

/** Lines the model was actually asked for; a reader sends none. */
async function modelRequestLines(runtime: IsolatedRuntime): Promise<number> {
  const path = join(runtime.root, 'model-requests.jsonl');
  if (!existsSync(path)) return 0;
  return (await readFile(path, 'utf8')).split('\n').filter(line => line.trim() !== '').length;
}

type NativeClient = Awaited<ReturnType<typeof connectRuntime>>;

/**
 * What the page really shows: the box the student sees, next to the pixels the
 * canvas holds. A page that keeps its proportions has the same ratio in both,
 * and a zoom that only repaints pixels without growing the box is not a zoom.
 */
async function shownPage(page: Page): Promise<{ width: number; height: number; ratio: number; pixelRatio: number }> {
  return page.getByTestId('pdf-canvas').evaluate(canvas => {
    const element = canvas as HTMLCanvasElement;
    const box = element.getBoundingClientRect();
    return {
      width: box.width, height: box.height,
      ratio: box.height === 0 ? 0 : box.width / box.height,
      pixelRatio: element.height === 0 ? 0 : element.width / element.height,
    };
  });
}

function value<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/**
 * Every Session the native store actually holds, sorted. Reading a file must not
 * add one: the classroom page filters blanks out of its own list, so comparing
 * native ids is the only honest way to see a lesson that was never opened.
 */
/**
 * Open one original from the shelf. The 资料 page is a full-width shelf until a
 * book is chosen; the reader is then its own page with a 返回资料 button.
 */
async function openMaterial(page: Page, title: string): Promise<void> {
  await page.getByTestId('material-row').filter({ hasText: title }).getByRole('button', { name: `预览：${title}`, exact: true }).click();
  await page.getByTestId('library-detail').getByRole('button', { name: '阅读原文', exact: true }).click();
  await expect(page.getByTestId('material-reader')).toBeVisible();
}

async function nativeSessionIds(client: NativeClient): Promise<string[]> {
  const listed = value(await client.rpc<SessionListValue>('session/list', { _request: {} }));
  return listed.items.map(row => row.sessionId).sort();
}

/**
 * Every record file the Host's own workspace store holds, with its size. Reading
 * a book must not write one — the skeleton of an unbroken book does not exist
 * yet, and this reader has no way to create it.
 */
async function recordFiles(workspace: string): Promise<string[]> {
  const dataRoot = join(workspace, '.studyforge');
  if (!existsSync(dataRoot)) return [];
  const found: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await walk(path); continue; }
      found.push(`${relative(dataRoot, path)}:${String((await stat(path)).size)}`);
    }
  };
  await walk(dataRoot);
  return found.sort();
}

/** A structurally valid PDF of `pages` blank pages, each with its own content stream. */
function blankPdf(pages: number): Buffer {
  const objects: string[] = [];
  const kids = Array.from({ length: pages }, (_, index) => `${String(3 + index)} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${String(pages)} >>`);
  for (let index = 0; index < pages; index += 1) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents ${String(3 + pages + index)} 0 R >>`);
  }
  for (let index = 0; index < pages; index += 1) objects.push('<< /Length 0 >>\nstream\n\nendstream');
  return serializePdf(objects);
}

/**
 * The document opens and reports one page, but the page dictionary's kid points
 * at an object that is not a page, so pdf.js fails while *producing the page*.
 * That is a page-stage failure inside a readable file, not a damaged header.
 */
function undrawablePdf(): Buffer {
  return serializePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 4 >>\nstream\nzzzz\nendstream',
  ]);
}

/** Cross-referenced single-generation PDF from object bodies, 1-based. */
function serializePdf(objects: readonly string[]): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  let size = parts[0]?.length ?? 0;
  for (const [index, body] of objects.entries()) {
    offsets.push(size);
    const text = `${String(index + 1)} 0 obj\n${body}\nendobj\n`;
    parts.push(Buffer.from(text));
    size += Buffer.byteLength(text);
  }
  const xref = ['xref', `0 ${String(objects.length + 1)}`, '0000000000 65535 f ',
    ...offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n `)].join('\n');
  parts.push(Buffer.from(`${xref}\ntrailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(size)}\n%%EOF\n`));
  return Buffer.concat(parts);
}

test('the materials page reads a Chinese formula note and an image without a lesson or a model call', async ({ page, runtime }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const note = testInfo.outputPath('三角函数笔记.md');
  const image = testInfo.outputPath('函数图像.png');
  await writeFile(note, MARKDOWN, 'utf8');
  await writeFile(image, readerImage('png'));

  await enterClassroom(page, runtime.authUrl);
  const client = await connectRuntime(runtime);
  const sessionsBefore = await nativeSessionIds(client);
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await page.getByTestId('material-file-input').setInputFiles(note);
  await openMaterial(page, '三角函数笔记');

  // Markdown keeps its structure: a real heading, a real table, and TeX through KaTeX.
  const markdown = page.getByTestId('material-markdown');
  await expect(markdown.getByRole('heading', { name: '三角函数笔记' })).toBeVisible();
  await expect(markdown.locator('table')).toBeVisible();
  await expect(markdown.locator('.katex').first()).toBeVisible();
  // P6 adds a book root and an explicit breakdown action. Merely opening the
  // book still creates no section, lesson, model request or learning fact.
  await expect(page.getByTestId('book-nodes').locator('[data-kind]')).toHaveCount(1);
  await page.getByTestId('book-nodes').locator('[data-kind="book"]').getByTestId('mindmap-node').click();
  await expect(page.getByRole('button', { name: '细分目录', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '拆成题卡', exact: true })).toBeVisible();
  // The formula note is photographed on its own, before the reader switches files.
  await page.screenshot({ path: testInfo.outputPath('materials-read-md.png'), fullPage: true });

  // The image is decoded from its own bytes at the real size of the original.
  await page.getByTestId('materials-back').click();
  await page.getByTestId('material-file-input').setInputFiles(image);
  await openMaterial(page, '函数图像');
  const shown = page.getByTestId('material-image');
  await expect(shown).toBeVisible();
  expect(await shown.evaluate(element => {
    const img = element as HTMLImageElement;
    return [img.naturalWidth, img.naturalHeight];
  })).toEqual([900, 560]);
  await expect(shown).toBeInViewport();
  await expect.poll(async () => (await shown.boundingBox())?.width ?? 0).toBeGreaterThan(200);
  await page.screenshot({ path: testInfo.outputPath('materials-read.png'), fullPage: true });

  // Narrow viewport: the same original stays readable instead of collapsing.
  await page.setViewportSize({ width: 390, height: 844 });
  await shown.scrollIntoViewIfNeeded();
  await expect(shown).toBeInViewport();
  // The shell's own sidebar collapses to a rail below its breakpoint; until that
  // lands, the reader is squeezed into a sliver. Wait for the real layout, then
  // photograph it.
  await expect.poll(async () => (await shown.boundingBox())?.width ?? 0).toBeGreaterThan(200);
  await page.screenshot({ path: testInfo.outputPath('materials-read-narrow.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });

  // Reading the same book again, with both files already in the library, adds
  // no record of its own: an unbroken book's skeleton is absent, not guessed.
  const recordsAfterImport = await recordFiles(join(runtime.root, 'classroom'));
  await page.getByTestId('materials-back').click();
  await openMaterial(page, '三角函数笔记');
  await expect(page.getByTestId('material-markdown')).toBeVisible();
  expect(await recordFiles(join(runtime.root, 'classroom'))).toEqual(recordsAfterImport);

  // Reading is not talking: the native session set is untouched (a page that
  // filters blanks cannot show this), and no model was called.
  expect(await nativeSessionIds(client)).toEqual(sessionsBefore);
  await page.getByRole('button', { name: '课程', exact: true }).first().click();
  await expect(page.getByTestId('studyforge-page-studyforge.courses')).toContainText('暂无课程');
  expect(await modelRequestLines(runtime)).toBe(0);
  expect(errors).toEqual([]);
});

test('paging and zooming show only finished pages, and a page that cannot be drawn says so', async ({ page, runtime }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const raster = readerImage('jpeg');
  const scan = testInfo.outputPath('扫描件.pdf');
  const blank = testInfo.outputPath('六页.pdf');
  const undrawable = testInfo.outputPath('画不出的页.pdf');
  await writeFile(scan, scannedPdf(raster, 900, 560));
  await writeFile(blank, blankPdf(6));
  await writeFile(undrawable, undrawablePdf());

  await enterClassroom(page, runtime.authUrl);
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await page.getByTestId('material-file-input').setInputFiles(scan);
  await openMaterial(page, '扫描件');

  const viewer = page.getByTestId('pdf-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveAttribute('data-pdf-displayed-page', '1');
  await expect.poll(async () => page.getByTestId('pdf-canvas').evaluate(canvas => (canvas as HTMLCanvasElement).width)).toBeGreaterThan(0);
  // A drawn page with real content, not one flat colour block.
  const drawn = await page.getByTestId('pdf-canvas').evaluate(canvas => {
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext('2d');
    if (!context || element.width === 0) return { width: element.width, colours: 0 };
    const { data } = context.getImageData(0, 0, element.width, element.height);
    const colours = new Set<string>();
    for (let index = 0; index < data.length; index += 4 * 37) colours.add(`${String(data[index])},${String(data[index + 1])},${String(data[index + 2])}`);
    return { width: element.width, colours: colours.size };
  });
  expect(drawn.width).toBeGreaterThan(0);
  expect(drawn.colours).toBeGreaterThan(8);

  // The displayed page keeps the canvas's own proportions (no width-only squeeze).
  const fitted = await shownPage(page);
  expect(Math.abs(fitted.ratio - fitted.pixelRatio) / fitted.pixelRatio).toBeLessThan(0.02);
  const boxWidth = await page.getByTestId('pdf-page-box').boundingBox();

  // Zooming changes the size on screen, not just the pixels behind it.
  const scaleShown = Number(await viewer.getAttribute('data-pdf-displayed-scale'));
  await page.getByTestId('pdf-zoom-in').click();
  await expect(viewer).toHaveAttribute('data-pdf-displayed-scale', String(Number((scaleShown + 0.2).toFixed(2))));
  await expect.poll(async () => (await shownPage(page)).width).toBeGreaterThan(fitted.width * 1.05);
  const zoomed = await shownPage(page);
  expect(Math.abs(zoomed.ratio - zoomed.pixelRatio) / zoomed.pixelRatio).toBeLessThan(0.02);

  // And the fit control puts the page back inside its own column.
  await page.getByTestId('pdf-fit').click();
  await expect.poll(async () => (await shownPage(page)).width).toBeLessThanOrEqual((boxWidth?.width ?? 0) + 1);
  await expect.poll(async () => (await shownPage(page)).width).toBeCloseTo(fitted.width, 0);
  const refitted = await shownPage(page);
  expect(Math.abs(refitted.ratio - refitted.pixelRatio) / refitted.pixelRatio).toBeLessThan(0.02);

  await page.getByTestId('pdf-next').click();
  await expect(viewer).toHaveAttribute('data-pdf-displayed-page', '2');
  await expect(page.getByTestId('pdf-page')).toHaveText('第 2 / 2 页');
  await page.screenshot({ path: testInfo.outputPath('materials-pdf.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('pdf-canvas').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('pdf-canvas')).toBeInViewport();
  // Fit-to-width makes the page itself narrower here; what must not stay narrow
  // is the reader column the shell hands it.
  await expect.poll(async () => (await page.getByTestId('pdf-viewer').boundingBox())?.width ?? 0).toBeGreaterThan(200);
  // A wider page in a narrow column still keeps its proportions.
  const narrow = await shownPage(page);
  expect(Math.abs(narrow.ratio - narrow.pixelRatio) / narrow.pixelRatio).toBeLessThan(0.02);
  await page.screenshot({ path: testInfo.outputPath('materials-pdf-narrow.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });

  // Six pages, five fast turns: only the finished last page may be on screen.
  await page.getByTestId('materials-back').click();
  await page.getByTestId('material-file-input').setInputFiles([blank, undrawable]);
  await openMaterial(page, '六页');
  await expect(viewer).toHaveAttribute('data-pdf-displayed-page', '1');
  for (let turn = 0; turn < 5; turn += 1) await page.getByTestId('pdf-next').click({ delay: 0 });
  await expect(viewer).toHaveAttribute('data-pdf-requested-page', '6');
  await expect(viewer).toHaveAttribute('data-pdf-displayed-page', '6', { timeout: 20_000 });
  await expect(page.getByTestId('pdf-page')).toHaveText('第 6 / 6 页');
  // Still at fit-width after paging: the new page is framed like the others.
  await expect(viewer).toHaveAttribute('data-pdf-displayed-scale', /[0-9]/);

  // A page whose own content cannot be decoded is a failure, not a stale page.
  await page.getByTestId('materials-back').click();
  await openMaterial(page, '画不出的页');
  await expect(page.getByTestId('pdf-page-failed')).toBeVisible({ timeout: 20_000 });
  await expect(viewer).not.toHaveAttribute('data-pdf-displayed-page', /\d/);
  expect(await page.getByTestId('pdf-canvas').evaluate(canvas => (canvas as HTMLCanvasElement).width === 0 || (canvas as HTMLCanvasElement).getContext('2d')?.getImageData(0, 0, 1, 1).data[3] === 0)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('materials-pdf-failure.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('a corrupt file is refused with a next action instead of a blank reader', async ({ page, runtime }, testInfo) => {
  const broken = testInfo.outputPath('损坏的笔记.md');
  await writeFile(broken, Buffer.from([0xff, 0xfe, 0x00, 0x41, 0x00]));

  await enterClassroom(page, runtime.authUrl);
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await page.getByTestId('material-file-input').setInputFiles(broken);
  await expect(page.getByTestId('materials-notice')).toContainText('读不出来');
  await expect(page.getByTestId('material-row')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('materials-corrupt.png'), fullPage: true });
});

test('the sandboxed HTML cannot reach the application, and a lesson opens the same original in the native rightbar', async ({ page, runtime }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const htmlPath = testInfo.outputPath('讲义.html');
  const note = testInfo.outputPath('和角公式.md');
  await writeFile(htmlPath, '<!doctype html><title>讲义</title><h1>讲义</h1><script>document.title="ran"</script>', 'utf8');
  await writeFile(note, MARKDOWN, 'utf8');
  await startLesson(page, runtime);

  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await page.getByTestId('material-file-input').setInputFiles(htmlPath);
  await openMaterial(page, '讲义');
  const frame = page.getByTestId('material-html');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  // The check has to run *inside* the frame: the iframe runs with an opaque
  // origin, so reading the parent's location from there throws.
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  const child = page.frames().find(candidate => candidate !== page.mainFrame());
  const reach = await child?.evaluate(() => {
    try { return String(parent.location.href); } catch { return 'blocked'; }
  });
  expect(reach).toBe('blocked');

  // The same page's own action opens the real lesson's native column, and reading
  // sends nothing new to the model.
  const before = await modelRequestLines(runtime);
  await page.getByTestId('materials-back').click();
  await page.getByTestId('material-file-input').setInputFiles(note);
  await openMaterial(page, '和角公式');
  await page.getByTestId('material-open-classroom').click();
  // Opening in the classroom lands in the lesson's own workspace pane, not the
  // retired native rightbar.
  const panel = page.getByTestId('studyforge-lesson-panel');
  await expect(panel.getByText('和角公式', { exact: false }).first()).toBeVisible();
  await expect(panel.getByRole('heading', { name: '三角函数笔记' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('classroom-official-preview.png'), fullPage: true });
  expect(await modelRequestLines(runtime)).toBe(before);
  expect(errors).toEqual([]);
});

test('a contents read that never came back is not shown as an empty book', async ({ page, runtime }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const note = testInfo.outputPath('还没有目录.md');
  await writeFile(note, MARKDOWN, 'utf8');
  await enterClassroom(page, runtime.authUrl);

  // A refusal on the wire, in the gateway's own envelope: the reader is told the
  // contents did not come back, which is not the same claim as "this book has no
  // contents".
  let refused = true;
  await page.route('**/api/studyforgeOrganization/book', async route => {
    if (!refused) { await route.continue(); return; }
    const body = route.request().postDataJSON() as { readonly rpcId: string };
    await route.fulfill({ json: {
      type: 'server-response', rpcId: body.rpcId,
      result: { ok: false, error: { code: 'material_missing', message: 'material not found' } },
    } });
  });

  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await page.getByTestId('material-file-input').setInputFiles(note);
  await openMaterial(page, '还没有目录');
  await expect(page.getByText('结构暂时无法读取，请刷新。')).toBeVisible();
  await expect(page.getByTestId('book-nodes')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('materials-outline-refused.png'), fullPage: true });

  // Asked again with the read working, the notice goes away: an unbroken book is
  // silent, and the failure is not left standing in for it.
  refused = false;
  await page.getByRole('button', { name: '刷新目录' }).click();
  await expect(page.getByText('结构暂时无法读取，请刷新。')).toHaveCount(0);
  await expect(page.getByTestId('book-nodes').locator('[data-kind]')).toHaveCount(1);
  // A later failed refresh must not leave a stale structure presented as current.
  refused = true;
  await page.getByRole('button', { name: '刷新目录' }).click();
  await expect(page.getByText('结构暂时无法读取，请刷新。')).toBeVisible();
  await expect(page.getByTestId('book-nodes')).toHaveCount(0);
  refused = false;
  await page.getByRole('button', { name: '刷新目录' }).click();
  await expect(page.getByTestId('book-nodes').locator('[data-kind]')).toHaveCount(1);
  expect(errors).toEqual([]);
});
