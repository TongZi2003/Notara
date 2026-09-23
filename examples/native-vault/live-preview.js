import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { EditorState, Facet, StateField, StateEffect } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { parseFrontmatter } from './frontmatter.js';
import { cardUnderstandingSections, teacherBlocks } from './lesson-script.js';
import { displayMathSource, mathSource, mathSyntax, mathWidget, MATH_DISPLAY, MATH_INLINE } from './math-latex.js';
import { mediaLocatorSuffix, parseMediaTarget } from './media.js';
import { reviewAssessmentText } from './review-data.js';

const openPage = Facet.define({ combine: handlers => handlers[0] ?? (() => {}) });
const mediaAssets = Facet.define({ combine: values => values[0] ?? {} });
const renderPdfRegion = Facet.define({ combine: values => values[0] ?? null });
// Absent when no caller wires tag navigation; tags then stay plain text instead
// of advertising a control that cannot go anywhere.
const onTag = Facet.define({ combine: handlers => handlers[0] ?? null });
const focusPreview = StateEffect.define();
const previewFocus = StateField.define({
  create: () => false,
  update(value, transaction) { for (const effect of transaction.effects) if (effect.is(focusPreview)) value = effect.value; return value; },
});
const HIGHLIGHT = 'VaultHighlight';
const highlightDelimiter = { resolve: HIGHLIGHT, mark: 'VaultHighlightMark' };
const vaultSyntax = {
  defineNodes: ['VaultMediaEmbed', 'VaultWikiLink', HIGHLIGHT, 'VaultHighlightMark'],
  parseInline: [{
    name: 'VaultMediaEmbed', before: 'Image',
    parse(cx, next, pos) {
      if (next !== 33 || cx.char(pos + 1) !== 91 || cx.char(pos + 2) !== 91) return -1;
      const match = /^!\[\[([^\]\n]+)\]\]/.exec(cx.slice(pos, cx.end));
      return match ? cx.addElement(cx.elt('VaultMediaEmbed', pos, pos + match[0].length)) : -1;
    },
  }, {
    name: 'VaultWikiLink', before: 'Link',
    parse(cx, next, pos) {
      if (next !== 91 || cx.char(pos + 1) !== 91) return -1;
      const match = /^\[\[([^\]\n]+)\]\]/.exec(cx.slice(pos, cx.end));
      return match ? cx.addElement(cx.elt('VaultWikiLink', pos, pos + match[0].length)) : -1;
    },
  }, {
    name: HIGHLIGHT,
    parse(cx, next, pos) {
      if (next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
      if (cx.char(pos - 1) === 61) return -1;
      const before = cx.slice(pos - 1, pos), after = cx.slice(pos + 2, pos + 3);
      return cx.addDelimiter(highlightDelimiter, pos, pos + 2, !/\s|^$/.test(after), !/\s|^$/.test(before));
    },
  }],
};

/** Incomplete YAML must remain editable, never break the editor. */
export function previewFrontmatter(content) {
  try { return parseFrontmatter(content); }
  catch { return { frontmatter: {}, body: content, range: null }; }
}

// Machine metadata is written as an HTML comment inside ordinary Markdown:
//   <!-- notara:route-node "l2" -->   <!-- notara:route-node:end -->
//   <!-- notara:route-log -->         <!-- notara:route-log:end -->
//   <!-- notara:lesson-summary  …meta lines…  -->   <!-- notara:lesson-summary:end -->
// Only the marker itself is hidden, and a route marker is hidden only when its
// own line closes it. A comment nobody terminated stays readable as source
// instead of swallowing the lesson, the brief and everything after it; HTML is
// still never interpreted or executed.
const CLOSED_METADATA_MARKER = /^<!--[ \t]*notara:(?:route-node(?::end)?|route-log(?::end)?|lesson-summary:end)\b[^\n]*?-->/;
const SUMMARY_BEGIN_MARKER = /^<!--[ \t]*notara:lesson-summary\b/;

/** How many characters of one HTML block are the note's own machine marker. */
export function metadataCommentLength(raw) {
  const text = String(raw ?? '');
  const closed = CLOSED_METADATA_MARKER.exec(text);
  if (closed) return closed[0].length;
  // The summary block opens an unclosed comment; its own metadata lines run to
  // the first `-->`, which lesson-data.js validates as the block's terminator.
  if (SUMMARY_BEGIN_MARKER.test(text)) {
    const end = text.indexOf('-->');
    if (end >= 0) return end + 3;
  }
  return 0;
}

// Property keys come from the note's own YAML. Only the keys the teaching
// templates and the review projection actually write get a Chinese label and a
// type icon; every other key stays verbatim rather than being guessed at.
const PROPERTY_LABELS = {
  type: '类型', status: '状态', tags: '标签', title: '标题', date: '日期', name: '名称',
  lessons: '课程', subjects: '科目', template: '模板', created: '创建时间', updated: '修改时间',
  learned: '已开始复习', mastery: '复习档位', interval: '复习间隔',
  last_review: '上次复习', next_review: '下次复习', review_history: '复习记录',
};
const PROPERTY_ICONS = {
  text: 'M4 7h16M4 12h10M4 17h13',
  number: 'M9 4 7 20M17 4l-2 16M4 9h16M3 15h16',
  date: 'M4 6h16v14H4zM4 11h16M8 3v5M16 3v5',
  boolean: 'm5 13 4 4 10-10',
  list: 'M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01',
  tags: 'M3 8h8l9 4-9 4H3zM6.5 12h.01',
  record: 'M4 5h16v14H4zM8 9h8M8 13h8M8 17h5',
};
// Review rows are read, not audited: a compact line per assessment beats the
// raw record objects, and unknown keys keep their own name.
const REVIEW_LABELS = {
  at: '时间', date: '日期', time: '时间', day: '日期', score: '得分', total: '满分',
  grade: '评级', mark: '评价', outcome: '结果', result: '结果', correct: '正确', duration: '用时', note: '备注',
};

function propertyKind(key, value) {
  if (key === 'tags') return 'tags';
  if (key === 'review_history') return 'record';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
  return 'text';
}

function propertyIcon(kind) {
  const holder = document.createElement('span');
  holder.className = 'cm-vault-property-icon';
  holder.setAttribute('aria-hidden', 'true');
  holder.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${PROPERTY_ICONS[kind] ?? PROPERTY_ICONS.text}"/></svg>`;
  return holder;
}

function scalarText(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value === '' ? '—' : value;
  if (typeof value === 'number') return String(value);
  return inlineValueText(value);
}

function inlineValueText(value) {
  if (Array.isArray(value)) return value.map(scalarText).join('、') || '—';
  if (value && typeof value === 'object') { const keys = Object.keys(value); return keys.length ? `${keys.length} 项` : '—'; }
  return scalarText(value);
}

/** One review or record line: translated keys when known, verbatim otherwise. */
function recordLine(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return inlineValueText(entry);
  const parts = [];
  for (const [key, value] of Object.entries(entry)) {
    if (value === null || value === undefined || value === '') continue;
    parts.push(`${Object.hasOwn(REVIEW_LABELS, key) ? REVIEW_LABELS[key] : key} ${inlineValueText(value)}`);
  }
  return parts.join(' · ') || '—';
}

function recordDetails(label, entries) {
  const details = document.createElement('details');
  details.className = 'cm-vault-property-record';
  const summary = document.createElement('summary');
  summary.textContent = label;
  const list = document.createElement('ul');
  for (const entry of entries) { const item = document.createElement('li'); item.textContent = recordLine(entry); list.append(item); }
  details.append(summary, list);
  return details;
}

function tagPill(text, handler) {
  const pill = document.createElement(handler ? 'button' : 'span');
  pill.className = 'cm-vault-tag';
  pill.textContent = text;
  if (!handler) return pill;
  pill.type = 'button';
  pill.title = `在图谱中查看「${text}」`;
  pill.setAttribute('aria-label', `按标签 ${text} 筛选`);
  pill.addEventListener('mousedown', event => event.preventDefault());
  pill.addEventListener('click', event => { event.preventDefault(); handler(text); });
  return pill;
}

class PropertiesWidget extends WidgetType {
  kind = 'properties';
  constructor(properties) { super(); this.properties = properties; }
  eq(other) { return JSON.stringify(this.properties) === JSON.stringify(other.properties); }
  toDOM(view) {
    const tagHandler = view.state.facet(onTag);
    const root = document.createElement('details');
    root.className = 'cm-vault-properties'; root.open = true; root.setAttribute('aria-label', '页面属性');
    root.addEventListener('toggle', () => view.requestMeasure(), true);
    const header = document.createElement('summary'), caret = document.createElement('span'), title = document.createElement('strong'), count = document.createElement('span'), edit = document.createElement('button');
    header.className = 'cm-vault-properties-head';
    // A flex summary loses its native marker, so the fold affordance is drawn
    // explicitly and rotates the way the rest of the app's chevrons do.
    caret.className = 'cm-vault-properties-caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>';
    title.textContent = '页面属性'; title.className = 'cm-vault-properties-title';
    count.className = 'cm-vault-properties-count';
    count.textContent = `${Object.keys(this.properties).length} 项`;
    edit.type = 'button'; edit.className = 'cm-vault-properties-edit'; edit.textContent = '编辑属性';
    edit.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from }, scrollIntoView: true });
      view.focus();
    });
    header.append(caret, title, count, edit); root.append(header);
    const fields = document.createElement('dl');
    fields.className = 'cm-vault-properties-list';
    for (const [key, value] of Object.entries(this.properties)) {
      const label = document.createElement('dt'), cell = document.createElement('dd'), name = document.createElement('span');
      label.className = 'cm-vault-property-key'; label.title = key;
      name.textContent = Object.hasOwn(PROPERTY_LABELS, key) ? PROPERTY_LABELS[key] : key;
      label.append(propertyIcon(propertyKind(key, value)), name);
      cell.className = 'cm-vault-property-value';
      if (key === 'lessons' && Array.isArray(value) && value.length) {
        const titles = value.map(item => item?.title).filter(Boolean).join('、');
        cell.textContent = titles ? `${value.length} 节课 · ${titles}` : `${value.length} 节课`;
      } else if (key === 'review_history' && Array.isArray(value) && value.length) {
        const records = value.map(item => ({ 日期: item.day, 结果: `${item.revertedAt ? '已撤销 · ' : ''}${reviewAssessmentText(item)}`, 方式: item.actor === 'self' ? '自评' : '课堂评估', 说明: item.note }));
        cell.append(recordDetails(`${value.length} 次评估`, records));
      } else if (Array.isArray(value) && value.length) {
        if (value.some(item => item !== null && typeof item === 'object')) cell.append(recordDetails(`${value.length} 项`, value));
        else for (const item of value) cell.append(tagPill(scalarText(item), key === 'tags' ? tagHandler : null));
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const keys = Object.keys(value);
        cell.append(keys.length ? recordDetails(`${keys.length} 个字段`, keys.map(entry => ({ [entry]: value[entry] }))) : document.createTextNode('—'));
      } else cell.textContent = scalarText(value);
      fields.append(label, cell);
    }
    if (!fields.childNodes.length) { const empty = document.createElement('p'); empty.textContent = '暂无属性'; root.append(empty); }
    else root.append(fields);
    return root;
  }
  ignoreEvent() { return true; }
}

class WikiLinkWidget extends WidgetType {
  kind = 'wiki-link';
  constructor(path, label) { super(); this.path = path; this.label = label; }
  eq(other) { return this.path === other.path && this.label === other.label; }
  activate(view) { view.state.facet(openPage)(this.path); }
  toDOM(view) {
    const link = document.createElement('button');
    link.type = 'button'; link.className = 'cm-vault-wikilink'; link.textContent = this.label;
    link.title = `打开 ${this.label}`;
    link.addEventListener('mousedown', event => event.preventDefault());
    link.addEventListener('click', () => this.activate(view));
    return link;
  }
  ignoreEvent() { return true; }
}

class MediaEmbedWidget extends WidgetType {
  kind = 'media-embed';
  constructor(asset, locator, invalidLocator = false) { super(); this.asset = asset; this.locator = locator; this.invalidLocator = invalidLocator; }
  eq(other) { return this.invalidLocator === other.invalidLocator && this.asset?.revision === other.asset?.revision && JSON.stringify(this.locator) === JSON.stringify(other.locator); }
  toDOM(view) {
    const asset = this.asset, root = document.createElement('div');
    root.className = 'cm-vault-media-embed';
    if (!asset) { root.textContent = '媒体加载中…'; return root; }
    const source = asset.assetKind === 'pdf' && this.locator?.kind === 'pdf-page' ? `${asset.dataUrl}#page=${this.locator.page}` : asset.dataUrl;
    if (asset.assetKind === 'pdf') {
      const target=asset.path+(this.invalidLocator?'':mediaLocatorSuffix(this.locator)),button=document.createElement('button');
      button.type='button';button.className='cm-vault-wikilink';button.textContent=this.invalidLocator?'打开原文核对':`查看原文 · 第 ${this.locator?.page??1} 页`;
      button.addEventListener('click',()=>view.state.facet(openPage)(target));root.append(button);
      // A malformed page or region is never repaired into "page one": the card
      // keeps its claim visible and sends the reader to check the real place.
      if(this.invalidLocator){const warning=document.createElement('p');warning.textContent='引用位置无效，请核对页码或区域。';root.append(warning);return root;}
      if(this.locator?.revision&&this.locator.revision!==asset.revision){const warning=document.createElement('p');warning.textContent='原 PDF 已变化，请打开原文核对这一处引用。';root.append(warning);return root;}
      const renderer=view.state.facet(renderPdfRegion);
      if(renderer){const canvas=document.createElement('canvas');canvas.style.display='block';canvas.style.maxWidth='100%';canvas.style.marginTop='8px';root.append(canvas);const abort=new AbortController();root._pdfAbort=abort;void renderer(asset,this.locator,canvas,abort.signal).catch(()=>{if(!abort.signal.aborted){canvas.remove();const message=document.createElement('p');message.textContent='区域预览暂时无法显示，请打开原文。';root.append(message);}});}
    }
    else if (asset.assetKind === 'image') { const image = document.createElement('img'); image.src = source; image.alt = asset.title; image.style.maxWidth = '100%'; root.append(image); }
    else if (asset.assetKind === 'video') { const video = document.createElement('video'); video.src = source; video.controls = true; video.style.maxWidth = '100%'; root.append(video); }
    else if (asset.assetKind === 'audio') { const audio = document.createElement('audio'); audio.src = source; audio.controls = true; root.append(audio); }
    else if (asset.assetKind === 'html') { const frame = document.createElement('iframe'); frame.src = source; frame.sandbox = ''; frame.title = asset.title; frame.style.width = '100%'; frame.style.height = '420px'; frame.style.border = '0'; root.append(frame); }
    else root.textContent = `无法预览 ${asset.title}`;
    return root;
  }
  ignoreEvent() { return true; }
  destroy(dom) { dom._pdfAbort?.abort(); }
}

class TaskWidget extends WidgetType {
  kind = 'task';
  constructor(checked, from, to) { super(); this.checked = checked; this.from = from; this.to = to; }
  eq(other) { return this.checked === other.checked && this.from === other.from && this.to === other.to; }
  activate(view) {
    // A read-only nested preview renders the same list, but ticking it must
    // never try to rewrite the parent document.
    if (view.state.readOnly) return;
    const current = view.state.sliceDoc(this.from, this.to);
    if (!/^\[[ xX]\]$/.test(current)) return;
    view.dispatch({ changes: { from: this.from, to: this.to, insert: this.checked ? '[ ]' : '[x]' }, userEvent: 'input' });
  }
  toDOM(view) {
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = this.checked; input.className = 'cm-vault-task-checkbox';
    input.disabled = view.state.readOnly;
    input.setAttribute('aria-label', this.checked ? '标为未完成' : '标为已完成');
    input.addEventListener('mousedown', event => event.preventDefault());
    input.addEventListener('change', () => this.activate(view));
    return input;
  }
  ignoreEvent() { return true; }
}

// Teacher material lives inside the same Markdown file as the lesson, so the
// fold is a reading aid and never a permission boundary: the body renders as
// read-only Markdown and the real source stays one explicit step away.
//
// Which note is open, and which one is being edited, is state of this editor
// alone, keyed by the block's real position: two files — or two identical notes
// in one file — never share a fold, duplicates never collapse together, and a
// note keeps its state while the file around it is edited. Nothing is persisted
// across reloads, and a fold never opens because a cursor happened to land in
// it.
export const expandTeacherNote = StateEffect.define();
export const editTeacherNote = StateEffect.define();
export const collapseTeacherNote = StateEffect.define();

export const teacherPanels = StateField.define({
  create: () => new Map(),
  update(panels, transaction) {
    let next = panels;
    for (const effect of transaction.effects) {
      const status = effect.is(expandTeacherNote) ? 'open' : effect.is(editTeacherNote) ? 'editing' : effect.is(collapseTeacherNote) ? null : undefined;
      if (status === undefined) continue;
      if (next === panels) next = new Map(panels);
      next.delete(effect.value);
      if (status) next.set(effect.value, status);
    }
    if (!transaction.docChanged) return next;
    const starts = new Set(safeTeacherBlocks(transaction.newDoc.toString()).map(block => block.from)), mapped = new Map();
    for (const [from, status] of next) { const at = transaction.changes.mapPos(from, 1); if (starts.has(at)) mapped.set(at, status); }
    return mapped;
  },
});

// The card's 教师理解 section folds for the reading reason the teacher notes do,
// and is keyed by its own section start: a note and a section beginning at the
// same offset can never share one state.
export const expandUnderstandingSection = StateEffect.define();
export const editUnderstandingSection = StateEffect.define();
export const collapseUnderstandingSection = StateEffect.define();

export const understandingPanels = StateField.define({
  create: () => new Map(),
  update(panels, transaction) {
    let next = panels;
    for (const effect of transaction.effects) {
      const status = effect.is(expandUnderstandingSection) ? 'open' : effect.is(editUnderstandingSection) ? 'editing' : effect.is(collapseUnderstandingSection) ? null : undefined;
      if (status === undefined) continue;
      if (next === panels) next = new Map(panels);
      next.delete(effect.value);
      if (status) next.set(effect.value, status);
    }
    if (!transaction.docChanged) return next;
    const starts = new Set(safeUnderstandingSections(transaction.newDoc.toString()).map(section => section.from)), mapped = new Map();
    for (const [from, status] of next) { const at = transaction.changes.mapPos(from, 1); if (starts.has(at)) mapped.set(at, status); }
    return mapped;
  },
});

/** A lesson-script failure must never break editing, exactly like frontmatter. */
function safeTeacherBlocks(content) {
  try { return teacherBlocks(content); } catch { return []; }
}

/** A card-section failure must never break editing either. */
function safeUnderstandingSections(content) {
  try { return cardUnderstandingSections(content); } catch { return []; }
}

function teacherBlockText(text, block) { return text.slice(block.from, block.to); }

/** The assets a folded body embeds, by revision. A PDF that only finishes
 * loading after the note was opened must not stay stuck on “媒体加载中…”, so a
 * reused fold row is rebuilt when one of its own assets changes. */
function teacherAssetStamp(text, assets) {
  const paths = new Set();
  for (const match of String(text).matchAll(/!\[\[([^\]\n]+)\]\]/g)) paths.add(parseMediaTarget(match[1]).path);
  return [...paths].map(path => `${path}@${assets?.[path]?.revision ?? ''}`).join('|');
}

const nextFrame = run => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 16));
const dropFrame = handle => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle); else clearTimeout(handle); };

/** Static icons only: no user text ever reaches markup. */
function teacherIcon(path, size = 12) {
  const holder = document.createElement('span');
  holder.setAttribute('aria-hidden', 'true');
  holder.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
  return holder;
}

/** The folded body is the same Markdown, rendered by the same preview in a
 * read-only editor: formulas, highlights, links and PDF regions keep working,
 * while every write path stays in the parent document. */
function foldBodyExtensions(view) {
  return [
    vaultPreview(view.state.facet(openPage), view.state.facet(mediaAssets), view.state.facet(onTag), view.state.facet(renderPdfRegion)),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.lineWrapping,
  ];
}

function mountFoldBody(dom, view, body) {
  const host = dom._notaraFoldBody;
  if (!host || host._notaraFoldView) return;
  try {
    const nested = new EditorView({
      parent: host,
      state: EditorState.create({ doc: body, extensions: foldBodyExtensions(view) }),
    });
    host._notaraFoldView = nested;
    dom._notaraFoldNested = nested;
  } catch {
    host.textContent = '教师内容暂时无法展开。';
  }
  view.requestMeasure();
}

function dropFoldBody(dom) {
  if (dom._notaraFoldFrame) { dropFrame(dom._notaraFoldFrame); dom._notaraFoldFrame = 0; }
  const nested = dom._notaraFoldNested;
  dom._notaraFoldNested = null;
  const host = dom._notaraFoldBody;
  if (host) { host._notaraFoldView = null; host.textContent = ''; }
  // Destroying the nested editor also aborts its PDF region renders.
  if (nested) { try { nested.destroy(); } catch { /* the widget DOM is going away */ } }
}

/** A widget built before it is attached to the document cannot measure, so the
 * first mount waits one frame when the editor has not placed it yet. */
function showFoldBody(dom, view, body) {
  if (dom._notaraFoldFrame) { dropFrame(dom._notaraFoldFrame); dom._notaraFoldFrame = 0; }
  if (dom.isConnected) mountFoldBody(dom, view, body);
  else dom._notaraFoldFrame = nextFrame(() => { dom._notaraFoldFrame = 0; if (dom.isConnected) mountFoldBody(dom, view, body); });
}

/** Where the caret goes when a block folds again: outside it when the file has
 * anywhere else to put a cursor, and at the block's own edge when the file is
 * one single note. The fold closes in both cases, because the state — not the
 * caret — decides what is rendered. */
function foldAnchor(state, from) {
  if (from > 0) return from - 1;
  const block = safeTeacherBlocks(state.doc.toString()).find(item => item.from === from);
  const end = block ? block.to : from;
  return end < state.doc.length ? end + 1 : from;
}

class TeacherDetailsWidget extends WidgetType {
  kind = 'teacher-details';
  constructor({ from, text, summary, body, expanded, assets }) { super(); this.from = from; this.text = text; this.summary = summary; this.body = body; this.expanded = expanded; this.assets = assets; }
  // Position and content, not the fold itself: a reused DOM keeps its own
  // <details> element, while a note that moved or changed is rebuilt instead of
  // showing the previous block's body.
  eq(other) { return this.from === other.from && this.text === other.text && this.assets === other.assets; }
  toDOM(view) {
    const root = document.createElement('details');
    root.className = 'cm-vault-teacher';
    const head = document.createElement('summary');
    head.className = 'cm-vault-teacher-head';
    const caret = teacherIcon('m9 5 7 7-7 7');
    caret.className = 'cm-vault-teacher-caret';
    const label = document.createElement('span');
    label.className = 'cm-vault-teacher-label';
    label.textContent = this.summary;
    head.append(caret, label);
    // A read-only preview has no parent document to edit, so it offers no edit
    // control: only the editor that owns the file can open the source.
    if (!view.state.readOnly) {
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'cm-vault-teacher-edit'; edit.textContent = '编辑教师内容';
      edit.title = '在父文档 Markdown 源码中编辑这段教师说明';
      edit.addEventListener('mousedown', event => event.preventDefault());
      edit.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        view.dispatch({ effects: editTeacherNote.of(this.from), selection: { anchor: this.from }, scrollIntoView: true });
        view.focus();
      });
      head.append(edit);
    }
    const panel = document.createElement('div');
    panel.className = 'cm-vault-teacher-body';
    root._notaraFoldBody = panel;
    root.append(head, panel);
    root.addEventListener('toggle', () => {
      if (!root.isConnected) return;
      view.dispatch({ effects: (root.open ? expandTeacherNote : collapseTeacherNote).of(this.from) });
      if (root.open) showFoldBody(root, view, this.body); else dropFoldBody(root);
      view.requestMeasure();
    });
    root.open = this.expanded;
    if (this.expanded) showFoldBody(root, view, this.body);
    return root;
  }
  ignoreEvent() { return true; }
  destroy(dom) { dropFoldBody(dom); }
}

/** Shown only while the block's real source is open for editing. */
class TeacherEditingWidget extends WidgetType {
  kind = 'teacher-editing';
  constructor(from) { super(); this.from = from; }
  eq(other) { return this.from === other.from; }
  toDOM(view) {
    const root = document.createElement('span');
    root.className = 'cm-vault-teacher-bar';
    const fold = document.createElement('button');
    fold.type = 'button'; fold.className = 'cm-vault-teacher-collapse';
    fold.append(teacherIcon('m5 9 7-7 7 7', 11), document.createTextNode('收起教师内容'));
    fold.title = '回到折叠的教师内容';
    fold.addEventListener('mousedown', event => event.preventDefault());
    fold.addEventListener('click', event => {
      event.preventDefault();
        view.dispatch({ effects: collapseTeacherNote.of(this.from), selection: { anchor: foldAnchor(view.state, this.from) }, scrollIntoView: true });
    });
    root.append(fold);
    return root;
  }
  ignoreEvent() { return true; }
}

/** A card's 教师理解 section: 内容 and 学生理解 keep their place in the flow,
 * while the teacher's own reading stays one quiet row that opens on purpose.
 * The body is the same Markdown read through the same preview, so formulas,
 * links and embedded media keep working inside it. */
class UnderstandingSectionWidget extends WidgetType {
  kind = 'understanding-section';
  constructor({ from, text, title, body, expanded, assets }) { super(); this.from = from; this.text = text; this.title = title; this.body = body; this.expanded = expanded; this.assets = assets; }
  eq(other) { return this.from === other.from && this.text === other.text && this.assets === other.assets; }
  toDOM(view) {
    const root = document.createElement('details');
    root.className = 'cm-vault-teacher cm-vault-section';
    const head = document.createElement('summary');
    head.className = 'cm-vault-teacher-head';
    const caret = teacherIcon('m9 5 7 7-7 7');
    caret.className = 'cm-vault-teacher-caret';
    const label = document.createElement('span');
    label.className = 'cm-vault-teacher-label';
    label.textContent = this.title;
    head.append(caret, label);
    // Only the surface that owns the file offers the source, exactly like a
    // folded teacher note: a read-only preview never claims an edit it cannot
    // make.
    if (!view.state.readOnly) {
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'cm-vault-teacher-edit'; edit.textContent = `编辑${this.title}`;
      edit.title = `在父文档 Markdown 源码中编辑这段${this.title}`;
      edit.addEventListener('mousedown', event => event.preventDefault());
      edit.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        view.dispatch({ effects: editUnderstandingSection.of(this.from), selection: { anchor: this.from }, scrollIntoView: true });
        view.focus();
      });
      head.append(edit);
    }
    const panel = document.createElement('div');
    panel.className = 'cm-vault-teacher-body';
    root._notaraFoldBody = panel;
    root.append(head, panel);
    root.addEventListener('toggle', () => {
      if (!root.isConnected) return;
      view.dispatch({ effects: (root.open ? expandUnderstandingSection : collapseUnderstandingSection).of(this.from) });
      if (root.open) showFoldBody(root, view, this.body); else dropFoldBody(root);
      view.requestMeasure();
    });
    root.open = this.expanded;
    if (this.expanded) showFoldBody(root, view, this.body);
    return root;
  }
  ignoreEvent() { return true; }
  destroy(dom) { dropFoldBody(dom); }
}

/** Shown only while the section's real source is open for editing. */
class UnderstandingEditingWidget extends WidgetType {
  kind = 'understanding-editing';
  constructor(from, title) { super(); this.from = from; this.title = title; }
  eq(other) { return this.from === other.from && this.title === other.title; }
  toDOM(view) {
    const root = document.createElement('span');
    root.className = 'cm-vault-teacher-bar';
    const fold = document.createElement('button');
    fold.type = 'button'; fold.className = 'cm-vault-teacher-collapse';
    fold.append(teacherIcon('m5 9 7-7 7 7', 11), document.createTextNode(`收起${this.title}`));
    fold.title = '回到折叠的教师理解';
    fold.addEventListener('mousedown', event => event.preventDefault());
    fold.addEventListener('click', event => {
      event.preventDefault();
      view.dispatch({ effects: collapseUnderstandingSection.of(this.from), selection: { anchor: foldAnchor(view.state, this.from) }, scrollIntoView: true });
    });
    root.append(fold);
    return root;
  }
  ignoreEvent() { return true; }
}

// Whole-line classes go through a line decoration; CodeMirror measures the
// resulting box, so fenced code and quotes stay selectable and copyable.
function markLines(state, ranges, from, to, spec) {
  for (let position = from; position <= to;) {
    const line = state.doc.lineAt(position);
    ranges.push(Decoration.line(spec).range(line.from));
    if (line.to >= to) break;
    position = line.to + 1;
  }
}

function buildDecorations(state) {
  const ranges = [], text = state.doc.toString(), metadata = previewFrontmatter(text);
  // A read-only preview is always unstyled as source: clicking a formula or a
  // link inside a folded teacher body must not flip that body back to Markdown.
  const focused = state.field(previewFocus) && !state.readOnly;
  const hide = (from, to) => { if (to > from) ranges.push(Decoration.replace({}).range(from, to)); };
  const mark = (from, to, name) => { if (to > from) ranges.push(Decoration.mark({ class: name }).range(from, to)); };
  const active = (from, to) => focused && state.selection.ranges.some(selection =>
    state.doc.lineAt(selection.from).from <= to && state.doc.lineAt(selection.to).to >= from);
  // A teacher note shows its source only after an explicit edit action. A caret
  // that merely sits at 0 — or anywhere else — never reveals a note, which keeps
  // the default state of a lesson page folded no matter where focus starts.
  //
  // A caller that reuses this decoration field without the teaching extension
  // keeps a working editor that simply never folds.
  const teacher = safeTeacherBlocks(text), panels = state.field(teacherPanels, false) ?? new Map(), assets = state.facet(mediaAssets);
  const sections = safeUnderstandingSections(text), sectionPanels = state.field(understandingPanels, false) ?? new Map();
  // A folded section replaces its whole Markdown, and CodeMirror refuses two
  // decorations over one range: a note inside a folded section is read through
  // the section's own body instead of drawing a second fold.
  const foldedSections = sections.filter(section => section.to > section.from && sectionPanels.get(section.from) !== 'editing');
  const insideSection = point => foldedSections.some(section => point >= section.from && point < section.to);
  const folded = teacher.filter(block => block.to > block.from && panels.get(block.from) !== 'editing' && !insideSection(block.from));
  // A formula reveals its TeX only while the cursor is inside it. Dense math
  // would otherwise flip back to source whenever the line is edited.
  const touches = (from, to) => focused && state.selection.ranges.some(range => range.from < to && range.to > from);
  if (metadata.range) {
    const { from, to } = metadata.range;
    if (!focused || !state.selection.ranges.some(selection => selection.from < to && selection.to >= from)) {
      ranges.push(Decoration.replace({ block: true, widget: new PropertiesWidget(metadata.frontmatter) }).range(from, to));
    } else mark(from, to, 'cm-vault-frontmatter');
  }
  syntaxTree(state).iterate({ enter(ref) {
    const { name, from, to, node } = ref;
    if (metadata.range && from < metadata.range.to && name !== 'Document') return false;
    // A folded teacher block hides its own lines completely; its inner Markdown
    // is rendered by the nested read-only preview instead of by decorations
    // that would overlap the replacement range.
    if (name !== 'Document' && folded.some(block => from >= block.from && from < block.to)) return false;
    // The same holds for a folded 教师理解 section, whose own heading line is
    // replaced together with everything the section contains.
    if (name !== 'Document' && insideSection(from)) return false;
    if(name==='HTMLBlock'||name==='CommentBlock') {
      const hidden=metadataCommentLength(state.sliceDoc(from,to));
      if(hidden)ranges.push(Decoration.replace({block:true}).range(from,from+hidden));
      return false;
    }
    if (name === 'FencedCode' || name === 'CodeBlock') { markLines(state, ranges, from, to, { class: 'cm-vault-code' }); return false; }
    if (['HTMLBlock', 'Link', 'Image'].includes(name)) return false;
    if (name === MATH_INLINE || name === MATH_DISPLAY) {
      const source = mathSource(name, state.sliceDoc(from, to));
      if (touches(from, to)) mark(from, to, 'cm-vault-math-source');
      else {
          const widget = mathWidget('inline', source, from, to);
        if (widget) ranges.push(Decoration.replace({ widget }).range(from, to));
      }
      return false;
    }
    if (name === 'Paragraph' && state.doc.lineAt(from).from === from) {
      const source = displayMathSource(state.sliceDoc(from, to));
      if (source !== null) {
        const first = state.doc.lineAt(from), last = state.doc.lineAt(to);
        if (touches(first.from, last.to)) mark(from, to, 'cm-vault-math-source');
        else {
          const widget = mathWidget('display', source, first.from, last.to);
          if (widget) ranges.push(Decoration.replace({ block: true, widget }).range(first.from, last.to));
        }
        return false;
      }
    }
    if (name === 'Blockquote') markLines(state, ranges, from, to, { class: 'cm-vault-quote' });
    if (name === 'InlineCode') {
      if (!active(from, to)) {
        mark(from, to, 'cm-vault-inline-code');
        for (let child = node.firstChild; child; child = child.nextSibling) if (child.name === 'CodeMark') hide(child.from, child.to);
      }
      return false;
    }
    if (/^(ATX|Setext)Heading[1-6]$/.test(name)) {
      ranges.push(Decoration.line({ attributes: { role: 'heading', 'aria-level': name.slice(-1), 'aria-label': state.sliceDoc(from, to).replace(/^#+\s*/, '').replace(/\n[=-]+$/, '') } }).range(state.doc.lineAt(from).from));
    }
    if (active(from, to)) return;
    if (name === 'VaultWikiLink') {
      const raw = state.sliceDoc(from + 2, to - 2), [target, alias] = raw.split('|');
      const path = target.split('#')[0].trim().replace(/^[.][/]/, '');
      if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || /^[A-Za-z]:/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) return false;
      ranges.push(Decoration.replace({ widget: new WikiLinkWidget(/\.md$/i.test(path) ? path : `${path}.md`, alias?.trim() || target.trim()) }).range(from, to));
      return false;
    }
    if (name === 'VaultMediaEmbed') {
      const target = parseMediaTarget(state.sliceDoc(from + 3, to - 2)), asset = state.facet(mediaAssets)[target.path];
      if (/\.md$/i.test(target.path)) {
        const path = target.path;
        if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || /^[A-Za-z]:/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) return false;
        const label = `↩ ${path}${target.locator?.anchor ? ` · ${target.locator.anchor}` : ''}`;
        ranges.push(Decoration.replace({ widget: new WikiLinkWidget(`${path}${mediaLocatorSuffix(target.locator)}`, label) }).range(from, to));
        return false;
      }
      ranges.push(Decoration.replace({ widget: new MediaEmbedWidget(asset, target.locator, target.invalidLocator === true) }).range(from, to));
      return false;
    }
    if (name === 'StrongEmphasis') mark(from, to, 'cm-vault-strong');
    if (name === 'Emphasis') mark(from, to, 'cm-vault-emphasis');
    if (name === 'Strikethrough') mark(from, to, 'cm-vault-strike');
    if (name === HIGHLIGHT) {
      const raw = state.sliceDoc(from, to);
      if (raw.length > 4 && raw.startsWith('==') && raw.endsWith('==')) {
        hide(from, from + 2); mark(from + 2, to - 2, 'cm-vault-highlight'); hide(to - 2, to);
      }
    }
    if (/^(ATX|Setext)Heading[1-6]$/.test(name)) {
      mark(from, to, `cm-vault-heading cm-vault-h${name.slice(-1)}`);
    }
    if (['EmphasisMark', 'StrikethroughMark', 'HeaderMark', 'QuoteMark'].includes(name)) hide(from, to);
    if (name === 'TaskMarker') ranges.push(Decoration.replace({ widget: new TaskWidget(state.sliceDoc(from, to).toLowerCase() === '[x]', from, to) }).range(from, to));
  } });
  const rows = new Set(folded);
  for (const block of teacher) {
    if (block.to <= block.from) continue;
    // A note inside a folded 教师理解 is read through the section's own body, so
    // it draws no control of its own while that section is closed.
    if (insideSection(block.from)) continue;
    if (rows.has(block)) ranges.push(Decoration.replace({ block: true, widget: new TeacherDetailsWidget({
      from: block.from, text: teacherBlockText(text, block), summary: block.summary,
      body: text.slice(block.bodyFrom, block.bodyTo), expanded: panels.get(block.from) === 'open',
      assets: teacherAssetStamp(text.slice(block.bodyFrom, block.bodyTo), assets),
    }) }).range(block.from, block.to));
    // An edited block has no fold row to click, so the same state is left
    // through its own small control.
    else ranges.push(Decoration.widget({ widget: new TeacherEditingWidget(block.from), side: -1 }).range(block.from));
  }
  // 内容 and 学生理解 stay in the page; only the teacher's own reading of a card
  // starts folded, and its source is one explicit click away.
  for (const section of sections) {
    if (section.to <= section.from) continue;
    if (sectionPanels.get(section.from) === 'editing') {
      ranges.push(Decoration.widget({ widget: new UnderstandingEditingWidget(section.from, section.title), side: -1 }).range(section.from));
      continue;
    }
    const body = text.slice(section.bodyFrom, section.bodyTo).replace(/\s+$/, '');
    ranges.push(Decoration.replace({ block: true, widget: new UnderstandingSectionWidget({
      from: section.from, text: text.slice(section.from, section.to), title: section.title, body,
      expanded: sectionPanels.get(section.from) === 'open', assets: teacherAssetStamp(body, assets),
    }) }).range(section.from, section.to));
  }
  return Decoration.set(ranges, true);
}

// Block replacements must be supplied directly by a StateField, never a
// viewport ViewPlugin (CodeMirror disallows layout-changing decorations there).
export const vaultPreviewField = StateField.define({
  create: buildDecorations,
  update(value, transaction) {
    return transaction.docChanged || transaction.selection || transaction.reconfigured || transaction.effects.some(effect => effect.is(focusPreview))
      || transaction.startState.field(teacherPanels, false) !== transaction.state.field(teacherPanels, false)
      || transaction.startState.field(understandingPanels, false) !== transaction.state.field(understandingPanels, false)
      || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      ? buildDecorations(transaction.state) : value;
  },
  provide: field => [EditorView.decorations.from(field), EditorView.atomicRanges.of(view => {
    const ranges=[];
    view.state.field(field).between(0,view.state.doc.length,(from,to,decoration)=>{
      if(['teacher-details','understanding-section'].includes(decoration.spec.widget?.kind))ranges.push(Decoration.mark({}).range(from,to));
    });
    return Decoration.set(ranges,true);
  })],
});

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: '15px' },
  '.cm-content': { padding: '0 0 80px', lineHeight: '1.85', caretColor: 'var(--dsw-alias-label-primary)' },
  '.cm-gutters': { display: 'none' },
  '.cm-line': { padding: '0' },
  // The scale follows the native DSH Markdown baseline (h1 21px / h2 19px /
  // h3 18px of a 14px body, strong 600) at this editor's 15px body size.
  '.cm-line[role=heading]': { fontWeight: '650', lineHeight: '1.45', padding: '6px 0', textDecoration: 'none' },
  '.cm-line[role=heading] span': { textDecoration: 'none' },
  '.cm-line[aria-level="1"]': { fontSize: '1.65em' },
  '.cm-line[aria-level="2"]': { fontSize: '1.35em' },
  '.cm-line[aria-level="3"]': { fontSize: '1.15em' },
  '.cm-vault-heading': { fontWeight: 'inherit' },
  '.cm-vault-h4, .cm-vault-h5, .cm-vault-h6': { fontWeight: '600' },
  '.cm-vault-strong': { fontWeight: '600' },
  '.cm-vault-emphasis': { fontStyle: 'italic' },
  '.cm-vault-strike': { textDecoration: 'line-through', color: 'var(--dsw-alias-label-secondary)' },
  '.cm-vault-highlight': { background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 24%, transparent)', borderRadius: '3px', padding: '0 2px' },
  '.cm-vault-inline-code': { fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, monospace)', fontSize: '0.875em', background: 'var(--dsw-alias-markdown-inline-code)', border: '0.5px solid var(--dsw-alias-border-l1)', borderRadius: '6px', padding: '0 5px' },
  // Inside a heading the emphasis keeps the heading's weight and the code chip
  // keeps the heading's size, matching the native Markdown renderer.
  '.cm-vault-heading .cm-vault-strong': { fontWeight: 'inherit' },
  '.cm-vault-heading .cm-vault-inline-code': { fontSize: '1em' },
  '.cm-vault-code': { fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, monospace)', fontSize: '0.9em', background: 'var(--dsw-alias-markdown-code-block)' },
  '.cm-vault-quote': { borderLeft: '2px solid var(--dsw-alias-label-caption)', paddingLeft: '14px', color: 'var(--dsw-alias-label-secondary)' },
  '.cm-vault-math-inline': { cursor: 'text', padding: '0 1px' },
  '.cm-vault-math-display': { maxWidth: '100%', padding: '6px 0', cursor: 'text' },
  '.cm-vault-math .katex': { fontSize: '1.05em' },
  // Long display formulas scroll inside their own block; the source stays one
  // click away, so nothing is silently truncated.
  '.cm-vault-math-display .katex-display': { margin: '0', maxWidth: '100%', overflowX: 'auto', overflowY: 'hidden' },
  '.cm-vault-math-source': { background: 'var(--dsw-alias-bg-layer-2)', borderRadius: '3px', boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l1)' },
  '.cm-vault-frontmatter': { color: 'var(--dsw-alias-label-secondary)', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: '.85em' },
  '.cm-vault-wikilink': { color: 'var(--dsw-alias-link)', textDecoration: 'underline', textDecorationColor: 'color-mix(in srgb, var(--dsw-alias-link) 45%, transparent)', textUnderlineOffset: '3px', cursor: 'pointer', border: '0', padding: '0', background: 'none', font: 'inherit', fontWeight: '500' },
  '.cm-vault-task-checkbox': { width: '16px', height: '16px', margin: '0 5px 0 0', verticalAlign: 'middle', accentColor: 'var(--dsw-alias-interactive-bg-active)' },
  // A property sheet, not a metadata wall: the key column is as wide as its
  // widest label, values wrap beside it, and record arrays fold into a count.
  '.cm-vault-properties': { margin: '0 0 18px', padding: '2px 0', fontSize: '12.5px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'normal' },
  '.cm-vault-properties-head': { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', listStyle: 'none' },
  '.cm-vault-properties-caret': { display: 'inline-flex', flex: 'none', color: 'var(--dsw-alias-label-caption)', transition: 'transform .12s ease' },
  '.cm-vault-properties[open] .cm-vault-properties-caret': { transform: 'rotate(90deg)' },
  '.cm-vault-properties-title': { fontWeight: '600' },
  '.cm-vault-properties-count': { color: 'var(--dsw-alias-label-caption)' },
  '.cm-vault-properties-edit': { marginLeft: 'auto', border: '0', background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', font: 'inherit', padding: '0' },
  '.cm-vault-properties-edit:hover': { color: 'var(--dsw-alias-label-primary)' },
  '.cm-vault-properties-edit:focus-visible': { outline: '2px solid var(--dsw-alias-state-business-primary)', outlineOffset: '1px' },
  '.cm-vault-properties[open] .cm-vault-properties-head': { marginBottom: '8px' },
  '.cm-vault-properties-list': { display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '6px 14px', margin: '0', padding: '0 0 0 2px' },
  '.cm-vault-property-key': { display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' },
  '.cm-vault-property-icon': { display: 'inline-flex', flex: 'none', color: 'var(--dsw-alias-label-caption)' },
  '.cm-vault-property-value': { margin: '0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px', minWidth: '0', color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' },
  '.cm-vault-property-record': { minWidth: '0', color: 'var(--dsw-alias-label-secondary)' },
  '.cm-vault-property-record summary': { cursor: 'pointer', color: 'var(--dsw-alias-label-tertiary)' },
  '.cm-vault-property-record ul': { display: 'grid', gap: '2px', maxHeight: '132px', margin: '4px 0 0', padding: '0', listStyle: 'none', overflow: 'auto', fontVariantNumeric: 'tabular-nums' },
  '.cm-vault-tag': { border: '1px solid transparent', borderRadius: '999px', padding: '0 8px', background: 'var(--dsw-alias-markdown-tag, var(--dsw-alias-interactive-bg-active))', color: 'var(--dsw-alias-label-secondary)', font: 'inherit', lineHeight: '17px' },
  'button.cm-vault-tag': { cursor: 'pointer' },
  'button.cm-vault-tag:hover': { borderColor: 'var(--dsw-alias-link)', color: 'var(--dsw-alias-link)' },
  'button.cm-vault-tag:focus-visible': { outline: '2px solid var(--dsw-alias-state-business-primary)', outlineOffset: '1px' },
  // Teacher material folds into one quiet row beside the lesson: same Markdown,
  // same formulas, but the note only takes space when it is wanted.
  '.cm-vault-teacher': { margin: '0 0 18px', fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'normal' },
  '.cm-vault-teacher-head': { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', listStyle: 'none' },
  '.cm-vault-teacher-caret': { display: 'inline-flex', flex: 'none', color: 'var(--dsw-alias-label-caption)', transition: 'transform .12s ease' },
  '.cm-vault-teacher[open] .cm-vault-teacher-caret': { transform: 'rotate(90deg)' },
  '.cm-vault-teacher-label': { fontWeight: '600', color: 'var(--dsw-alias-label-tertiary)' },
  '.cm-vault-teacher-edit': { marginLeft: 'auto', border: '0', background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', font: 'inherit', padding: '0' },
  '.cm-vault-teacher-edit:hover': { color: 'var(--dsw-alias-label-primary)' },
  '.cm-vault-teacher-edit:focus-visible': { outline: '2px solid var(--dsw-alias-state-business-primary)', outlineOffset: '1px' },
  '.cm-vault-teacher[open] .cm-vault-teacher-head': { marginBottom: '8px' },
  '.cm-vault-teacher-body': { padding: '0 0 0 12px', borderLeft: '2px solid var(--dsw-alias-border-l1)', maxHeight: '520px', overflow: 'auto', overscrollBehavior: 'contain' },
  '.cm-vault-teacher-body .cm-editor': { fontSize: '14px' },
  '.cm-vault-teacher-body .cm-content': { padding: '0 0 8px' },
  '.cm-vault-teacher-bar': { display: 'inline-flex', alignItems: 'center', marginRight: '8px', verticalAlign: 'baseline' },
  '.cm-vault-teacher-collapse': { display: 'inline-flex', alignItems: 'center', gap: '3px', border: '0', background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', font: 'inherit', fontSize: '12px', padding: '0' },
  '.cm-vault-teacher-collapse:hover': { color: 'var(--dsw-alias-label-primary)' },
  '.cm-vault-teacher-collapse:focus-visible': { outline: '2px solid var(--dsw-alias-state-business-primary)', outlineOffset: '1px' },
  // A folded 教师理解 stands in for the card's own `##` heading, so its row
  // keeps the heading's reading weight instead of shrinking to a note label.
  '.cm-vault-section': { margin: '0 0 20px' },
  '.cm-vault-section .cm-vault-teacher-label': { fontSize: '1.05em', color: 'var(--dsw-alias-label-primary)' },
  '.cm-scroller': { overflow: 'visible', fontFamily: 'var(--dsw-font-family, ui-sans-serif, system-ui, sans-serif)' },
});

export function vaultPreview(onOpenPage, assets = {}, tagHandler = null, pdfRenderer = null) {
  return [markdown({ base: markdownLanguage, extensions: [vaultSyntax, mathSyntax] }), openPage.of(onOpenPage), mediaAssets.of(assets), renderPdfRegion.of(pdfRenderer), onTag.of(tagHandler), previewFocus, teacherPanels, understandingPanels, EditorView.focusChangeEffect.of((_state, focusing) => focusPreview.of(focusing)), vaultPreviewField, theme, EditorState.allowMultipleSelections.of(true)];
}

// Re-exported so a reader of this entry point can reach the math contract
// without knowing the module split.
export { displayMathSource, MATH_DISPLAY, MATH_INLINE, mathSource, renderMath } from './math-latex.js';
