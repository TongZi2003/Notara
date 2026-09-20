import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { EditorState, Facet, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { parseFrontmatter } from './frontmatter.js';

const openPage = Facet.define({ combine: handlers => handlers[0] ?? (() => {}) });
const wikiSyntax = {
  defineNodes: ['VaultWikiLink'],
  parseInline: [{
    name: 'VaultWikiLink', before: 'Link',
    parse(cx, next, pos) {
      if (next !== 91 || cx.char(pos + 1) !== 91) return -1;
      const match = /^\[\[([^\]\n]+)\]\]/.exec(cx.slice(pos, cx.end));
      return match ? cx.addElement(cx.elt('VaultWikiLink', pos, pos + match[0].length)) : -1;
    },
  }],
};

/** Incomplete YAML must remain editable, never break the editor. */
export function previewFrontmatter(content) {
  try { return parseFrontmatter(content); }
  catch { return { frontmatter: {}, body: content, range: null }; }
}

class PropertiesWidget extends WidgetType {
  kind = 'properties';
  constructor(properties) { super(); this.properties = properties; }
  eq(other) { return JSON.stringify(this.properties) === JSON.stringify(other.properties); }
  toDOM(view) {
    const root = document.createElement('section');
    root.className = 'cm-vault-properties'; root.setAttribute('aria-label', '页面属性');
    const header = document.createElement('header'), title = document.createElement('strong'), edit = document.createElement('button');
    title.textContent = '页面属性'; edit.type = 'button'; edit.textContent = '编辑属性';
    edit.addEventListener('click', () => {
      view.dispatch({ selection: { anchor: view.state.doc.line(2).from }, scrollIntoView: true });
      view.focus();
    });
    header.append(title, edit); root.append(header);
    const fields = document.createElement('dl');
    const labels = { type: '类型', status: '状态', tags: '标签', title: '标题', date: '日期', name: '名称' };
    for (const [key, value] of Object.entries(this.properties)) {
      const label = document.createElement('dt'), cell = document.createElement('dd');
      label.textContent = Object.hasOwn(labels, key) ? labels[key] : key;
      label.title = key;
      if (Array.isArray(value) && value.length) {
        for (const item of value) {
          const chip = document.createElement('span'); chip.className = 'cm-vault-tag'; chip.textContent = item; cell.append(chip);
        }
      } else cell.textContent = value === null || value === '' || Array.isArray(value) ? '—' : String(value);
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

class TaskWidget extends WidgetType {
  kind = 'task';
  constructor(checked, from, to) { super(); this.checked = checked; this.from = from; this.to = to; }
  eq(other) { return this.checked === other.checked && this.from === other.from && this.to === other.to; }
  activate(view) {
    const current = view.state.sliceDoc(this.from, this.to);
    if (!/^\[[ xX]\]$/.test(current)) return;
    view.dispatch({ changes: { from: this.from, to: this.to, insert: this.checked ? '[ ]' : '[x]' }, userEvent: 'input' });
  }
  toDOM(view) {
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = this.checked; input.className = 'cm-vault-task-checkbox';
    input.setAttribute('aria-label', this.checked ? '标为未完成' : '标为已完成');
    input.addEventListener('mousedown', event => event.preventDefault());
    input.addEventListener('change', () => this.activate(view));
    return input;
  }
  ignoreEvent() { return true; }
}

function buildDecorations(state) {
  const ranges = [], metadata = previewFrontmatter(state.doc.toString());
  const hide = (from, to) => { if (to > from) ranges.push(Decoration.replace({}).range(from, to)); };
  const mark = (from, to, name) => { if (to > from) ranges.push(Decoration.mark({ class: name }).range(from, to)); };
  const active = (from, to) => state.selection.ranges.some(selection =>
    state.doc.lineAt(selection.from).from <= to && state.doc.lineAt(selection.to).to >= from);
  if (metadata.range) {
    const { from, to } = metadata.range;
    if (!state.selection.ranges.some(selection => selection.from < to && selection.to >= from)) {
      ranges.push(Decoration.replace({ block: true, widget: new PropertiesWidget(metadata.frontmatter) }).range(from, to));
    } else mark(from, to, 'cm-vault-frontmatter');
  }
  syntaxTree(state).iterate({ enter(ref) {
    const { name, from, to, node } = ref;
    if (metadata.range && from < metadata.range.to && name !== 'Document') return false;
    if (['FencedCode', 'CodeBlock', 'HTMLBlock', 'Link', 'Image'].includes(name)) return false;
    if (name === 'InlineCode') {
      if (!active(from, to)) {
        mark(from, to, 'cm-vault-inline-code');
        for (let child = node.firstChild; child; child = child.nextSibling) if (child.name === 'CodeMark') hide(child.from, child.to);
      }
      return false;
    }
    if (active(from, to)) return;
    if (name === 'VaultWikiLink') {
      const raw = state.sliceDoc(from + 2, to - 2), [target, alias] = raw.split('|');
      const path = target.split('#')[0].trim().replace(/^[.][/]/, '');
      if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || /^[A-Za-z]:/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) return false;
      ranges.push(Decoration.replace({ widget: new WikiLinkWidget(/\.md$/i.test(path) ? path : `${path}.md`, alias?.trim() || target.trim()) }).range(from, to));
      return false;
    }
    if (name === 'StrongEmphasis') mark(from, to, 'cm-vault-strong');
    if (name === 'Emphasis') mark(from, to, 'cm-vault-emphasis');
    if (name === 'Strikethrough') mark(from, to, 'cm-vault-strike');
    if (/^(ATX|Setext)Heading[1-6]$/.test(name)) {
      mark(from, to, `cm-vault-heading cm-vault-h${name.slice(-1)}`);
    }
    if (['EmphasisMark', 'StrikethroughMark', 'HeaderMark'].includes(name)) hide(from, to);
    if (name === 'TaskMarker') ranges.push(Decoration.replace({ widget: new TaskWidget(state.sliceDoc(from, to).toLowerCase() === '[x]', from, to) }).range(from, to));
  } });
  return Decoration.set(ranges, true);
}

// Block replacements must be supplied directly by a StateField, never a
// viewport ViewPlugin (CodeMirror disallows layout-changing decorations there).
export const vaultPreviewField = StateField.define({
  create: buildDecorations,
  update(value, transaction) {
    return transaction.docChanged || transaction.selection || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      ? buildDecorations(transaction.state) : value;
  },
  provide: field => EditorView.decorations.from(field),
});

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: '15px' },
  '.cm-content': { padding: '0 0 80px', lineHeight: '1.85', caretColor: 'var(--dsw-alias-label-primary)' },
  '.cm-gutters': { display: 'none' },
  '.cm-line': { padding: '0' },
  '.cm-vault-heading': { fontWeight: '650' },
  '.cm-vault-h1': { fontSize: '1.6em' },
  '.cm-vault-h2': { fontSize: '1.35em' },
  '.cm-vault-h3': { fontSize: '1.15em' },
  '.cm-vault-strong': { fontWeight: '700' },
  '.cm-vault-emphasis': { fontStyle: 'italic' },
  '.cm-vault-strike': { textDecoration: 'line-through' },
  '.cm-vault-inline-code': { fontFamily: 'ui-monospace, SFMono-Regular, monospace', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: '3px', padding: '1px 3px' },
  '.cm-vault-frontmatter': { color: 'var(--dsw-alias-label-secondary)', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: '.85em' },
  '.cm-vault-wikilink': { color: 'var(--dsw-alias-label-link, var(--dsw-alias-label-primary))', textDecoration: 'underline', cursor: 'pointer', border: '0', padding: '0', background: 'none', font: 'inherit' },
  '.cm-vault-task-checkbox': { width: '16px', height: '16px', margin: '0 5px 0 0', verticalAlign: 'middle', accentColor: 'var(--dsw-alias-interactive-bg-active)' },
  '.cm-vault-properties': { margin: '0 0 20px', padding: '12px 16px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2)', fontSize: '13px', whiteSpace: 'normal' },
  '.cm-vault-properties header': { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' },
  '.cm-vault-properties button': { border: '0', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', font: 'inherit' },
  '.cm-vault-properties dl': { display: 'grid', gridTemplateColumns: 'minmax(60px, 100px) minmax(0, 1fr)', gap: '8px 16px', margin: '0' },
  '.cm-vault-properties dt': { color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere' },
  '.cm-vault-properties dd': { margin: '0', display: 'flex', flexWrap: 'wrap', gap: '6px', overflowWrap: 'anywhere' },
  '.cm-vault-tag': { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '4px', padding: '0 7px', background: 'var(--dsw-alias-bg-layer-1)' },
  '.cm-scroller': { overflow: 'visible' },
});

export function vaultPreview(onOpenPage) {
  return [markdown({ base: markdownLanguage, extensions: wikiSyntax }), openPage.of(onOpenPage), vaultPreviewField, theme, EditorState.allowMultipleSelections.of(true)];
}
