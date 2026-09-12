/**
 * Text and Markdown selections → `text` locators (1-based lines, 0-based
 * UTF-16 columns, end-exclusive).
 *
 * Plain text has an exact map: the `<pre>` holds the source text and nothing
 * else, so a DOM offset *is* a source offset. Markdown is rendered HTML, so the
 * DOM no longer carries source offsets; there the quote is located in the real
 * source and the selection is only accepted when that position is the one the
 * reader actually sees — a repeated phrase with no way to tell the occurrences
 * apart yields no locator instead of a plausible-looking wrong one.
 */
import type { SourceLocator } from '@studyforge/contracts/materials';

/** One text locator; the union member is narrowed rather than re-declared. */
export type TextLocator = Extract<SourceLocator, { kind: 'text' }>;
import { round4 } from './geometry.ts';

/** One selected span, described in the source's own text. */
export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

/** Exact source offsets for a selection inside an element whose text *is* the source. */
export function plainTextSpan(root: HTMLElement, range: Range): TextSpan | undefined {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return undefined;
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const end = start + range.toString().length;
  return end > start ? { start, end } : undefined;
}

/** One `text` locator from character offsets in the source text. */
export function textLocator(source: string, span: TextSpan): TextLocator | undefined {
  if (span.start < 0 || span.end > source.length || span.end <= span.start) return undefined;
  const start = pointAt(source, span.start);
  const end = pointAt(source, span.end);
  if (end.line < start.line || (end.line === start.line && end.column <= start.column)) return undefined;
  return { kind: 'text', start: { line: start.line, column: start.column }, end: { line: end.line, column: end.column } };
}

/**
 * Source offsets for a quote selected in rendered Markdown.
 *
 * `renderedOffset` is where the selection sits in the *rendered* text, which is
 * what tells two identical quotes apart: the occurrence the reader sees is the
 * one whose preceding text matches the source prefix. Ambiguity fails closed.
 */
export function markdownSpan(source: string, quote: string, renderedPrefix: string): TextSpan | undefined {
  if (quote === '') return undefined;
  const positions: number[] = [];
  for (let at = source.indexOf(quote); at >= 0; at = source.indexOf(quote, at + 1)) positions.push(at);
  if (positions.length === 0) return undefined;
  if (positions.length === 1) return { start: positions[0] as number, end: (positions[0] as number) + quote.length };
  // Several occurrences: keep only those whose source prefix the reader's own
  // rendered prefix is a real (whitespace-tolerant) subsequence of.
  // Rendered text is not a source map. Repeated text needs the exact source
  // view; dropping markup characters can confuse formulas and repeated rows.
  return undefined;
}

/** One `{ line, column }` point for a character offset; 1-based lines, 0-based columns. */
export function pointAt(text: string, offset: number): { readonly line: number; readonly column: number } {
  let line = 1, lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === '\n') { line += 1; lineStart = index + 1; }
  }
  return { line, column: offset - lineStart };
}

/** Collapse whitespace and drop markup characters so rendered and source text can be compared. */
function normalize(text: string): string {
  return text.replace(/[#*`>\s]+/g, '');
}

/** The visible source text before `offset`: what a reader would have seen above the quote. */
function visibleSource(source: string, offset: number): string {
  return source.slice(0, offset).replace(/[#*`>]+/g, '');
}

/** Round a span for storage; kept here so both adapters agree on the tolerance. */
export function stableSpan(span: TextSpan): TextSpan {
  return { start: Math.trunc(round4(span.start)), end: Math.trunc(round4(span.end)) };
}
