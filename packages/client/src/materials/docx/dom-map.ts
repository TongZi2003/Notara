/**
 * P3.3 exact DOM mapping for the DOCX preview.
 *
 * The rendered preview is aligned to the OOXML index by **the complete
 * structural path**, and the alignment is all-or-nothing. The walk rebuilds the
 * same `name[index]` chain the index builds (`body/p[3]`,
 * `body/tbl[0]/tr[1]/tc[0]/p[0]`, …) from the previewer's own layout; before a
 * single id is written, the whole body is checked one paragraph at a time:
 *
 * 1. no element the walk does not know may appear, because a wrapper it cannot
 *    read is a structure it cannot verify;
 * 2. the paragraph count on both sides must be equal — a paragraph the
 *    previewer dropped (a `w:customXml` story, for example) shifts every later
 *    duplicate onto its neighbour's path, so the count is the guard that keeps a
 *    repeated paragraph from being bound to the wrong one;
 * 3. every paragraph's path must equal the index's path at the same position,
 *    and its rendered text must equal that block's text once layout characters
 *    are projected away.
 *
 * If any of those fails, this pass writes **no** ids at all and reports why.
 * An unpositioned paragraph is the honest outcome; a plausible-looking binding
 * that a reader could navigate to the wrong place is not.
 *
 * Text comparison keeps ordinary spaces (`a b` and `ab` are different
 * originals) and removes only the layout characters the previewer draws instead
 * of printing — tab and line break, exactly what
 * `@studyforge/domain/docx-text`'s `projectWithoutLayout` removes.
 *
 * The previewer's own wrappers have one fixed reading each: `section` (page) and
 * `article` (its content) are transparent and keep their parent's numbering;
 * `header`, `footer`, `ol`, `ul`, `li` and `aside` are preview-only stories the
 * index never locates. `w:sdt` is a real index step that the previewer flattens
 * while parsing, so a document using it simply fails check 2 or 3 and reports
 * itself unpositioned.
 */
import type { DocxIndex, DocxPathStep } from '@studyforge/domain/docx';
import { projectWithoutLayout } from '@studyforge/domain/docx-text';

/** Attribute that carries the OOXML `blockId` on a rendered element. */
export const DOCX_BLOCK_ATTRIBUTE = 'data-sf-block-id';

/** What one alignment pass produced, including what it honestly could not place. */
export interface DocxDomMap {
  /** True only when every body paragraph was bound to its own exact path. */
  readonly positioned: boolean;
  /** Ids written this pass; zero whenever `positioned` is false. */
  readonly mapped: number;
  /** Paths where the two sides disagreed (structure order or text). */
  readonly conflicts: readonly string[];
  /** Index blocks with no paragraph left for them. */
  readonly unmatchedBlocks: readonly string[];
  /** Rendered paragraphs with no index block left for them. */
  readonly unmappedElements: readonly HTMLElement[];
  /** Unknown wrapper tags the walk refused to look through, de-duplicated. */
  readonly unverifiedWrappers: readonly string[];
}

/** One rendered paragraph with the path the OOXML body would spell for it. */
interface RenderedParagraph {
  readonly element: HTMLElement;
  readonly path: readonly DocxPathStep[];
  readonly text: string;
}

/** Sibling counters of one flow container: paragraphs and tables, by local name. */
interface FlowCounters {
  paragraphs: number;
  tables: number;
}

/** The index's own root step: `body` carries no index, exactly as `blockIdOf` spells it. */
const BODY_ROOT: DocxPathStep = { name: 'body', index: 0 };

/** The previewer's layout wrappers, which are not OOXML flow elements. */
const TRANSPARENT_WRAPPERS = new Set(['section', 'article']);

/** Preview-only stories the index never locates. */
const PREVIEW_ONLY_STORIES = new Set(['header', 'footer', 'ol', 'ul', 'li', 'aside']);

/**
 * Bind every rendered paragraph to the index block at its own exact path.
 * @param root - the container the previewer rendered into.
 * @param index - the Host's index of the exact bytes that were rendered.
 * @returns the mapping result; ids are present only when it verified completely.
 */
export function applyDocxDomMap(root: HTMLElement, index: DocxIndex): DocxDomMap {
  // A re-render or a new version must not keep yesterday's ids.
  for (const stale of root.querySelectorAll(`[${DOCX_BLOCK_ATTRIBUTE}]`)) stale.removeAttribute(DOCX_BLOCK_ATTRIBUTE);
  const unverifiedWrappers = new Set<string>();
  const rendered = collectRenderedParagraphs(root, unverifiedWrappers);
  const verdict = verifyAlignment(rendered, index, unverifiedWrappers);
  if (!verdict.positioned) return verdict;
  for (const [position, paragraph] of rendered.entries()) {
    const block = index.blocks[position];
    if (block === undefined) return verdict;
    paragraph.element.setAttribute(DOCX_BLOCK_ATTRIBUTE, block.blockId);
  }
  return { ...verdict, mapped: rendered.length };
}

/** The rendered element one block id landed on, when this pass placed it. */
export function docxBlockElement(root: HTMLElement, blockId: string): HTMLElement | undefined {
  const found = root.querySelector(`[${DOCX_BLOCK_ATTRIBUTE}="${blockId}"]`);
  return found instanceof HTMLElement ? found : undefined;
}

/**
 * Decide whether the two sides are one structure before anything is claimed.
 * @returns the complete result; `positioned` is false whenever any check failed.
 */
function verifyAlignment(
  rendered: readonly RenderedParagraph[],
  index: DocxIndex,
  unverifiedWrappers: ReadonlySet<string>,
): DocxDomMap {
  const blocks = index.blocks;
  const conflicts: string[] = [];
  for (const [position, paragraph] of rendered.entries()) {
    const block = blocks[position];
    if (block === undefined) break;
    const blockId = block.blockId;
    if (blockIdOf(paragraph.path) !== blockId) { conflicts.push(blockId); continue; }
    if (projectWithoutLayout(block.text).text !== paragraph.text) { conflicts.push(blockId); }
  }
  const unmatchedBlocks = rendered.length < blocks.length ? blocks.slice(rendered.length).map(block => block.blockId) : [];
  const unmappedElements = blocks.length < rendered.length ? rendered.slice(blocks.length).map(paragraph => paragraph.element) : [];
  const positioned = unverifiedWrappers.size === 0
    && rendered.length === blocks.length
    && conflicts.length === 0;
  return {
    positioned,
    mapped: 0,
    conflicts,
    unmatchedBlocks,
    unmappedElements,
    unverifiedWrappers: [...unverifiedWrappers],
  };
}

/** One path spelled exactly as the index's `blockIdOf` spells it. */
function blockIdOf(path: readonly DocxPathStep[]): string {
  return path.map((step, position) => position === 0 ? step.name : `${step.name}[${String(step.index)}]`).join('/');
}

/** The text a rendered paragraph prints, with non-breaking spaces read as ordinary ones. */
function renderedText(element: Element): string {
  return (element.textContent ?? '').replace(/\u00a0/gu, ' ');
}

/** Every rendered paragraph of the body flow, in document order. */
function collectRenderedParagraphs(root: HTMLElement, unverifiedWrappers: Set<string>): RenderedParagraph[] {
  const out: RenderedParagraph[] = [];
  walkFlow(root, [BODY_ROOT], { paragraphs: 0, tables: 0 }, out, unverifiedWrappers);
  return out;
}

/**
 * Walk one flow container — the body, a table cell, or the previewer's own
 * transparent wrapper — numbering `w:p` and `w:tbl` siblings exactly as the
 * index does.
 */
function walkFlow(
  container: Element,
  base: readonly DocxPathStep[],
  counters: FlowCounters,
  out: RenderedParagraph[],
  unverifiedWrappers: Set<string>,
): void {
  for (const child of container.children) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'p') {
      const path = [...base, { name: 'p', index: counters.paragraphs }];
      counters.paragraphs += 1;
      out.push({ element: child as HTMLElement, path, text: renderedText(child) });
      continue;
    }
    if (tag === 'table') {
      const path = [...base, { name: 'tbl', index: counters.tables }];
      counters.tables += 1;
      walkTable(child, path, out, unverifiedWrappers);
      continue;
    }
    if (PREVIEW_ONLY_STORIES.has(tag)) continue;
    if (TRANSPARENT_WRAPPERS.has(tag)) {
      walkFlow(child, base, counters, out, unverifiedWrappers);
      continue;
    }
    // An element this mapping does not know: its subtree is never claimed.
    unverifiedWrappers.add(tag);
  }
}

/** Walk one rendered table into rows, cells, and the flow inside each cell. */
function walkTable(table: Element, base: readonly DocxPathStep[], out: RenderedParagraph[], unverifiedWrappers: Set<string>): void {
  let rows = 0;
  for (const row of rowElements(table)) {
    const rowPath = [...base, { name: 'tr', index: rows }];
    rows += 1;
    let cells = 0;
    for (const cell of row.children) {
      const tag = cell.tagName.toLowerCase();
      if (tag !== 'td' && tag !== 'th') continue;
      const cellPath = [...rowPath, { name: 'tc', index: cells }];
      cells += 1;
      // A cell numbers its own paragraphs and nested tables from zero.
      walkFlow(cell, cellPath, { paragraphs: 0, tables: 0 }, out, unverifiedWrappers);
    }
  }
}

/** Direct `tr` children, or the rows of an explicit/implicit row group. */
function rowElements(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of table.children) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'tr') rows.push(child);
    else if (tag === 'tbody' || tag === 'thead' || tag === 'tfoot') {
      for (const row of child.children) if (row.tagName.toLowerCase() === 'tr') rows.push(row);
    }
  }
  return rows;
}
