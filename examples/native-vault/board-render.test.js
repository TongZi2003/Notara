import test from 'node:test';
import assert from 'node:assert/strict';
import { exportBoard, renderBoardScene } from './board-render.js';
import { sourceRef } from './agent-io.js';

const scene = () => ({ version: 1, elements: [{ id: 'label', type: 'text', x: 10, y: 12, width: 180, height: 40, text: '<图形>', originalText: '<图形>', fontSize: 20 }], appState: {}, files: {} });

test('drawing content exports as safe static SVG in HTML and portable SVG data in Markdown', () => {
  const board = { blocks: [{ id: 'drawing-one', title: '思路图', kind: 'note', body: '', contentType: 'drawing' }] };
  const output = exportBoard(board, { contents: { 'drawing-one': scene() } });
  assert.match(output.html, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]+role="img"/);
  assert.match(output.html, /&lt;图形&gt;/);
  assert.doesNotMatch(output.html, /<图形>|<script|onerror=/i);
  assert.match(output.markdown, /!\[白板绘图\]\(data:image\/svg\+xml;base64,/);
});

test('canvas export includes manual edges and groups only for the selected visible blocks', () => {
  const board = {
    blocks: [
      { id: 'a', title: '观察', kind: 'note', body: '先看图。' },
      { id: 'b', title: '结论', kind: 'note', body: '因此成立。' },
      { id: 'private', title: '个人尝试', kind: 'attempt', body: '不公开。' },
    ],
    manualEdges: [
      { id: 'edge-ab', from: 'a', to: 'b', label: '推出', direction: 'forward' },
      { id: 'edge-private', from: 'a', to: 'private', label: '私有关系', direction: 'both' },
    ],
    groups: [
      { id: 'group-ab', title: '公开思路', members: ['a', 'b'] },
      { id: 'group-private', title: '私有组', members: ['a', 'private'] },
    ],
  };
  const normal = exportBoard(board);
  assert.match(normal.markdown, /## 白板关系/);
  assert.match(normal.markdown, /观察 → 结论：推出/);
  assert.match(normal.markdown, /分组「公开思路」：观察、结论/);
  assert.doesNotMatch(normal.markdown, /私有关系|私有组|不公开/);
  assert.match(normal.html, /aria-label="白板关系"/);
  assert.match(exportBoard(board, { attempt: true }).markdown, /私有关系/);
});

test('source and link cards render with validated references and escaped external URLs', () => {
  const board = { blocks: [
    { id: 'source', title: '定义资料', kind: 'note', body: '原资料不复制。', contentType: 'source', sourceRef: sourceRef('workspace', '知识/定义.md', 'a'.repeat(24)) },
    { id: 'link', title: '延伸阅读', kind: 'note', body: '', contentType: 'link', url: 'https://example.org/a?x=1&y=2' },
  ] };
  const output = exportBoard(board);
  assert.match(output.markdown, /资料引用：知识\/定义\.md/);
  assert.match(output.html, /资料引用：知识\/定义\.md/);
  assert.match(output.html, /href="https:\/\/example\.org\/a\?x=1&amp;y=2"/);
});

test('scene renderer refuses raw HTML-like fields and unsupported external links', () => {
  const sanitized = renderBoardScene({ version: 1, elements: [{ id: 'x', type: 'text', x: 0, y: 0, width: 1, height: 1, text: 'x', customData: { html: '<script>' } }], appState: {}, files: {} });
  assert.doesNotMatch(sanitized, /<script/);
  const bad = { version: 1, elements: [{ id: 'x', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, link: 'javascript:alert(1)' }], appState: {}, files: {} };
  assert.throws(() => renderBoardScene(bad), /board_scene_url_invalid/);
});
