import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNavigationFocus, primaryPaneSide } from './workspace-split-layout.js';

test('primary pane follows classroom content after the physical seats are swapped', () => {
  assert.equal(primaryPaneSide({ left: 'files', right: 'board', swapped: true }), 'right');
  assert.equal(primaryPaneSide({ left: 'classroom', right: 'chat' }), 'right');
  assert.equal(primaryPaneSide({ left: 'chat', right: 'files' }), 'left');
  assert.equal(primaryPaneSide({ left: 'files', right: 'graph' }), 'left');
});

test('file focus objects become legacy reader targets while strings stay unchanged', () => {
  assert.equal(normalizeNavigationFocus('讲义.pdf#page=4'), '讲义.pdf#page=4');
  assert.equal(normalizeNavigationFocus({ path: '讲义.pdf', fragment: '#page=4&rect=0.1,0.2,0.3,0.4' }), '讲义.pdf#page=4&rect=0.1,0.2,0.3,0.4');
  assert.equal(normalizeNavigationFocus({ path: '讲义.pdf', fragment: 'page=4' }), '讲义.pdf#page=4');
  assert.equal(normalizeNavigationFocus({ path: '讲义.pdf' }), '讲义.pdf');
  assert.equal(normalizeNavigationFocus({ fragment: '#page=4' }), '');
});
