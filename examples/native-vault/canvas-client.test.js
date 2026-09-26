import assert from 'node:assert/strict';
import test from 'node:test';
import { createVaultCanvas, graphLayoutMode } from './canvas-client.js';

test('large graphs use a bounded static layout instead of quadratic force simulation', () => {
  assert.equal(graphLayoutMode(180), 'force');
  assert.equal(graphLayoutMode(181), 'static');
});

function boardFixture() {
  const selected = [], contexts = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: current => ({ current }), useEffect: () => {},
  };
  const { Board } = createVaultCanvas(React, { STYLE: {}, IconButton: () => {} });
  const node = { key: 'source.pdf', title: 'Source', role: 'root' };
  const tree = Board({ nodes: [node], edges: [], state: { positions: new Map([[node.key, { x: 0, y: 0 }]]) }, onSelect: item => selected.push(item), onContext: item => contexts.push(item) });
  return { tree, button: tree.children.find(item => item?.props?.['data-node']), selected, contexts };
}

for (const event of [{ button: 2, ctrlKey: false }, { button: 0, ctrlKey: true }]) {
  test(`context gesture ${JSON.stringify(event)} does not enter drag or select`, () => {
    const { tree, button, selected, contexts } = boardFixture();
    let prevented = false;
    tree.props.onPointerDown({ ...event, target: { closest: () => null }, currentTarget: { setPointerCapture() {} }, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, false);
    button.props.onClick(event);
    assert.deepEqual(selected, []);
    button.props.onPointerDown({ ...event, preventDefault() {}, stopPropagation() {} });
    button.props.onContextMenu({ ...event, preventDefault() {}, stopPropagation() {} });
    assert.equal(contexts.length, 1);
    assert.deepEqual(selected, []);
  });
}

test('ordinary clicks still select the node', () => {
  const { button, selected } = boardFixture();
  button.props.onClick({ button: 0, ctrlKey: false });
  assert.equal(selected.length, 1);
});
