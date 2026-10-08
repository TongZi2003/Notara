import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareBoundedCompression, confirmNativeCommit, KERNEL_SUMMARY_CHAR_LIMIT } from './context-memory-kernel.js';

const raw = (seq, text = 'Original student statement.') => ({ seq, blockIndex: 0, role: 'user', text });
const checkpoint = (seq, tier, blockIndex = 0) => ({ seq, blockIndex, role: 'user',
  text: `Native checkpoint block ${blockIndex}.`, checkpoint: { tier, compactionId: `c${seq}` } });

test('bounded kernel transaction folds mixed native tiers and complete checkpoint blocks', () => {
  const atoms = [raw(0), ...[0, 1, 2].map(i => checkpoint(12, 1, i)), raw(4), checkpoint(15, 2), raw(6)];
  const before = JSON.stringify(atoms);
  const plan = prepareBoundedCompression(atoms, { startSeq: 12, endSeq: 15 }, 'Combined teaching progress; exact original statements remain in history.');
  assert.equal(plan.tier, 3);
  assert.deepEqual(plan.shadowedSeqs, [12, 4, 15]);
  assert.equal(plan.atomIds.length, 5);
  assert.deepEqual(plan.directSources.map(source => source.kind), ['checkpoint', 'raw', 'checkpoint']);
  assert.equal(JSON.stringify(atoms), before, 'kernel must not mutate native input');
});

test('the native commit must match the proposed coverage and exact summary', () => {
  const plan = prepareBoundedCompression([raw(0), raw(1)], { startSeq: 0, endSeq: 1 }, 'Original facts available in the retained source.');
  const result = { shadowedSeqs: [0, 1], shadowedRange: { start: 0, end: 1 },
    summary: [{ type: 'text', text: plan.summary }], compactionId: 'actual-native', startSeq: 2, summarySeq: 3 };
  const event = { seq: 4, type: 'user/message', data: { source: { kind: 'compact-checkpoint', compactionId: 'actual-native' } },
    sourceEventSeqs: [2, 3, 0, 1] };
  assert.equal(confirmNativeCommit(plan, result, event).tier, 1);
  assert.throws(() => confirmNativeCommit(plan, result, { ...event, sourceEventSeqs: [2, 3, 0, 1, 99] }), /direct source edges/);
  assert.throws(() => confirmNativeCommit(plan, { ...result, shadowedSeqs: [1, 0] }, event), /different surface range/);
  assert.throws(() => confirmNativeCommit(plan, result, null), /absent/);
});

test('kernel may not silently widen a selected native tool range', () => {
  const atoms = [raw(0), { seq: 1, blockIndex: 0, role: 'assistant', text: '{"query":"original fact"}',
    toolPair: { id: 'call', side: 'call', name: 'history_search' } },
  { seq: 2, blockIndex: 0, role: 'tool', text: 'Original statement.', toolPair: { id: 'call', side: 'result', name: 'history_search' } }, raw(3)];
  assert.throws(() => prepareBoundedCompression(atoms, { startSeq: 0, endSeq: 1 }, 'Incomplete pair.'), /complete native tool pair/);
  const plan = prepareBoundedCompression(atoms, { startSeq: 0, endSeq: 2 }, 'Read the earlier statement.');
  assert.deepEqual(plan.shadowedSeqs, [0, 1, 2]);
  assert.throws(() => prepareBoundedCompression([raw(0), { ...raw(1), blockIndex: 2 }],
    { startSeq: 0, endSeq: 1 }, 'Bad source coverage.'), /every block/);
});

test('kernel work is bounded by the selected frontier and rejects oversize input', () => {
  const atoms = Array.from({ length: 512 }, (_, seq) => checkpoint(seq, 3));
  const plan = prepareBoundedCompression(atoms, { startSeq: 0, endSeq: 511 }, 'Bounded current frontier.');
  assert.equal(plan.metrics.maxSeedEffectiveIds, 1);
  assert.equal(plan.metrics.kernelMessages, 512);
  assert.equal(plan.directSources.length, 512);
  assert.throws(() => prepareBoundedCompression([...atoms, checkpoint(512, 3)],
    { startSeq: 0, endSeq: 512 }, 'Too many atoms.'), /1..512/);
  assert.throws(() => prepareBoundedCompression([raw(0, 'x'.repeat(2 * 1024 * 1024 + 1))],
    { startSeq: 0, endSeq: 0 }, 'Too much text.'), /byte cap/);
});

test('kernel preserves long native summaries without an assumed token-to-character ratio', () => {
  const text = 'a'.repeat(65536);
  const plan = prepareBoundedCompression([raw(1)], { startSeq: 1, endSeq: 1 }, text);
  assert.equal(plan.summary, text);
  assert.throws(() => prepareBoundedCompression([raw(1)], { startSeq: 1, endSeq: 1 },
    'a'.repeat(KERNEL_SUMMARY_CHAR_LIMIT + 1)), /bounded summary/);
});
