/**
 * Real DOCX fixtures for the P3.3 index (and, reused, for the P3.3 renderer).
 *
 * Each fixture is an actual deflated ZIP archive built in memory with the shape
 * Word writes: content types, package and document relationships, the main
 * document part, the preview-only parts (header, footer, footnotes, comments),
 * a stylesheet, and one media file. Nothing here is a mock parser object, and
 * {@link readZipEntries} reads the archive back through the central directory and
 * `node:zlib` alone, so a test can prove the fixture is a real ZIP instead of
 * trusting the library that wrote it.
 */
import { zipSync } from 'fflate';
import { crc32, inflateRawSync } from 'node:zlib';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

/** DOS zip timestamps only cover 1980-2099; a fixed one keeps bytes reproducible. */
const FIXED_MTIME = new Date('2020-01-01T00:00:00Z');

/** One XML part of the archive. */
export interface DocxPart {
  readonly path: string;
  readonly xml: string;
}

/** One binary part of the archive: media, and any part whose bytes are not text. */
export interface DocxBinaryPart {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** Namespaces the fixtures use; a prefixed element without one is not valid XML. */
const NAMESPACES = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
  'xmlns:v="urn:schemas-microsoft-com:vml"',
].join(' ');

/** The smallest valid PNG; only the indexer's media-skipping path uses it. */
export const ONE_PIXEL_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

export const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>';

export const PACKAGE_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';

export const DOCUMENT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test/" TargetMode="External"/>'
  + '<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>'
  + '</Relationships>';

/** Wrap one WordprocessingML part root around body content. */
export function wmlPart(root: string, inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:${root} ${NAMESPACES}>${inner}</w:${root}>`;
}

/** A main document part around `<w:body>` content. */
export function documentXml(body: string): string {
  return wmlPart('document', `<w:body>${body}</w:body>`);
}

/**
 * Build one DOCX archive. The parts land in insertion order and the timestamp is
 * fixed, so the same parts always produce the same bytes.
 */
export function buildDocx(parts: readonly DocxPart[], binaries: readonly DocxBinaryPart[] = []): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': encoder.encode(CONTENT_TYPES_XML),
    '_rels/.rels': encoder.encode(PACKAGE_RELS_XML),
    'word/_rels/document.xml.rels': encoder.encode(DOCUMENT_RELS_XML),
  };
  for (const part of parts) files[part.path] = encoder.encode(part.xml);
  for (const part of binaries) files[part.path] = part.bytes;
  return zipSync(files, { level: 6, mtime: FIXED_MTIME });
}

/** A minimal but real DOCX whose body is exactly `body`. */
export function docxWithBody(body: string): Uint8Array {
  return buildDocx([{ path: 'word/document.xml', xml: documentXml(body) }]);
}

/** What {@link docxWithUnderstatedDocumentSize} claims its document part holds. */
export const UNDERSTATED_DOCUMENT_SIZE = 10;

/**
 * A real ZIP whose `word/document.xml` entry lies about its own size: both
 * headers declare {@link UNDERSTATED_DOCUMENT_SIZE} bytes while the stored data
 * holds the whole XML. A reader still returns the bytes that are really there,
 * which is exactly the case the index's post-inflate ceiling has to stop; the
 * fixture stays a few hundred bytes instead of being a fabricated giant.
 */
export function docxWithUnderstatedDocumentSize(body: string): Uint8Array {
  return singleStoredEntryZip('word/document.xml', encoder.encode(documentXml(body)), UNDERSTATED_DOCUMENT_SIZE);
}

/** One stored entry with a chosen (possibly wrong) declared uncompressed size. */
function singleStoredEntryZip(name: string, data: Uint8Array, declaredSize: number): Uint8Array {
  const nameBytes = encoder.encode(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0x0021, 12);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(data.byteLength, 18);
  local.writeUInt32LE(declaredSize, 22);
  local.writeUInt16LE(nameBytes.byteLength, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0x0021, 14);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(data.byteLength, 20);
  central.writeUInt32LE(declaredSize, 24);
  central.writeUInt16LE(nameBytes.byteLength, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.byteLength + nameBytes.byteLength, 12);
  end.writeUInt32LE(local.byteLength + nameBytes.byteLength + data.byteLength, 16);
  return new Uint8Array(Buffer.concat([
    local, Buffer.from(nameBytes), Buffer.from(data), central, Buffer.from(nameBytes), end,
  ]));
}

const PARAGRAPH_RUN = '<w:r><w:t>中</w:t><w:tab/><w:br/><w:t>后</w:t></w:r>';

/** A paragraph whose text needs `xml:space="preserve"`, in three runs. */
const SPACED_PARAGRAPH =
  '<w:p>'
  + '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">  前  </w:t></w:r>'
  + PARAGRAPH_RUN
  + '<w:hyperlink r:id="rId7"><w:r><w:t>链接字</w:t></w:r></w:hyperlink>'
  + '</w:p>';

/** An image node: it renders as a picture and holds no `w:t` characters. */
const DRAWING =
  '<w:drawing><wp:inline>'
  + '<wp:extent cx="914400" cy="914400"/>'
  + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
  + '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="image1.png"/></pic:nvPicPr></pic:pic>'
  + '</a:graphicData></a:graphic>'
  + '</wp:inline></w:drawing>';

/** A VML text box: the words inside it belong to a nested story, not to this paragraph. */
const TEXT_BOX =
  '<w:pict><v:textbox><w:txbxContent>'
  + '<w:p><w:r><w:t>框内字</w:t></w:r></w:p>'
  + '</w:txbxContent></v:textbox></w:pict>';

/** Block-level math, a sibling of `w:p` inside the body. */
const BLOCK_MATH = '<m:oMathPara><m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath></m:oMathPara>';

/** Inline math, a direct child of `w:p`. */
const INLINE_MATH = '<m:oMath><m:r><m:t>y=2</m:t></m:r></m:oMath>';

/** Two cells of the same words plus a nested table: repeated content, distinct paths. */
const REPEATED_TABLE =
  '<w:tbl>'
  + '<w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>'
  + '<w:tr>'
  + '<w:tc><w:tcPr/><w:p><w:r><w:t>重复格</w:t></w:r></w:p></w:tc>'
  + '<w:tc><w:tcPr/><w:p><w:r><w:t>重复格</w:t></w:r></w:p></w:tc>'
  + '</w:tr>'
  + '<w:tr>'
  + '<w:tc><w:tcPr/>'
  + '<w:p><w:r><w:t>外层</w:t></w:r></w:p>'
  + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>嵌套</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
  + '</w:tc>'
  + '<w:tc><w:tcPr/><w:p><w:r><w:t>第二行</w:t></w:r></w:p></w:tc>'
  + '</w:tr>'
  + '</w:tbl>';

/** Body content of {@link mixedDocx}: every rule the P3.3 index must hold. */
export const MIXED_BODY =
  SPACED_PARAGRAPH
  + '<w:p/>'
  + SPACED_PARAGRAPH
  + '<w:p><w:r><w:t>😀A</w:t></w:r></w:p>'
  + '<w:p>'
  + `<w:r><w:t>图</w:t>${DRAWING}</w:r>`
  + '<w:r><w:sym w:font="Wingdings" w:char="F0E7"/></w:r>'
  + '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
  + '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
  + '<w:del w:id="1" w:author="老师"><w:r><w:delText>旧字</w:delText></w:r></w:del>'
  + INLINE_MATH
  + '<w:r><w:t>尾</w:t></w:r>'
  + '<w:r><w:br w:type="page"/></w:r>'
  + '</w:p>'
  + `<w:p><w:r>${TEXT_BOX}</w:r></w:p>`
  + BLOCK_MATH
  + REPEATED_TABLE
  + REPEATED_TABLE
  + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>';

/**
 * The mixed fixture: duplicate paragraphs and duplicate tables, Chinese text,
 * an emoji, a hyperlink run, spaces, tabs and line breaks, an image, an inline
 * and a block formula, a symbol, a field, a tracked deletion, a text box, plus
 * the parts this index must leave to the previewer.
 */
export function mixedDocx(): Uint8Array {
  return buildDocx(
    [
      { path: 'word/document.xml', xml: documentXml(MIXED_BODY) },
      { path: 'word/header1.xml', xml: wmlPart('hdr', '<w:p><w:r><w:t>页眉字</w:t></w:r></w:p>') },
      { path: 'word/footer2.xml', xml: wmlPart('ftr', '<w:p><w:r><w:t>页脚字</w:t></w:r></w:p>') },
      { path: 'word/footnotes.xml', xml: wmlPart('footnotes', '<w:footnote w:id="1"><w:p><w:r><w:t>注脚字</w:t></w:r></w:p></w:footnote>') },
      { path: 'word/comments.xml', xml: wmlPart('comments', '<w:comment w:id="0" w:author="老师"><w:p><w:r><w:t>批注字</w:t></w:r></w:p></w:comment>') },
      { path: 'word/styles.xml', xml: wmlPart('styles', '<w:style w:type="paragraph" w:styleId="Normal"/>') },
    ],
    [{ path: 'word/media/image1.png', bytes: ONE_PIXEL_PNG }],
  );
}

/** One entry of a ZIP archive as read by {@link readZipEntries}. */
export interface ZipEntry {
  readonly name: string;
  /** 0 = stored, 8 = deflate. */
  readonly method: number;
  /** The inflated bytes decoded as UTF-8 text. */
  readonly text: string;
}

/**
 * Read a ZIP through its central directory and `node:zlib`, with no help from
 * fflate. This is the fixture's own proof that it is a real archive; sizes come
 * from the central directory, which is what a writer emits when it knows them.
 */
export function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findSignature(bytes, 0x06054b50);
  if (end < 0) throw new Error('这个 fixture 不是 ZIP：找不到中央目录结尾。');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('中央目录条目签名不对。');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({ name, method, text: decoder.decode(inflateLocalEntry(bytes, view, localOffset, compressedSize, method)) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function inflateLocalEntry(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  compressedSize: number,
  method: number,
): Uint8Array {
  if (view.getUint32(offset, true) !== 0x04034b50) throw new Error('本地文件头签名不对。');
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extraLength;
  const raw = bytes.subarray(start, start + compressedSize);
  return method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw;
}

/** Offset of a little-endian ZIP signature, scanned from the end of the archive. */
function findSignature(bytes: Uint8Array, signature: number): number {
  for (let index = bytes.length - 4; index >= 0; index -= 1) {
    if (
      bytes[index] === (signature & 0xff)
      && bytes[index + 1] === ((signature >> 8) & 0xff)
      && bytes[index + 2] === ((signature >> 16) & 0xff)
      && bytes[index + 3] === ((signature >> 24) & 0xff)
    ) {
      return index;
    }
  }
  return -1;
}
