import assert from 'node:assert/strict';
import test from 'node:test';
import { projectNativeSpan, verifyNativeSpanCoverage, NATIVE_SPAN_ALIAS_LIMIT } from './context-memory-span.js';
import { prepareBoundedCompression } from './context-memory-kernel.js';

const text = value => ({ type: 'text', text: value });
const user = (seq, content = [text(`Source ${seq}.`)]) => ({ seq, message: { id: `m-${seq}`, role: 'user', source: { kind: 'user' }, content } });
function inputOf(records, { head, empty = [] } = {}) {
  const all = head ? [head, ...records.filter(record => record.message)] : records.filter(record => record.message);
  return { messages: all.map(record => record.message), nativeSpan: {
    shadowedSeqs: records.map(record => record.seq), startSeq: records[0].seq, endSeq: records.at(-1).seq,
    ...(head ? { systemHeadSeq: head.seq } : {}), messageSeqs: all.map(record => record.seq), emptyNodes: empty } };
}
const checkpoint = (seq, tier, compactionId = `c-${seq}`) => ({ seq, tier, message: { id: `m-${seq}`, role: 'user',
  source: { kind: 'compact-checkpoint', compactionId }, content: [text('Frame opens.'), text(`Tier ${tier}.`), text('Frame closes.')] } });
const optionsOf = records => ({ checkpointTier: (seq, compactionId) => {
  const record = records.find(record => record.seq === seq && record.message?.source.compactionId === compactionId);
  return record ? { seq, compactionId, tier: record.tier } : undefined;
} });
function validate(input, options) {
  const projected = projectNativeSpan(input, options);
  const plan = prepareBoundedCompression(projected.atoms, projected.kernelSelection, 'Native checkpoint verified.');
  return { projected, plan, coverage: verifyNativeSpanCoverage(projected, plan) };
}
const pair = (from = 0, resultContent = [text('Tool result.')], id = `call-${from}`) => [
  { seq: from, message: { id: `m-${from}`, role: 'assistant', source: { kind: 'model' },
    content: [{ type: 'reasoning', text: 'Old reasoning.' }, { type: 'tool-call', id, name: 'vault_read', arguments: '{"path":"synthetic"}' }] } },
  { seq: from + 1, message: { id: `m-${from + 1}`, role: 'tool', source: { kind: 'tool', callId: id }, toolCallId: id, content: resultContent } },
];

test('513 messages and 513 blocks retain complete native coverage under a bounded kernel view', () => {
  for (const records of [Array.from({ length: 513 }, (_, seq) => user(seq)), [user(0, Array.from({ length: 513 }, (_, i) => text(`Block ${i}.`)))]]) {
    const { projected, coverage } = validate(inputOf(records));
    assert.ok(projected.atoms.length <= NATIVE_SPAN_ALIAS_LIMIT);
    assert.equal(coverage.blockCount, 513);
    assert.equal(coverage.eventCount, records.length);
    assert.deepEqual(coverage.shadowedSeqs, records.map(record => record.seq));
  }
});

test('large originals never enter kernel text, including a multi-block tool result', () => {
  const sentinel = 'PRIVATE_ORIGINAL_MUST_NOT_ENTER_KERNEL';
  const body = sentinel + '中'.repeat(1024 * 1024);
  const records = [user(0, [text(body)]), ...pair(1, [text(body), text('Second result block.'), text('Third result block.')])];
  const { projected, coverage } = validate(inputOf(records));
  assert.equal(coverage.blockCount, 6);
  assert.ok(Buffer.byteLength(JSON.stringify(projected.atoms)) < 2048);
  assert.ok(!JSON.stringify(projected.atoms).includes(sentinel));
  assert.equal(records[0].message.content[0].text, body);
});

test('checkpoint/raw interval aliases preserve maximum tier and unknown conservative planning', () => {
  const records = [user(900), checkpoint(1000, 1), ...Array.from({ length: 1024 }, (_, i) => user(10000 + i)), checkpoint(5000, 2), user(2)];
  const { projected, coverage } = validate(inputOf(records), optionsOf(records));
  assert.equal(coverage.tier, 3);
  assert.equal(projected.manifest.highestTier, 2);
  assert.deepEqual(coverage.shadowedRange, { start: 900, end: 2 });
  assert.ok(projected.atoms.length <= 512);
  assert.equal(coverage.blockCount, records.length + 4);
  for (const tier of [1, 2, 3, null]) {
    const single = [checkpoint(8, tier)];
    assert.equal(validate(inputOf(single), optionsOf(single)).coverage.tier, tier === 1 ? 2 : 3);
  }
});

test('parallel tools form whole balanced aliases and missing/duplicate mates fail closed', () => {
  const records = pair(0);
  records[0].message.content.push({ type: 'tool-call', id: 'parallel-b', name: 'vault_search', arguments: '{}' });
  records.push({ seq: 2, message: { id: 'm-2', role: 'tool', source: { kind: 'tool', callId: 'parallel-b' }, toolCallId: 'parallel-b', content: [] } });
  const { projected, coverage } = validate(inputOf(records));
  assert.equal(projected.atoms.length, 1);
  assert.equal(coverage.eventCount, 3);
  assert.throws(() => projectNativeSpan(inputOf(records.slice(0, 2))), /splits native tool pair/);
  assert.throws(() => projectNativeSpan(inputOf(records.slice(1))), /unpaired/);
  const duplicate = structuredClone(records);
  duplicate.push({ ...structuredClone(records[1]), seq: 4, message: { ...structuredClone(records[1].message), id: 'm-4' } });
  assert.throws(() => projectNativeSpan(inputOf(duplicate)), /unpaired/);
  const mismatch = structuredClone(records);
  mismatch[1].message.source.callId = 'wrong';
  assert.throws(() => projectNativeSpan(inputOf(mismatch)), /mismatched/);
});

test('aliases never end inside tool pairs and each alias uses its exact maximum checkpoint tier', () => {
  const records = Array.from({ length: 520 }, (_, index) => pair(index * 2)).flat();
  records.splice(100, 0, checkpoint(10000, 1));
  records.splice(700, 0, checkpoint(10001, 2));
  const { projected } = validate(inputOf(records), optionsOf(records));
  for (const atom of projected.atoms) {
    const { start, end } = projected.covers.get(`native:${atom.seq}:${atom.blockIndex}`).ranges[0];
    const events = projected.manifest.events.slice(start, end + 1);
    const selected = records.slice(start, end + 1);
    const calls = selected.flatMap(record => record.message.content.filter(block => block.type === 'tool-call').map(block => block.id));
    const results = selected.filter(record => record.message.role === 'tool').map(record => record.message.toolCallId);
    assert.deepEqual(calls, results);
    const maximum = Math.max(0, ...events.map(event => event.checkpoint?.tier ?? 0));
    assert.equal(atom.checkpoint?.tier ?? 0, maximum);
  }
});

test('empty non-head nodes, developer changes, images/files and opaque replay preserve event coverage', () => {
  const records = [user(1), { seq: 5 }, { seq: 3, message: { id: 'm-3', role: 'developer', source: { kind: 'runtime-context' },
    content: [{ type: 'tool-addition', toolName: 'vault_read' }, { type: 'tool-removal', toolName: 'old_tool' }] } },
    user(8, [{ type: 'image', attachment: { id: 'synthetic-image' } }, { type: 'image', attachment: { id: 'offloaded-image' }, offloaded: true },
      { type: 'file', attachment: { id: 'synthetic-file' } }]), ...pair(9)];
  Object.defineProperty(records.at(-2).message.source, 'replayState', { get() { throw new Error('opaque replay must not be inspected'); } });
  const head = { seq: 0, message: { id: 'system-head', role: 'system', source: { kind: 'system-prompt' }, content: [text('System head.')] } };
  const { coverage } = validate(inputOf(records, { head, empty: [{ seq: 5, nativeRole: 'system' }] }));
  assert.equal(coverage.eventCount, 6);
  assert.equal(coverage.blockCount, 9);
  assert.ok(!coverage.shadowedSeqs.includes(0));
});

test('strict native manifest identity, ordering, empty nodes and checkpoint validation', () => {
  const simple = inputOf([user(1), user(2)]);
  assert.throws(() => projectNativeSpan({ ...simple, nativeSpan: { ...simple.nativeSpan, startSeq: 2 } }), /positional/);
  assert.throws(() => projectNativeSpan({ ...simple, nativeSpan: { ...simple.nativeSpan, messageSeqs: [2, 1] } }), /surface order/);
  assert.throws(() => projectNativeSpan({ ...simple, nativeSpan: { ...simple.nativeSpan, shadowedSeqs: [1, 1], endSeq: 1 } }), /positional/);
  assert.throws(() => projectNativeSpan({ ...simple, messages: [simple.messages[0]], nativeSpan: { ...simple.nativeSpan, messageSeqs: [1] } }), /missing native node/);
  assert.throws(() => projectNativeSpan({ ...simple, nativeSpan: { ...simple.nativeSpan, emptyNodes: [{ seq: 1, nativeRole: 'system' }] } }), /empty native node/);
  assert.throws(() => projectNativeSpan({ ...simple, nativeSpan: { ...simple.nativeSpan, systemHeadSeq: 1 } }), /reserved system head/);
  const active = inputOf([{ seq: 1, message: { id: 'system', role: 'system', source: { kind: 'system-prompt' }, content: [text('Active.')] } }]);
  assert.throws(() => projectNativeSpan(active), /active system/);
  const cp = [checkpoint(1, 1)];
  assert.throws(() => projectNativeSpan(inputOf(cp)), /tier projection unavailable/);
  assert.throws(() => projectNativeSpan(inputOf(cp), { checkpointTier: () => ({ seq: 2, compactionId: 'c-1', tier: 1 }) }), /tier projection unavailable/);
  assert.throws(() => projectNativeSpan(inputOf([checkpoint(1, 1, 'same'), checkpoint(2, 1, 'same')]), { checkpointTier: (seq, compactionId) => ({ seq, compactionId, tier: 1 }) }), /duplicate native checkpoint/);
});

test('kernel coverage rejects missing foreign duplicate reordered aliases and bad direct intervals', () => {
  const { projected, plan } = validate(inputOf([user(1), user(2), user(3)]));
  for (const atomIds of [plan.atomIds.slice(1), [...plan.atomIds, 'foreign'], [...plan.atomIds, plan.atomIds[0]], [...plan.atomIds].reverse()]) {
    assert.throws(() => verifyNativeSpanCoverage(projected, { ...plan, atomIds }), /alias/);
  }
  assert.throws(() => verifyNativeSpanCoverage(projected, { ...plan, tier: 3 }), /tier/);
  const first = projected.covers.get(plan.atomIds[0]);
  projected.covers.set(plan.atomIds[0], { ...first, ranges: [{ start: 1, end: 1 }] });
  assert.throws(() => verifyNativeSpanCoverage(projected, plan), /range splits/);
});

test('50k native events and millions of original blocks use at most 512 direct aliases', () => {
  const repeated = Array.from({ length: 64 }, () => text('Original body remains exclusively in the serial summarizer.'));
  const records = Array.from({ length: 50000 }, (_, seq) => user(seq, repeated));
  const { projected, coverage } = validate(inputOf(records));
  assert.ok(projected.atoms.length <= 512);
  assert.equal(coverage.eventCount, 50000);
  assert.equal(coverage.blockCount, 3200000);
  assert.ok(Buffer.byteLength(JSON.stringify(projected.atoms)) < 256 * 1024);
  assert.ok([...projected.covers.values()].every(cover => cover.ranges.length === 1));
  assert.ok(!JSON.stringify(projected.atoms).includes('Original body remains'));
});
