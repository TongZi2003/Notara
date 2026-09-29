import assert from 'node:assert/strict';
import test from 'node:test';
import { currentSessionId, mainViewSettled } from './session-current.js';

const row = (id, mainView = 0) => ({ id, retainedBy: { mainView } });

test('the main conversation is the session its view retains', () => {
  assert.equal(currentSessionId({ byId: { a: row('a'), b: row('b', 1) } }), 'b');
  assert.equal(currentSessionId({ byId: { a: row('a') } }), undefined);
  assert.equal(currentSessionId(undefined), undefined);
});

test('the main view has settled only once the list is ready and it holds a session', () => {
  assert.equal(mainViewSettled({ phase: 'pending', byId: { a: row('a', 1) } }), false);
  // Between the list arriving and DSH restoring the last selection nothing is retained yet.
  assert.equal(mainViewSettled({ phase: 'ready', byId: { a: row('a') } }), false);
  assert.equal(mainViewSettled({ phase: 'ready', byId: { a: row('a', 1) } }), true);
});
