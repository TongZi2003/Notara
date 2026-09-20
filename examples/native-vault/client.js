window.__ModuleLoader__.load({
  id: '@notara/vault-native',
  factory: (require) => {
    const React = require('react');
    const { useEffect, useMemo, useState } = React;

    const SEED = [
      { path: '路线/三角函数.md', body: '# 三角函数学习路线\n\n## 目标\n建立单位圆、图像和恒等变换之间的联系。\n\n## 节点\n- [ ] 单位圆\n- [ ] 正弦函数图像\n- [ ] 恒等变换\n\n[[知识/向量]]' },
      { path: '知识/向量.md', body: '# 向量\n\n向量既可以用代数坐标表示，也可以用几何方向表示。\n\n## 关键联系\n- 基底\n- 数形结合\n\n[[卡片/定义域]]' },
      { path: '卡片/定义域.md', body: '# 定义域\n\n先找表达式中每个运算的限制，再取这些限制的交集。\n\n- [ ] 能说出限制来自哪里\n- [ ] 能检查端点' },
    ];
    const STYLE = {
      page: { height: '100%', minHeight: 0, background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', fontFamily: 'var(--dsw-font-family, ui-sans-serif, system-ui, sans-serif)', display: 'flex', flexDirection: 'column' },
      top: { height: 52, flex: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px', borderBottom: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)' },
      brand: { fontSize: 16, letterSpacing: '.02em', color: 'var(--dsw-alias-label-primary)', fontWeight: 650 },
      badge: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 99, padding: '3px 8px' },
      hint: { marginLeft: 'auto', color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
      body: { display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', minHeight: 0, flex: 1 },
      rail: { background: 'var(--dsw-alias-bg-layer-2)', borderRight: '1px solid var(--dsw-alias-border-l1)', padding: '16px 12px', overflow: 'auto' },
      section: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', letterSpacing: '.08em', textTransform: 'uppercase', padding: '3px 10px 10px' },
      row: { width: '100%', boxSizing: 'border-box', textAlign: 'left', border: 0, background: 'transparent', color: 'var(--dsw-alias-label-primary)', padding: '9px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
      rowActive: { background: 'var(--dsw-alias-interactive-bg-active)', color: 'var(--dsw-alias-label-primary)', fontWeight: 600 },
      main: { minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 42%)', background: 'var(--dsw-alias-bg-layer-1)' },
      editor: { minWidth: 0, padding: '28px 34px', overflow: 'auto' },
      title: { fontSize: 26, fontWeight: 600, margin: 0, color: 'var(--dsw-alias-label-primary)' },
      path: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, marginTop: 8 },
      textarea: { width: '100%', minHeight: 420, boxSizing: 'border-box', marginTop: 24, padding: 14, resize: 'vertical', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, background: 'var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1))', color: 'var(--dsw-alias-label-primary)', font: '14px/1.75 ui-monospace, SFMono-Regular, monospace', outline: 'none' },
      preview: { borderLeft: '1px solid var(--dsw-alias-border-l1)', padding: '28px 28px', overflow: 'auto', background: 'var(--dsw-alias-bg-layer-2)' },
      previewLabel: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 20 },
      previewText: { whiteSpace: 'pre-wrap', font: '15px/1.85 var(--dsw-font-family, ui-sans-serif, system-ui, sans-serif)', color: 'var(--dsw-alias-label-primary)' },
      search: { width: '100%', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '8px 10px', background: 'var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1))', color: 'var(--dsw-alias-label-primary)', marginBottom: 18, outline: 'none' },
    };
    const load = () => { try { return JSON.parse(localStorage.getItem('notara-vault-native:v1') || 'null') || SEED; } catch { return SEED; } };
    const save = (docs) => localStorage.setItem('notara-vault-native:v1', JSON.stringify(docs));
    const buttonStyle = (active) => ({ ...STYLE.row, ...(active ? STYLE.rowActive : {}) });

    function App() {
      const [docs, setDocs] = useState(load);
      const [selected, setSelected] = useState(docs[0]?.path || '');
      const [query, setQuery] = useState('');
      const current = docs.find(item => item.path === selected) || docs[0];
      const matches = useMemo(() => docs.filter(item => !query.trim() || (item.path + item.body).toLowerCase().includes(query.toLowerCase())), [docs, query]);
      useEffect(() => { if (current && current.path !== selected) setSelected(current.path); }, [current, selected]);
      const update = (body) => { const next = docs.map(item => item.path === current.path ? { ...item, body } : item); setDocs(next); save(next); };
      return React.createElement('div', { style: STYLE.page },
        React.createElement('header', { style: STYLE.top },
          React.createElement('span', { style: STYLE.brand }, 'Notara Vault'),
          React.createElement('span', { style: STYLE.badge }, '原生 DSH 插件'),
          React.createElement('span', { style: STYLE.hint }, '这是一个独立副本 · 旧版课堂未加载'),
        ),
        React.createElement('div', { style: STYLE.body },
          React.createElement('aside', { style: STYLE.rail },
            React.createElement('div', { style: STYLE.section }, 'Markdown Vault'),
            React.createElement('input', { style: STYLE.search, placeholder: '搜索资产…', value: query, onChange: event => setQuery(event.target.value) }),
            matches.map(item => React.createElement('button', { key: item.path, style: buttonStyle(item.path === current?.path), onClick: () => setSelected(item.path) }, item.path)),
          ),
          React.createElement('main', { style: STYLE.main },
            current && React.createElement(React.Fragment, null,
              React.createElement('section', { style: STYLE.editor },
                React.createElement('h1', { style: STYLE.title }, current.path.split('/').at(-1).replace('.md', '')),
                React.createElement('div', { style: STYLE.path }, current.path),
                React.createElement('textarea', { 'aria-label': 'Markdown 编辑器', style: STYLE.textarea, value: current.body, onChange: event => update(event.target.value) }),
              ),
              React.createElement('section', { style: STYLE.preview },
                React.createElement('div', { style: STYLE.previewLabel }, 'Live preview'),
                React.createElement('div', { style: STYLE.previewText }, current.body),
              ),
            ),
          ),
        ),
      );
    }

    const VIEW_ID = 'notara-vault';

    return {
      inject: ['slots'],
      apply(ctx) {
        console.info('notara-vault-native: apply');
        ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: VIEW_ID,
          order: 20,
          label: () => '资产',
        }, App)), 'notara-vault-native: conversation view');
      },
    };
  },
});
