/**
 * P3.3 DOCX text normalization (docs/migration/2026-09-11-dsh/P3-materials.md §P3.3).
 *
 * One paragraph becomes one string. `w:t` supplies the characters; `w:tab` and
 * `w:br`/`w:cr` keep their layout characters ('\t', '\n') because the rendered
 * line shows them and P4 maps a real DOM `Range` back to these offsets. Nothing
 * else contributes characters: an image, an OMML formula, a symbol glyph, a
 * field instruction, a text box and tracked-change deletions are recorded as
 * zero-length spans carrying their content kind, so the index never invents text
 * the original bytes do not hold.
 *
 * Offsets are UTF-16 code units, 0-based and end-exclusive — the unit the P1.2
 * `SourceLocator` (`{ kind:'docx'; part; blockId; start; end }`) uses and the
 * unit a DOM `Range` counts in, so one emoji is two units on both sides.
 */

/** `w:tab`: one tab stop in the rendered line. */
export const DOCX_TAB = '\t';
/** `w:br` / `w:cr`: one line break in the rendered line. */
export const DOCX_LINE_BREAK = '\n';

/** What one inline piece contributes to its paragraph. */
export type DocxPieceKind = 'text' | 'tab' | 'break' | 'nonText';

/** `w:br w:type="page"` moves the rest to the next page; the bytes carry no extra line. */
export type DocxBreakType = 'line' | 'page';

/**
 * Non-text inline content. Each of these renders as something real (a picture, a
 * formula, a field result), but none of them carries `w:t` characters, so the
 * index marks the position instead of writing words the DOCX does not contain.
 */
export type DocxNonTextContent =
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

/** One inline piece as read from the OOXML run, before merging. */
export interface DocxInlinePiece {
  readonly kind: DocxPieceKind;
  /** The characters this piece adds; `''` for {@link DocxNonTextContent} pieces. */
  readonly text: string;
  /** 0-based ordinal of the owning `w:r` among the paragraph's runs, in document order. */
  readonly run: number;
  readonly content?: DocxNonTextContent;
  readonly breakType?: DocxBreakType;
}

/** Where one piece landed in the merged paragraph text. */
export interface DocxBlockSegment {
  readonly kind: DocxPieceKind;
  /** UTF-16 offset into the paragraph text, inclusive. */
  readonly start: number;
  /** UTF-16 offset into the paragraph text, exclusive. */
  readonly end: number;
  readonly run: number;
  readonly content?: DocxNonTextContent;
  readonly breakType?: DocxBreakType;
}

/** One paragraph's merged text plus the spans it came from. */
export interface MergedParagraphText {
  readonly text: string;
  readonly segments: readonly DocxBlockSegment[];
}

/** The length unit of every DOCX offset: UTF-16 code units, emoji included. */
export function utf16Length(text: string): number {
  return text.length;
}

/**
 * Merge run-level pieces into paragraph text, recording one span per source run.
 *
 * Runs are merged for the reader (three runs of one word are one word again),
 * while each `run` keeps its provenance. Adjacent pieces of the same run, kind
 * and content are folded into one span so a run written as several `w:t` nodes
 * does not fragment. Empty `w:t` pieces add nothing and are dropped.
 */
export function mergeParagraphPieces(pieces: readonly DocxInlinePiece[]): MergedParagraphText {
  const chunks: string[] = [];
  const segments: DocxBlockSegment[] = [];
  let offset = 0;
  for (const piece of pieces) {
    if (piece.kind === 'text' && piece.text.length === 0) continue;
    const start = offset;
    const end = offset + piece.text.length;
    const previous = segments[segments.length - 1];
    if (
      previous !== undefined &&
      previous.end === start &&
      previous.kind === piece.kind &&
      previous.run === piece.run &&
      previous.content === piece.content &&
      previous.breakType === piece.breakType
    ) {
      segments[segments.length - 1] = {
        ...previous,
        end,
      };
    } else {
      segments.push({
        kind: piece.kind,
        start,
        end,
        run: piece.run,
        ...(piece.content === undefined ? {} : { content: piece.content }),
        ...(piece.breakType === undefined ? {} : { breakType: piece.breakType }),
      });
    }
    chunks.push(piece.text);
    offset = end;
  }
  return { text: chunks.join(''), segments };
}

/** A DOM-shaped view of index text with the OOXML layout characters removed. */
export interface LayoutProjection {
  /** Index text without the layout characters, for comparing against DOM `textContent`. */
  readonly text: string;
  /** For each code unit of {@link text}, the UTF-16 offset it had in the index text. */
  readonly offsets: readonly number[];
}

/**
 * Project index text onto what a previewer's `textContent` shows.
 *
 * Only the characters OOXML keeps structural — tabs and line breaks — are
 * dropped; spaces and every other character stay, so the returned `offsets` map
 * a DOM range back onto real index offsets. This is a projection for P4's
 * DOM mapping, never a search: a caller must still hold the block it compares
 * against, so two identical paragraphs can never be confused for one another.
 */
export function projectWithoutLayout(text: string): LayoutProjection {
  const characters: string[] = [];
  const offsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === undefined) continue;
    if (character === DOCX_TAB || character === DOCX_LINE_BREAK || character === '\r') continue;
    characters.push(character);
    offsets.push(index);
  }
  return { text: characters.join(''), offsets };
}

/**
 * Read one UTF-16 range of a block text, refusing offsets the block cannot hold.
 * @throws RangeError when the range is not a dense integer span inside `text`.
 */
export function rangeText(text: string, start: number, end: number): string {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) {
    throw new RangeError(`DOCX 文本区间 ${start}-${end} 超出这段正文（0-${text.length}），不能按这个范围取原文。`);
  }
  return text.slice(start, end);
}
