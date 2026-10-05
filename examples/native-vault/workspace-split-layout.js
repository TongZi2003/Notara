/** Keep classroom controls attached to their content when panes change seats. */
export function primaryPaneSide(layout) {
  for (const id of ['board', 'notara-vault-classroom', 'chat']) {
    if (layout?.left === id) return 'left';
    if (layout?.right === id) return 'right';
  }
  return 'left';
}

/** Convert newer file focus objects to the target string understood by old readers. */
export function normalizeNavigationFocus(focus) {
  if (typeof focus === 'string') return focus;
  if (!focus || typeof focus !== 'object' || Array.isArray(focus) || typeof focus.path !== 'string') return '';
  const fragment = typeof focus.fragment === 'string' ? focus.fragment : '';
  return focus.path + (fragment ? (fragment.startsWith('#') ? fragment : `#${fragment}`) : '');
}
