import assert from 'node:assert/strict';
import test from 'node:test';
import { FOREST_FORMS, TILE_W, forestBounds, forestGrowth, forestHit, forestLayout, forestLush, isoPoint, routeForestLayout } from './forest-client.js';

const leaf = light => ({ key: 'k', kind: 'leaf', light: { kind: 'leaf', ...light } });
const parent = (mastery, coverage) => ({ key: 'p', kind: 'parent', light: { kind: 'parent', leafCount: 4, observedCount: Math.round(coverage * 4), mastery, coverage } });
const course = role => ({ key: 'c', kind: 'course', light: { role } });

test('a tree grows only from real evidence and never withers', () => {
  assert.equal(forestGrowth(leaf({ observed: false })).form, 'mound', 'no evidence is bare soil');
  assert.equal(forestGrowth(leaf({ unreadable: true })).form, 'mound');
  assert.equal(forestGrowth({ kind: 'leaf' }).form, 'mound', 'a projection still loading is soil, not a rock');
  // A real difficulty keeps the tree small; it is still alive.
  assert.equal(forestGrowth(leaf({ observed: true, probability: .12 })).form, 'sprout');
  assert.equal(forestGrowth(leaf({ observed: true, probability: .45 })).form, 'sapling');
  assert.equal(forestGrowth(leaf({ observed: true, probability: .9 })).form, 'tree');
  const heights = [.1, .3, .5, .7, .9].map(probability => forestGrowth(leaf({ observed: true, probability })).height);
  assert.deepEqual(heights, [...heights].sort((a, b) => a - b));
  assert.ok(forestGrowth(leaf({ observed: false })).height < heights[0]);
  const every = [leaf({ observed: false }), leaf({ unreadable: true }), leaf({ observed: true, probability: 0 }), parent(0, 0), parent(.1, .25), { kind: 'unlinked' }, course('logged'), course('opened'), course('lesson')];
  for (const star of every) assert.ok(FOREST_FORMS.includes(forestGrowth(star).form), forestGrowth(star).form);
  assert.ok(!FOREST_FORMS.some(form => /dead|wither|stump/.test(form)));
});

test('a parent grows with mastery; coverage shows in the grass, never in the tree', () => {
  assert.equal(forestGrowth(parent(.7, 1)).form, 'oak');
  assert.equal(forestGrowth(parent(.7, 1)).height, forestGrowth(parent(.7, .25)).height);
  assert.ok(forestGrowth(parent(.9, .5)).height > forestGrowth(parent(.4, .5)).height);
  assert.equal(forestGrowth(parent(.2, 0)).form, 'mound', 'a branch nobody has evaluated is still soil');
  assert.equal(forestLush(leaf({ observed: true, probability: .2 })), true, 'any evaluated leaf greens its tile');
  assert.equal(forestLush(leaf({ observed: false })), false);
  assert.equal(forestLush({ kind: 'leaf' }), false);
});

test('what stays outside mastery is a bush or a rock, and a course is its own tree', () => {
  assert.equal(forestGrowth({ kind: 'unlinked', light: { kind: 'unlinked' }, node: { kind: 'page', type: 'insight' } }).form, 'bush');
  assert.equal(forestGrowth({ kind: 'unlinked', light: { kind: 'unlinked' }, node: { kind: 'asset' } }).form, 'rock');
  assert.equal(forestGrowth({ kind: 'parent', light: { kind: 'parent', leafCount: 0 } }).form, 'bush');
  assert.equal(forestGrowth(course('logged')).form, 'ginkgo');
  assert.equal(forestGrowth(course('opened')).form, 'sprout');
  assert.equal(forestGrowth(course('lesson')).form, 'stake');
  const knowledge = [.1, .5, .9].map(probability => forestGrowth(leaf({ observed: true, probability })).form).concat(forestGrowth(parent(.8, 1)).form);
  assert.ok(!knowledge.includes('ginkgo'), 'finishing a course never looks like mastering knowledge');
});

function sampleForest() {
  const nodes = [], edges = [];
  for (const root of ['函数', '几何', '概率']) {
    nodes.push({ key: root, title: `${root}专题` });
    for (let i = 0; i < 6; i += 1) {
      nodes.push({ key: `${root}/${i}` }); edges.push({ kind: 'split', source: root, target: `${root}/${i}` });
      for (let j = 0; j < 3; j += 1) { nodes.push({ key: `${root}/${i}/${j}` }); edges.push({ kind: 'split', source: `${root}/${i}`, target: `${root}/${i}/${j}` }); }
    }
  }
  nodes.push({ key: '讲义.pdf' }, { key: '说明.html' });
  edges.push({ kind: 'reference', source: '函数/0/0', target: '说明.html' });
  return { nodes, edges };
}
const inside = (plot, point) => point.i >= plot.i && point.i < plot.i + plot.w && point.j >= plot.j && point.j < plot.j + plot.h;

test('each split tree is one plot of land; every node gets its own tile', () => {
  const { nodes, edges } = sampleForest();
  const first = forestLayout(nodes, edges), second = forestLayout(nodes, edges);
  assert.equal(first.points.size, nodes.length);
  assert.deepEqual([...first.points.entries()], [...second.points.entries()]);
  assert.deepEqual(first.plots, second.plots);
  const tiles = new Set([...first.points.values()].map(point => `${point.i},${point.j}`));
  assert.equal(tiles.size, nodes.length, 'no two trees share a tile');
  assert.equal(first.plots.length, 4, 'three split trees and one meadow');
  for (const [a, p] of first.plots.entries()) for (const q of first.plots.slice(a + 1)) {
    const apart = p.i + p.w <= q.i || q.i + q.w <= p.i || p.j + p.h <= q.j || q.j + q.h <= p.j;
    assert.ok(apart, `${p.key} overlaps ${q.key}`);
  }
  for (const [key, point] of first.points) {
    const plot = first.plots.find(item => item.key === point.plot);
    assert.ok(plot && inside(plot, point), `${key} sits on its plot`);
    assert.ok(point.i > plot.i && point.i < plot.i + plot.w - 1 && point.j > plot.j && point.j < plot.j + plot.h - 1, `${key} keeps a grass border`);
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  }
});

test('children are planted beside their parent, and loose files share a meadow', () => {
  const { nodes, edges } = sampleForest();
  const { points } = forestLayout(nodes, edges);
  const far = (a, b) => Math.max(Math.abs(points.get(a).i - points.get(b).i), Math.abs(points.get(a).j - points.get(b).j));
  for (const root of ['函数', '几何', '概率']) {
    assert.equal(points.get(root).depth, 0);
    assert.equal(points.get(root).root, root);
    for (let i = 0; i < 6; i += 1) {
      assert.ok(far(root, `${root}/${i}`) <= 2, `${root}/${i} beside its root`);
      for (let j = 0; j < 3; j += 1) assert.ok(far(`${root}/${i}`, `${root}/${i}/${j}`) <= 3, `${root}/${i}/${j} beside its parent`);
    }
    assert.equal(points.get(`${root}/2/1`).depth, 2);
  }
  // Each plot is named on a sign at its front corner, a border tile nothing grows on.
  const { groups, plots } = forestLayout(nodes, edges), taken = new Set([...points.values()].map(point => `${point.i},${point.j}`));
  assert.deepEqual(groups.map(group => group.label).sort(), ['几何专题', '函数专题', '概率专题'].sort());
  for (const group of groups) {
    const plot = plots.find(item => `plot:${item.key}` === group.key);
    assert.ok(plot, group.key);
    assert.deepEqual({ x: group.x, y: group.y }, isoPoint(plot.i + plot.w - 1, plot.j + plot.h - 1));
    assert.ok(!taken.has(`${plot.i + plot.w - 1},${plot.j + plot.h - 1}`));
  }
  // A reference is not a split: the linked file still lives in the meadow.
  assert.equal(points.get('讲义.pdf').plot, points.get('说明.html').plot);
  assert.equal(points.get('说明.html').root, null);
  assert.notEqual(points.get('说明.html').plot, points.get('函数').plot);
});

test('a parent cycle still plants every node', () => {
  const layout = forestLayout([{ key: 'a' }, { key: 'b' }, { key: 'c' }], [
    { kind: 'split', source: 'a', target: 'b' }, { kind: 'split', source: 'b', target: 'c' }, { kind: 'split', source: 'c', target: 'a' }]);
  assert.equal(layout.points.size, 3);
  assert.deepEqual(forestLayout([], []).points.size, 0);
});

test('a route is a road through one strip of land, with stage signs and branches off their lesson', () => {
  const rows = [
    { key: 'l1', pathway: 'main', stage: '基础' }, { key: 'l2', pathway: 'main', stage: '基础' },
    { key: 'r1', pathway: 'remedial', stage: '基础' }, { key: 'x1', pathway: 'extension', stage: '基础' },
    { key: 'l3', pathway: 'main', stage: '进阶' },
  ];
  const edges = [{ kind: 'sequence', source: 'l1', target: 'l2' }, { kind: 'branch', source: 'l2', target: 'r1' }, { kind: 'branch', source: 'l2', target: 'x1' }, { kind: 'sequence', source: 'l2', target: 'l3' }];
  const { points, groups, plots, roads } = routeForestLayout(rows, edges);
  assert.ok(points.get('l1').x < points.get('l2').x && points.get('l2').x < points.get('l3').x, 'the main line walks along the road');
  assert.ok(points.get('r1').y > points.get('l2').y, '补练 hangs below');
  assert.ok(points.get('x1').y < points.get('l2').y, '拓展 rises above');
  assert.equal(new Set([...points.values()].map(point => `${point.i},${point.j}`)).size, rows.length);
  assert.equal(plots.length, 1);
  for (const point of points.values()) assert.ok(inside(plots[0], point));
  const road = new Set(roads.map(tile => `${tile.i},${tile.j}`));
  for (const key of ['l1', 'l2', 'l3']) assert.ok(road.has(`${points.get(key).i},${points.get(key).j + 1}`), `${key} stands by the road`);
  for (const point of points.values()) assert.ok(!road.has(`${point.i},${point.j}`), 'nothing is planted on the road');
  // A stage sign stands by the road just before the stage's first lesson.
  assert.deepEqual(groups.map(group => group.label), ['基础', '进阶']);
  for (const [group, first] of [[groups[0], 'l1'], [groups[1], 'l3']]) {
    assert.ok(group.x < points.get(first).x, `${group.label} comes before ${first}`);
    assert.ok(![...points.values()].some(point => point.x === group.x && point.y === group.y), 'no lesson under a sign');
    assert.ok(!road.has(`${group.i},${group.j}`) && inside(plots[0], group), 'the sign is on the verge');
  }
  assert.deepEqual(routeForestLayout([{ key: 'solo', pathway: 'main', stage: '' }], []).groups, []);
  assert.equal(routeForestLayout([], []).plots.length, 0);
});

test('a tree is clicked where it stands: narrow enough for its neighbours, nearer trees on top', () => {
  const tall = parent(.9, 1), low = leaf({ observed: false });
  for (const zoom of [.5, 1, 2]) {
    const hit = forestHit(tall, zoom, { i: 3, j: 3 });
    assert.ok(hit.width <= TILE_W * zoom * .62 + 1e-9 || hit.width === 22, `zoom ${zoom}: ${hit.width}`);
    assert.ok(hit.height >= forestGrowth(tall).height * zoom, 'the whole tree is clickable');
    assert.equal(hit.lift, hit.height / 2, 'the label starts at the ground');
  }
  assert.ok(forestHit(low, 1, { i: 3, j: 3 }).height >= 22, 'a mound is still easy to hit');
  assert.ok(forestHit(low, 1, { i: 4, j: 4 }).z > forestHit(tall, 1, { i: 3, j: 3 }).z, 'the nearer tile stacks above');
  assert.ok(forestHit(low, 1, { i: 4, j: 3 }).z > forestHit(low, 1, { i: 3, j: 3 }).z);
});

test('fitting the forest frames every plot and the trees standing on it', () => {
  const { nodes, edges } = sampleForest();
  const layout = forestLayout(nodes, edges), bounds = forestBounds(layout);
  for (const plot of layout.plots) for (const [i, j] of [[plot.i - .5, plot.j - .5], [plot.i + plot.w - .5, plot.j - .5], [plot.i + plot.w - .5, plot.j + plot.h - .5], [plot.i - .5, plot.j + plot.h - .5]]) {
    const corner = isoPoint(i, j);
    assert.ok(corner.x >= bounds.minX && corner.x <= bounds.maxX && corner.y >= bounds.minY && corner.y <= bounds.maxY, `${plot.key} corner`);
  }
  const top = Math.min(...[...layout.points.values()].map(point => point.y));
  assert.ok(bounds.minY < top - 60, 'room above the highest tree');
  assert.equal(forestBounds({ plots: [] }), null);
});
