import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import { IMAGE_MAX_EDGE, PDF_PAGE_MAX_EDGE, readImageBytes, readPdfPage } from './agent-media.js';
import { parseMediaTarget } from './media.js';

// --- synthetic PDF fixtures -------------------------------------------------
// A real two-page PDF: page 1 carries a Helvetica text layer, page 2 is a pure
// image XObject (no text layer). Built here so the tests never depend on an
// external PDF CLI or a checked-in binary.

function serializePdf(objects) {
  const chunks = [], offsets = [0];
  let position = 0;
  const push = buffer => { chunks.push(buffer); position += buffer.length; };
  push(Buffer.from('%PDF-1.4\n', 'latin1'));
  objects.forEach((body, index) => {
    offsets.push(position);
    push(Buffer.from(`${index + 1} 0 obj\n`, 'latin1'));
    push(body);
    push(Buffer.from('\nendobj\n', 'latin1'));
  });
  const xrefPosition = position;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index++) xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPosition}\n%%EOF\n`;
  push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}

function pdfStream(body) {
  return Buffer.concat([Buffer.from(`<< /Length ${body.length} >>\nstream\n`, 'latin1'), body, Buffer.from('\nendstream', 'latin1')]);
}

async function textPagePdf() {
  const jpeg = await sharp({ create: { width: 240, height: 160, channels: 3, background: { r: 24, g: 96, b: 200 } } }).jpeg().toBuffer();
  const pageOne = Buffer.from([
    'BT /F1 24 Tf 72 700 Td (Vector Addition Title) Tj ET',
    'BT /F1 12 Tf 72 650 Td (Alpha line body) Tj ET',
    'BT /F1 12 Tf 72 630 Td (Beta line body) Tj ET',
    '',
  ].join('\n'), 'latin1');
  const pageTwo = Buffer.from('q 300 0 0 200 100 400 cm /Im1 Do Q\n', 'latin1');
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>', 'latin1'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', 'latin1'),
    pdfStream(pageOne),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 'latin1'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>', 'latin1'),
    pdfStream(pageTwo),
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width 240 /Height 160 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, 'latin1'),
      jpeg,
      Buffer.from('\nendstream', 'latin1'),
    ]),
  ];
  return new Uint8Array(serializePdf(objects));
}

async function inspectPng(data) {
  const buffer = Buffer.from(data, 'base64');
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'image payload must be a PNG');
  const meta = await sharp(buffer).metadata();
  const stats = await sharp(buffer).greyscale().stats();
  return { buffer, meta, stats };
}

const TITLE_REGION = [0.1, 0.06, 0.45, 0.05];

test('readPdfPage reads a real page: text layer, page count and rasterized image', async () => {
  const bytes = await textPagePdf();
  const result = await readPdfPage(bytes);
  assert.equal(result.page, 1);
  assert.equal(result.pageCount, 2);
  assert.match(result.text, /Vector Addition Title/);
  assert.match(result.text, /Alpha line body/);
  assert.match(result.text, /Beta line body/);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.image.mimeType, 'image/png');
  const { meta, stats } = await inspectPng(result.image.data);
  assert.equal(meta.width, result.image.width);
  assert.equal(meta.height, result.image.height);
  assert.ok(result.image.width > 100 && result.image.height > 100);
  assert.ok(result.image.width <= PDF_PAGE_MAX_EDGE && result.image.height <= PDF_PAGE_MAX_EDGE);
  assert.ok(stats.channels[0].min < 40, 'rendered page must contain real ink, not a blank canvas');
  // Reading must not detach or consume the caller-owned buffer.
  const before = Buffer.from(bytes).toString('base64');
  const again = await readPdfPage(bytes, { page: 1 });
  assert.equal(Buffer.from(bytes).toString('base64'), before);
  assert.equal(again.image.data, result.image.data, 'the same bytes must render identically');
});

test('readPdfPage keeps page numbering instead of clamping an invalid page', async () => {
  const bytes = await textPagePdf();
  const pageTwo = await readPdfPage(bytes, { page: 2 });
  assert.equal(pageTwo.page, 2);
  assert.equal(pageTwo.pageCount, 2);
  assert.equal(pageTwo.text, '');
  assert.deepEqual(pageTwo.warnings, ['pdf_page_has_no_text_layer']);
  const { meta, stats } = await inspectPng(pageTwo.image.data);
  assert.equal(meta.width, pageTwo.image.width);
  assert.ok(stats.channels[0].stdev > 5, 'image-only page must return the real raster, not a blank page');

  for (const page of [0, -1, 3, 99, 1.5, '1', Number.NaN]) {
    await assert.rejects(() => readPdfPage(bytes, { page }), /pdf_page_invalid/, `page=${String(page)} must be rejected`);
  }
});

test('readPdfPage crops the real page image and region text for a normalized rect', async () => {
  const bytes = await textPagePdf();
  const full = await readPdfPage(bytes);
  const region = await readPdfPage(bytes, { page: 1, rect: TITLE_REGION });
  assert.equal(region.text, 'Vector Addition Title');
  assert.deepEqual(region.warnings, []);
  const { meta, stats } = await inspectPng(region.image.data);
  assert.equal(meta.width, region.image.width);
  assert.equal(meta.height, region.image.height);
  assert.ok(region.image.width < full.image.width, 'region crop must be smaller than the full page');
  assert.ok(region.image.height < full.image.height, 'region crop must be smaller than the full page');
  // Region pixel size follows the requested rect within rounding of one pixel.
  const expectedAspect = (TITLE_REGION[2] * 612) / (TITLE_REGION[3] * 792);
  assert.ok(Math.abs(region.image.width / region.image.height - expectedAspect) < 0.05);
  assert.ok(stats.channels[0].min < 40, 'cropped region must contain the real rendered title');
});

test('readPdfPage accepts the vault pdf-region locator shape verbatim', async () => {
  const bytes = await textPagePdf();
  const parsed = parseMediaTarget(`媒体/向量讲义.pdf#page=1&rect=${TITLE_REGION.join(',')}`);
  assert.deepEqual(parsed.locator, { kind: 'pdf-region', page: 1, rect: TITLE_REGION });
  const region = await readPdfPage(bytes, { page: parsed.locator.page, rect: parsed.locator.rect });
  assert.equal(region.text, 'Vector Addition Title');
});

test('readPdfPage returns the image and a warning when a region has no text', async () => {
  const bytes = await textPagePdf();
  const blankRegion = await readPdfPage(bytes, { page: 1, rect: [0.6, 0.85, 0.3, 0.1] });
  assert.equal(blankRegion.text, '');
  assert.deepEqual(blankRegion.warnings, ['pdf_region_has_no_text']);
  const { meta } = await inspectPng(blankRegion.image.data);
  assert.ok(meta.width > 0 && meta.height > 0);
  for (const rect of [[0, 0, 0, 0.5], [0, 0, 0.2], ['a', 0, 1, 1], [0, 0, 1.4, 0]]) {
    await assert.rejects(() => readPdfPage(bytes, { page: 1, rect }), /pdf_region_invalid/);
  }
  // Out-of-range but non-degenerate selections clamp like `normalizedRect`.
  const clamped = await readPdfPage(bytes, { page: 1, rect: [-0.2, 0.06, 1.4, 0.05] });
  assert.match(clamped.text, /Vector Addition Title/);
});

test('readPdfPage rejects non-PDF bytes and honours an aborted signal', async () => {
  await assert.rejects(() => readPdfPage(new Uint8Array([1, 2, 3])), /pdf_document_invalid/);
  await assert.rejects(() => readPdfPage('not bytes'), /pdf_bytes_invalid/);
  const controller = new AbortController();
  controller.abort();
  const bytes = await textPagePdf();
  await assert.rejects(async () => {
    try { await readPdfPage(bytes, { signal: controller.signal }); }
    catch (error) { assert.equal(error.name, 'AbortError'); throw error; }
  }, /aborted/);
  const after = await readPdfPage(bytes, { signal: new AbortController().signal });
  assert.equal(after.pageCount, 2, 'a fresh signal must keep working after an aborted call');

  // Aborting while a read is in flight must stop it, not finish behind our back.
  const live = new AbortController();
  const pending = readPdfPage(bytes, { signal: live.signal });
  const timer = setTimeout(() => live.abort(), 1);
  await assert.rejects(pending, error => { assert.equal(error.name, 'AbortError'); return true; });
  clearTimeout(timer);
});

test('readImageBytes downsizes to a model-usable image and reports true dimensions', async () => {
  const png = await sharp({ create: { width: 3000, height: 1200, channels: 3, background: { r: 200, g: 30, b: 90 } } }).png().toBuffer();
  const result = await readImageBytes(new Uint8Array(png), { mime: 'image/png' });
  assert.equal(result.image.mimeType, 'image/png');
  const meta = await sharp(Buffer.from(result.image.data, 'base64')).metadata();
  assert.equal(result.image.width, meta.width);
  assert.equal(result.image.height, meta.height);
  assert.equal(Math.max(result.image.width, result.image.height), IMAGE_MAX_EDGE);
  assert.ok(Math.abs(result.image.width / result.image.height - 2.5) < 0.02);

  const jpeg = await sharp({ create: { width: 2400, height: 800, channels: 3, background: { r: 10, g: 180, b: 40 } } }).jpeg().toBuffer();
  const jpegResult = await readImageBytes(new Uint8Array(jpeg), { mime: 'image/jpeg' });
  assert.equal(jpegResult.image.mimeType, 'image/jpeg');
  assert.ok(jpegResult.image.width <= IMAGE_MAX_EDGE);

  const small = await sharp({ create: { width: 64, height: 32, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
  const smallResult = await readImageBytes(new Uint8Array(small), {});
  assert.deepEqual([smallResult.image.width, smallResult.image.height], [64, 32]);

  // Vault media types the shell may hand over: only png/jpeg/webp survive as-is.
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#0a0"/></svg>');
  const svgResult = await readImageBytes(new Uint8Array(svg), { mime: 'image/svg+xml' });
  assert.deepEqual([svgResult.image.mimeType, svgResult.image.width, svgResult.image.height], ['image/png', 400, 200]);
  const webp = await sharp({ create: { width: 120, height: 60, channels: 3, background: { r: 1, g: 2, b: 3 } } }).webp().toBuffer();
  assert.equal((await readImageBytes(new Uint8Array(webp), { mime: 'image/webp' })).image.mimeType, 'image/webp');
  const tiff = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 5, g: 5, b: 5 } } }).tiff().toBuffer();
  assert.equal((await readImageBytes(new Uint8Array(tiff), {})).image.mimeType, 'image/png');

  await assert.rejects(() => readImageBytes(new Uint8Array([0, 1, 2, 3])), /image_/);
  await assert.rejects(() => readImageBytes(new Uint8Array(0)), /image_bytes_invalid/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readImageBytes(new Uint8Array(png), { signal: controller.signal }), /aborted/);
});
