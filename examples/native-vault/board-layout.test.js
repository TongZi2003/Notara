import assert from 'node:assert/strict';
import test from 'node:test';
import { LAYOUT, layoutBoard, readingOrder, sectionWidth, sizeWidth } from './board-layout.js';

const section = (id, title = id) => ({ id, title });
const block = (id, sectionId, extra = {}) => ({ id, section: sectionId, size: 'narrow', ...extra });
const at = (layout, id) => layout.positions.get(id);
const step = LAYOUT.track + LAYOUT.gutter, top = LAYOUT.origin + LAYOUT.titleHeight;

test('blocks go down the first column by measured height, then on to the next column', () => {
  const blocks = ['a', 'b', 'c', 'd'].map(id => block(id, 's'));
  const heights = new Map([['a', 400], ['b', 400], ['c', 300], ['d', 100]]);
  const layout = layoutBoard([section('s')], blocks, heights);
  assert.deepEqual(at(layout, 'a'), { x: LAYOUT.origin, y: top, width: LAYOUT.track });
  assert.equal(at(layout, 'b').y, top + 400 + LAYOUT.gap, 'measured, not estimated');
  assert.equal(at(layout, 'c').x, LAYOUT.origin + step, 'the full first column hands over');
  assert.equal(at(layout, 'c').y, top);
  assert.equal(at(layout, 'd').x, LAYOUT.origin + step, 'the second column continues');
});

test('when all three columns are full a new band starts under everything', () => {
  const blocks = ['a', 'b', 'c', 'd'].map(id => block(id, 's'));
  const heights = new Map([['a', 880], ['b', 500], ['c', 880], ['d', 50]]);
  const layout = layoutBoard([section('s')], blocks, heights);
  assert.equal(at(layout, 'b').x, LAYOUT.origin + step);
  assert.equal(at(layout, 'c').x, LAYOUT.origin + step * 2);
  assert.equal(at(layout, 'd').x, LAYOUT.origin, 'writing never goes back to an earlier column, even with room left');
  assert.equal(at(layout, 'd').y, top + 880 + LAYOUT.gap, 'the new band starts under the tallest column');
  const crowded = layoutBoard([section('s')], ['a', 'b', 'c', 'd'].map(id => block(id, 's')), new Map([['a', 880], ['b', 880], ['c', 880], ['d', 50]]));
  assert.equal(at(crowded, 'd').x, LAYOUT.origin);
  assert.equal(at(crowded, 'd').y, top + 880 + LAYOUT.gap);
});

test('wide and full blocks sit under the columns they cover; beside and below follow their anchor', () => {
  const blocks = [block('q', 's'), block('try', 's', { place: { relativeTo: 'q', position: 'beside' } }), block('fig', 's', { size: 'wide' }), block('proof', 's', { size: 'full' }), block('note', 's', { place: { relativeTo: 'q', position: 'below' } })];
  const heights = new Map([['q', 200], ['try', 320], ['fig', 150], ['proof', 100], ['note', 60]]);
  const layout = layoutBoard([section('s')], blocks, heights);
  assert.deepEqual(at(layout, 'try'), { x: LAYOUT.origin + step, y: top, width: LAYOUT.track });
  assert.equal(at(layout, 'fig').width, sizeWidth('wide'));
  assert.equal(at(layout, 'fig').x, LAYOUT.origin + step, 'the wide block starts at the current column');
  assert.equal(at(layout, 'fig').y, top + 320 + LAYOUT.gap, 'under the taller column it covers');
  assert.equal(at(layout, 'proof').x, LAYOUT.origin);
  assert.equal(at(layout, 'proof').width, sectionWidth());
  assert.equal(at(layout, 'proof').y, at(layout, 'fig').y + 150 + LAYOUT.gap);
  assert.ok(at(layout, 'note').y >= at(layout, 'proof').y + 100, 'below never overlaps what is already there');
});

test('adding a block never moves earlier blocks; a taller block pushes only what is under it', () => {
  const sections = [section('s')], base = [block('a', 's'), block('b', 's')];
  const heights = new Map([['a', 100], ['b', 100]]);
  const before = layoutBoard(sections, base, heights);
  const after = layoutBoard(sections, [...base, block('c', 's')], heights);
  assert.deepEqual(at(after, 'a'), at(before, 'a'));
  assert.deepEqual(at(after, 'b'), at(before, 'b'));
  const grown = layoutBoard(sections, base, new Map([['a', 300], ['b', 100]]));
  assert.deepEqual(at(grown, 'a'), at(before, 'a'));
  assert.equal(at(grown, 'b').y, at(before, 'b').y + 200);
});

test('pinned blocks keep their position; sections run left to right after an old board', () => {
  const legacy = { id: 'old', x: 60, y: 60, width: 340, size: 'narrow' };
  const blocks = [legacy, block('a', 's1'), block('pinned', 's1', { x: 900, y: 40 }), block('b', 's2')];
  const layout = layoutBoard([section('s1'), section('s2')], blocks, new Map());
  assert.deepEqual(at(layout, 'old'), { x: 60, y: 60, width: 340, pinned: true });
  assert.equal(at(layout, 'pinned').x, 900, 'a dragged block stays where the student put it');
  assert.equal(layout.frames[0].x, 60 + 340 + LAYOUT.sectionGap, 'sections begin to the right of the old board');
  // s1 had one column in use when s2 began, so it is one column wide.
  assert.equal(layout.frames[0].width, LAYOUT.track);
  assert.equal(layout.frames[1].x, layout.frames[0].x + LAYOUT.track + LAYOUT.sectionGap);
  assert.equal(at(layout, 'b').x, layout.frames[1].x);
  assert.equal(at(layout, 'a').y, top, 'the flow does not avoid the pinned block');
  assert.deepEqual(readingOrder([section('s1'), section('s2')], blocks).map(group => [group.title, group.blocks.map(item => item.id)]), [[null, ['old']], ['s1', ['a', 'pinned']], ['s2', ['b']]]);
});

test('an earlier section keeps the columns it had when the next began; later blocks go down inside them', () => {
  const sections = [section('s1'), section('s2')];
  const heights = new Map([['a', 200], ['b', 200], ['c', 150], ['late', 120], ['wide', 80]]);
  const first = [block('a', 's1'), block('b', 's1')];
  const withNext = [...first, block('c', 's2')];
  const layout = layoutBoard(sections, withNext, heights);
  assert.equal(layout.frames[0].width, LAYOUT.track, 'two short blocks: one column, not three');
  assert.equal(layout.frames[0].columns, 1);
  assert.equal(at(layout, 'c').x, LAYOUT.origin + LAYOUT.track + LAYOUT.sectionGap, 'the next section follows right after');
  // Adding the next section moved nothing already written.
  const alone = layoutBoard(sections, first, heights);
  assert.deepEqual(at(layout, 'a'), at(alone, 'a'));
  assert.deepEqual(at(layout, 'b'), at(alone, 'b'));
  // Back in s1 after s2 began: the new blocks stay in its one column, a wide one narrows.
  const later = layoutBoard(sections, [...withNext, block('late', 's1'), block('wide', 's1', { size: 'wide' })], heights);
  assert.equal(at(later, 'late').x, LAYOUT.origin);
  assert.equal(at(later, 'late').y, top + 200 + LAYOUT.gap + 200 + LAYOUT.gap);
  assert.deepEqual(at(later, 'wide'), { x: LAYOUT.origin, y: at(later, 'late').y + 120 + LAYOUT.gap, width: LAYOUT.track });
  assert.deepEqual(at(later, 'c'), at(layout, 'c'), 'the later section does not move');
  // The last section is open to the right; its frame covers what it uses.
  assert.equal(later.frames[1].width, LAYOUT.track);
  assert.equal(later.frames[0].titleWidth, LAYOUT.track + LAYOUT.sectionGap - 16, 'a title may run into the gap');
  assert.equal(later.frames[1].titleWidth, sectionWidth(), 'the last title is not squeezed');
  // A section that filled two columns before the next began keeps two.
  const tall = layoutBoard(sections, [block('x', 's1'), block('y', 's1'), block('z', 's2')], new Map([['x', 880], ['y', 300], ['z', 100]]));
  assert.equal(tall.frames[0].columns, 2);
  assert.equal(at(tall, 'z').x, LAYOUT.origin + sectionWidth(LAYOUT, 2) + LAYOUT.sectionGap);
});
