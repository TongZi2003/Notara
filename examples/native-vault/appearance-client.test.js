import assert from 'node:assert/strict';
import test from 'node:test';
import { APPEARANCE_KEY, createAppearance } from './appearance-client.js';

const memory = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return { values, getItem: key => (values.has(key) ? values.get(key) : null), setItem: (key, value) => values.set(key, String(value)) };
};

test('the minimal theme is the default, and only a known style is ever read back', () => {
  assert.equal(createAppearance(memory()).getSnapshot().style, 'minimal');
  assert.equal(createAppearance(memory({ [APPEARANCE_KEY]: 'notebook' })).getSnapshot().style, 'notebook');
  assert.equal(createAppearance(memory({ [APPEARANCE_KEY]: 'garden' })).getSnapshot().style, 'minimal');
  assert.equal(createAppearance(undefined).getSnapshot().style, 'minimal');
});

test('switching persists per browser and tells every subscriber once', () => {
  const storage = memory(), appearance = createAppearance(storage);
  let calls = 0; const stop = appearance.subscribe(() => { calls += 1; });
  appearance.setStyle('notebook');
  assert.equal(appearance.getSnapshot().style, 'notebook');
  assert.equal(storage.values.get(APPEARANCE_KEY), 'notebook');
  appearance.setStyle('notebook');
  appearance.setStyle('sepia');
  assert.equal(calls, 1, 'a repeat or an unknown style changes nothing');
  stop(); appearance.setStyle('minimal');
  assert.equal(calls, 1);
  assert.equal(storage.values.get(APPEARANCE_KEY), 'minimal');
});

test('blocked storage never breaks the switch', () => {
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const appearance = createAppearance(blocked);
  assert.equal(appearance.getSnapshot().style, 'minimal');
  let seen = '';
  appearance.subscribe(() => { seen = appearance.getSnapshot().style; });
  appearance.setStyle('notebook');
  assert.equal(seen, 'notebook', 'the choice holds for this page even when it cannot be saved');
});
