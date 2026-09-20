import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, highlightActiveLine, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, drawSelection, keymap } from '@codemirror/view';

class VaultTaskWidget extends WidgetType {
  constructor(checked, from, to, replacement) { super(); this.checked = checked; this.from = from; this.to = to; this.replacement = replacement; }
  eq(other) { return other.checked === this.checked && other.replacement === this.replacement; }
  toDOM(view) {
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = this.checked; input.className = 'cm-vault-task-checkbox';
    input.addEventListener('mousedown', event => event.preventDefault());
    input.addEventListener('change', () => view.dispatch({ changes: { from: this.from, to: this.to, insert: this.replacement }, userEvent: 'input' }));
    return input;
  }
  ignoreEvent() { return true; }
}

function buildVaultDecorations(view) {
  const decorations = [];
  const activeLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  for (let number = 1; number <= view.state.doc.lines; number++) {
    const line = view.state.doc.line(number), text = line.text;
    if (number === activeLine) continue;
    const heading = text.match(/^(#{1,6}\s+)/);
    if (heading) {
      decorations.push(Decoration.replace({}).range(line.from, line.from + heading[1].length));
      decorations.push(Decoration.mark({ class: 'cm-vault-heading' }).range(line.from + heading[1].length, line.to));
    }
    const task = text.match(/^(\s*)([-*+]\s+\[([ xX])\]\s+)/);
    if (task) {
      const from = line.from + task.index + task[1].length;
      const to = from + task[2].length;
      const replacement = task[2].replace(/\[([ xX])\]/, task[3].toLowerCase() === 'x' ? '[x]' : '[ ]');
      decorations.push(Decoration.replace({ widget: new VaultTaskWidget(task[3].toLowerCase() === 'x', from, to, replacement) }).range(from, to));
    }
    if (/^\s*```/.test(text)) decorations.push(Decoration.mark({ class: 'cm-vault-code-fence' }).range(line.from, line.to));
    if (/^\s*(---|[A-Za-z][\w-]*:\s*)/.test(text)) decorations.push(Decoration.mark({ class: 'cm-vault-frontmatter' }).range(line.from, line.to));
    for (const match of text.matchAll(/\[\[[^\]]+\]\]/g)) decorations.push(Decoration.mark({ class: 'cm-vault-wikilink' }).range(line.from + match.index, line.from + match.index + match[0].length));
    for (const match of text.matchAll(/(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g)) decorations.push(Decoration.mark({ class: 'cm-vault-emphasis' }).range(line.from + match.index, line.from + match.index + match[0].length));
  }
  return Decoration.set(decorations, true);
}

const vaultLivePreview = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = buildVaultDecorations(view); }
  update(update) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = buildVaultDecorations(update.view);
  }
}, { decorations: plugin => plugin.decorations });

const vaultTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: '15px' },
  '.cm-content': { padding: '0 0 80px', lineHeight: '1.85', caretColor: 'var(--dsw-alias-label-primary)' },
  '.cm-gutters': { display: 'none' },
  '.cm-line': { padding: '0' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-vault-heading': { fontWeight: '650', fontSize: '1.25em' },
  '.cm-vault-wikilink': { color: 'var(--dsw-alias-label-link, var(--dsw-alias-label-primary))', textDecoration: 'underline' },
  '.cm-vault-emphasis': { fontStyle: 'italic' },
  '.cm-vault-code-fence': { color: 'var(--dsw-alias-label-secondary)', fontFamily: 'ui-monospace, SFMono-Regular, monospace' },
  '.cm-vault-frontmatter': { color: 'var(--dsw-alias-label-secondary)', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: '.85em' },
  '.cm-vault-task-checkbox': { width: '16px', height: '16px', margin: '0 8px 0 0', verticalAlign: 'middle', accentColor: 'var(--dsw-alias-interactive-bg-active)' },
  '.cm-scroller': { overflow: 'visible' },
}, { dark: false });

window.__ModuleLoader__.load({
  id: '@notara/vault-native',
  factory: (require) => {
    const React = require('react');
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    // DSH's browser Remote API only mounts strict codecs. The Host remains the
    // authoritative validator for every field; this client codec checks the
    // transport envelope and leaves the detailed contract at that boundary.
    const strictJsonSchema = {
      parse(value) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Remote input must be an object');
        return value;
      },
    };
    const REMOTE_METHODS = ['list', 'read', 'save', 'search', 'query', 'links', 'templates', 'createFromTemplate', 'tasks', 'toggleTask'];
    const REMOTE_CONTRIBUTION = {
      package: '@notara/vault-native',
      descriptors: REMOTE_METHODS.map(method => ({
        id: `@notara/vault-native#notaraVault/${method}`,
        service: 'notaraVault',
        namespace: 'notaraVault',
        method,
        invocation: { kind: 'direct' },
        parameters: [{ name: 'input', wire: 'input', source: 'json', codec: { mode: 'strict', typeSymbol: '@notara/vault-native#JsonObject', schema: strictJsonSchema } }],
        result: { mode: 'strict', typeSymbol: '@notara/vault-native#JsonValue', schema: strictJsonSchema },
      })),
    };

    const STYLE = {
      page: { height: '100%', minHeight: 0, background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', fontFamily: 'var(--dsw-font-family, ui-sans-serif, system-ui, sans-serif)', display: 'flex', flexDirection: 'column' },
      top: { height: 52, flex: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px', borderBottom: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)' },
      brand: { fontSize: 16, letterSpacing: '.02em', color: 'var(--dsw-alias-label-primary)', fontWeight: 650 },
      badge: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 99, padding: '3px 8px' },
      hint: { marginLeft: 'auto', color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
      body: { display: 'grid', gridTemplateColumns: '270px minmax(0, 1fr)', minHeight: 0, flex: 1 },
      rail: { background: 'var(--dsw-alias-bg-layer-2)', borderRight: '1px solid var(--dsw-alias-border-l1)', padding: '16px 12px', overflow: 'auto' },
      section: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', letterSpacing: '.08em', textTransform: 'uppercase', padding: '3px 10px 10px' },
      search: { width: '100%', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '8px 10px', background: 'var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1))', color: 'var(--dsw-alias-label-primary)', marginBottom: 14, outline: 'none' },
      row: { width: '100%', boxSizing: 'border-box', textAlign: 'left', border: 0, background: 'transparent', color: 'var(--dsw-alias-label-primary)', padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
      rowActive: { background: 'var(--dsw-alias-interactive-bg-active)', color: 'var(--dsw-alias-label-primary)', fontWeight: 600 },
      treeFolder: { color: 'var(--dsw-alias-label-secondary)', padding: '8px 10px 4px', fontSize: 12 },
      main: { minWidth: 0, overflow: 'auto', background: 'var(--dsw-alias-bg-layer-1)' },
      article: { maxWidth: 900, margin: '0 auto', padding: '34px 42px 90px' },
      title: { fontSize: 28, lineHeight: 1.25, fontWeight: 650, margin: 0, color: 'var(--dsw-alias-label-primary)' },
      path: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, marginTop: 8 },
      toolbar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 22, paddingBottom: 16, borderBottom: '1px solid var(--dsw-alias-border-l1)' },
      quiet: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 5, background: 'transparent', color: 'var(--dsw-alias-label-primary)', padding: '6px 10px', cursor: 'pointer', font: 'inherit', fontSize: 12 },
      content: { marginTop: 26, fontSize: 15, lineHeight: 1.85, color: 'var(--dsw-alias-label-primary)' },
      heading1: { fontSize: 24, lineHeight: 1.35, margin: '28px 0 12px' },
      heading2: { fontSize: 19, lineHeight: 1.4, margin: '24px 0 10px' },
      heading3: { fontSize: 16, lineHeight: 1.5, margin: '18px 0 8px' },
      paragraph: { margin: '8px 0', whiteSpace: 'pre-wrap' },
      saveState: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, marginLeft: 'auto' },
      meta: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginTop: 20 },
      metaItem: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, padding: '9px 11px', background: 'var(--dsw-alias-bg-layer-2)' },
      metaLabel: { display: 'block', color: 'var(--dsw-alias-label-secondary)', fontSize: 11, marginBottom: 4 },
      metaValue: { fontSize: 13 },
      links: { display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 18 },
      link: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-link, var(--dsw-alias-label-primary))', cursor: 'pointer', padding: 0, font: 'inherit', fontSize: 13, textDecoration: 'underline' },
      notice: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, marginLeft: 4 },
      empty: { color: 'var(--dsw-alias-label-secondary)', padding: 40, textAlign: 'center' },
      template: { marginTop: 22, padding: '12px 10px', borderTop: '1px solid var(--dsw-alias-border-l1)' },
      templateInput: { width: '100%', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 5, padding: '7px 8px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', marginBottom: 7, outline: 'none' },
    };

    const buttonStyle = (active) => ({ ...STYLE.row, ...(active ? STYLE.rowActive : {}) });
    function CodeMirrorMarkdown({ content, onChange }) {
      const host = useRef(null);
      const viewRef = useRef(null);
      const changeHandler = useRef(onChange);
      useEffect(() => { changeHandler.current = onChange; }, [onChange]);
      useEffect(() => {
        if (!host.current) return undefined;
        const state = EditorState.create({
          doc: content,
          extensions: [
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
            drawSelection(),
            EditorView.lineWrapping,
            markdown({ base: markdownLanguage }),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            vaultLivePreview,
            vaultTheme,
            EditorView.updateListener.of(update => {
              if (update.docChanged) changeHandler.current(update.state.doc.toString());
            }),
          ],
        });
        const view = new EditorView({ state, parent: host.current });
        viewRef.current = view;
        return () => view.destroy();
      }, []);
      useEffect(() => {
        const view = viewRef.current;
        if (view && view.state.doc.toString() !== content) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
      }, [content]);
      return React.createElement('div', { ref: host, style: STYLE.content, 'aria-label': 'Markdown Live Preview 编辑器' });
    }

    function Tree({ node, selected, onSelect, depth = 0 }) {
      return React.createElement(React.Fragment, null, node.children.map(child => child.path
        ? React.createElement('button', { key: child.path, style: { ...buttonStyle(child.path === selected), paddingLeft: 10 + depth * 12 }, onClick: () => onSelect(child.path) }, child.name)
        : React.createElement('div', { key: `${depth}:${child.name}` },
          React.createElement('div', { style: { ...STYLE.treeFolder, paddingLeft: 10 + depth * 12 } }, child.name),
          React.createElement(Tree, { node: child, selected, onSelect, depth: depth + 1 }),
        )),
      );
    }

    function App({ ctx }) {
      const vault = ctx.remote.notaraVault;
      const [files, setFiles] = useState([]);
      const [tree, setTree] = useState({ name: '', children: [] });
      const [selected, setSelected] = useState('');
      const [document, setDocument] = useState(undefined);
      const [draft, setDraft] = useState('');
      const [dirty, setDirty] = useState(false);
      const [saving, setSaving] = useState(false);
      const [backlinks, setBacklinks] = useState([]);
      const [templates, setTemplates] = useState([]);
      const [query, setQuery] = useState('');
      const [hits, setHits] = useState([]);
      const [notice, setNotice] = useState('正在读取…');
      const [templatePath, setTemplatePath] = useState('');
      const [newPath, setNewPath] = useState('路线/新页面.md');
      const [newTitle, setNewTitle] = useState('新页面');

      const refresh = useCallback(async (preferred) => {
        const result = await vault.list({});
        if (!result.ok) { setNotice('文件树暂时无法读取。'); return; }
        setFiles(result.value.files); setTree(result.value.tree);
        const next = preferred || selected || result.value.files[0]?.path || '';
        if (next) setSelected(next);
        setNotice(`${result.value.files.length} 个 Markdown 页面`);
      }, [selected, vault]);

      const open = useCallback(async path => {
        if (!path) return;
        const [read, links] = await Promise.all([vault.read({ path }), vault.links({ path })]);
        if (!read.ok) { setNotice('页面暂时无法读取。'); return; }
        setSelected(path); setDocument(read.value); setDraft(read.value.content); setDirty(false); setBacklinks(links.ok ? links.value.incoming : []); setNotice('');
      }, [vault]);

      useEffect(() => { void refresh(); }, []);
      useEffect(() => { if (selected) void open(selected); }, [selected]);
      useEffect(() => { void vault.templates({}).then(result => { if (result.ok) { setTemplates(result.value); if (!templatePath) setTemplatePath(result.value[0]?.path || ''); } }); }, []);

      const shownFiles = useMemo(() => query.trim() ? hits : files, [files, hits, query]);
      const selectPage = path => {
        if (!path || path === selected) return;
        if (dirty) { setNotice('当前页面有未保存修改，请先保存或放弃。'); return; }
        setQuery(''); setHits([]); setSelected(path);
      };
      const runSearch = async value => {
        setQuery(value);
        if (!value.trim()) { setHits([]); return; }
        const result = await vault.search({ query: value, limit: 50 });
        if (result.ok) setHits(result.value);
      };
      const save = async () => {
        if (!document || !dirty || saving) return;
        setSaving(true);
        try {
          const result = await vault.save({ path: document.path, content: draft, expectedRevision: document.revision });
          if (result.ok) {
            setDocument(result.value); setDraft(result.value.content); setDirty(false); setNotice('已保存');
            await refresh(result.value.path);
          } else setNotice('页面已经被别人改过，请刷新后决定保留哪一版。');
        } catch { setNotice('保存失败，当前修改仍保留在页面中。'); }
        setSaving(false);
      };
      const discard = () => { if (document) { setDraft(document.content); setDirty(false); setNotice('已放弃未保存修改'); } };
      const create = async event => {
        event.preventDefault();
        if (dirty) { setNotice('当前页面有未保存修改，请先保存或放弃。'); return; }
        if (!templatePath || !newPath.trim()) return;
        const result = await vault.createFromTemplate({ templatePath, path: newPath.trim(), values: { title: newTitle.trim() || '新页面', date: new Date().toISOString().slice(0, 10) }, expectedRevision: null });
        if (result.ok) { setNewPath('路线/新页面.md'); await refresh(result.value.path); setSelected(result.value.path); }
        else setNotice('创建失败：目标页面可能已经存在。');
      };
      const selectFromResult = path => selectPage(path);

      return React.createElement('div', { style: STYLE.page },
        React.createElement('header', { style: STYLE.top },
          React.createElement('span', { style: STYLE.brand }, 'Notara Vault'),
          React.createElement('span', { style: STYLE.badge }, '文件事实源'),
          React.createElement('span', { style: STYLE.hint }, notice || '已连接工作区'),
        ),
        React.createElement('div', { style: STYLE.body },
          React.createElement('aside', { style: STYLE.rail },
            React.createElement('div', { style: STYLE.section }, 'Markdown Vault'),
            React.createElement('input', { style: STYLE.search, placeholder: '搜索标题、内容或路径…', value: query, onChange: event => { void runSearch(event.target.value); } }),
            query.trim() ? shownFiles.map(item => React.createElement('button', { key: item.path, style: buttonStyle(item.path === selected), onClick: () => selectFromResult(item.path) }, item.path)) : React.createElement(Tree, { node: tree, selected, onSelect: selectPage }),
            React.createElement('div', { style: STYLE.template },
              React.createElement('div', { style: STYLE.section }, '从模板新建'),
              React.createElement('select', { style: STYLE.templateInput, value: templatePath, onChange: event => setTemplatePath(event.target.value) }, templates.map(item => React.createElement('option', { key: item.path, value: item.path }, item.title || item.path))),
              React.createElement('input', { style: STYLE.templateInput, value: newTitle, onChange: event => setNewTitle(event.target.value), placeholder: '页面标题' }),
              React.createElement('input', { style: STYLE.templateInput, value: newPath, onChange: event => setNewPath(event.target.value), placeholder: '目标路径，例如路线/新课.md' }),
              React.createElement('button', { style: STYLE.quiet, disabled: !templates.length, onClick: create }, '创建 Markdown 页面'),
            ),
          ),
          React.createElement('main', { style: STYLE.main }, document
            ? React.createElement('article', { style: STYLE.article },
              React.createElement('h1', { style: STYLE.title }, document.title),
              React.createElement('div', { style: STYLE.path }, document.path),
              React.createElement('div', { style: STYLE.toolbar },
                React.createElement('button', { style: STYLE.quiet, onClick: () => { void refresh(document.path); void open(document.path); } }, '刷新'),
                React.createElement('button', { style: STYLE.quiet, disabled: !dirty || saving, onClick: () => { void save(); } }, saving ? '保存中…' : '保存'),
                React.createElement('button', { style: STYLE.quiet, disabled: !dirty || saving, onClick: discard }, '放弃修改'),
                React.createElement('span', { style: STYLE.saveState }, dirty ? '有未保存修改' : `已同步 · ${document.revision}`),
              ),
              React.createElement('div', { style: STYLE.meta },
                React.createElement('div', { style: STYLE.metaItem }, React.createElement('span', { style: STYLE.metaLabel }, '类型'), React.createElement('span', { style: STYLE.metaValue }, document.type || '未标注')),
                React.createElement('div', { style: STYLE.metaItem }, React.createElement('span', { style: STYLE.metaLabel }, '状态'), React.createElement('span', { style: STYLE.metaValue }, document.status || '未标注')),
                React.createElement('div', { style: STYLE.metaItem }, React.createElement('span', { style: STYLE.metaLabel }, 'Task'), React.createElement('span', { style: STYLE.metaValue }, `${document.tasks.filter(task => task.checked).length}/${document.tasks.length}`)),
              ),
              React.createElement(CodeMirrorMarkdown, { key: document.path, content: draft, onChange: value => { setDraft(value); setDirty(true); setNotice('有未保存修改'); } }),
              React.createElement('section', { style: STYLE.links },
                document.links.map(path => React.createElement('button', { key: `out:${path}`, style: STYLE.link, onClick: () => selectFromResult(path) }, `→ ${path}`)),
                backlinks.map(path => React.createElement('button', { key: `in:${path}`, style: STYLE.link, onClick: () => selectFromResult(path) }, `← ${path}`)),
              ),
            )
            : React.createElement('div', { style: STYLE.empty }, files.length ? '选择一个 Markdown 页面' : 'vault 里还没有 Markdown 页面'),
          ),
        ),
      );
    }

    return {
      inject: ['remote'],
      async apply(ctx) {
        const unmount = await ctx.remote.$mount(REMOTE_CONTRIBUTION);
        ctx.effect(() => unmount, 'notara-vault-native: remote');
        ctx.plugin({
          inject: ['slots', 'remote.notaraVault'],
          apply(scope) {
            console.info('notara-vault-native: apply');
            scope.effect(() => scope.slots.inject('conversation.view', () => scope.slots.register({
              name: 'conversation.view',
              id: 'notara-vault',
              order: 20,
              label: () => '资产',
            }, props => React.createElement(App, { ...props, ctx: scope })), 'notara-vault-native: conversation view'));
          },
        });
      },
    };
  },
});
