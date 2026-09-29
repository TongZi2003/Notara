import assert from 'node:assert/strict';
import test from 'node:test';
import { insertComposerText } from './composer-insert.js';

function fakeCtx({ current = 's1', draft = '', phase = 'plain', occurrences = [], busy = null, accept = true } = {}) {
  const calls = [];
  const scope = { bail: (_scope, name, payload) => { calls.push({ name, payload }); return accept; } };
  const ctx = {
    sessions: { scope: id => id === 's1' ? scope : null, list: { getSnapshot: () => ({ byId: current ? { [current]: { id: current, retainedBy: { mainView: 1 } } } : {} }) } },
    conversation: { blocks: { storeFor: () => ({ getSnapshot: () => busy }) }, input: { for: () => ({ state: { getSnapshot: () => ({ phase, draft, draftRev: 7, occurrences }) } }) } },
  };
  return { ctx, calls };
}

test('inserts at the end of the draft without sending, a new line only after existing text', () => {
  let probe = fakeCtx();
  assert.equal(insertComposerText(probe.ctx, 's1', '  帮我规划一条学习路线 '), true);
  assert.deepEqual(probe.calls, [{ name: 'slash/input-insert-text', payload: { text: '帮我规划一条学习路线', span: { start: 0, end: 0, draftRev: 7 } } }]);
  // A reference in the draft is one character in the input but longer in the text.
  probe = fakeCtx({ draft: '先复习ABCDE', occurrences: ['ABCDE'] });
  insertComposerText(probe.ctx, 's1', '再规划');
  assert.equal(probe.calls[0].payload.text, '\n再规划');
  assert.equal(probe.calls[0].payload.span.start, 4);
});

test('refuses when it cannot insert into this lesson now', () => {
  assert.equal(insertComposerText(fakeCtx().ctx, 's1', '  '), false);
  assert.equal(insertComposerText(fakeCtx({ current: 's2' }).ctx, 's1', 'x'), false);
  assert.equal(insertComposerText(fakeCtx({ phase: 'slash' }).ctx, 's1', 'x'), false);
  assert.equal(insertComposerText(fakeCtx({ busy: { id: 'b' } }).ctx, 's1', 'x'), false);
  assert.equal(insertComposerText(fakeCtx({ accept: false }).ctx, 's1', 'x'), false);
});
