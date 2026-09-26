import assert from 'node:assert/strict';
import test from 'node:test';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { mathLabelParts, mathSyntax, MATH_DISPLAY, renderMath } from './math-latex.js';

test('math labels keep inline and display dollar forms as renderable parts', () => {
  assert.deepEqual(mathLabelParts('速度 $v$ 与 $$a^2$$'), [
    { kind: 'text', value: '速度 ' },
    { kind: 'math', display: false, source: 'v' },
    { kind: 'text', value: ' 与 ' },
    { kind: 'math', display: true, source: 'a^2' },
  ]);
});

test('escaped dollars stay ordinary link text', () => {
  assert.deepEqual(mathLabelParts('价格 \\$5 与 $x$'), [
    { kind: 'text', value: '价格 \\$5 与 ' },
    { kind: 'math', display: false, source: 'x' },
  ]);
});

test('multiline display math and chemistry render through the Markdown extension', () => {
  const state = EditorState.create({
    doc: '[化学 $\\ce{2H2 + O2 -> 2H2O}$](https://example.com)\n\n$$\\begin{aligned}\nx^2&=1\\\\\ny^2&=4\n\\end{aligned}$$,',
    extensions: [markdown({ base: markdownLanguage, extensions: [mathSyntax] })],
  });
  assert.match(syntaxTree(state).toString(), new RegExp(MATH_DISPLAY));
  assert.match(renderMath('\\ce{2H2 + O2 -> 2H2O}', false), /katex/);
});
