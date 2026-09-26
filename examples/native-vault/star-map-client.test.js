import assert from 'node:assert/strict';
import test from 'node:test';
import { constellationLayout, edgeLit, routeStarLayout, starGlow, starLight } from './star-map-client.js';
import { starKindOf, starOf } from './views-client.js';

const leaf = light => ({ kind: 'leaf', light: { kind: 'leaf', ...light } });

test('light comes only from the projection: unobserved is hollow, missing is unknown, never zero', () => {
  assert.deepEqual(starLight(leaf({ observed: true, probability: .83 })), { state: 'lit', level: .83 });
  assert.deepEqual(starLight(leaf({ observed: false, probability: .2 })), { state: 'unobserved', level: 0 });
  assert.deepEqual(starLight(leaf({ unreadable: true })), { state: 'unreadable', level: 0 });
  assert.deepEqual(starLight({ kind: 'leaf' }), { state: 'unknown', level: 0 });
  assert.deepEqual(starLight({ kind: 'parent', light: { kind: 'parent', leafCount: 4, coverage: 0, mastery: .2 } }), { state: 'unobserved', level: 0, coverage: 0 });
  assert.deepEqual(starLight({ kind: 'parent', light: { kind: 'parent', leafCount: 4, coverage: .5, mastery: .4 } }), { state: 'lit', level: .4, coverage: .5 });
  assert.equal(starLight({ kind: 'parent', light: { kind: 'parent', leafCount: 0 } }).state, 'unlinked');
  assert.equal(starLight({ kind: 'unlinked', light: { kind: 'unlinked' } }).state, 'unlinked');
  // A course lights from its summary alone; an opened classroom is not finished.
  assert.deepEqual(starLight({ kind: 'course', light: { role: 'logged' } }), { state: 'lit', level: 1 });
  assert.equal(starLight({ kind: 'course', light: { role: 'opened' } }).state, 'opened');
  assert.equal(starLight({ kind: 'course', light: { role: 'lesson' } }).state, 'planned');
});

test('a constellation line lights only between two lit stars', () => {
  const bright = leaf({ observed: true, probability: .9 }), weak = leaf({ observed: true, probability: .3 }), dark = leaf({ observed: false });
  assert.equal(edgeLit(bright, bright), true);
  assert.equal(edgeLit(bright, weak), false);
  assert.equal(edgeLit(bright, dark), false);
});

test('a stale projection of another shape lends no light', () => {
  const card = { path: '卡片/甲.md', title: '甲', kind: 'page', type: 'card', childCount: 0 };
  assert.equal(starKindOf(card), 'leaf');
  assert.equal(starKindOf({ ...card, childCount: 2 }), 'parent');
  assert.equal(starKindOf({ path: '讲义.pdf', kind: 'asset', childCount: 0 }), 'unlinked');
  assert.equal(starOf(card, { nodes: { '卡片/甲.md': { kind: 'leaf', observed: true, probability: .7 } } }).light.probability, .7);
  assert.equal(starOf({ ...card, childCount: 2 }, { nodes: { '卡片/甲.md': { kind: 'leaf', observed: true, probability: .7 } } }).light, undefined);
  assert.equal(starOf(card, null).light, undefined);
});

test('constellations are deterministic, complete and kept apart; references move nothing', () => {
  const nodes = [], edges = [];
  for (const root of ['函数', '几何', '概率']) {
    nodes.push({ key: root });
    for (let i = 0; i < 6; i += 1) {
      nodes.push({ key: `${root}/${i}` }); edges.push({ kind: 'split', source: root, target: `${root}/${i}` });
      for (let j = 0; j < 3; j += 1) { nodes.push({ key: `${root}/${i}/${j}` }); edges.push({ kind: 'split', source: `${root}/${i}`, target: `${root}/${i}/${j}` }); }
    }
  }
  nodes.push({ key: '孤星甲' }, { key: '孤星乙' });
  const first = constellationLayout(nodes, edges), second = constellationLayout(nodes, edges);
  assert.equal(first.points.size, nodes.length);
  assert.deepEqual([...first.points.entries()], [...second.points.entries()]);
  const withReference = constellationLayout(nodes, [...edges, { kind: 'reference', source: '函数/0/0', target: '几何/1' }]);
  assert.deepEqual(withReference.points.get('几何/1'), first.points.get('几何/1'));
  // Stars of different constellations never crowd each other.
  const points = [...first.points.entries()];
  for (const [a, p] of points) for (const [b, q] of points) {
    if (p.root !== q.root && p.root && q.root) assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > 40, `${a} vs ${b}`);
  }
  assert.equal(first.points.get('函数').depth, 0);
  assert.equal(first.points.get('函数/2/1').depth, 2);
});

test('a parent cycle still places every star', () => {
  const layout = constellationLayout([{ key: 'a' }, { key: 'b' }, { key: 'c' }], [
    { kind: 'split', source: 'a', target: 'b' }, { kind: 'split', source: 'b', target: 'c' }, { kind: 'split', source: 'c', target: 'a' }]);
  assert.equal(layout.points.size, 3);
  for (const point of layout.points.values()) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
});

test('a route runs left to right, names its stages and hangs branches off their lesson', () => {
  const rows = [
    { key: 'l1', pathway: 'main', stage: '基础' }, { key: 'l2', pathway: 'main', stage: '基础' },
    { key: 'r1', pathway: 'remedial', stage: '基础' }, { key: 'x1', pathway: 'extension', stage: '基础' },
    { key: 'l3', pathway: 'main', stage: '进阶' },
  ];
  const edges = [{ kind: 'sequence', source: 'l1', target: 'l2' }, { kind: 'branch', source: 'l2', target: 'r1' }, { kind: 'branch', source: 'l2', target: 'x1' }, { kind: 'sequence', source: 'l2', target: 'l3' }];
  const { points, groups } = routeStarLayout(rows, edges);
  assert.ok(points.get('l1').x < points.get('l2').x && points.get('l2').x < points.get('l3').x);
  assert.ok(points.get('r1').y > points.get('l2').y, '补练 hangs below');
  assert.ok(points.get('x1').y < points.get('l2').y, '拓展 rises above');
  assert.deepEqual(groups.map(group => group.label), ['基础', '进阶']);
  for (const group of groups) assert.ok([...points.values()].filter(point => point.stage === group.label).every(point => point.y > group.y));
  assert.deepEqual(routeStarLayout([{ key: 'solo', pathway: 'main', stage: '' }], []).groups, []);
});

test('glow reads the light: mastery burns the core, coverage spreads the halo, no evidence stays dim', () => {
  const parent = (mastery, coverage) => starGlow({ key: 'p', kind: 'parent', light: { kind: 'parent', leafCount: 4, mastery, coverage } });
  assert.ok(parent(.7, 1).halo > parent(.7, .25).halo, 'wider coverage, wider halo');
  assert.equal(parent(.7, 1).core, parent(.7, .25).core, 'coverage never changes the core brightness');
  assert.ok(parent(.9, .5).core > parent(.4, .5).core);
  const bright = starGlow(leaf({ observed: true, probability: .9 })), weak = starGlow(leaf({ observed: true, probability: .4 }));
  assert.ok(bright.spike > 0 && weak.spike === 0, 'spikes only on well-supported light');
  const dark = starGlow(leaf({ observed: false }));
  assert.equal(dark.spike, 0);
  assert.equal(dark.tone, 'dim', 'an unlit star keeps its own tone, visible on either sky');
  assert.ok(dark.halo < weak.halo && dark.alpha < weak.alpha, 'unobserved is a dim star, not a lit one');
  assert.ok(starGlow({ kind: 'leaf' }).alpha < dark.alpha, 'a missing projection is dimmer still');
  assert.equal(starGlow({ kind: 'course', light: { role: 'logged' } }).tone, 'gold');
  assert.equal(starGlow({ kind: 'course', light: { role: 'lesson' } }).spike, 0);
});
