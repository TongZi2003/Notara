/**
 * P3.3 DOCX stable index.
 *
 * The fixtures are real deflated ZIP archives (`tests/fixtures/materials/docx-fixtures.ts`),
 * and the first test reads one back through the central directory with `node:zlib`
 * alone, so nothing here depends on the indexer agreeing with the library it
 * shares with the writer. The rest pin the properties P4 relies on: structural
 * ids that stay put, merged run text with UTF-16 offsets, and content that the
 * original bytes do not spell out staying out of the index.
 */
import { describe, expect, test } from 'vitest';
import { DocxIndexError, indexDocx, type DocxIndexOptions } from '../../packages/domain/src/materials/docx/index-docx.ts';
import {
  mergeParagraphPieces,
  projectWithoutLayout,
  rangeText,
  utf16Length,
} from '../../packages/domain/src/materials/docx/normalize-text.ts';
import {
  buildDocx,
  docxWithBody,
  docxWithUnderstatedDocumentSize,
  mixedDocx,
  readZipEntries,
  wmlPart,
} from '../fixtures/materials/docx-fixtures.ts';

const encoder = new TextEncoder();

const MIXED_BLOCK_IDS = [
  'body/p[0]',
  'body/p[1]',
  'body/p[2]',
  'body/p[3]',
  'body/p[4]',
  'body/p[5]',
  'body/tbl[0]/tr[0]/tc[0]/p[0]',
  'body/tbl[0]/tr[0]/tc[1]/p[0]',
  'body/tbl[0]/tr[1]/tc[0]/p[0]',
  'body/tbl[0]/tr[1]/tc[0]/tbl[0]/tr[0]/tc[0]/p[0]',
  'body/tbl[0]/tr[1]/tc[1]/p[0]',
  'body/tbl[1]/tr[0]/tc[0]/p[0]',
  'body/tbl[1]/tr[0]/tc[1]/p[0]',
  'body/tbl[1]/tr[1]/tc[0]/p[0]',
  'body/tbl[1]/tr[1]/tc[0]/tbl[0]/tr[0]/tc[0]/p[0]',
  'body/tbl[1]/tr[1]/tc[1]/p[0]',
];

async function failureOf(bytes: Uint8Array, options: DocxIndexOptions = {}): Promise<DocxIndexError> {
  try {
    await indexDocx(bytes, options);
  } catch (error) {
    if (error instanceof DocxIndexError) return error;
    throw error;
  }
  throw new Error('indexDocx accepted bytes it must refuse');
}

describe('DOCX index v2', () => {
  test('reads the fixture as a real ZIP, with no help from fflate', () => {
    const entries = readZipEntries(mixedDocx());
    expect(entries.map(entry => entry.name)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/header1.xml',
      'word/footer2.xml',
      'word/footnotes.xml',
      'word/comments.xml',
      'word/styles.xml',
      'word/media/image1.png',
    ]);
    const main = entries.find(entry => entry.name === 'word/document.xml');
    expect(main?.method).toBe(8);
    expect(main?.text).toContain('<w:body>');
    expect(main?.text).toContain('重复格');
  });

  test('indexes body paragraphs and table cells in document order', async () => {
    const index = await indexDocx(mixedDocx());
    expect(index.indexedParts).toEqual(['word/document.xml']);
    expect(index.blocks.map(block => block.blockId)).toEqual(MIXED_BLOCK_IDS);
    expect(index.blocks.map(block => block.ordinal)).toEqual(index.blocks.map((_block, position) => position));
    expect(index.blocks.every(block => block.part === 'word/document.xml' && block.kind === 'paragraph')).toBe(true);
    expect(index.blocks[0]?.path).toEqual([
      { name: 'body', index: 0 },
      { name: 'p', index: 0 },
    ]);
  });

  test('keeps spaces, tabs and line breaks and merges runs into one paragraph', async () => {
    const index = await indexDocx(mixedDocx());
    expect(index.blocks[0]?.text).toBe('  前  中\t\n后链接字');
    expect(index.blocks[0]?.segments).toEqual([
      { kind: 'text', start: 0, end: 5, run: 0 },
      { kind: 'text', start: 5, end: 6, run: 1 },
      { kind: 'tab', start: 6, end: 7, run: 1 },
      { kind: 'break', start: 7, end: 8, run: 1, breakType: 'line' },
      { kind: 'text', start: 8, end: 9, run: 1 },
      { kind: 'text', start: 9, end: 12, run: 2 },
    ]);
    expect(index.blocks[1]?.text).toBe('');
  });

  test('folds several w:t of one run into one span', async () => {
    const index = await indexDocx(docxWithBody('<w:p><w:r><w:t>前</w:t><w:t>后</w:t></w:r></w:p>'));
    expect(index.blocks[0]?.text).toBe('前后');
    expect(index.blocks[0]?.segments).toEqual([{ kind: 'text', start: 0, end: 2, run: 0 }]);
  });

  test('counts offsets in UTF-16 code units, emoji included', async () => {
    const index = await indexDocx(mixedDocx());
    const emoji = index.blocks[3];
    expect(emoji?.text).toBe('😀A');
    expect(utf16Length(emoji?.text ?? '')).toBe(3);
    expect(emoji?.segments).toEqual([{ kind: 'text', start: 0, end: 3, run: 0 }]);
    expect(projectWithoutLayout('甲\t乙')).toEqual({ text: '甲乙', offsets: [0, 2] });
    expect(rangeText('甲\t乙', 0, 2)).toBe('甲\t');
    expect(() => rangeText('甲', 0, 2)).toThrow(RangeError);
  });

  test('gives duplicate paragraphs and repeated tables different ids', async () => {
    const index = await indexDocx(mixedDocx());
    const duplicates = index.blocks.filter(block => block.text === '  前  中\t\n后链接字');
    expect(duplicates.map(block => block.blockId)).toEqual(['body/p[0]', 'body/p[2]']);
    const repeated = index.blocks.filter(block => block.text === '重复格');
    expect(repeated.map(block => block.blockId)).toEqual([
      'body/tbl[0]/tr[0]/tc[0]/p[0]',
      'body/tbl[0]/tr[0]/tc[1]/p[0]',
      'body/tbl[1]/tr[0]/tc[0]/p[0]',
      'body/tbl[1]/tr[0]/tc[1]/p[0]',
    ]);
    expect(new Set(index.blocks.map(block => block.blockId)).size).toBe(index.blocks.length);
  });

  test('keeps the innermost table position of a nested cell', async () => {
    const index = await indexDocx(mixedDocx());
    const nested = index.blocks.find(block => block.blockId === 'body/tbl[1]/tr[1]/tc[0]/tbl[0]/tr[0]/tc[0]/p[0]');
    expect(nested?.text).toBe('嵌套');
    expect(nested?.table).toEqual({ table: 0, row: 0, cell: 0, paragraph: 0 });
    expect(index.blocks.find(block => block.blockId === 'body/tbl[1]/tr[1]/tc[1]/p[0]')?.table)
      .toEqual({ table: 1, row: 1, cell: 1, paragraph: 0 });
    expect(index.blocks[0]?.table).toBeUndefined();
  });

  test('never invents text for images, formulas, symbols, fields, text boxes or deletions', async () => {
    const index = await indexDocx(mixedDocx());
    const texts = index.blocks.map(block => block.text);
    const mixed = index.blocks[4];
    expect(mixed?.text).toBe('图尾\n');
    expect(mixed?.segments.filter(segment => segment.kind === 'nonText').map(segment => segment.content)).toEqual([
      'drawing',
      'symbol',
      'field',
      'field',
      'deletedText',
      'math',
    ]);
    expect(mixed?.segments.at(-1)).toEqual({ kind: 'break', start: 2, end: 3, run: 6, breakType: 'page' });
    expect(index.blocks[5]?.text).toBe('');
    for (const marker of ['x=1', 'y=2', '旧字', 'PAGE', '框内字', '页眉字', '页脚字', '注脚字', '批注字']) {
      expect(texts.some(text => text.includes(marker))).toBe(false);
    }
  });

  test('reports the parts and areas it leaves to the previewer', async () => {
    const index = await indexDocx(mixedDocx());
    expect(index.notIndexed).toEqual([
      { area: 'comments', part: 'word/comments.xml', count: 1 },
      { area: 'deletedText', part: 'word/document.xml', count: 1 },
      { area: 'drawing', part: 'word/document.xml', count: 1 },
      { area: 'field', part: 'word/document.xml', count: 2 },
      { area: 'footer', part: 'word/footer2.xml', count: 1 },
      { area: 'footnotes', part: 'word/footnotes.xml', count: 1 },
      { area: 'header', part: 'word/header1.xml', count: 1 },
      { area: 'math', part: 'word/document.xml', count: 2 },
      { area: 'picture', part: 'word/document.xml', count: 1 },
      { area: 'symbol', part: 'word/document.xml', count: 1 },
      { area: 'textBox', part: 'word/document.xml', count: 1 },
    ]);
  });

  test('walks content controls and keeps their path', async () => {
    const index = await indexDocx(docxWithBody('<w:sdt><w:sdtContent><w:p><w:r><w:t>控件字</w:t></w:r></w:p></w:sdtContent></w:sdt>'));
    expect(index.blocks.map(block => [block.blockId, block.text])).toEqual([
      ['body/sdt[0]/sdtContent[0]/p[0]', '控件字'],
    ]);
  });

  test('is stable for the same bytes', async () => {
    expect(mixedDocx()).toEqual(mixedDocx());
    expect(await indexDocx(mixedDocx())).toEqual(await indexDocx(mixedDocx()));
  });

  test('refuses bytes it cannot index instead of guessing', async () => {
    expect((await failureOf(new Uint8Array([1, 2, 3, 4]))).code).toBe('docx_unreadable');
    expect((await failureOf(new Uint8Array(0))).code).toBe('docx_unreadable');
    expect((await failureOf(buildDocx([{ path: 'word/styles.xml', xml: wmlPart('styles', '<w:style/>') }]))).code)
      .toBe('docx_main_part_missing');
    const broken = wmlPart('document', '<w:body><w:p></w:p></w:body>').replace('</w:p>', '');
    expect((await failureOf(buildDocx([{ path: 'word/document.xml', xml: broken }]))).code).toBe('docx_xml_invalid');
    expect((await failureOf(buildDocx([{ path: 'word/document.xml', xml: wmlPart('document', '<w:p/>') }]))).code)
      .toBe('docx_document_invalid');
    const media = buildDocx([], [{ path: 'word/media/only.png', bytes: encoder.encode('not an xml part') }]);
    expect((await failureOf(media)).code).toBe('docx_main_part_missing');
  });

  test('refuses a document part that is not valid UTF-8 instead of shifting offsets', async () => {
    const broken = new Uint8Array(Buffer.concat([
      Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'),
      Buffer.from([0xff, 0xfe]),
      Buffer.from('</w:t></w:r></w:p></w:body></w:document>'),
    ]));
    const failure = await failureOf(buildDocx([], [{ path: 'word/document.xml', bytes: broken }]));
    expect(failure.code).toBe('docx_document_encoding');
    // The same shape with valid UTF-8 indexes normally, so the refusal is the encoding.
    const readable = buildDocx([{ path: 'word/document.xml', xml: new TextDecoder().decode(broken) }]);
    expect((await indexDocx(readable)).blocks.map(block => block.text)).toEqual(['\ufffd\ufffd']);
  });

  test('refuses a document part that would inflate past the index ceiling', async () => {
    // The archive says it is oversized: the part is never inflated at all.
    const declared = await failureOf(mixedDocx(), { maxDocumentBytes: 64 });
    expect(declared.code).toBe('docx_document_too_large');
    expect(declared.message).toContain('声明');
    // The header understates its own size: what really arrived is the hard stop.
    const understated = await failureOf(docxWithUnderstatedDocumentSize('<w:p><w:r><w:t>膨胀</w:t></w:r></w:p>'), { maxDocumentBytes: 64 });
    expect(understated.code).toBe('docx_document_too_large');
    expect(understated.message).toContain('实际');
    // A ceiling above the real part leaves the same bytes indexable.
    expect((await indexDocx(mixedDocx(), { maxDocumentBytes: 1024 * 1024 })).blocks.length).toBe(MIXED_BLOCK_IDS.length);
    await expect(indexDocx(docxWithBody('<w:p/>'), { maxDocumentBytes: 0 })).rejects.toThrow(RangeError);
  });

  test('merges paragraph pieces into one text with per-run spans', () => {
    const merged = mergeParagraphPieces([
      { kind: 'text', text: ' 甲', run: 0 },
      { kind: 'text', text: '乙', run: 1 },
      { kind: 'text', text: '丙', run: 1 },
      { kind: 'tab', text: '\t', run: 2 },
      { kind: 'nonText', text: '', run: 3, content: 'math' },
      { kind: 'text', text: '', run: 4 },
    ]);
    expect(merged.text).toBe(' 甲乙丙\t');
    expect(merged.segments).toEqual([
      { kind: 'text', start: 0, end: 2, run: 0 },
      { kind: 'text', start: 2, end: 4, run: 1 },
      { kind: 'tab', start: 4, end: 5, run: 2 },
      { kind: 'nonText', start: 5, end: 5, run: 3, content: 'math' },
    ]);
  });

  test('namespace identity admits default prefixes and refuses foreign lookalikes', async () => {
    const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const content = `<document xmlns='${namespace}'><body><p><r><t>正文</t></r></p></body></document>`;
    expect((await indexDocx(buildDocx([{ path: 'word/document.xml', xml: content }]))).blocks.map(block => block.text)).toEqual(['正文']);
    await expect(indexDocx(buildDocx([{ path: 'word/document.xml', xml: content.replace(namespace, 'urn:foreign') }]))).rejects.toMatchObject({ code: 'docx_document_invalid' });
    const mixed = content.replace('</body>', '<p xmlns="urn:foreign"><r><t>不是正文</t></r></p></body>');
    expect((await indexDocx(buildDocx([{ path: 'word/document.xml', xml: mixed }]))).blocks.map(block => block.text)).toEqual(['正文']);
  });
});
