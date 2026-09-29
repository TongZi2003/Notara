/** The vault's file tree: the library page and the Vault panel draw the same one. */
export function createFileTree(React, { STYLE }) {
  const h = React.createElement;
  const rowStyle = active => ({ ...STYLE.row, ...(active ? STYLE.rowActive : {}) });
  function Tree({ node, selected, onSelect, onContext, depth = 0 }) {
    return h(React.Fragment, null, node.children.map(child => child.path
      ? h('button', { key: child.path, type: 'button', title: child.path, 'aria-current': child.path === selected ? 'true' : undefined, style: { ...rowStyle(child.path === selected), paddingLeft: 10 + depth * 12 },
        onContextMenu: onContext && (event => { event.preventDefault(); onContext(child.path, event); }), onClick: () => onSelect(child.path) }, `${child.kind === 'asset' ? '▧ ' : ''}${child.name}`)
      : h('details', { key: `${depth}:${child.name}`, open: true },
        h('summary', { style: { ...STYLE.treeFolder, paddingLeft: 10 + depth * 12 } }, child.name),
        h(Tree, { node: child, selected, onSelect, onContext, depth: depth + 1 }))));
  }
  return Tree;
}
