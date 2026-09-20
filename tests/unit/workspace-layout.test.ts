import { describe, expect, it } from 'vitest';
import { VIEWS, dockView, leaves, removeView, resizeTree, readLayout, geometry, type SplitTree } from '../../packages/client/src/classroom/workspace-layout.ts';
describe('independent workspace views', () => {
  it('keeps experimental rounds out of the default view registry', () => {
    expect(VIEWS).toEqual(['chat', 'thoughts', 'materials', 'vault']);
  });
  it('moves every view to every edge without duplication or losing its siblings', () => {
    for (const moving of VIEWS) for (const target of VIEWS) for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
      const seed: SplitTree = { axis: 'x', ratio: .5, a: 'chat', b: { axis: 'y', ratio: .5, a: 'thoughts', b: { axis: 'x', ratio: .5, a: 'materials', b: 'vault' } } };
      const tree = dockView(seed, moving, target, edge);
      expect(leaves(tree).sort()).toEqual([...VIEWS].sort());
      const { panes } = geometry(tree, { x: 0, y: 0, width: 1200, height: 800 });
      for (const pane of Object.values(panes)) { expect(pane!.width).toBeGreaterThan(0); expect(pane!.height).toBeGreaterThan(0); }
    }
  });
  it('collapses empty branches, restores a hidden view and bounds resize', () => {
    const tree = dockView(dockView('chat', 'thoughts', 'chat', 'right'), 'materials', 'thoughts', 'bottom');
    expect(removeView(removeView(tree, 'chat'), 'thoughts')).toBe('materials');
    expect(removeView('materials', 'materials')).toBeNull();
    expect(dockView(null, 'chat', 'chat', 'left')).toBe('chat');
    expect(resizeTree(tree, '', 2)).toMatchObject({ ratio: .8 });
  });
  it('rejects invalid or duplicated persisted layouts and keeps empty layouts deliberate', () => {
    const fallback = { tree: 'chat' as const, active: 'chat' as const, visited: ['chat' as const] };
    expect(readLayout({ tree: { axis: 'x', ratio: .5, a: 'chat', b: 'chat' }, active: 'chat' }, fallback)).toBe(fallback);
    expect(readLayout({ tree: 'script', active: 'chat' }, fallback)).toBe(fallback);
    expect(readLayout({ tree: null, active: 'chat' }, fallback).tree).toBeNull();
  });
});
