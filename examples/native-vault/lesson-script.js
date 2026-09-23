// One Markdown source, shared by the editor and the teacher's bounded reader.
// This is a deliberately small authoring contract: public ## stages, the card's
// 内容/参考理解/学生理解 sections, and line-delimited <details> blocks. It never
// interprets or executes HTML.
import { markdownLines } from './learning-data.js';
import { parseFrontmatter } from './frontmatter.js';

const CLOSE = /^ {0,3}<\/details>\s*$/i;
// The opening line may keep the summary beside the tag: the teaching skills
// write the shorthand `<details><summary>原文参考答案</summary>` for a card that
// cites the real answer. Text after the tag that is not a summary stays ordinary
// prose, so a line that only mentions `<details>` never hides the material that
// follows it.
const HEAD = /^ {0,3}<details(?:\s+[^<>]*)?>/i;
const HEAD_SUMMARY = /^[ \t]*<summary\b[^>]*>[\s\S]*?<\/summary>/i;
const INLINE_CLOSE = /<\/details\s*>/i;
const SUMMARY_START = '<!-- notara:lesson-summary';
const fail = code => { throw new Error(code); };

/** Source lines outside YAML, fenced/indented code and HTML comments. */
function structuralLines(content) {
  const lines = markdownLines(content);
  let yaml = lines[0]?.text.replace(/^\uFEFF/, '').trim() === '---', fence = null, comment = false;
  return lines.map((line, index) => {
    const row = { ...line, number: index + 1, structural: false };
    if (yaml) { if (index && /^(---|\.\.\.)\s*$/.test(line.text)) yaml = false; return row; }
    if (fence) {
      const end = line.text.match(/^ {0,3}(`+|~+)\s*$/);
      if (end && end[1][0] === fence[0] && end[1].length >= fence.length) fence = null;
      return row;
    }
    if (comment) { if (line.text.includes('-->')) comment = false; return row; }
    const start = line.text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (start) { fence = start[1]; return row; }
    if (/^( {4}|\t)/.test(line.text)) return row;
    if (line.text.trimStart().startsWith('<!--')) {
      row.summaryStart = line.text.trim() === SUMMARY_START;
      comment = !line.text.includes('-->');
      return row;
    }
    row.structural = true;
    return row;
  });
}

/** Outermost disclosure blocks, using UTF-16 offsets for CodeMirror. A broken
 * closing tag stays collapsed through EOF and is reported to authoring tools. */
export function teacherBlocks(content) {
  const text = String(content ?? ''), blocks = [];
  let root = null, depth = 0;
  const finish = (from, openEnd, to, bodyTo, closed) => {
    const inner = text.slice(openEnd, bodyTo);
    const summary = inner.match(/^\s*<summary\b[^>]*>([\s\S]*?)<\/summary>[ \t]*(?:\r?\n)?/i);
    blocks.push({ from, to, bodyFrom: openEnd + (summary?.[0].length ?? 0), bodyTo,
      summary: summary ? summary[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 160) || '教师参考' : '教师参考', closed });
  };
  for (const line of structuralLines(text)) {
    if (!line.structural) continue;
    const opening = detailsHead(line.text);
    if (opening) {
      if (!depth) root = { from: line.start, openEnd: line.start + opening.end };
      depth += 1;
      // A block that opens and closes on its own line is whole by itself: there
      // is no separate `</details>` line left to wait for.
      if (opening.close !== null) {
        depth -= 1;
        if (!depth && root) { finish(root.from, root.openEnd, line.end, line.start + opening.close, true); root = null; }
      }
    } else if (CLOSE.test(line.text) && depth) {
      depth -= 1;
      if (!depth) { finish(root.from, root.openEnd, line.end, line.start, true); root = null; }
    }
  }
  if (root) finish(root.from, root.openEnd, text.length, text.length, false);
  return blocks;
}

/** One line's real disclosure opening: the `<details …>` tag, an optional
 * `<summary>…</summary>` written beside it, and — for a block that never leaves
 * its own line — the offset of the closing tag that ends it. */
function detailsHead(text) {
  const head = HEAD.exec(text);
  if (!head) return null;
  const rest = text.slice(head[0].length);
  if (!rest.trim()) return { end: head[0].length, close: null };
  const summary = HEAD_SUMMARY.exec(rest);
  if (!summary) return null;
  const close = INLINE_CLOSE.exec(rest.slice(summary[0].length));
  return { end: head[0].length, close: close ? head[0].length + summary[0].length + close.index : null };
}

const H2 = /^ {0,3}##\s+(.+?)(?:\s+#+)?\s*$/;
// The card's three sections are the contract the card templates, the card
// material skills and the knowledge graph all read: the question, the teacher's
// own understanding, and what the student really said.
const CARD_TYPES = new Set(['card', 'insight', 'topic']);
const CARD_FACT_TITLES = ['内容', '原文摘录'];
const CARD_STUDENT_TITLE = '学生理解';
const CARD_UNDERSTANDING_TITLES = ['参考理解', '教师理解'];

function frontmatterType(content) {
  try {
    const { frontmatter } = parseFrontmatter(content);
    return typeof frontmatter?.type === 'string' ? frontmatter.type.trim() : '';
  } catch {
    // Incomplete YAML must not decide what the reader sees.
    return '';
  }
}

/**
 * The 教师理解 part of a card: the `## 参考理解` section — the current contract
 * name, with `## 教师理解` accepted as well — that a learner opens on purpose
 * while 内容 and 学生理解 stay in the flow.
 *
 * Only a real card folds: a page whose own frontmatter declares one of the card
 * types, or — when it declares no type at all — a page carrying the whole
 * three-section shape. A lesson stage that merely happens to be called 参考理解
 * stays public material. Ranges are UTF-16 offsets for the editor, and an empty
 * list means this page has nothing of the kind.
 */
export function cardUnderstandingSections(content) {
  const text = String(content ?? ''), lines = structuralLines(text), blocks = teacherBlocks(text);
  const inside = point => blocks.some(block => point >= block.from && point < block.to);
  const headings = [];
  lines.forEach((line, index) => {
    if (!line.structural || inside(line.start)) return;
    const match = H2.exec(line.text);
    if (match) headings.push({ title: match[1].trim(), from: line.start, bodyFrom: lines[index + 1]?.start ?? text.length });
  });
  const titles = new Set(headings.map(row => row.title));
  const understanding = headings.some(row => CARD_UNDERSTANDING_TITLES.includes(row.title));
  // A declared type is authoritative — a lesson script that happens to use the
  // same three words is student material. Only a page with no type at all is
  // read by its shape, so a hand-written card still folds.
  const declared = frontmatterType(text);
  const card = declared
    ? CARD_TYPES.has(declared)
    : CARD_FACT_TITLES.some(title => titles.has(title)) && titles.has(CARD_STUDENT_TITLE);
  if (!understanding || !card) return [];
  return headings.flatMap((heading, index) => {
    if (!CARD_UNDERSTANDING_TITLES.includes(heading.title)) return [];
    const to = headings[index + 1]?.from ?? text.length;
    // A heading whose own line already runs past the section keeps the file readable.
    if (to <= heading.from + 1) return [];
    return [{ from: heading.from, to, bodyFrom: Math.min(heading.bodyFrom, to), bodyTo: to, title: heading.title }];
  });
}

/** Index only public level-two headings. Headings in answers, code, YAML and
 * appended classroom logs never become teaching stages. Keys are derived, not
 * written into the file; consumers must pair them with the real revision. */
export function lessonScriptIndex(content) {
  const text = String(content ?? ''), lines = structuralLines(text), blocks = teacherBlocks(text);
  const inside = point => blocks.some(block => point >= block.from && point < block.to);
  const summary = lines.find(line => line.summaryStart && !inside(line.start));
  const end = summary?.start ?? text.length;
  let start = 0;
  if (lines[0]?.text.replace(/^\uFEFF/, '').trim() === '---') {
    const close = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line.text));
    start = close < 0 ? end : (lines[close + 1]?.start ?? end);
  }
  const headings = lines.filter(line => line.structural && line.start >= start && line.start < end && !inside(line.start))
    .flatMap(line => {
      const match = H2.exec(line.text);
      return match ? [{ title: match[1].trim(), from: line.start }] : [];
    });
  const first = headings[0]?.from ?? end;
  if (text.slice(start, first).trim()) headings.unshift({ title: '本课导览', from: start });
  const lineAt = offset => {
    let low = 0, high = lines.length - 1;
    while (low < high) { const mid = Math.ceil((low + high) / 2); if (lines[mid].start <= offset) low = mid; else high = mid - 1; }
    return low + 1;
  };
  const sections = headings.map((heading, index) => {
    const to = headings[index + 1]?.from ?? end;
    return { key: `section-${index + 1}`, title: heading.title, from: heading.from, to,
      lineFrom: lineAt(heading.from), lineTo: lineAt(Math.max(heading.from, to - 1)),
      teacherCount: blocks.filter(block => block.from >= heading.from && block.from < to).length };
  });
  return { sections, teacherBlocks: blocks, warnings: blocks.some(block => !block.closed) ? ['lesson_teacher_block_unclosed'] : [] };
}

function assertLesson(document, expectedRevision) {
  if ((document?.type ?? document?.frontmatter?.type) !== 'lesson' || typeof document?.content !== 'string') fail('lesson_script_required');
  if (expectedRevision !== undefined && expectedRevision !== document.revision) fail('vault_reference_stale');
}

/** No body or teacher answers in the outline, even for older lesson formats. */
export function lessonOutline(document, { expectedRevision, offset = 0, limit = 40 } = {}) {
  assertLesson(document, expectedRevision);
  if (!Number.isInteger(offset) || offset < 0) fail('vault_offset_invalid');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('vault_limit_invalid');
  const index = lessonScriptIndex(document.content), total = index.sections.length;
  const sections = index.sections.slice(offset, offset + limit).map(({ key, title, lineFrom, lineTo, teacherCount }) => ({ key, title: title.slice(0, 200), lineFrom, lineTo, teacherCount }));
  return { path: document.path, title: document.title, revision: document.revision, ref: document.ref,
    sections, total, offset, nextOffset: offset + sections.length < total ? offset + sections.length : null,
    bodyRead: false, warnings: index.warnings };
}

/** Read one stage including its adjacent teacher notes. Pagination is explicit
 * and counted in Unicode code points, so long proofs are never silently lost. */
export function readLessonStage(document, { section, expectedRevision, offset = 0, limit = 6000 } = {}) {
  if (typeof expectedRevision !== 'string' || !expectedRevision) fail('vault_reference_invalid');
  assertLesson(document, expectedRevision);
  if (!Number.isInteger(offset) || offset < 0) fail('vault_offset_invalid');
  if (!Number.isInteger(limit) || limit < 1 || limit > 12000) fail('vault_limit_invalid');
  const index = lessonScriptIndex(document.content);
  if (index.warnings.length) fail(index.warnings[0]);
  const stage = index.sections.find(item => item.key === section);
  if (!stage) fail('lesson_section_not_found');
  const body = Array.from(document.content.slice(stage.from, stage.to)), total = body.length;
  if (offset > total) fail('vault_offset_invalid');
  const content = body.slice(offset, offset + limit).join('');
  const nextOffset = offset + limit < total ? offset + limit : null;
  return { path: document.path, title: document.title, revision: document.revision, ref: document.ref,
    section: stage.key, sectionTitle: stage.title, lineFrom: stage.lineFrom, lineTo: stage.lineTo,
    content, teacherCount: stage.teacherCount, audience: 'teacher', offset, total, nextOffset,
    offsetUnit: 'unicode-code-points', truncated: nextOffset !== null };
}
