/**
 * Word selections → `docx` locators (`part` + `blockId` + UTF-16 offsets).
 *
 * The preview stamps every paragraph it could map to an index block with that
 * block's own id, so the locator is read from the element the reader really
 * selected in — never from the quote. A selection that crosses paragraphs
 * becomes one locator per paragraph; text in a paragraph with no stamped id is
 * not positionable and yields nothing rather than a neighbour's id.
 */
import type { SourceLocator } from '@studyforge/contracts/materials';

/** One Word locator; the union member is narrowed rather than re-declared. */
export type DocxLocator = Extract<SourceLocator, { kind: 'docx' }>;

/** The default part name the DocumentPreview contract uses for the main body. */
export const DOCX_MAIN_PART = 'word/document.xml';

/** One stamped block: the element plus its part and block identity. */
export interface StampedBlock {
  readonly element: HTMLElement;
  readonly part: string;
  readonly blockId: string;
}

/** The stamped block containing one node, if any. */
export function stampedBlockOf(root: HTMLElement, node: Node): StampedBlock | undefined {
  const start = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const element = start?.closest('[data-sf-block-id]');
  if (!(element instanceof HTMLElement) || !root.contains(element)) return undefined;
  const blockId = element.dataset.sfBlockId;
  if (blockId === undefined || blockId === '') return undefined;
  return { element, part: element.dataset.sfPart ?? root.dataset.sfPart ?? DOCX_MAIN_PART, blockId };
}

/**
 * One locator per paragraph the selection touches.
 *
 * A selection that stays inside one paragraph is the common case; a selection
 * that spans paragraphs is split so no locator claims text from another block.
 */
export function docxLocators(root: HTMLElement, range: Range): readonly DocxLocator[] {
  if (stampedBlockOf(root, range.startContainer) === undefined || stampedBlockOf(root, range.endContainer) === undefined) return [];
  const parts: DocxLocator[] = [];
  for (const element of root.querySelectorAll<HTMLElement>('[data-sf-block-id]')) {
    if (!range.intersectsNode(element)) continue;
    const block = stampedBlockOf(root, element);
    if (block === undefined) continue;
    const selected = document.createRange();
    selected.selectNodeContents(element);
    if (element.contains(range.startContainer)) selected.setStart(range.startContainer, range.startOffset);
    if (element.contains(range.endContainer)) selected.setEnd(range.endContainer, range.endOffset);
    const offsets = offsetsIn(element, selected);
    if (offsets !== undefined) parts.push({ kind: 'docx', part: block.part, blockId: block.blockId, start: offsets[0], end: offsets[1] });
  }
  return parts;
}

/** UTF-16 offsets of the range inside one block element, end-exclusive. */
function offsetsIn(block: HTMLElement, range: Range): readonly [number, number] | undefined {
  const start = offsetWithin(block, range.startContainer, range.startOffset);
  const end = offsetWithin(block, range.endContainer, range.endOffset);
  if (start === undefined || end === undefined || end <= start) return undefined;
  return [start, end];
}

/** Character offset of one (node, offset) pair inside `block`. */
function offsetWithin(block: HTMLElement, node: Node, offset: number): number | undefined {
  if (!block.contains(node)) return undefined;
  const before = document.createRange();
  before.selectNodeContents(block);
  before.setEnd(node, offset);
  return before.toString().length;
}
