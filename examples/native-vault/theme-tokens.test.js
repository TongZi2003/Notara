import assert from 'node:assert/strict';
import test from 'node:test';
import { MODERN_TOKENS, NOTEBOOK_FONT_FAMILY, NOTEBOOK_TOKENS, themeTokens } from './theme-tokens.js';

const pair = value => value && typeof value.light === 'string' && typeof value.dark === 'string';

test('the notebook repaints every token the minimal theme sets, in both schemes', () => {
  for (const name of Object.keys(MODERN_TOKENS)) {
    assert.ok(pair(NOTEBOOK_TOKENS[name]), `${name} has a notebook light/dark pair`);
  }
  for (const [name, value] of Object.entries(NOTEBOOK_TOKENS)) assert.ok(pair(value), name);
  assert.notEqual(NOTEBOOK_TOKENS['--dsw-alias-bg-base'].light, MODERN_TOKENS['--dsw-alias-bg-base'].light, 'paper, not white');
  assert.notEqual(NOTEBOOK_TOKENS['--dsw-alias-bg-base'].dark, MODERN_TOKENS['--dsw-alias-bg-base'].dark);
  assert.ok(NOTEBOOK_TOKENS['--dsw-font-family'].light.startsWith(`"${NOTEBOOK_FONT_FAMILY}"`), 'the handwriting face comes first');
  assert.match(NOTEBOOK_TOKENS['--dsw-font-family'].light, /KaiTi|Kaiti/, 'a system Kai face covers the first load');
});

test('only the notebook carries its paper tokens; anything unknown is the minimal theme', () => {
  assert.equal(themeTokens('minimal'), MODERN_TOKENS);
  assert.equal(themeTokens('garden'), MODERN_TOKENS);
  assert.equal(themeTokens(undefined), MODERN_TOKENS);
  assert.ok(!Object.keys(MODERN_TOKENS).some(name => name.startsWith('--nb-')));
  const notebook = themeTokens('notebook');
  for (const name of ['--nb-note', '--nb-tape', '--nb-rule', '--nb-margin', '--nb-seal', '--nb-hl', '--nb-card']) assert.ok(pair(notebook[name]), name);
  for (const name of Object.keys(MODERN_TOKENS)) assert.deepEqual(notebook[name], NOTEBOOK_TOKENS[name]);
});
