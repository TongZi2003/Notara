import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const preview = await import('./live-preview.js');
const source = '---\ntype: note\nstatus: draft\ntags: [math, vector]\n---\n# 向量\n\n[[路线/向量路线]]\n';
function state(doc = source, onOpenPage = () => {}, assets = {}) {
  assert.equal(typeof preview.vaultPreview, 'function', 'semantic Live Preview must be installed');
  const text = EditorState.create({ doc }).doc;
  return EditorState.create({ doc: text, selection: { anchor: text.length }, extensions: preview.vaultPreview(onOpenPage, assets) });
}
function decorations(value) {
  const result = [];
  value.field(preview.vaultPreviewField).between(0, value.doc.length, (from, to, decoration) => result.push({ from, to, ...decoration.spec }));
  return result;
}
const properties = value => decorations(value).find(item => item.widget?.kind === 'properties');
const links = value => decorations(value).filter(item => item.widget?.kind === 'wiki-link');
// Headless states have no DOM focus events. Exercise the same facet the real
// editor uses rather than bypassing the production focus/read-only guard.
const focus = value => value.update({ effects: value.facet(EditorView.focusChangeEffect).map(handler => handler(value, true)).filter(Boolean) }).state;

test('identical teacher notes have independent explicit fold state that follows edits', () => {
  const block='<details>\n<summary>教师参考</summary>\n\n答案\n</details>';
  const source=block+'\n\n'+block;
  let value=state(source);
  const second=block.length+2;
  const folded=value=>decorations(value).filter(item=>item.widget?.kind==='teacher-details');
  assert.equal(folded(value).length,2);
  value=value.update({selection:{anchor:0}}).state;
  assert.equal(folded(value).length,2);
  value=value.update({effects:preview.editTeacherNote.of(second)}).state;
  assert.equal(folded(value).length,1);
  assert.equal(value.field(preview.teacherPanels).get(second),'editing');
  value=value.update({changes:{from:0,insert:'前言\n\n'}}).state;
  assert.equal(value.field(preview.teacherPanels).get(second+4),'editing');
  value=value.update({effects:preview.collapseTeacherNote.of(second+4)}).state;
  assert.equal(folded(value).length,2);
  assert.equal(state(source).field(preview.teacherPanels).size,0);
});

test('frontmatter becomes a property block without changing Markdown or its following heading', () => {
  const value = state(), block = properties(value);
  assert.ok(block?.block);
  assert.deepEqual(block.widget.properties, { type: 'note', status: 'draft', tags: ['math', 'vector'] });
  assert.equal(source.slice(block.from, block.to), source.slice(0, source.indexOf('\n# 向量')));
  assert.equal(value.doc.toString(), source);
});

test('cursor or multi-selection inside frontmatter reveals source; leaving restores updated properties', () => {
  let value = focus(state());
  value = value.update({ selection: { anchor: source.indexOf('draft') } }).state;
  assert.equal(properties(value), undefined);
  value = value.update({ changes: { from: source.indexOf('draft'), to: source.indexOf('draft') + 5, insert: 'active' } }).state;
  value = value.update({ selection: { anchor: value.doc.length } }).state;
  assert.equal(properties(value).widget.properties.status, 'active');
  value = value.update({ selection: EditorSelection.create([EditorSelection.cursor(10), EditorSelection.cursor(value.doc.length)], 1) }).state;
  assert.equal(properties(value), undefined);
});

test('empty, CRLF and incomplete frontmatter do not hide ordinary Markdown', () => {
  assert.deepEqual(properties(state('---\n---\n正文\n')).widget.properties, {});
  assert.equal(properties(state('---\r\ntype: note\r\n---\r\n正文\r\n')).widget.properties.type, 'note');
  for (const doc of ['正文\n---\n', '---\ntags: [math]\n', '---\ntype: note\n---oops\n正文\n', '---\ninvalid YAML\n---\n正文\n']) assert.equal(properties(state(doc)), undefined);
});

test('wiki links display a label and navigate to a canonical page, including aliases', () => {
  const opened = [], value = state('[[路线/向量路线]]\n[[路线/向量路线.md|复习路线]]\n', path => opened.push(path));
  const widgets = links(value).map(item => item.widget);
  assert.deepEqual(widgets.map(widget => [widget.label, widget.path]), [['路线/向量路线', '路线/向量路线.md'], ['复习路线', '路线/向量路线.md']]);
  widgets[0].activate({ state: value });
  assert.deepEqual(opened, ['路线/向量路线.md']);
  assert.equal(links(focus(value).update({ selection: { anchor: 5 } }).state).length, 1);
});

test('Markdown source embeds navigate to the passage instead of waiting for a media asset', () => {
  const opened = [], target = '知识/向量.md#anchor=%E5%85%B3%E9%94%AE%E8%81%94%E7%B3%BB';
  const value = state(`![[${target}]]\n`, path => opened.push(path));
  const widget = links(value)[0]?.widget;
  assert.ok(widget, 'a Markdown source must be a readable navigation link');
  assert.equal(widget.label, '↩ 知识/向量.md · 关键联系');
  widget.activate({ state: value });
  assert.deepEqual(opened, [target]);
  assert.equal(decorations(value).some(item => item.widget?.kind === 'media-embed'), false);
});

test('code, escaped links and traversal paths never become navigable page widgets', () => {
  const value = state('`[[路线/向量路线]]`\n\n```md\n[[路线/向量路线]]\n**example**\n- [ ] sample\n```\n\n    [[路线/向量路线]]\n\n\\[[路线/向量路线]]\n[[../outside]]\n');
  assert.equal(links(value).length, 0);
  assert.equal(decorations(value).some(item => item.widget?.kind === 'task'), false);
});

test('strong, emphasis and inline code receive distinct styles and conceal their delimiters', () => {
  const doc = '**粗体** *斜体* `代码`\n', value = state(doc), ranges = decorations(value);
  for (const name of ['cm-vault-strong', 'cm-vault-emphasis', 'cm-vault-inline-code']) assert.ok(ranges.some(item => item.class === name));
  const concealed = ranges.filter(item => !item.class && !item.widget).map(item => doc.slice(item.from, item.to));
  assert.deepEqual(concealed, ['**', '**', '*', '*', '`', '`']);
});

test('task widget toggles the Markdown marker and rebinds positions after text moves', () => {
  let value = state('- [ ] 学习\n');
  const widget = decorations(value).find(item => item.widget?.kind === 'task').widget;
  widget.activate({ state: value, dispatch: transaction => { value = value.update(transaction).state; } });
  assert.equal(value.doc.toString(), '- [x] 学习\n');
  value = value.update({ changes: { from: 0, insert: '前言\n\n' } }).state;
  const moved = decorations(value).find(item => item.widget?.kind === 'task').widget;
  assert.equal(widget.eq(moved), false);
  moved.activate({ state: value, dispatch: transaction => { value = value.update(transaction).state; } });
  assert.equal(value.doc.toString(), '前言\n\n- [ ] 学习\n');
});

test('media embeds become typed preview widgets and preserve PDF page locators', () => {
  const asset = { path: '资料/讲义.pdf', assetKind: 'pdf', mime: 'application/pdf', revision: 'r1', title: '讲义', dataUrl: 'data:application/pdf;base64,AA==' };
  const value = state('![[资料/讲义.pdf#page=3]]\n', () => {}, { [asset.path]: asset });
  const widget = decorations(value).find(item => item.widget?.kind === 'media-embed')?.widget;
  assert.equal(widget.asset, asset);
  assert.deepEqual(widget.locator, { kind: 'pdf-page', page: 3 });
});

test('route-node metadata comments hide their own marker and leave the brief alone', () => {
  const doc = '<!-- notara:route-node "l1" -->\n本节先讲函数。\n\n<!-- notara:route-node:end -->\n\n<!-- notara:route-log -->\n- 2026-09-22 增加一次补练\n<!-- notara:route-log:end -->\n\n后面的正文照常显示。\n';
  const value = state(doc);
  const concealed = decorations(value).filter(item => !item.class && !item.widget).map(item => doc.slice(item.from, item.to));
  assert.deepEqual(concealed, ['<!-- notara:route-node "l1" -->', '<!-- notara:route-node:end -->', '<!-- notara:route-log -->', '<!-- notara:route-log:end -->']);
  assert.equal(value.doc.toString(), doc, 'hiding a marker never rewrites the page');
});

test('a metadata comment that closes on its own line is the only thing hidden', () => {
  const marker = '<!-- notara:route-node "l2" -->';
  assert.equal(preview.metadataCommentLength(marker), marker.length);
  assert.equal(preview.metadataCommentLength(`${marker} 后面的同一行内容`), marker.length);
  assert.equal(preview.metadataCommentLength('<!-- notara:route-node:end -->'), '<!-- notara:route-node:end -->'.length);
});

test('an unterminated metadata comment never swallows the body that follows', () => {
  // 旧小结块的元数据本来就是一段未闭合注释：仍按第一个 `-->` 收起。
  assert.equal(preview.metadataCommentLength('<!-- notara:lesson-summary\nid: ls-1\nsession: s1\n-->'), '<!-- notara:lesson-summary\nid: ls-1\nsession: s1\n-->'.length);
  // 路线标记只在整行自己闭合时隐藏；没闭合就必须保持可见，而不是吃掉后面的正文。
  assert.equal(preview.metadataCommentLength('<!-- notara:route-node "l2"\n\n正文\n'), 0);
  assert.equal(preview.metadataCommentLength('<!-- notara:lesson-summary:end\n正文\n'), 0);
  assert.equal(preview.metadataCommentLength('<!-- 普通注释 -->'), 0);
});

// The reading surfaces (route 总述, route 课程说明, asset 阅读页) all render this
// one preview with `readOnly`, so a fold that only exists for an editor is not a
// fix: the same page must fold in both.
function readOnlyState(doc, assets = {}) {
  const text = EditorState.create({ doc }).doc;
  return EditorState.create({ doc: text, selection: { anchor: 0 }, extensions: [...preview.vaultPreview(() => {}, assets, null, null), EditorState.readOnly.of(true)] });
}

test('the teacher shorthand folds in an editing and in a read-only preview alike', () => {
  const doc = '---\ntype: route\n---\n# 路线\n\n## 阶段主线\n\n说明。\n\n<details><summary>教师参考</summary>\n\n真安排。\n</details>\n\n后文照常显示。\n';
  for (const [label, value] of [['editor', state(doc)], ['reader', readOnlyState(doc)]]) {
    const widget = decorations(value).find(item => item.widget?.kind === 'teacher-details')?.widget;
    assert.ok(widget, `${label}: <details><summary>教师参考</summary> must fold instead of printing raw HTML`);
    assert.equal(widget.summary, '教师参考');
    assert.equal(widget.expanded, false);
    assert.equal(widget.body.includes('真安排'), true);
    assert.equal(value.doc.toString(), doc, `${label}: folding never rewrites the page`);
  }
});

test("a card's 教师理解 starts folded while 内容 and 学生理解 keep their place", () => {
  const doc = '---\ntype: card\n---\n# 卡\n\n## 内容\n\n求 $1+1$。\n\n## 参考理解\n\n独立求解：$2$。\n\n## 教师理解\n\n另一段说明。\n\n## 学生理解\n\n他数了数。\n';
  let value = state(doc);
  const fold = (run, from) => decorations(run).find(item => item.widget?.kind === 'understanding-section' && (from === undefined || item.from === from))?.widget;
  const [first, second] = decorations(value).filter(item => item.widget?.kind === 'understanding-section');
  assert.equal(first.widget.title, '参考理解');
  assert.equal(second.widget.title, '教师理解');
  assert.equal(first.widget.expanded, false, '教师理解 starts folded');
  assert.equal(second.widget.expanded, false);
  // The body is the real Markdown of that section: formulas and subsections are
  // rendered by the nested preview instead of being flattened or dropped.
  assert.equal(first.widget.body.includes('独立求解：$2$'), true);
  assert.equal(first.widget.body.includes('### 何时想起'), false);
  // 内容 and 学生理解 are never inside a replacement range.
  const replaced = decorations(value).filter(item => item.block && item.widget).map(item => [item.from, item.to]);
  for (const needle of ['求 $1+1$。', '他数了数。']) {
    const at = doc.indexOf(needle);
    assert.equal(replaced.some(([from, to]) => at >= from && at < to), false, `${needle} stays in the page`);
  }
  // Every section folds on its own: opening one never opens the other.
  value = value.update({ effects: preview.expandUnderstandingSection.of(first.from) }).state;
  assert.equal(fold(value, first.from).expanded, true);
  assert.equal(fold(value, second.from).expanded, false);
  // 编辑 reveals that section's own source and leaves a control to fold it back.
  value = value.update({ effects: preview.editUnderstandingSection.of(first.from) }).state;
  assert.equal(fold(value, first.from), undefined);
  assert.equal(fold(value, second.from).expanded, false, 'the other section keeps its own fold');
  assert.equal(value.field(preview.understandingPanels).get(first.from), 'editing');
  assert.equal(decorations(value).some(item => item.widget?.kind === 'understanding-editing'), true);
  value = value.update({ effects: preview.collapseUnderstandingSection.of(first.from) }).state;
  assert.equal(fold(value, first.from).expanded, false);
  assert.equal(value.field(preview.understandingPanels).size, 0);
  assert.equal(value.doc.toString(), doc, 'a fold never rewrites the card');
});

test('a teacher note inside a folded 教师理解 is read through that section, not twice', () => {
  const doc = '---\ntype: card\n---\n## 内容\n\n题干\n\n## 参考理解\n\n<details><summary>原文参考答案</summary>\n\n2\n</details>\n\n## 学生理解\n';
  const value = state(doc);
  const kinds = decorations(value).filter(item => item.widget).map(item => item.widget.kind);
  assert.deepEqual(kinds.filter(kind => kind === 'understanding-section').length, 1);
  assert.equal(kinds.includes('teacher-details'), false);
  assert.equal(kinds.includes('teacher-editing'), false);
  const section = decorations(value).find(item => item.widget?.kind === 'understanding-section');
  assert.equal(section.widget.body.includes('<details><summary>原文参考答案</summary>'), true);
});

test('a lesson stage called 参考理解 never folds in the classroom script', () => {
  const doc = '---\ntype: lesson\n---\n## 内容\n\n求 $1+1$。\n\n## 参考理解\n\n公开讲解。\n\n## 学生理解\n\n他数了数。\n';
  assert.equal(decorations(state(doc)).some(item => item.widget?.kind === 'understanding-section'), false);
  assert.equal(decorations(state(doc)).some(item => item.widget?.kind === 'understanding-editing'), false);
});
