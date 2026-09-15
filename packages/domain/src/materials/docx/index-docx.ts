/**
 * P3.3 DOCX stable index (docs/migration/2026-09-11-dsh/P3-materials.md §P3.3).
 *
 * `indexDocx` turns the exact bytes of one immutable MaterialVersion into the
 * block list a source anchor points at: `{ kind:'docx'; part; blockId; start;
 * end }` has to resolve again after a re-read, a refresh or a restart, so every
 * id comes from the OOXML structure — the part name plus the same-name sibling
 * path of the paragraph — and never from content, a full-text search or a
 * previewer's DOM. Two paragraphs that happen to hold the same words therefore
 * keep different `blockId`s, two identical tables keep different cell paths, and
 * the same bytes always produce the same index.
 *
 * Indexed: the paragraphs of the main document part (`word/document.xml`)
 * wherever they sit, including table cells and nested tables, each with its
 * merged text and UTF-16 spans. Deliberately not indexed: headers, footers,
 * footnotes, endnotes and comments (separate parts with no reliable mapping into
 * the previewed body), plus the image, OMML formula, symbol glyph, field
 * instruction, text box and tracked-change deletion content inside the body.
 * Those are counted in {@link DocxIndex.notIndexed} instead of being turned into
 * invented text; showing them stays the previewer's job, and this index never
 * claims a position it cannot map.
 */
import { unzip, type UnzipFileInfo } from 'fflate';
import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from '@xmldom/xmldom';
import { MAX_MATERIAL_BYTES } from '@studyforge/contracts/material-records';
import {
  DOCX_LINE_BREAK,
  DOCX_TAB,
  mergeParagraphPieces,
  type DocxBlockSegment,
  type DocxBreakType,
  type DocxInlinePiece,
  type DocxNonTextContent,
} from './normalize-text.ts';

/** The document part every Word-compatible writer uses for body content. */
export const DOCX_MAIN_DOCUMENT_PART = 'word/document.xml';
const WORD_NAMESPACES = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
const MATH_NAMESPACES = new Set(['http://schemas.openxmlformats.org/officeDocument/2006/math', 'http://purl.oclc.org/ooxml/officeDocument/math']);

/**
 * Inflated-size ceiling for the main document part.
 *
 * One imported original is already capped at {@link MAX_MATERIAL_BYTES}
 * compressed, and no single part of it is allowed to expand past that same
 * budget: a small archive whose XML would inflate to gigabytes is refused
 * instead of being allocated, because indexing it could never be bounded.
 */
export const DOCX_MAX_DOCUMENT_BYTES = MAX_MATERIAL_BYTES;

/** Per-call index limits. */
export interface DocxIndexOptions {
  /** Overrides {@link DOCX_MAX_DOCUMENT_BYTES}; a positive integer count of bytes. */
  readonly maxDocumentBytes?: number;
}

/** One step of the structural path that becomes a `blockId`. */
export interface DocxPathStep {
  /** OOXML local name, namespace prefix stripped (`p`, `tbl`, `tr`, `tc`, `sdt`, …). */
  readonly name: string;
  /** 0-based index among siblings with the same local name. */
  readonly index: number;
}

/** Every indexed block is one whole `w:p`; tables are structure, not their own block. */
export type DocxBlockKind = 'paragraph';

/** Where a paragraph sits inside a table, for a caller that maps the rendered grid. */
export interface DocxTablePosition {
  /** Index of the innermost `w:tbl` among its same-name siblings. */
  readonly table: number;
  readonly row: number;
  readonly cell: number;
  /** Index of the paragraph among its cell's `w:p` siblings. */
  readonly paragraph: number;
}

/** One locatable paragraph of one OOXML part. */
export interface DocxBlock {
  /** OOXML part name, e.g. `word/document.xml`. */
  readonly part: string;
  /** `body/p[3]`, `body/tbl[0]/tr[1]/tc[0]/p[0]`, … — unique and stable for these bytes. */
  readonly blockId: string;
  /** Merged paragraph text: spaces, tabs and line breaks as stored, UTF-16 offsets. */
  readonly text: string;
  /** 0-based document order across {@link DocxIndex.blocks}; the key a DOM walk can align on. */
  readonly ordinal: number;
  readonly kind: DocxBlockKind;
  /** The spans `text` was merged from, one per run (plus zero-length non-text spans). */
  readonly segments: readonly DocxBlockSegment[];
  /** The path `blockId` was rendered from, for callers that map structure directly. */
  readonly path: readonly DocxPathStep[];
  /** Present when the paragraph is inside a table cell. */
  readonly table?: DocxTablePosition;
}

/** A structural area that exists in the bytes but carries no locatable block. */
export type DocxUnindexedArea =
  | 'header'
  | 'footer'
  | 'footnotes'
  | 'endnotes'
  | 'comments'
  | 'drawing'
  | 'picture'
  | 'object'
  | 'math'
  | 'symbol'
  | 'field'
  | 'textBox'
  | 'deletedText'
  | 'noteReference'
  | 'commentReference'
  | 'noBreakHyphen'
  | 'softHyphen';

/** How much unindexed content one part holds. Reported, never mapped. */
export interface DocxUnindexedPart {
  readonly area: DocxUnindexedArea;
  readonly part: string;
  readonly count: number;
}

/** The index of one DOCX version. `ordinal` is the position inside `blocks`. */
export interface DocxIndex {
  readonly blocks: readonly DocxBlock[];
  /** Parts this index actually read for blocks; today only the main document part. */
  readonly indexedParts: readonly string[];
  /** Present-but-unmapped content, so a caller can say what it is not locating. */
  readonly notIndexed: readonly DocxUnindexedPart[];
}

/** A DOCX that cannot be indexed exactly. The bytes stay untouched and unindexed. */
export class DocxIndexError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'DocxIndexError';
  }
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

/** Containers the body walk descends into; their names still appear in the path. */
const CONTAINER_NAMES = new Set(['tbl', 'tr', 'tc', 'sdt', 'sdtContent', 'customXml']);

/** Inline wrappers whose child runs belong to the same paragraph. */
const INLINE_WRAPPERS = new Set([
  'hyperlink',
  'smartTag',
  'ins',
  'del',
  'moveTo',
  'moveFrom',
  'sdt',
  'sdtContent',
  'customXml',
  'fldSimple',
  'bdo',
  'dir',
]);

/** Separate parts that a preview-only reader owns: counted, never given block ids. */
const UNINDEXED_PART_AREAS: readonly (readonly [RegExp, DocxUnindexedArea])[] = [
  [/^word\/header\d*\.xml$/, 'header'],
  [/^word\/footer\d*\.xml$/, 'footer'],
  [/^word\/footnotes\.xml$/, 'footnotes'],
  [/^word\/endnotes\.xml$/, 'endnotes'],
  [/^word\/comments\.xml$/, 'comments'],
];

/** Run-child names that carry content but no characters. */
const NON_TEXT_AREAS: Readonly<Record<string, DocxNonTextContent>> = {
  object: 'object',
  oMath: 'math',
  sym: 'symbol',
  instrText: 'field',
  fldChar: 'field',
  delText: 'deletedText',
  footnoteReference: 'noteReference',
  endnoteReference: 'noteReference',
  commentReference: 'commentReference',
  noBreakHyphen: 'noBreakHyphen',
  softHyphen: 'softHyphen',
};

interface WalkState {
  readonly part: string;
  readonly blocks: DocxBlock[];
  readonly unindexed: Map<string, DocxUnindexedPart>;
}

/**
 * Index one DOCX archive.
 * @param bytes - the exact bytes of the version; they are read, never rewritten.
 * @param options - optional ceiling for the main document part's inflated size.
 * @returns blocks in document order plus the content this index does not map.
 * @throws DocxIndexError when the archive, the main part or its XML cannot be
 *   read, when the document part is not UTF-8, or when it would inflate past the
 *   ceiling.
 */
export async function indexDocx(bytes: Uint8Array, options: DocxIndexOptions = {}): Promise<DocxIndex> {
  const maxDocumentBytes = options.maxDocumentBytes ?? DOCX_MAX_DOCUMENT_BYTES;
  if (!Number.isInteger(maxDocumentBytes) || maxDocumentBytes <= 0) {
    throw new RangeError('maxDocumentBytes must be a positive integer number of bytes');
  }
  const { documentXml, partNames } = await readDocxParts(bytes, maxDocumentBytes);
  const document = parseXmlPart(documentXml, DOCX_MAIN_DOCUMENT_PART);
  const body = findBodyElement(document, DOCX_MAIN_DOCUMENT_PART);
  const state: WalkState = { part: DOCX_MAIN_DOCUMENT_PART, blocks: [], unindexed: new Map() };
  walkContainer(body, [{ name: 'body', index: 0 }], state);
  for (const name of partNames) {
    for (const [pattern, area] of UNINDEXED_PART_AREAS) {
      if (pattern.test(name)) countUnindexed(state, area, 1, name);
    }
  }
  return {
    blocks: state.blocks,
    indexedParts: [DOCX_MAIN_DOCUMENT_PART],
    notIndexed: [...state.unindexed.values()].sort(compareUnindexed),
  };
}

interface DocxParts {
  readonly documentXml: string;
  /** Every zip entry name, including the parts this index does not inflate. */
  readonly partNames: readonly string[];
}

async function readDocxParts(bytes: Uint8Array, maxDocumentBytes: number): Promise<DocxParts> {
  const partNames: string[] = [];
  let declaredSize: number | undefined;
  const files = await unzipFiltered(bytes, (file) => {
    partNames.push(file.name);
    if (file.name !== DOCX_MAIN_DOCUMENT_PART) return false;
    declaredSize = file.originalSize;
    // The archive's own size field is checked before anything is inflated, so a
    // part that says it is oversized is never allocated at all.
    return file.originalSize <= maxDocumentBytes;
  });
  if (declaredSize !== undefined && declaredSize > maxDocumentBytes) {
    throw new DocxIndexError('docx_document_too_large',
      `${DOCX_MAIN_DOCUMENT_PART} 声明解压后有 ${String(declaredSize)} 字节，超过 ${String(maxDocumentBytes)} 字节上限，已拒绝，没有解压它。`);
  }
  const documentBytes = files.get(DOCX_MAIN_DOCUMENT_PART);
  if (documentBytes === undefined) {
    throw new DocxIndexError(
      'docx_main_part_missing',
      `DOCX 里没有 ${DOCX_MAIN_DOCUMENT_PART}，没有可以建立索引的正文；先按原文件预览，不要猜正文。`,
    );
  }
  // A header may understate its own size, so what really arrived is the hard stop.
  if (documentBytes.byteLength > maxDocumentBytes) {
    throw new DocxIndexError('docx_document_too_large',
      `${DOCX_MAIN_DOCUMENT_PART} 实际解压出 ${String(documentBytes.byteLength)} 字节，超过 ${String(maxDocumentBytes)} 字节上限，已拒绝。`);
  }
  return { documentXml: decodeDocumentXml(documentBytes), partNames };
}

/**
 * Decode the document part as UTF-8, refusing rather than substituting.
 *
 * A replacement character would keep the parse alive while every offset after
 * it shifted, so a part that is not valid UTF-8 is rejected outright. (Parts
 * written as UTF-16 are therefore refused here as well; every current writer of
 * `.docx` emits UTF-8 XML.)
 */
function decodeDocumentXml(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new DocxIndexError('docx_document_encoding',
      `${DOCX_MAIN_DOCUMENT_PART} 不是合法的 UTF-8 文本（${describe(error)}），按它建的索引会错位，已拒绝。`);
  }
}

/** Inflate only the parts a predicate asks for; every other name is still reported. */
function unzipFiltered(bytes: Uint8Array, wanted: (file: UnzipFileInfo) => boolean): Promise<Map<string, Uint8Array>> {
  return new Promise<Map<string, Uint8Array>>((resolve, reject) => {
    const fail = (error: unknown): void => {
      reject(new DocxIndexError('docx_unreadable', `这个文件不是能解开的 DOCX 压缩包：${describe(error)}`));
    };
    try {
      unzip(bytes, { filter: file => wanted(file) }, (error, files) => {
        if (error) {
          fail(error);
          return;
        }
        resolve(new Map(Object.entries(files)));
      });
    } catch (error) {
      fail(error);
    }
  });
}

function parseXmlPart(xml: string, part: string): XmlDocument {
  const problems: string[] = [];
  let parsed: XmlDocument;
  try {
    parsed = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning') problems.push(message);
      },
    }).parseFromString(xml, 'application/xml');
  } catch (error) {
    throw new DocxIndexError('docx_xml_invalid', `${part} 不是可解析的 OOXML：${describe(error)}`);
  }
  // A recovered parse would silently shift block ids, so it is refused instead.
  const problem = problems[0];
  if (problem !== undefined) {
    throw new DocxIndexError('docx_xml_invalid', `${part} 解析报错，索引会错位：${problem}`);
  }
  return parsed;
}

function findBodyElement(document: XmlDocument, part: string): XmlElement {
  const root = document.documentElement;
  if (root === null) throw new DocxIndexError('docx_document_invalid', `${part} 里没有根元素。`);
  if (root.localName !== 'document' || !WORD_NAMESPACES.has(root.namespaceURI ?? '')) throw new DocxIndexError('docx_document_invalid', `${part} 的根不是 Word 正文。`);
  for (const child of elementChildren(root)) {
    if (localNameOf(child) === 'body') return child;
  }
  throw new DocxIndexError('docx_document_invalid', `${part} 里没有 w:body，读不到正文。`);
}

/**
 * Walk one container in document order. `w:p` becomes a block; the body, tables,
 * rows, cells and content-control wrappers are descended into, each keeping its
 * own same-name sibling index so the path stays unique.
 */
function walkContainer(element: XmlElement, path: readonly DocxPathStep[], state: WalkState): void {
  const counters = new Map<string, number>();
  for (const child of elementChildren(element)) {
    const name = localNameOf(child);
    const index = counters.get(name) ?? 0;
    counters.set(name, index + 1);
    const childPath = [...path, { name, index }];
    if (name === 'p') {
      state.blocks.push(buildParagraph(child, childPath, state));
    } else if (name === 'oMathPara') {
      countUnindexed(state, 'math', 1);
    } else if (CONTAINER_NAMES.has(name)) {
      walkContainer(child, childPath, state);
    }
  }
}

function buildParagraph(paragraph: XmlElement, path: readonly DocxPathStep[], state: WalkState): DocxBlock {
  const pieces: DocxInlinePiece[] = [];
  collectInline(paragraph, pieces, { run: 0 }, state);
  const merged = mergeParagraphPieces(pieces);
  const table = tablePositionOf(path);
  return {
    part: state.part,
    blockId: blockIdOf(path),
    text: merged.text,
    ordinal: state.blocks.length,
    kind: 'paragraph',
    segments: merged.segments,
    path,
    ...(table === undefined ? {} : { table }),
  };
}

/** Runs of one paragraph, including the runs nested in hyperlinks and revisions. */
function collectInline(
  element: XmlElement,
  pieces: DocxInlinePiece[],
  counter: { run: number },
  state: WalkState,
): void {
  for (const child of elementChildren(element)) {
    const name = localNameOf(child);
    if (name === 'r') {
      const run = counter.run;
      counter.run += 1;
      collectRun(child, pieces, run, state);
    } else if (INLINE_WRAPPERS.has(name)) {
      collectInline(child, pieces, counter, state);
    } else if (name === 'oMath' || name === 'drawing' || name === 'pict' || name === 'object') {
      // Inline math and drawing live directly under `w:p` as often as inside a
      // run; either way they mark a position, they never write characters.
      const content = nonTextContentOf(name, child, state);
      if (content !== undefined) pieces.push({ kind: 'nonText', text: '', run: counter.run, content });
    }
  }
}

/** Classify one `w:r`: characters, layout characters, or non-text content. */
function collectRun(run: XmlElement, pieces: DocxInlinePiece[], runIndex: number, state: WalkState): void {
  for (const child of elementChildren(run)) {
    const name = localNameOf(child);
    if (name === 't') {
      const text = textOf(child);
      if (text.length > 0) pieces.push({ kind: 'text', text, run: runIndex });
      continue;
    }
    if (name === 'tab') {
      pieces.push({ kind: 'tab', text: DOCX_TAB, run: runIndex });
      continue;
    }
    if (name === 'br' || name === 'cr') {
      const type = attributeByLocalName(child, 'type');
      const breakType: DocxBreakType = name === 'br' && type === 'page' ? 'page' : 'line';
      pieces.push({ kind: 'break', text: DOCX_LINE_BREAK, run: runIndex, breakType });
      continue;
    }
    const content = nonTextContentOf(name, child, state);
    if (content !== undefined) pieces.push({ kind: 'nonText', text: '', run: runIndex, content });
  }
}

/**
 * Map one run-child name to the non-text content it holds, counting what the
 * index leaves to the previewer. Returns `undefined` for `w:rPr` and the other
 * children that carry no content at all.
 */
function nonTextContentOf(name: string, element: XmlElement, state: WalkState): DocxNonTextContent | undefined {
  if (name === 'drawing' || name === 'pict') return markContainerContent(name, element, state);
  const area = NON_TEXT_AREAS[name];
  if (area === undefined) return undefined;
  countUnindexed(state, area, 1);
  return area;
}

/** A drawing or VML shape: the text boxes inside it are a separate, unmapped area. */
function markContainerContent(name: string, element: XmlElement, state: WalkState): DocxNonTextContent {
  const area: DocxNonTextContent = name === 'drawing' ? 'drawing' : 'picture';
  countUnindexed(state, area, 1);
  if (!hasDescendantNamed(element, 'txbxContent')) return area;
  countUnindexed(state, 'textBox', 1);
  return 'textBox';
}

function hasDescendantNamed(element: XmlElement, name: string): boolean {
  for (const child of elementChildren(element)) {
    if (localNameOf(child) === name || hasDescendantNamed(child, name)) return true;
  }
  return false;
}

function countUnindexed(state: WalkState, area: DocxUnindexedArea, count: number, part = state.part): void {
  const key = `${part}\u0000${area}`;
  const seen = state.unindexed.get(key);
  state.unindexed.set(key, seen === undefined ? { area, part, count } : { area, part, count: seen.count + count });
}

function compareUnindexed(left: DocxUnindexedPart, right: DocxUnindexedPart): number {
  if (left.area !== right.area) return left.area < right.area ? -1 : 1;
  if (left.part === right.part) return 0;
  return left.part < right.part ? -1 : 1;
}

/**
 * `body/tbl[0]/tr[1]/tc[0]/p[0]`: read the path, not a search result. The single
 * `w:body` root is written as `body`; every deeper step counts same-name
 * siblings, so the id is unique inside the part and identical for the same bytes.
 */
function blockIdOf(path: readonly DocxPathStep[]): string {
  return path
    .map((step, position) => (position === 0 ? step.name : `${step.name}[${String(step.index)}]`))
    .join('/');
}

/** The innermost table the trailing paragraph belongs to, if any. */
function tablePositionOf(path: readonly DocxPathStep[]): DocxTablePosition | undefined {
  const last = path[path.length - 1];
  if (last === undefined || last.name !== 'p') return undefined;
  let table = -1;
  let row = -1;
  let cell = -1;
  for (let index = 0; index < path.length - 1; index += 1) {
    const step = path[index];
    if (step === undefined) continue;
    if (step.name === 'tbl') {
      table = step.index;
      row = -1;
      cell = -1;
    } else if (step.name === 'tr') {
      row = step.index;
    } else if (step.name === 'tc') {
      cell = step.index;
    }
  }
  if (table < 0) return undefined;
  return { table, row, cell, paragraph: last.index };
}

function elementChildren(node: XmlNode): XmlElement[] {
  const children: XmlElement[] = [];
  const nodes = node.childNodes;
  for (let index = 0; index < nodes.length; index += 1) {
    const child = nodes.item(index);
    // xmldom's typings model the DOM as non-discriminated interfaces, so the
    // element narrowing happens through nodeType and is spelled as a downcast.
    if (child !== null && child.nodeType === ELEMENT_NODE) children.push(child as XmlElement);
  }
  return children;
}

function textOf(element: XmlElement): string {
  const nodes = element.childNodes;
  let text = '';
  for (let index = 0; index < nodes.length; index += 1) {
    const child = nodes.item(index);
    if (child !== null && (child.nodeType === TEXT_NODE || child.nodeType === CDATA_SECTION_NODE)) {
      text += child.nodeValue ?? '';
    }
  }
  return text;
}

function localNameOf(node: XmlNode): string {
  if (!WORD_NAMESPACES.has(node.namespaceURI ?? '') && !MATH_NAMESPACES.has(node.namespaceURI ?? '')) return 'foreign:' + node.nodeName;
  const local = node.localName;
  if (local !== null && local.length > 0) return local;
  const name = node.nodeName;
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

/** Attribute lookup by local name, so a document may use any namespace prefix. */
function attributeByLocalName(element: XmlElement, localName: string): string | null {
  const attributes = element.attributes;
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes.item(index);
    if (attribute === null) continue;
    if ((attribute.localName ?? attribute.name) === localName) return attribute.value;
  }
  return null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
