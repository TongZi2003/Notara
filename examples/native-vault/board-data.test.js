import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard, renderBoard, validateBoardBody } from './board-data.js';
import { sourceRef } from './agent-io.js';

test('version two board metadata and relationships round-trip without narrowing Web height bounds', () => {
  const board = parseBoard(null, 'lesson');
  board.formatVersion = 2;
  board.sections = [{ id: 's-12345678', title: '共建' }];
  board.blocks = [
    { id: 'drawing', section: 's-12345678', kind: 'note', size: 'wide', title: '自由图', body: '', contentType: 'drawing', contentRef: 'a'.repeat(64), width: 1600, height: 4000 },
    { id: 'source', section: 's-12345678', kind: 'note', size: 'narrow', title: '资料', body: '定位原始资料。', contentType: 'source', sourceRef: sourceRef('workspace', '资料/定义.md', 'b'.repeat(24)) },
    { id: 'link', section: 's-12345678', kind: 'note', size: 'narrow', title: '链接', body: '', contentType: 'link', url: 'https://example.org/lesson' },
    { id: 'figure', section: 's-12345678', kind: 'note', size: 'narrow', title: '函数图', body: '```figure\naxes x -4..4 y -3..3\nfunction f(x) = x^2\n```', contentType: 'figure' },
  ];
  board.manualEdges = [{ id: 'edge-1', from: 'drawing', to: 'source', label: '引用', direction: 'both' }];
  board.groups = [{ id: 'group-1', title: '第一组', members: ['drawing', 'source'] }];
  board.historyRefs = ['c'.repeat(64)];
  const restored = parseBoard(renderBoard(board), 'lesson');
  assert.deepEqual(restored, board);
  assert.equal(restored.blocks[0].height, 4000);
});

test('legacy v1 boards remain readable while v2-only metadata is rejected under v1', () => {
  const legacy = '---\ntype: lesson-board\ntitle: 课堂板书\nsession: lesson\nsourceNotes: {}\n---\n<!-- notara-board {"id":"old","kind":"note","x":60,"y":60} -->\n## 旧块\n\n旧内容\n';
  assert.equal(parseBoard(legacy, 'lesson').blocks[0].body, '旧内容');
  const invalid = '---\ntype: lesson-board\ntitle: 课堂板书\nsession: lesson\nformatVersion: 1\nsourceNotes: {}\n---\n<!-- notara-board {"id":"old","kind":"note","x":60,"y":60,"contentType":"link","url":"https://example.org"} -->\n## 旧块\n\n旧内容\n';
  assert.throws(() => parseBoard(invalid, 'lesson'), /board_version_invalid/);
});

test('standalone figure cards require one non-answerable figure and reject mixed Markdown or questions', () => {
  const valid = '```figure\naxes x -4..4 y -3..3\nfunction f(x) = x^2\n```';
  assert.equal(validateBoardBody(valid, 'figure'), valid);
  for (const body of ['', `解释\n${valid}`, `${valid}\n\n说明`, '```figure\naxes x -4..4 y -3..3\nfunction f(x) = x\nask point "标原点"\n```']) {
    assert.throws(() => validateBoardBody(body, 'figure'), /board_figure_invalid/);
  }
});
