/**
 * P3.3 on a real Host: a DOCX renders from its own bytes, and the rendered DOM
 * is bound to the Host's index by the complete structural path — never by
 * searching for a quote. The scope is all-or-nothing: either every body
 * paragraph lands on its own index path, or the pass writes no ids at all.
 *
 * The fixtures are real deflated archives (`tests/fixtures/materials/docx-fixtures.ts`).
 * The tests pin the failure modes this mapping must not have: duplicate
 * paragraphs and duplicate tables stay separate, ordinary spaces stay
 * significant, and a paragraph the previewer drops (a `w:customXml` story)
 * leaves the whole document unpositioned instead of shifting a later duplicate
 * onto the missing one's path.
 */
import { writeFile } from 'node:fs/promises';
import { test as base, expect, type Page } from '@playwright/test';
import { zipSync } from 'fflate';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { enterClassroom } from './fixtures/classroom.ts';
import { docxWithBody, ONE_PIXEL_PNG } from '../fixtures/materials/docx-fixtures.ts';

const test = base.extend<{ runtime: IsolatedRuntime }>({
  runtime: async ({}, use, testInfo) => {
    const runtime = await startIsolated();
    try { await use(runtime); }
    finally { await runtime.stop(); await testInfo.attach('native-host-log', { body: runtime.log(), contentType: 'text/plain' }); }
  },
});

/** Import one DOCX through the page's own picker and wait for its rendering. */
async function importDocx(page: Page, file: string): Promise<void> {
  await page.getByRole('button', { name: '资料', exact: true }).first().click();
  await page.getByTestId('material-file-input').setInputFiles(file);
  // The shelf comes first; the reader is a page of its own once the book is opened.
  await page.getByTestId('material-row').filter({ hasText: file.split('/').pop()!.replace(/\.[^.]+$/u, '') }).getByRole('button').first().click();
  await expect(page.getByTestId('docx-body')).toBeVisible();
  await expect(page.getByTestId('docx-state')).toHaveAttribute('data-docx-status', 'ready');
}

const block = (id: string): string => `[data-sf-block-id="${id}"]`;

/** One paragraph part; `xml:space` keeps a leading or inner space meaningful. */
const para = (text: string): string => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** A two-cell table whose cells hold the same words, so only the path separates them. */
const table = (text: string): string =>
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>'
  + `<w:tr><w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr>`
  + '</w:tbl>';

const RICH_NAMESPACES = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
].join(' ');

/**
 * A real, renderable archive with an image relationship the previewer can
 * follow, an inline formula and a two-cell table. The index fixture
 * (`mixedDocx`) is built for the indexer, whose drawing carries no
 * relationship, so this one carries its own media part.
 */
function richDocx(): Uint8Array {
  const picture = '<w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><a:graphic>'
    + '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="image1.png"/></pic:nvPicPr>'
    + '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
    + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>'
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
    + '</a:graphicData></a:graphic></wp:inline></w:drawing>';
  const body = '<w:p><w:r><w:t>图前</w:t>' + picture + '<w:t>图后</w:t></w:r></w:p>'
    // `m:oMath` is a sibling of the runs inside `w:p`, which is where Word
    // writes an inline formula; nested inside a `w:r` it is not a formula any
    // reader would parse.
    + '<w:p><m:oMath><m:r><m:t>y=2</m:t></m:r></m:oMath><w:r><w:t>公式尾</w:t></w:r></w:p>'
    + table('重复格')
    + para('结尾');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${RICH_NAMESPACES}><w:body>${body}</w:body></w:document>`;
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>';
  const packageRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>';
  const documentRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>'
    + '</Relationships>';
  const encoder = new TextEncoder();
  return zipSync({
    '[Content_Types].xml': encoder.encode(contentTypes),
    '_rels/.rels': encoder.encode(packageRels),
    'word/_rels/document.xml.rels': encoder.encode(documentRels),
    'word/document.xml': encoder.encode(document),
    'word/media/image1.png': ONE_PIXEL_PNG,
  }, { level: 6, mtime: new Date('2020-01-01T00:00:00Z') });
}

test('duplicate paragraphs and duplicate tables each keep their own element, and a space is not nothing', async ({ page, runtime }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const file = testInfo.outputPath('重复结构.docx');
  await writeFile(file, docxWithBody(para('重复段') + para('重复段') + para('a b') + para('ab') + table('重复格') + table('重复格')));

  await enterClassroom(page, runtime.authUrl);
  await importDocx(page, file);
  const body = page.getByTestId('docx-body');
  await expect(page.locator('.sf-docx-shell')).toHaveAttribute('data-docx-positioned', 'true');

  // Identical words, two paragraphs, two elements, each at its own path.
  const firstParagraph = body.locator(block('body/p[0]'));
  const secondParagraph = body.locator(block('body/p[1]'));
  await expect(firstParagraph).toHaveCount(1);
  await expect(secondParagraph).toHaveCount(1);
  await expect(firstParagraph).toHaveText('重复段');
  await expect(secondParagraph).toHaveText('重复段');
  expect(await firstParagraph.evaluate((element) => element === document.querySelector('[data-sf-block-id="body/p[1]"]'))).toBe(false);

  // "a b" and "ab" are different originals and must not share a paragraph.
  await expect(body.locator(block('body/p[2]'))).toHaveText('a b');
  await expect(body.locator(block('body/p[3]'))).toHaveText('ab');

  // One repeated table, four cells of the same words, four paths, four elements.
  const cells = [
    'body/tbl[0]/tr[0]/tc[0]/p[0]', 'body/tbl[0]/tr[0]/tc[1]/p[0]',
    'body/tbl[1]/tr[0]/tc[0]/p[0]', 'body/tbl[1]/tr[0]/tc[1]/p[0]',
  ];
  for (const id of cells) {
    await expect(body.locator(block(id))).toHaveCount(1);
    await expect(body.locator(block(id))).toHaveText('重复格');
  }
  const distinct = await body.evaluate((root, ids) => new Set(ids.map(id => root.querySelector(`[data-sf-block-id="${id}"]`))).size, cells);
  expect(distinct).toBe(4);
  await page.screenshot({ path: testInfo.outputPath('docx-duplicates.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('a paragraph the previewer drops leaves the whole document unpositioned instead of shifting a duplicate', async ({ page, runtime }, testInfo) => {
  const file = testInfo.outputPath('展平结构.docx');
  // The index walks `customXml` (a real container) but the previewer's body parser
  // does not, so the first of the two identical paragraphs is missing from the DOM.
  await writeFile(file, docxWithBody(`<w:customXml><w:p><w:r><w:t>重复段</w:t></w:r></w:p></w:customXml>${para('重复段')}`));

  await enterClassroom(page, runtime.authUrl);
  await importDocx(page, file);
  const body = page.getByTestId('docx-body');

  await expect(page.locator('.sf-docx-shell')).toHaveAttribute('data-docx-positioned', 'false');
  // Nothing is claimed: the surviving paragraph is *not* bound to the first one's path.
  await expect(body.locator('[data-sf-block-id]')).toHaveCount(0);
  await expect(body).toContainText('重复段');
  await expect(page.getByTestId('docx-status')).toContainText('没法对应到原位置');
  await page.screenshot({ path: testInfo.outputPath('docx-unpositioned.png'), fullPage: true });
});

test('a flattened w:sdt document is unpositioned, and a rich document still draws its image, formula and table', async ({ page, runtime }, testInfo) => {
  const sdt = testInfo.outputPath('sdt.docx');
  await writeFile(sdt, docxWithBody(para('第一段')
    + '<w:sdt><w:sdtPr/><w:sdtContent><w:p><w:r><w:t>被展平的段落</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    + para('最后一段')));
  const mixed = testInfo.outputPath('混合文档.docx');
  await writeFile(mixed, richDocx());

  await enterClassroom(page, runtime.authUrl);
  await importDocx(page, sdt);
  const first = page.getByTestId('docx-body');
  await expect(page.locator('.sf-docx-shell')).toHaveAttribute('data-docx-positioned', 'false');
  await expect(first.locator('[data-sf-block-id]')).toHaveCount(0);
  // Every paragraph is still shown; only the claim is withheld.
  await expect(first).toContainText('被展平的段落');
  await expect(first).toContainText('最后一段');

  // The rich fixture keeps its real content whatever the positioning verdict is.
  await page.getByTestId('materials-back').click();
  await page.getByTestId('material-file-input').setInputFiles(mixed);
  await page.getByTestId('material-row').filter({ hasText: '混合文档' }).getByRole('button').first().click();
  const rich = page.getByTestId('docx-body');
  const drawing = rich.locator('img').first();
  await expect(drawing).toBeVisible();
  // A real drawn image, not a placeholder: the relationship resolved and the bytes decoded.
  await expect.poll(async () => drawing.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(rich.locator('table')).toHaveCount(1);
  await expect(rich).toContainText('重复格');
  await expect(rich).toContainText('公式尾');
  // The formula itself, not just the words after it: a real math node carrying
  // y=2, laid out with a size of its own.
  const formula = rich.locator('math').first();
  await expect(rich.locator('math')).toHaveCount(1);
  await expect(formula).toBeVisible();
  await expect(formula).toContainText('y=2');
  // Laid out with a size of its own, not an invisible node.
  await expect.poll(async () => {
    const box = await formula.boundingBox();
    return box !== null && box.width > 0 && box.height > 0;
  }).toBe(true);
  await expect(rich).toContainText('结尾');
  const positioned = await page.locator('.sf-docx-shell').getAttribute('data-docx-positioned');
  // Either every body paragraph is claimed or none is; a partial claim is the bug.
  const claimed = await rich.locator('[data-sf-block-id]').count();
  expect(positioned === 'true' ? claimed > 0 : claimed === 0).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('docx-mixed.png'), fullPage: true });
});
