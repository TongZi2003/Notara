import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { insertNewlineAndIndent } from '@codemirror/commands';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { CODE_LANGUAGES } from './media.js';
import { codeExtensions, createCodeSaveHandler, decodeCodeText, encodeCodeText, languageSupport } from './code-editor-client.js';

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
  // Put the function beyond CodeMirror's initial parse viewport so this always
  // exercises background parsing, independent of runner speed.
  const prefix = Array.from({ length: 300 }, (_, i) => `value_${i} = ${i}\n`).join('');
  const doc = `${prefix}def roll_dice(count):\n    total = 0\n    return tot`;
  let state = EditorState.create({ doc, extensions: codeExtensions('python') });
  assert.ok(syntaxTree(state).length < doc.length, 'exercise an incomplete initial parse');
  const tree = ensureSyntaxTree(state, doc.length, 1000);
  assert.ok(tree && tree.length >= doc.length, 'wait for Python local-name completion to have a complete syntax tree');
  // Like forceParsing's view.dispatch({}), publish the completed parse into a
  // new EditorState before completion sources read syntaxTree(context.state).
  state = state.update({}).state;
  assert.equal(syntaxTree(state), tree, 'completion reads the completed state tree');
  const sources = state.languageDataAt('autocomplete', doc.length);
  const context = new CompletionContext(state, doc.length, true);
  const labels = [];
  for (const source of sources) {
    const result = typeof source === 'function' ? await source(context) : null;
    for (const option of result?.options ?? []) labels.push(option.label);
  }
  assert.ok(labels.includes('total'), labels.join(','));
  assert.equal(state.facet(EditorState.tabSize), 4);

  const header = 'def roll_dice(count):';
  let indented = EditorState.create({ doc: header, selection: { anchor: header.length }, extensions: codeExtensions('python') });
  const indentationTree = ensureSyntaxTree(indented, header.length, 1000);
  assert.ok(indentationTree && indentationTree.length >= header.length, 'wait for Python indentation parsing');
  indented = indented.update({}).state;
  assert.equal(insertNewlineAndIndent({ state: indented, dispatch: transaction => { indented = transaction.state; } }), true);
  assert.equal(indented.doc.toString(), `${header}\n    `, 'Enter after a Python colon inserts one four-space indent');
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

test('overlapping saves share one CAS request and keep edits made while saving as a dirty draft', async () => {
  let text = 'print("first edit")', revision = 'rev-1', dirty = true;
  let draft = { path: 'lesson.py', revision, text };
  const requests = [], outcomes = [], pending = [], pendingRef = { current: null };
  const createSave = () => createCodeSaveHandler({
    isDirty: () => dirty,
    getText: () => text,
    getRevision: () => revision,
    saveSnapshot: (snapshot, expectedRevision) => {
      requests.push({ snapshot, expectedRevision });
      return new Promise(resolve => pending.push(resolve));
    },
    onResult: outcome => {
      outcomes.push(outcome);
      if (outcome.status !== 'saved') return;
      revision = outcome.value.revision;
      dirty = outcome.dirty;
      draft = dirty ? { path: 'lesson.py', revision, text: outcome.currentText } : null;
    },
    pendingRef,
  });

  const first = createSave()();
  const duplicate = createSave()();
  assert.strictEqual(duplicate, first, 'a concurrent flush waits for the in-flight save');
  await Promise.resolve();
  assert.deepEqual(requests, [{ snapshot: 'print("first edit")', expectedRevision: 'rev-1' }]);

  text = 'print("first edit")\nprint("typed during save")';
  draft = { path: 'lesson.py', revision, text };
  pending[0]({ ok: true, value: { path: 'lesson.py', revision: 'rev-2' } });
  assert.equal(await first, false, 'the first flush must report unsaved newer edits');
  assert.equal(revision, 'rev-2');
  assert.equal(dirty, true);
  assert.deepEqual(draft, { path: 'lesson.py', revision: 'rev-2', text });
  assert.deepEqual(outcomes[0], {
    status: 'saved', value: { path: 'lesson.py', revision: 'rev-2' },
    snapshot: 'print("first edit")', currentText: text, dirty: true,
  });

  const second = createSave()();
  await Promise.resolve();
  assert.deepEqual(requests[1], { snapshot: text, expectedRevision: 'rev-2' });
  pending[1]({ ok: true, value: { path: 'lesson.py', revision: 'rev-3' } });
  assert.equal(await second, true);
  assert.equal(dirty, false);
  assert.equal(draft, null, 'the draft clears only after the latest text is saved');
});

test('a rejected CAS leaves the draft and revision available for recovery', async () => {
  let revision = 'rev-old', dirty = true;
  const draft = { path: 'lesson.py', revision, text: 'uncommitted work' };
  const outcomes = [];
  const save = createCodeSaveHandler({
    isDirty: () => dirty,
    getText: () => draft.text,
    getRevision: () => revision,
    saveSnapshot: async () => ({ ok: false, error: { code: 'vault_revision_conflict' } }),
    onResult: outcome => outcomes.push(outcome),
  });

  assert.equal(await save(), false);
  assert.deepEqual(outcomes, [{ status: 'conflict' }]);
  assert.equal(dirty, true);
  assert.equal(revision, 'rev-old');
  assert.deepEqual(draft, { path: 'lesson.py', revision: 'rev-old', text: 'uncommitted work' });
});
