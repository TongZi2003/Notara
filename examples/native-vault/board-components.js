/**
 * Board components: the typed code blocks a lesson-board block may carry — the
 * one contract the Host (validation on write, answer checks, the message sent
 * to the teacher) and the page (rendering, drafts) both read. A component is
 * `\`\`\`<type>` … `\`\`\`` inside a block's Markdown body, written line by line;
 * its identity is (block, index among the block's components) plus a
 * fingerprint of what the student is asked, so an answer never silently moves
 * onto a changed question. There is no answer-key field anywhere: whether an
 * answer is right is the teacher's judgement after it arrives.
 */

import { FIGURE_SYNTAX, answerFigure, figureAnswerText, figureIdentity, parseFigure } from './board-figure.js';
import { FLOW_SYNTAX, answerFlow, flowAnswerText, flowBlanks, flowIdentity, parseFlow } from './board-flow.js';
import { FRAMES_SYNTAX, answerFrames, framesAnswerText, framesIdentity, framesSilent, parseFrames, predictedFrames } from './board-frames.js';

const fail = message => { throw new BoardComponentError(message); };
/** Parser errors of every component type carry a line; figure and flow have their own classes. */
const PARSE_ERRORS = new Set(['BoardComponentError', 'FigureError', 'FlowError', 'FramesError']);

export class BoardComponentError extends Error {
  constructor(message, line) { super(message); this.name = 'BoardComponentError'; this.line = line; }
}

/** A short, stable, non-cryptographic fingerprint (cyrb53) shared by both sides. */
export function fingerprint(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761); h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

const MAX_TEXT = 2000;
const clean = value => String(value ?? '').replace(/\r/g, '');
const text = (value, max, message) => {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(message);
  return value.trim();
};
const item = line => line.match(/^\s*[-*]\s+(.*)$/)?.[1]?.trim();

/** Numbered, trimmed, non-empty lines of a component's source. */
function numbered(source) {
  return clean(source).split('\n').map((raw, index) => ({ raw, value: raw.trim(), line: index + 1 })).filter(row => row.value);
}
function lineError(row, message) { throw new BoardComponentError(message, row?.line); }

const AUTO_OPTIONS = ['不确定', '都不对', '都不对，我觉得'];

/** `choice`: 题干 lines, then `- 选项` lines, then optional `multiple` / `reason required|optional`. */
function parseChoice(source) {
  const rows = numbered(source), stem = [], options = [];
  let multiple = false, reason = 'optional', stage = 'stem';
  for (const row of rows) {
    const option = item(row.raw);
    if (option !== undefined) {
      if (stage === 'keywords') lineError(row, '选项要写在 multiple、reason 这些设置之前。');
      stage = 'options';
      if (!option) lineError(row, '选项不能是空的。');
      if (option.length > 300) lineError(row, '一个选项最多 300 字。');
      if (AUTO_OPTIONS.some(auto => option.replace(/[。.…]+$/, '') === auto)) lineError(row, '“不确定”和“都不对，我觉得……”由系统自动加上，不用写。');
      if (options.includes(option)) lineError(row, `选项“${option}”重复了。`);
      options.push(option);
      continue;
    }
    if (stage === 'stem') { stem.push(row.value); continue; }
    stage = 'keywords';
    if (row.value === 'multiple') multiple = true;
    else if (/^reason\s+(required|optional)$/.test(row.value)) reason = row.value.split(/\s+/)[1];
    else lineError(row, `不认识的一行：“${row.value}”。选项以“- ”开头；设置只有 multiple 和 reason required / reason optional。`);
  }
  if (!stem.length) fail('缺少题干：第一行写要问的问题。');
  if (stem.join('\n').length > 600) fail('题干最多 600 字。');
  if (options.length < 2) fail('至少要有两个选项，每个以“- ”开头。');
  if (options.length > 8) fail('选项最多 8 个。');
  return { stem: stem.join('\n'), options, multiple, reason };
}

const BLANK = /\{\{([^{}\n]*)\}\}/g;
/** `blank`: lines with `{{ 提示 }}` holes; an optional first line `code <语言>` makes it code. */
function parseBlank(source) {
  const rows = clean(source).split('\n').map((raw, index) => ({ raw, line: index + 1 }));
  while (rows.length && !rows[0].raw.trim()) rows.shift();
  while (rows.length && !rows.at(-1).raw.trim()) rows.pop();
  let code = null;
  const head = rows[0]?.raw.trim().match(/^code\s+([A-Za-z0-9+#.-]{1,20})$/);
  if (head) { code = head[1].toLowerCase(); rows.shift(); }
  const lines = [], blanks = [];
  for (const row of rows) {
    if (/\{\{/.test(row.raw.replace(BLANK, '')) || /\}\}/.test(row.raw.replace(BLANK, ''))) lineError(row, '空要写成 {{ }} 或 {{ 提示 }}，花括号成对出现且不跨行。');
    for (const match of row.raw.matchAll(BLANK)) {
      const hint = match[1].trim();
      if (hint.length > 40) lineError(row, '空里的提示最多 40 字。');
      blanks.push({ hint, line: lines.length });
    }
    lines.push(code ? row.raw : row.raw.trim());
  }
  if (!blanks.length) fail('至少要留一个空，写成 {{ }}。');
  if (blanks.length > 6) fail('一个补一步最多 6 个空。');
  if (lines.join('\n').length > 3000) fail('补一步的正文最多 3000 字。');
  return { code, lines, blanks: blanks.map(({ hint }) => hint) };
}

/** `order`: 题干 lines, `- 条目` lines, optional `groups 甲 | 乙 | 丙` for sorting into groups. */
function parseOrder(source) {
  const rows = numbered(source), stem = [], items = [];
  let groups = null;
  for (const row of rows) {
    const entry = item(row.raw);
    if (entry !== undefined) {
      if (!entry) lineError(row, '条目不能是空的。');
      if (entry.length > 200) lineError(row, '一个条目最多 200 字。');
      if (items.includes(entry)) lineError(row, `条目“${entry}”重复了。`);
      items.push(entry);
      continue;
    }
    const grouped = row.value.match(/^groups\s+(.+)$/);
    if (grouped) {
      if (groups) lineError(row, 'groups 只能写一行。');
      groups = grouped[1].split('|').map(name => name.trim());
      if (groups.length < 2 || groups.length > 4 || groups.some(name => !name || name.length > 20)) lineError(row, 'groups 写 2 到 4 个组名，用 | 分开，每个最多 20 字。');
      if (new Set(groups).size !== groups.length) lineError(row, '组名重复了。');
      continue;
    }
    if (items.length) lineError(row, `不认识的一行：“${row.value}”。条目以“- ”开头；归类另写一行 groups 甲 | 乙。`);
    stem.push(row.value);
  }
  if (!stem.length) fail('缺少题干：第一行写要学生做什么，例如“把证明步骤排好”。');
  if (items.length < 2) fail('至少要有两个条目，每个以“- ”开头。');
  if (items.length > 12) fail('条目最多 12 个。');
  return { stem: stem.join('\n'), items, groups };
}

const special = (value, noteRequired) => {
  if (value.unsure === true) return { unsure: true, ...(value.note ? { note: text(value.note, MAX_TEXT, 'board_answer_invalid') } : {}) };
  if (typeof value.other === 'string') {
    const other = text(value.other, MAX_TEXT, 'board_answer_invalid');
    if (!other && noteRequired) fail('board_answer_invalid');
    return { other };
  }
  return undefined;
};
const onlyKeys = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail('board_answer_invalid');
};
const permutation = (list, size) => Array.isArray(list) && list.length === size && list.every(n => Number.isInteger(n) && n >= 0 && n < size) && new Set(list).size === size;

function answerChoice(spec, value) {
  onlyKeys(value, ['pick', 'reason', 'unsure', 'note', 'other']);
  const exit = special(value, true);
  if (exit) return exit;
  const pick = value.pick;
  if (!Array.isArray(pick) || !pick.length || pick.some(n => !Number.isInteger(n) || n < 0 || n >= spec.options.length) || new Set(pick).size !== pick.length || (!spec.multiple && pick.length !== 1)) fail('board_answer_invalid');
  const reason = value.reason === undefined ? '' : text(value.reason, MAX_TEXT, 'board_answer_invalid');
  if (spec.reason === 'required' && !reason) fail('board_answer_reason_required');
  return { pick: [...pick].sort((a, b) => a - b), ...(reason ? { reason } : {}) };
}
function answerBlank(spec, value) {
  onlyKeys(value, ['fills', 'unsure', 'note', 'other']);
  const exit = special(value, true);
  if (exit) return exit;
  if (!Array.isArray(value.fills) || value.fills.length !== spec.blanks.length) fail('board_answer_invalid');
  const fills = value.fills.map(fill => text(fill, MAX_TEXT, 'board_answer_invalid'));
  if (!fills.some(Boolean)) fail('board_answer_empty');
  return { fills };
}
function answerOrder(spec, value) {
  onlyKeys(value, ['order', 'groups', 'unsure', 'note', 'other']);
  const exit = special(value, true);
  if (exit) return exit;
  if (spec.groups) {
    const groups = value.groups;
    if (!Array.isArray(groups) || groups.length !== spec.groups.length || !groups.every(Array.isArray)) fail('board_answer_invalid');
    const all = groups.flat();
    if (!permutation(all, spec.items.length)) fail('board_answer_invalid');
    return { groups: groups.map(group => [...group]) };
  }
  if (!permutation(value.order, spec.items.length)) fail('board_answer_invalid');
  return { order: [...value.order] };
}

const letter = index => String.fromCharCode(65 + index);
const shorten = (value, max) => { const one = String(value).replace(/\s+/g, ' ').trim(); return one.length > max ? one.slice(0, max - 1) + '…' : one; };
const exitText = (answer, otherLead) => answer.unsure ? (answer.note ? `我不确定：${answer.note}` : '我不确定。') : `${otherLead}${answer.other}`;

const exitOf = value => value && typeof value === 'object' && !Array.isArray(value) && (value.unsure === true || typeof value.other === 'string') ? special(value, true) : undefined;

export const BOARD_COMPONENTS = Object.freeze({
  figure: {
    title: '图', answerable: spec => Boolean(spec.ask), parse: parseFigure,
    answer: (spec, value) => { const allowed = spec.ask?.kind === 'param' ? ['value'] : ['point']; onlyKeys(value, [...allowed, 'unsure', 'note', 'other']); return answerFigure(spec, value, exitOf); },
    label: spec => spec.ask?.prompt ?? '图',
    identity: figureIdentity,
    text: (spec, answer) => figureAnswerText(spec, answer) ?? exitText(answer, '我有别的想法：'),
    syntax: FIGURE_SYNTAX,
  },
  frames: {
    title: '逐帧演示', answerable: spec => predictedFrames(spec).length > 0, parse: parseFrames,
    answer: (spec, value) => answerFrames(spec, value),
    label: spec => spec.title ?? '逐帧演示',
    identity: framesIdentity,
    text: framesAnswerText,
    // 直接看 is kept for the teacher's overview but sends no message.
    silent: framesSilent,
    syntax: FRAMES_SYNTAX,
  },
  flow: {
    title: '关系图', answerable: spec => flowBlanks(spec).length > 0, parse: parseFlow,
    answer: (spec, value) => { onlyKeys(value, ['fills', 'unsure', 'note', 'other']); return answerFlow(spec, value, exitOf); },
    label: () => '关系图',
    identity: flowIdentity,
    text: (spec, answer) => flowAnswerText(spec, answer) ?? exitText(answer, '我有别的想法：'),
    syntax: FLOW_SYNTAX,
  },
  choice: {
    title: '选择与判断', answerable: true, parse: parseChoice, answer: answerChoice,
    label: spec => spec.stem.split('\n')[0],
    identity: spec => ['choice', spec.stem, ...spec.options, spec.multiple ? 'multiple' : 'single'].join('\u0000'),
    text: (spec, answer) => answer.pick
      ? `我选：${answer.pick.map(n => `${letter(n)} ${spec.options[n]}`).join('；')}${answer.reason ? `。理由：${answer.reason}` : ''}`
      : exitText(answer, '都不对，我觉得：'),
    syntax: '```choice\n这条弦的斜率是正还是负？\n- 正\n- 负\n- 取决于 M 在哪个象限\nreason required\n```\n第一行起是题干；每个选项一行，以“- ”开头（2 到 8 个）；多选另写一行 multiple；要求附理由写 reason required。不写对错，“不确定”和“都不对，我觉得……”由系统自动加。',
  },
  blank: {
    title: '补一步', answerable: true, parse: parseBlank, answer: answerBlank,
    label: () => '补一步',
    identity: spec => ['blank', spec.code ?? '', ...spec.lines].join('\u0000'),
    text: (spec, answer) => answer.fills
      ? (answer.fills.length === 1 ? `我填：${answer.fills[0] || '（没填）'}` : answer.fills.map((fill, n) => `第${n + 1}空：${fill || '（没填）'}`).join('；'))
      : exitText(answer, '我有别的想法：'),
    syntax: '```blank\n两式相减：$\\frac{(x_1+x_2)(x_1-x_2)}{4}+$ {{ }} $=0$\n所以斜率 $k=$ {{ 用 M 的坐标表示 }}\n```\n{{ }} 是一个空，花括号里的文字是提示（1 到 6 个空）；第一行写 code python 这类语言名时整块按代码显示。',
  },
  order: {
    title: '排序与归类', answerable: true, parse: parseOrder, answer: answerOrder,
    label: spec => spec.stem.split('\n')[0],
    identity: spec => ['order', spec.stem, ...spec.items, ...(spec.groups ?? [])].join('\u0000'),
    text: (spec, answer) => answer.order
      ? `我的顺序：${answer.order.map((n, i) => `${i + 1}. ${spec.items[n]}`).join(' ')}`
      : answer.groups ? `我的归类：${answer.groups.map((group, g) => `${spec.groups[g]}：${group.map(n => spec.items[n]).join('、') || '（空）'}`).join('；')}`
        : exitText(answer, '我有别的想法：'),
    syntax: '```order\n把证明步骤排好\n- 两式相减\n- 设 A、B 的坐标\n- 用中点坐标化简\n- 代入椭圆方程\n```\n第一行起是题干；每个条目一行（2 到 12 个），写之前先打乱顺序，界面按你写下的顺序显示；归类另写一行 groups 已知 | 所求（2 到 4 组）。',
  },
});
export const BOARD_COMPONENT_TYPES = Object.freeze(Object.keys(BOARD_COMPONENTS));
export const BOARD_ANSWER_LIMIT = 10;

const FENCE_OPEN = /^```([A-Za-z]+)[ \t]*$/, FENCE_CLOSE = /^```[ \t]*$/, ANY_FENCE = /^(```|~~~)/;

/**
 * Split a body into Markdown text and component segments, in order. Fences of
 * other languages stay Markdown. `open` is set when the body ends inside an
 * unclosed component fence (a streaming preview): that tail is not rendered.
 */
export function splitBoardBody(body) {
  const lines = clean(body).split('\n'), segments = [];
  let buffer = [], index = 0, open = null;
  const flush = () => { if (buffer.length) segments.push({ kind: 'markdown', text: buffer.join('\n') }); buffer = []; };
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row], opened = line.match(FENCE_OPEN);
    if (opened && Object.hasOwn(BOARD_COMPONENTS, opened[1])) {
      const start = row, inner = [];
      let closed = false;
      for (row = row + 1; row < lines.length; row++) { if (FENCE_CLOSE.test(lines[row])) { closed = true; break; } inner.push(lines[row]); }
      if (!closed) { open = { type: opened[1], index, source: inner.join('\n') }; break; }
      flush();
      segments.push({ kind: 'component', type: opened[1], index: index++, source: inner.join('\n'), startLine: start + 1 });
      continue;
    }
    if (ANY_FENCE.test(line)) {
      // Another language's code fence is Markdown, copied through untouched.
      const mark = line.slice(0, 3);
      buffer.push(line);
      for (row = row + 1; row < lines.length; row++) { buffer.push(lines[row]); if (lines[row].startsWith(mark)) break; }
      continue;
    }
    buffer.push(line);
  }
  flush();
  return { segments, open };
}

/** Parse one component; a parse error is kept on the component, never thrown. */
export function readComponent(segment) {
  const definition = BOARD_COMPONENTS[segment.type];
  try {
    const spec = definition.parse(segment.source);
    const answerable = typeof definition.answerable === 'function' ? definition.answerable(spec) : definition.answerable;
    return { ...segment, spec, fingerprint: fingerprint(definition.identity(spec)), answerable };
  } catch (error) {
    if (!PARSE_ERRORS.has(error?.name)) throw error;
    return { ...segment, error: { message: error.message, line: error.line } };
  }
}

/** Every component of a body, parsed, in order. */
export function boardComponents(body) {
  return splitBoardBody(body).segments.filter(segment => segment.kind === 'component').map(readComponent);
}

/**
 * The teacher's write check: every component must parse. The thrown message
 * locates the problem and carries that component's whole syntax so the next
 * write can be right without loading anything else.
 */
export function validateBoardComponents(body) {
  const { open } = splitBoardBody(body);
  if (open) throw new Error(`board_component_invalid：第${open.index + 1}个组件（${open.type}）没有用单独一行 \`\`\` 结束。\n${open.type} 的写法：\n${BOARD_COMPONENTS[open.type].syntax}`);
  const components = boardComponents(body);
  for (const component of components) {
    if (!component.error) continue;
    const where = component.error.line ? `第${component.error.line}行：` : '';
    throw new Error(`board_component_invalid：第${component.index + 1}个组件（${component.type}）${where}${component.error.message}\n${component.type} 的写法：\n${BOARD_COMPONENTS[component.type].syntax}`);
  }
  return components;
}

/** Validate a student's answer against the component it answers. */
export function validateBoardAnswer(component, value) {
  if (!component?.answerable || component.error) throw new Error('board_component_missing');
  try { return BOARD_COMPONENTS[component.type].answer(component.spec, value); }
  catch (error) { if (PARSE_ERRORS.has(error?.name)) throw new Error(error.message); throw error; }
}

/** The student's message: a locating prefix, then the answer in words. */
export function boardAnswerMessage({ sectionTitle, blockTitle, component, answer }) {
  const definition = BOARD_COMPONENTS[component.type];
  const label = definition.label(component.spec), where = label === '补一步' ? (blockTitle.includes('补一步') ? blockTitle : `${blockTitle} · 补一步`) : label;
  const place = [sectionTitle, where].filter(Boolean).map(part => shorten(part, 40));
  return `〔白板｜${place.join('｜')}〕${definition.text(component.spec, answer)}`;
}

/** A one-line summary of an answer for the teacher's per-turn board overview. */
export function boardAnswerSummary(component, answer) {
  const text=String(BOARD_COMPONENTS[component.type].text(component.spec, answer)).replace(/\s+/g,' ').trim();
  const chars=Array.from(text);
  return chars.length>60?chars.slice(0,59).join('')+'…':text;
}

/** Answers kept for the current question and the ones left from a changed one. */
export function answersFor(component, answers = []) {
  const own = answers.filter(entry => entry.c === component.index);
  return { current: own.filter(entry => entry.fp === component.fingerprint), stale: own.filter(entry => entry.fp !== component.fingerprint) };
}

/** Append one answer, keeping at most BOARD_ANSWER_LIMIT per component question. */
export function appendBoardAnswer(answers = [], entry) {
  const next = [...answers, entry], same = next.filter(item => item.c === entry.c && item.fp === entry.fp);
  const drop = new Set(same.slice(0, Math.max(0, same.length - BOARD_ANSWER_LIMIT)));
  return next.filter(item => !drop.has(item)).slice(-80);
}

/** Validate the stored answer list inside a block marker. */
export function validateStoredAnswers(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 80) throw new Error('board_format_invalid');
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !['id', 'c', 'fp', 'at', 'v'].includes(key))
      || typeof entry.id !== 'string' || !/^[a-f0-9]{8,32}$/.test(entry.id) || !Number.isInteger(entry.c) || entry.c < 0 || entry.c > 50
      || typeof entry.fp !== 'string' || !/^[a-f0-9]{16}$/.test(entry.fp) || typeof entry.at !== 'string' || Number.isNaN(Date.parse(entry.at))
      || !entry.v || typeof entry.v !== 'object' || Array.isArray(entry.v)) throw new Error('board_format_invalid');
  }
  return value;
}

/** A readable line for an answer whose question has since changed: only what it held. */
export function staleAnswerSummary(type, value) {
  if (value?.unsure) return value.note ? `不确定：${value.note}` : '不确定';
  if (typeof value?.other === 'string') return `别的想法：${value.other}`;
  if (type === 'choice' && Array.isArray(value?.pick)) return `选了 ${value.pick.map(n => String.fromCharCode(65 + n)).join('、')}${value.reason ? `，理由：${value.reason}` : ''}`;
  if (type === 'blank' && Array.isArray(value?.fills)) return value.fills.map((fill, n) => `第${n + 1}空：${fill || '（没填）'}`).join('；');
  if (type === 'order' && Array.isArray(value?.order)) return `顺序：${value.order.map(n => n + 1).join(' → ')}`;
  if (type === 'order' && Array.isArray(value?.groups)) return `归类：${value.groups.map(group => group.map(n => n + 1).join('、') || '空').join(' ｜ ')}`;
  if (type === 'figure' && value?.point) return `点 (${value.point.x}, ${value.point.y})`;
  if (type === 'figure' && Number.isFinite(value?.value)) return `参数 ${value.value}`;
  if (type === 'frames' && Number.isInteger(value?.frame)) return value.skipped ? `第${value.frame + 1}帧直接看了` : `第${value.frame + 1}帧预测：${value.text ?? '预测不出来'}`;
  if (type === 'flow' && value?.fills) return Object.entries(value.fills).map(([id, text]) => `${id}：${text || '（没填）'}`).join('；');
  return '作答';
}
