import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorSelection, EditorState } from '@codemirror/state';

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

test('frontmatter becomes a property block without changing Markdown or its following heading', () => {
  const value = state(), block = properties(value);
  assert.ok(block?.block);
  assert.deepEqual(block.widget.properties, { type: 'note', status: 'draft', tags: ['math', 'vector'] });
  assert.equal(source.slice(block.from, block.to), source.slice(0, source.indexOf('\n# 向量')));
  assert.equal(value.doc.toString(), source);
});

test('cursor or multi-selection inside frontmatter reveals source; leaving restores updated properties', () => {
  let value = state();
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
  assert.equal(links(value.update({ selection: { anchor: 5 } }).state).length, 1);
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
