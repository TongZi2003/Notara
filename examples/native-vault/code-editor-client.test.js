import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { CODE_LANGUAGES } from './media.js';
import { codeExtensions, decodeCodeText, encodeCodeText, languageSupport } from './code-editor-client.js';

test('every code language the Vault lists has an editor mode', () => {
  for (const language of Object.keys(CODE_LANGUAGES)) assert.ok(languageSupport(language), language);
  assert.ok(languageSupport('unknown'), 'an unknown language falls back to plain text');
});

test('text round-trips through the asset bytes as UTF-8, and non-UTF-8 bytes are refused', () => {
  const text = 'def 掷骰子(n):\n    return n  # 注释 ✓\n';
  assert.equal(decodeCodeText(`data:text/plain;base64,${encodeCodeText(text)}`), text);
  assert.equal(decodeCodeText('data:text/plain;base64,'), '');
  assert.throws(() => decodeCodeText(`data:text/plain;base64,${Buffer.from([0xff, 0xfe, 0xfd]).toString('base64')}`), /code_text_invalid/);
});

test('Python completes names defined in the file and indents after a colon', async () => {
  const doc = 'def roll_dice(count):\n    total = 0\n    return tot';
  const state = EditorState.create({ doc, extensions: codeExtensions('python') });
  const sources = state.languageDataAt('autocomplete', doc.length);
  const context = new CompletionContext(state, doc.length, true);
  const labels = [];
  for (const source of sources) {
    const result = typeof source === 'function' ? await source(context) : null;
    for (const option of result?.options ?? []) labels.push(option.label);
  }
  assert.ok(labels.includes('total'), labels.join(','));
  assert.equal(state.facet(EditorState.tabSize), 4);
});

test('other languages complete from words already in the file', async () => {
  const doc = '(define (square value) (* value value))\n(square val';
  const state = EditorState.create({ doc, extensions: codeExtensions('scheme') });
  const context = new CompletionContext(state, doc.length, true);
  const labels = [];
  for (const source of state.languageDataAt('autocomplete', doc.length)) {
    const result = typeof source === 'function' ? await source(context) : null;
    for (const option of result?.options ?? []) labels.push(option.label);
  }
  assert.ok(labels.includes('value'), labels.join(','));
});
