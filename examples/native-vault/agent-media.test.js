import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import sharp from 'sharp';

import { IMAGE_MAX_EDGE, PDF_PAGE_MAX_EDGE, readImageBytes, readPdfPage,readPdfPageCount,readPdfOutline } from './agent-media.js';
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

async function textPagePdf({outline=false,padding=0}={}) {
  const jpeg = await sharp({ create: { width: 240, height: 160, channels: 3, background: { r: 24, g: 96, b: 200 } } }).jpeg().toBuffer();
  const pageOne = Buffer.from([
    'BT /F1 24 Tf 72 700 Td (Vector Addition Title) Tj ET',
    'BT /F1 12 Tf 72 650 Td (Alpha line body) Tj ET',
    'BT /F1 12 Tf 72 630 Td (Beta line body) Tj ET',
    '',
  ].join('\n'), 'latin1');
  const pageTwo = Buffer.from('q 300 0 0 200 100 400 cm /Im1 Do Q\n', 'latin1');
  const objects = [
    Buffer.from(outline?'<< /Type /Catalog /Pages 2 0 R /Outlines 9 0 R /PageLabels 12 0 R /Names << /Dests 13 0 R >> >>':'<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
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
  if(outline)objects.push(...[
    '<< /Type /Outlines /First 10 0 R /Last 11 0 R /Count 3 >>',
    '<< /Title (Introduction) /Parent 9 0 R /Next 11 0 R /Dest (intro) >>',
    '<< /Title (Chapter) /Parent 9 0 R /Prev 10 0 R /Dest [6 0 R /Fit] /First 14 0 R /Last 14 0 R /Count 1 >>',
    '<< /Nums [0 << /S /r >> 1 << /S /D /St 101 >>] >>',
    '<< /Names [(intro) [3 0 R /Fit]] >>',
    '<< /Title (External destination) /Parent 11 0 R /A << /S /URI /URI (https://invalid.example/) >> >>',
  ].map(body=>Buffer.from(body,'latin1')));
  if(padding)objects.push(pdfStream(Buffer.alloc(padding,32)));
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

test('PDF ranges render the same real page without fetching an unused large stream',async()=>{
  const bytes=await textPagePdf({padding:512*1024}),ranges=[];
  const source={length:bytes.length,readRange:async(begin,end)=>{ranges.push([begin,end]);return bytes.slice(begin,end);}};
  const ranged=await readPdfPage(source,{page:1}),full=await readPdfPage(bytes,{page:1});
  assert.equal(ranged.text,full.text);assert.equal(ranged.image.data,full.image.data);
  assert.ok(ranges.length>1,'the fixture must exercise a later range request');
  assert.ok(ranges.reduce((total,[begin,end])=>total+end-begin,0)<bytes.length,'unused object bytes are not all fetched');
  assert.equal(await readPdfPageCount(source),2);
});

test('range read failures and cancellation reject instead of leaving pdf.js pending',{timeout:5000},async()=>{
  const bytes=await textPagePdf({padding:512*1024});let reads=0;
  await assert.rejects(readPdfPage({length:bytes.length,readRange:async(begin,end)=>{
    if(++reads>1)throw new Error('vault_revision_conflict');return bytes.slice(begin,end);
  }}),/vault_revision_conflict/);
  const controller=new AbortController();reads=0;
  await assert.rejects(readPdfPage({length:bytes.length,readRange:async(begin,end)=>{
    if(++reads>1)controller.abort();return bytes.slice(begin,end);
  }},{signal:controller.signal}),error=>error.name==='AbortError');
  await assert.rejects(readPdfPage({length:bytes.length,readRange:async()=>new Uint8Array(1)}),/pdf_range_invalid/);
});

test('bookmarks resolve named destinations to physical pages and retain printed labels',async()=>{
  const result=await readPdfOutline(await textPagePdf({outline:true}));
  assert.equal(result.pageCount,2);assert.deepEqual(result.pageLabels,['i','101']);
  assert.deepEqual(result.items[0],{title:'Introduction',page:1,pageLabel:'i',items:[]});
  assert.equal(result.items[1].page,2);assert.equal(result.items[1].pageLabel,'101');
  assert.equal(result.items[1].items[0].page,null,'an external target cannot be represented as page 1');
  assert.deepEqual(result.warnings,['pdf_outline_destination_unresolved']);
  const missing=await readPdfOutline(await textPagePdf());
  assert.deepEqual(missing.items,[]);assert.deepEqual(missing.warnings,['pdf_outline_missing']);
});

test('requested render scale returns actual dimensions and respects the measured pixel limit',async()=>{
  const bytes=await textPagePdf(),small=await readPdfPage(bytes,{scale:1}),larger=await readPdfPage(bytes,{scale:2});
  assert.equal(small.image.width,612);assert.equal(small.image.height,792);assert.equal(small.image.scale,1);
  assert.equal(larger.image.width,1224);assert.equal(larger.image.height,1584);
  const limited=await readPdfPage(bytes,{scale:3});
  assert.equal(limited.image.height,PDF_PAGE_MAX_EDGE);assert.ok(limited.image.scale<3);
  assert.ok(limited.warnings.includes('pdf_render_scale_limited'));
  for(const scale of [0,.19,3.1,Infinity,'2'])await assert.rejects(readPdfPage(bytes,{scale}),/pdf_render_scale_invalid/);
});

test('small page units reach a readable automatic size without expanding explicit scale limits', async () => {
  const bytes = new Uint8Array(serializePdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 245 363] /Resources << >> /Contents 4 0 R >>'),
    pdfStream(Buffer.from('0 0 0 rg 25 25 100 200 re f')),
  ]));
  const automatic = await readPdfPage(bytes), explicit = await readPdfPage(bytes, { scale: 3 });
  assert.equal(automatic.image.height, 2048);
  assert.equal(explicit.image.height, 1089);
  assert.ok(automatic.image.width <= 2048);
  assert.ok((await inspectPng(automatic.image.data)).stats.channels[0].stdev > 20, 'the actual drawn content must remain present');
});

test('named Chinese CMaps preserve CJK text instead of silently dropping it', async () => {
  const bytes = new Uint8Array(serializePdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>'),
    Buffer.from('<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] >>'),
    Buffer.from('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 6 0 R /DW 1000 >>'),
    Buffer.from('<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /Ascent 900 /Descent -200 /CapHeight 800 /ItalicAngle 0 /StemV 80 >>'),
    pdfStream(Buffer.from('BT /F1 24 Tf 30 100 Td <4e2d6587516c5f0f> Tj ET')),
  ]));
  const page = await readPdfPage(bytes);
  assert.match(page.text, /中文公式/);
  assert.deepEqual(page.warnings, []);
});

test('JPEG2000 page images retain their black and blue geometry through the bundled decoder', async () => {
  // 4.8 KiB, locally generated 32x32 geometry: no user-book content.
  const bytes = new Uint8Array(await readFile(new URL('../../tests/fixtures/jpx-geometry.pdf', import.meta.url)));
  const page = await readPdfPage(bytes);
  const { data, info } = await sharp(Buffer.from(page.image.data, 'base64')).raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => {
    const offset = (Math.floor(info.height * y) * info.width + Math.floor(info.width * x)) * info.channels;
    return Array.from(data.subarray(offset, offset + 3));
  };
  assert.deepEqual(pixel(.25, .25), [0, 0, 0]);
  assert.deepEqual(pixel(.72, .72), [0, 0, 255]);
  assert.deepEqual(pixel(.9, .1), [255, 255, 255]);
  assert.deepEqual(page.warnings, ['pdf_page_has_no_text_layer']);
});

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
  assert.ok(region.image.width * region.image.height < full.image.width * full.image.height, 'the magnified selection must still cover fewer pixels than the full page');
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
