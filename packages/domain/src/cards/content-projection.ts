/**
 * P5.1 card author-content projection (plan §P5.1).
 *
 * The stored card row keeps two things apart that used to share one Markdown
 * body: the author's own text (`content`) and the system's review ledger
 * (`history`/`review`). Nothing here parses headings out of a body, so a section
 * the author calls 复习 or 重写 is ordinary text and no renderer has to guess
 * where "the system part" would start.
 *
 * Three derived reads come from the same place:
 *  - a content reader P4's learning search can consume: it sees the author's
 *    text and never the review ledger;
 *  - the changed-field projection P5.7 shows as "what one accepted edit really
 *    rewrote", which is the only reason two revisions are compared at all;
 *  - the bounded math-delimiter check the write path runs on text the current
 *    write really changed (`bin/math_content.py`: delimiters and structure, not
 *    mathematical correctness; command-level diagnostics stay with the browser's
 *    KaTeX preview).
 */
import type { CardContent, CardRecord, HostContext } from '@studyforge/contracts';
import type { Saved } from '../storage/record-store.ts';

/** The read side one card store really has; a native `RecordStore` satisfies it. */
export interface CardRecordReader {
  list(ctx: HostContext): Saved<CardRecord>[];
}

/** What P4's learning search needs: authored text with its real ref and revision. */
export interface CardContentReader {
  list(ctx: HostContext): Saved<CardContent>[];
}

/** Author text without the review ledger, so search and renderers never read history as content. */
export function cardContentReader(records: CardRecordReader): CardContentReader {
  return { list: ctx => records.list(ctx).map(row => ({ ...row, data: row.data.content })) };
}

/** One text field the author owns, named the way a projection reports it. */
export interface AuthorTextField {
  readonly field: string;
  readonly text: string;
}

/** Every authored text field; `notes` is author text too, it is simply not searchable content. */
export function authorTextFields(content: CardContent): AuthorTextField[] {
  const fields: AuthorTextField[] = [{ field: 'front', text: content.front }, { field: 'notes', text: content.notes }];
  content.sections.forEach((section, index) => {
    fields.push({ field: `sections[${index}].heading`, text: section.heading });
    fields.push({ field: `sections[${index}].body`, text: section.body });
  });
  return fields;
}

/**
 * The authored text fields this write really changed. A metadata-only edit
 * reports none, which is exactly why it can never be blocked by text that was
 * already stored — only content created or rewritten now is re-checked.
 */
export function changedTextFields(before: CardContent, after: CardContent): AuthorTextField[] {
  const fields: AuthorTextField[] = [];
  if (before.front !== after.front) fields.push({ field: 'front', text: after.front });
  if (before.notes !== after.notes) fields.push({ field: 'notes', text: after.notes });
  const count = Math.max(before.sections.length, after.sections.length);
  for (let index = 0; index < count; index += 1) {
    const previous = before.sections[index];
    const section = after.sections[index];
    // A removed section has no new text to check; an untouched one is not this write's business.
    if (section === undefined) continue;
    if (previous !== undefined && previous.heading === section.heading && previous.body === section.body) continue;
    if (previous?.heading !== section.heading) fields.push({ field: `sections[${index}].heading`, text: section.heading });
    if (previous?.body !== section.body) fields.push({ field: `sections[${index}].body`, text: section.body });
  }
  return fields;
}

/**
 * Which author fields one accepted revision changed, for the P5.7 detail view.
 * The stored row keeps whole revisions; this only names them, it never rewrites
 * the text and never redlines the author's own card back.
 */
export function changedAuthorFields(before: CardContent, after: CardContent): string[] {
  const changed: string[] = [];
  for (const field of ['title', 'presentation', 'front', 'notes', 'tags', 'sources', 'links', 'chapter', 'topic'] as const) {
    if (JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null)) changed.push(field);
  }
  const count = Math.max(before.sections.length, after.sections.length);
  for (let index = 0; index < count; index += 1) {
    if (JSON.stringify(before.sections[index] ?? null) !== JSON.stringify(after.sections[index] ?? null)) changed.push(`sections[${index}]`);
  }
  return changed;
}

/** One problem in an authored text field; it names the place, not a verdict about the math. */
export interface MathIssue {
  readonly code: string;
  readonly field: string;
  readonly line: number;
  readonly column: number;
  readonly excerpt: string;
  readonly message: string;
}

/**
 * LaTeX commands that have no business outside a math delimiter. This is the
 * frozen B set (`bin/math_content.py::_COMMANDS`), not a rule engine.
 */
const LATEX_COMMANDS: ReadonlySet<string> = new Set([
  'sqrt', 'frac', 'dfrac', 'tfrac', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'arcsin', 'arccos', 'arctan', 'log', 'ln', 'exp', 'lim', 'sum', 'prod', 'int', 'oint',
  'vec', 'overline', 'underline', 'hat', 'bar', 'dot', 'ddot', 'text', 'operatorname',
  'left', 'right', 'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'theta', 'lambda',
  'mu', 'pi', 'rho', 'sigma', 'phi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta',
  'Lambda', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega', 'mathbb', 'mathbf', 'mathrm',
  'mathit', 'mathsf', 'ne', 'neq', 'ge', 'geq', 'le', 'leq', 'infty', 'cdot', 'times',
  'angle', 'triangle', 'parallel', 'perp', 'quad', 'qquad', 'begin', 'end',
]);

interface MathSpan { readonly source: string; readonly start: number; readonly end: number; readonly open: string; readonly close: string; }

/** Delimiters in the order B recognised them, longest opener first. */
const DELIMITERS: readonly (readonly [string, string])[] = [['$$', '$$'], ['\\(', '\\)'], ['\\[', '\\]'], ['$', '$']];

/** Markdown that is not prose: fenced blocks and inline code keep their offsets but are not checked. */
export function protectedMarkdown(text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  let fence: string | null = null;
  let index = 0;
  while (index < text.length) {
    const newline = text.indexOf('\n', index);
    const end = newline < 0 ? text.length : newline + 1;
    const line = text.slice(index, end);
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence === null && marker) {
      fence = marker[1]!;
      for (let i = index; i < end; i += 1) mask[i] = true;
    } else if (fence !== null) {
      for (let i = index; i < end; i += 1) mask[i] = true;
      const trimmed = line.replace(/[\r\n]+$/, '');
      const closer = new RegExp(`^ {0,3}${escapeRegExp(fence[0]!)}{${String(fence.length)},}\\s*$`);
      if (trimmed.length > 0 && closer.test(trimmed)) fence = null;
    }
    index = end;
  }
  let at = 0;
  while (at < text.length) {
    if (mask[at] === true || text[at] !== '`') { at += 1; continue; }
    let run = 1;
    while (at + run < text.length && text[at + run] === '`') run += 1;
    const closing = text.indexOf('`'.repeat(run), at + run);
    if (closing < 0) { at += run; continue; }
    for (let i = at; i < closing + run; i += 1) mask[i] = true;
    at = closing + run;
  }
  return mask;
}

/** Delimiters and braces only: this says a card can render, never that the math is right. */
export function checkMath(text: string, field: string): MathIssue[] {
  const mask = protectedMarkdown(text);
  const issues: MathIssue[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if ((code < 32 && text[index] !== '\t' && text[index] !== '\n' && text[index] !== '\r') || code === 127) {
      issues.push(problem(text, index, field, 'control_character', `含不可见控制字符 U+${code.toString(16).toUpperCase().padStart(4, '0')}；请重新输入这一小段，保留正常换行。`));
    }
  }
  const { spans, mathMask } = mathSpans(text, mask, field, issues);
  for (const span of spans) issues.push(...spanProblems(text, span, field));
  for (const match of text.matchAll(/\\([A-Za-z]+)/g)) {
    const index = match.index;
    const command = match[1]!;
    if (mask[index] === true || mathMask[index] === true || escaped(text, index) || !LATEX_COMMANDS.has(command)) continue;
    issues.push(problem(text, index, field, 'bare_latex', `LaTeX 命令 \\${command} 没有放进数学定界符；行内写 \`$…$\`，独立公式写 \`$$…$$\`。`));
  }
  issues.sort((left, right) => left.line - right.line || left.column - right.column || left.code.localeCompare(right.code));
  return issues;
}

/** Every issue in the text fields this write really changed, in field then position order. */
export function mathProblems(fields: readonly AuthorTextField[]): MathIssue[] {
  return fields.flatMap(({ field, text }) => text.length === 0 ? [] : checkMath(text, field));
}

/** One student-readable line per issue; the code stays machine-readable on the issue itself. */
export function formatMathIssue(issue: MathIssue): string {
  return `${issue.field} 第${String(issue.line)}行第${String(issue.column)}列：${issue.message}`;
}

function mathSpans(text: string, mask: readonly boolean[], field: string, issues: MathIssue[]): { spans: MathSpan[]; mathMask: boolean[] } {
  const spans: MathSpan[] = [];
  const mathMask = new Array<boolean>(text.length).fill(false);
  let index = 0;
  while (index < text.length) {
    if (mask[index] === true) { index += 1; continue; }
    const pair = DELIMITERS.find(([open]) => text.startsWith(open, index) && !escaped(text, index));
    if (pair === undefined) { index += 1; continue; }
    const [open, close] = pair;
    // `$5` and `$1,200` are prices, not the start of a formula.
    if (open === '$' && /^\$\d+(?:[.,]\d+)?(?=$|[\s，。；！？、])/.test(text.slice(index))) { index += 1; continue; }
    const from = index + open.length;
    const at = findClose(text, mask, from, close);
    if (at < 0) {
      issues.push(problem(text, index, field, 'unclosed_math', '数学定界符没有闭合；行内用 $…$ 或 \\(…\\)，独立公式用 $$…$$ 或 \\[ … \\]。'));
      for (let i = index; i < text.length; i += 1) mathMask[i] = true;
      break;
    }
    const stop = at + close.length;
    for (let i = index; i < stop; i += 1) mathMask[i] = true;
    spans.push({ source: text.slice(from, at), start: from, end: at, open, close });
    index = stop;
  }
  return { spans, mathMask };
}

function spanProblems(text: string, span: MathSpan, field: string): MathIssue[] {
  const issues: MathIssue[] = [];
  const stack: number[] = [];
  for (let offset = 0; offset < span.source.length; offset += 1) {
    const character = span.source[offset];
    const at = span.start + offset;
    if (character === '{' && !escaped(span.source, offset)) { stack.push(offset); continue; }
    if (character !== '}' || escaped(span.source, offset)) continue;
    if (stack.length > 0) stack.pop();
    else issues.push(problem(text, at, field, 'unbalanced_brace', '公式里有多余的 }；请只修这一段公式的花括号。'));
  }
  for (const offset of stack) issues.push(problem(text, span.start + offset, field, 'unbalanced_brace', '公式里的 { 没有对应的 }；请只修这一段公式的花括号。'));
  for (const match of span.source.matchAll(/(?<!\\)_{2,}/g)) {
    issues.push(problem(text, span.start + match.index, field, 'math_fill_blank', '填空横线不能放进数学定界符；写成 $x=$ ________，不要写 $x=________$。'));
  }
  return issues;
}

function findClose(text: string, mask: readonly boolean[], start: number, close: string): number {
  for (let index = start; index < text.length; index += 1) {
    if (mask[index] !== true && text.startsWith(close, index) && !escaped(text, index)) return index;
  }
  return -1;
}

function escaped(text: string, index: number): boolean {
  let count = 0;
  for (let at = index - 1; at >= 0 && text[at] === '\\'; at -= 1) count += 1;
  return count % 2 === 1;
}

function problem(text: string, index: number, field: string, code: string, message: string): MathIssue {
  const start = text.lastIndexOf('\n', index) + 1;
  const rawEnd = text.indexOf('\n', index);
  const end = rawEnd < 0 ? text.length : rawEnd;
  const excerpt = text.slice(start, end).slice(0, 120).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, character => `\\u${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
  return { code, field, line: text.slice(0, index).split('\n').length, column: index - start + 1, excerpt, message };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
