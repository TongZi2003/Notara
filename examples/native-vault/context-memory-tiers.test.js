import assert from 'node:assert/strict';
import test from 'node:test';
import { checkpointTiersProjection as projection, checkpointSurfaceNodes, checkpointSurfaceMatches } from './context-memory-tiers.js';

const user = (seq, source = { kind: 'user' }, surfaceOp = 'append', sourceEventSeqs) => ({
  seq, type: 'user/message', data: { source }, surfaceOp, ...(sourceEventSeqs ? { sourceEventSeqs } : {}),
});
const replace = (startSeq, endSeq = startSeq) => ({ type: 'replace', startSeq, endSeq });
const summary = (seq, id, shadowedSeqs) => ({ seq, type: 'compaction/summary', data: {
  compactionId: id, shadowedSeqs, shadowedRange: { start: shadowedSeqs[0], end: shadowedSeqs.at(-1) },
} });
const commit = (seq, id, shadowedSeqs) => user(seq, { kind: 'compact-checkpoint', compactionId: id },
  replace(shadowedSeqs[0], shadowedSeqs.at(-1)), [seq - 1, ...shadowedSeqs]);

test('tiers publish only after the exact native replacement and preserve fork prefixes', () => {
  let state = projection.init();
  for (let seq = 0; seq < 4; seq++) state = projection.apply(state, user(seq));
  state = projection.apply(state, summary(4, 'first', [0, 1]));
  const beforeCommit = state;
  assert.equal(state.checkpoints.length, 0);
  state = projection.apply(state, commit(5, 'first', [0, 1]));
  assert.equal(state.checkpoints[0].tier, 1);
  state = projection.apply(state, summary(6, 'second', [2, 3]));
  state = projection.apply(state, commit(7, 'second', [2, 3]));
  state = projection.apply(state, summary(8, 'parent', [5, 7]));
  assert.equal(state.checkpoints.length, 2);
  state = projection.apply(state, commit(9, 'parent', [5, 7]));
  assert.deepEqual(state.checkpoints, [{ seq: 9, compactionId: 'parent', tier: 2 }]);
  const fork = projection.apply(beforeCommit, { seq: 5, type: 'session/end-seed', data: {} });
  assert.equal(fork.pending, null);
  assert.equal(fork.checkpoints.length, 0);
  assert.equal(beforeCommit.pending.compactionId, 'first');
});

test('position order, foreign source references and same-checkpoint rewrites retain exact tiers', () => {
  let state = projection.init();
  for (let seq = 0; seq < 4; seq++) state = projection.apply(state, user(seq));
  state = projection.apply(state, summary(4, 'first', [0, 1]));
  state = projection.apply(state, commit(5, 'first', [0, 1]));
  // Referencing an outside checkpoint does not remove it from the surface.
  state = projection.apply(state, user(6, { kind: 'user' }, replace(2, 3), [2, 3, 5]));
  assert.deepEqual(checkpointSurfaceNodes(state), [5, 6]);
  assert.equal(state.checkpoints[0].seq, 5);
  state = projection.apply(state, user(7, { kind: 'compact-checkpoint', compactionId: 'first' }, replace(5), [5]));
  assert.equal(state.checkpoints[0].tier, 1);
  assert.deepEqual(checkpointSurfaceNodes(state), [7, 6]);
  state = projection.apply(state, summary(8, 'ordered', [7, 6]));
  state = projection.apply(state, commit(9, 'ordered', [7, 6]));
  assert.equal(state.checkpoints[0].tier, 2);
  state = projection.apply(state, user(10, { kind: 'user' }, replace(9), [9]));
  assert.deepEqual(state.checkpoints, []);
});

test('unknown checkpoints stay unknown and a history of replacements does not accumulate metadata', () => {
  let state = projection.apply(projection.init(), user(0, { kind: 'compact-checkpoint', compactionId: 'legacy' }));
  assert.equal(state.checkpoints[0].tier, null);
  for (let seq = 1; seq < 100000; seq += 2) {
    const nodes = checkpointSurfaceNodes(state);
    state = projection.apply(state, summary(seq, `c${seq}`, nodes));
    state = projection.apply(state, commit(seq + 1, `c${seq}`, nodes));
  }
  assert.equal(state.nodeCount, 1);
  assert.equal(state.checkpoints.length, 1);
  assert.equal(state.checkpoints[0].tier, 3);
  assert.ok(JSON.stringify(state).length < 200);
});

test('large original histories retain immutable prefixes without copying the whole surface on every append', () => {
  let state = projection.init();
  for (let i = 0; i < 256; i++) state = projection.apply(state, user(i));
  const prefix = state;
  for (let i = 256; i < 100000; i++) state = projection.apply(state, user(i));
  assert.equal(prefix.nodeCount, 256);
  assert.equal(prefix.nodeChunks.length, 1);
  assert.equal(state.nodeChunks[0], prefix.nodeChunks[0], 'finished immutable chunks can be shared');
  const expected = Array.from({ length: 100000 }, (_, i) => i);
  assert.ok(checkpointSurfaceMatches(state, expected));
  expected[300] = -1;
  assert.equal(checkpointSurfaceMatches(state, expected), false);
  assert.ok(state.nodeChunks.every(chunk => chunk.length <= 256));
});
