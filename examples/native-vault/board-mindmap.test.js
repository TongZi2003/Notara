import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMindmap } from './board-mindmap.js';

const sceneElements = [{ id: 'a' }, { id: 'b' }];
const valid = { nodes: [{ elementId: 'a', parentId: null }, { elementId: 'b', parentId: 'a' }], links: [], notes: [] };

test('mindmap validation rejects sparse node, link, note, and element arrays with its domain error', () => {
  const sparse = values => { const result = []; result.length = values; return result; };
  assert.throws(() => validateMindmap({ ...valid, nodes: sparse(1) }, sceneElements), /board_mindmap_invalid/);
  assert.throws(() => validateMindmap({ ...valid, links: sparse(1) }, sceneElements), /board_mindmap_invalid/);
  assert.throws(() => validateMindmap({ ...valid, notes: sparse(1) }, sceneElements), /board_mindmap_invalid/);
  assert.throws(() => validateMindmap({ nodes: [], links: [], notes: [] }, sparse(1)), /board_mindmap_invalid/);
  assert.equal(validateMindmap(valid, sceneElements).nodes.length, 2);
});
