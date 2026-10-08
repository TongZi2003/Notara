import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  createUserMessage, createAssistantMessage, createToolResultMessage,
  createDeveloperMessage, createSystemMessage, ToolCallId,
} from '@deepseek-ai/dsh-llm';
import { compactCheckpointSource } from '@deepseek-ai/dsh-compaction';
import { projectNativeSpan, verifyNativeSpanCoverage } from './context-memory-span.js';
import { prepareBoundedCompression } from './context-memory-kernel.js';

// Use the installed native checkpoint framing without asserting its prose.
const sdk = readFileSync(new URL('../../node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js', import.meta.url), 'utf8');
const framing = name => JSON.parse(sdk.match(new RegExp(`const ${name} = (.*);`))[1]);
const text = value => ({ type: 'text', text: value });
const user = (content = [text('Exact original student statement.')]) => createUserMessage({ source: { kind: 'user' }, content });
const assistant = content => createAssistantMessage({ source: { provider: 'synthetic-only', model: 'fixture' }, content });
const call = (id, name = 'read_lesson') => ({ type: 'tool-call', id: ToolCallId(id), name, arguments: '{"path":"lesson.md"}' });
const result = (id, content) => createToolResultMessage({ callId: ToolCallId(id), content, isError: false });
const checkpoint = id => createUserMessage({ source: compactCheckpointSource(id), content: [
  text(`${framing('CHECKPOINT_PREAMBLE')}\n\n${framing('SUMMARY_OPEN_TAG')}`),
  text('Existing compact continuity.'), text(framing('SUMMARY_CLOSE_TAG')),
] });
function input(messages, seqs, { shadowedSeqs = seqs, emptyNodes = [], systemHeadSeq = 0 } = {}) {
  return { messages, nativeSpan: { shadowedSeqs, startSeq: shadowedSeqs[0], endSeq: shadowedSeqs.at(-1),
    systemHeadSeq, messageSeqs: seqs, emptyNodes } };
}
function compress(source, options) {
  const projected = projectNativeSpan(source, options);
  const plan = prepareBoundedCompression(projected.atoms, projected.kernelSelection, 'Verified compact continuity.');
  return { projected, plan, coverage: verifyNativeSpanCoverage(projected, plan) };
}
const image = () => ({ type: 'image', attachment: { attachmentId: 'synthetic-image', mediaType: 'image/png',
  bytes: 120, width: 10, height: 10, name: 'diagram.png' } });
const file = () => ({ type: 'file', attachment: { attachmentId: 'synthetic-file', name: 'source.pdf', bytes: 100 } });

test('SDK multi-block results retain all native blocks and leave the original messages intact', () => {
  const source = input([assistant([text('Inspecting.'), call('one')]),
    result('one', [text('first'), text('second'), text('third')])], [7, 8]);
  const before = JSON.stringify(source);
  const { projected, plan, coverage } = compress(source);
  assert.equal(projected.atoms.length, 1);
  assert.deepEqual(projected.covers.get(plan.atomIds[0]), { ranges: [{ start: 0, end: 1 }], eventCount: 2, blockCount: 5 });
  assert.deepEqual(projected.manifest.events, [
    { seq: 7, nativeRole: 'assistant', blockCount: 2 }, { seq: 8, nativeRole: 'tool', blockCount: 3 },
  ]);
  assert.equal(coverage.blockCount, 5);
  assert.equal(JSON.stringify(source), before);
});

test('SDK parallel calls may finish in reverse order while retaining one balanced interval', () => {
  const source = input([assistant([text('Two reads.'), call('a', 'first'), call('b', 'second')]),
    result('b', [text('B1'), text('B2')]), result('a', [text('A1'), text('A2')])], [10, 11, 12]);
  const { projected, plan, coverage } = compress(source);
  assert.deepEqual(projected.covers.get(plan.atomIds[0]).ranges, [{ start: 0, end: 2 }]);
  assert.equal(projected.atoms.length, 1);
  assert.equal(coverage.blockCount, 7);
  assert.deepEqual(coverage.shadowedSeqs, [10, 11, 12]);
});

test('real three-block checkpoints resolve provenance by exact native seq and compaction id', () => {
  const source = input([checkpoint('native-checkpoint')], [50]), lookedUp = [];
  const { projected, coverage } = compress(source, { checkpointTier: (seq, compactionId) => {
    lookedUp.push([seq, compactionId]); return { seq, compactionId, tier: 2 };
  } });
  assert.deepEqual(lookedUp, [[50, 'native-checkpoint']]);
  assert.equal(source.messages[0].content.length, 3);
  assert.deepEqual(projected.manifest.events[0], { seq: 50, nativeRole: 'user', blockCount: 3,
    checkpoint: { compactionId: 'native-checkpoint', tier: 2 } });
  assert.equal(coverage.tier, 3);
  assert.equal(coverage.blockCount, 3);
  for (const row of [undefined, null, {}, { seq: 51, compactionId: 'native-checkpoint', tier: 2 },
    { seq: 50, compactionId: 'another', tier: 2 },
    ...[0, 4, '2', undefined].map(tier => ({ seq: 50, compactionId: 'native-checkpoint', tier }))]) {
    assert.throws(() => projectNativeSpan(source, { checkpointTier: () => row }), /tier projection unavailable/);
  }
});

test('unknown checkpoint provenance remains null while the kernel plans at the highest tier', () => {
  const row = Object.freeze({ seq: 50, compactionId: 'unknown-old', tier: null });
  const { projected, coverage } = compress(input([checkpoint('unknown-old')], [50]), { checkpointTier: () => row });
  assert.equal(projected.manifest.events[0].checkpoint.tier, null);
  assert.equal(projected.atoms[0].checkpoint.tier, 3);
  assert.equal(coverage.tier, 3);
  assert.equal(row.tier, null);
});

test('real images, files, developer blocks and opaque replay never enter the kernel descriptor', () => {
  const attachmentMessage = user([text('ORIGINAL_TEXT_SENTINEL'), file(), image(), { ...image(), offloaded: true }]);
  const developer = createDeveloperMessage({ source: { kind: 'fixture', secret: 'SOURCE_SENTINEL' }, content: [
    { type: 'tool-addition', toolName: 'new_tool' }, { type: 'tool-removal', toolName: 'old_tool' }, text('DEVELOPER_SENTINEL'),
  ] });
  const nativeAssistant = assistant([text('ASSISTANT_SENTINEL'), { type: 'reasoning', text: 'REASONING_SENTINEL' }]);
  const model = { ...nativeAssistant, source: { ...nativeAssistant.source } };
  Object.defineProperty(model.source, 'replayState', { get() { throw new Error('Opaque replay must not be read'); } });
  Object.defineProperty(model.source, 'rawOutput', { get() { throw new Error('Raw model output must not be read'); } });
  const source = input([createSystemMessage('PERSONA_SENTINEL'), attachmentMessage, developer, model], [0, 4, 5, 6],
    { shadowedSeqs: [4, 5, 6] });
  const actualImage = attachmentMessage.content[2], offloadedImage = attachmentMessage.content[3];
  const originalFile = attachmentMessage.content[1];
  const { projected, coverage } = compress(source);
  assert.equal(coverage.blockCount, 9);
  assert.deepEqual(projected.manifest.events.map(event => event.nativeRole), ['user', 'developer', 'assistant']);
  const payload = JSON.stringify(projected);
  for (const sentinel of ['ORIGINAL_TEXT_SENTINEL', 'SOURCE_SENTINEL', 'DEVELOPER_SENTINEL', 'ASSISTANT_SENTINEL',
    'REASONING_SENTINEL', 'PERSONA_SENTINEL', 'synthetic-image', 'synthetic-file', 'replayState', 'rawOutput']) {
    assert.ok(!payload.includes(sentinel), sentinel);
  }
  // The native summarizer still receives the exact original attachment blocks.
  assert.equal(source.messages[1], attachmentMessage);
  assert.equal(source.messages[1].content[1], originalFile);
  assert.equal(source.messages[1].content[2], actualImage);
  assert.equal(source.messages[1].content[3], offloadedImage);
});

test('empty SDK users and dormant endpoints retain every surface position with zero source blocks', () => {
  const source = input([user([]), user(), user([])], [1, 2, 3], { shadowedSeqs: [9, 1, 2, 3, 8],
    emptyNodes: [{ seq: 9, nativeRole: 'system' }, { seq: 8, nativeRole: 'developer' }] });
  const { projected, coverage } = compress(source);
  assert.deepEqual(projected.manifest.events.map(event => event.blockCount), [0, 0, 1, 0, 0]);
  assert.equal(coverage.blockCount, 1);
  assert.equal(coverage.eventCount, 5);
  assert.deepEqual(coverage.shadowedSeqs, [9, 1, 2, 3, 8]);
  assert.deepEqual(coverage.shadowedRange, { start: 9, end: 8 });
  const empty = compress(input([user([]), assistant([])], [2, 1], { shadowedSeqs: [2, 1, 8],
    emptyNodes: [{ seq: 8, nativeRole: 'system' }] }));
  assert.equal(empty.coverage.blockCount, 0);
  assert.equal(empty.coverage.eventCount, 3);
});

test('empty SDK tool results close the pair without fabricating blocks or permitting endpoint omission', () => {
  const source = input([assistant([call('empty')]), result('empty', [])], [1, 2]);
  const { projected, plan, coverage } = compress(source);
  assert.equal(projected.atoms.length, 1);
  assert.deepEqual(projected.manifest.events[1], { seq: 2, nativeRole: 'tool', blockCount: 0 });
  assert.equal(coverage.eventCount, 2);
  assert.equal(coverage.blockCount, 1);
  assert.throws(() => verifyNativeSpanCoverage(projected, { ...plan, atomIds: [] }), /alias/);
  assert.throws(() => verifyNativeSpanCoverage(projected, { ...plan, atomIds: [...plan.atomIds, plan.atomIds[0]] }), /alias/);
  const altered = { ...projected, covers: new Map(projected.covers) };
  altered.covers.set(plan.atomIds[0], { ranges: [{ start: 0, end: 0 }], eventCount: 1, blockCount: 1 });
  assert.throws(() => verifyNativeSpanCoverage(altered, plan), /incomplete native event coverage/);
  assert.throws(() => projectNativeSpan(input([source.messages[0]], [1], { shadowedSeqs: [1, 2],
    emptyNodes: [{ seq: 2, nativeRole: 'tool' }] })), /empty native node/);
});

test('a real checkpoint between tool endpoints preserves nonmonotonic native order', () => {
  const source = input([assistant([call('mixed')]), checkpoint('middle'), result('mixed', [text('first'), text('second')])], [40, 70, 4]);
  const { projected, plan, coverage } = compress(source, { checkpointTier: (seq, compactionId) => ({ seq, compactionId, tier: 2 }) });
  assert.deepEqual(coverage.shadowedRange, { start: 40, end: 4 });
  assert.deepEqual(coverage.shadowedSeqs, [40, 70, 4]);
  assert.deepEqual(projected.manifest.events.map(event => [event.seq, event.blockCount]), [[40, 1], [70, 3], [4, 2]]);
  assert.deepEqual(projected.covers.get(plan.atomIds[0]), { ranges: [{ start: 0, end: 2 }], eventCount: 3, blockCount: 6 });
  assert.equal(coverage.tier, 3);
});

test('SDK identity conflicts, duplicate calls, invalid attachment shapes and unknown blocks fail closed', () => {
  const same = user();
  assert.throws(() => projectNativeSpan(input([same, { ...same }], [1, 2])), /duplicate native message identity/);
  assert.throws(() => projectNativeSpan(input([assistant([call('same'), call('same')]), result('same', [])], [1, 2])), /duplicate native tool call/);
  const conflicting = { ...result('one', []), toolCallId: ToolCallId('other') };
  assert.throws(() => projectNativeSpan(input([assistant([call('one')]), conflicting], [1, 2])), /mismatched native result/);
  for (const block of [{ type: 'file', attachment: [] }, { type: 'image', attachment: null },
    { ...image(), offloaded: false }, { type: 'future-opaque', secret: 'opaque' }]) {
    assert.throws(() => projectNativeSpan(input([{ ...user(), content: [block] }], [1])), /native attachment|image offload|unsupported native block/);
  }
});
