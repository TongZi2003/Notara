import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { projectNativeEventRecord, prepareNativeEventRecord, HISTORY_RECORD_CHUNK_CHARS,
  HISTORY_RECORD_BATCH_CHUNKS, HISTORY_RECORD_BATCH_BYTES } from './context-history-record.js';
import { NATIVE_HISTORY_SEARCH_POLICY, HISTORY_RETRIEVAL_TOOL_NAMES, HISTORY_SEARCH_IDENTITY_LIMITS,
  compactHistorySearchChunk, expandHistorySearchProjection } from './context-history-search-policy.js';
import { maskHistoryStringEscapes, createHistoryLiteralMatcher } from './context-history-evidence.js';

const text = value => ({ type: 'text', text: value });
const user = (seq, content) => ({ seq, type: 'user/message', data: { source: { kind: 'user' }, content } });
const poisoned = (object, fields) => {
  for (const field of fields) Object.defineProperty(object, field, { get() { throw new Error(`forbidden read: ${field}`); } });
  return object;
};
const parsed = record => JSON.parse([...record.chunks()].join(''));

test('3MiB original text is reconstructed exactly through bounded pieces, chunks and batches', async () => {
  const body = '中🙂\n"\\\t'.repeat(400000);
  assert.ok(Buffer.byteLength(body) > 3 * 1024 * 1024);
  const record = await prepareNativeEventRecord(user(7, [text(''), text(body), text('last\nline')]));
  assert.equal(record.metadata.encoding, 'native-event-v1');
  assert.ok([...record.pieces()].every(piece => piece.length <= 6144));
  const chunks = [...record.chunks()];
  assert.ok(chunks.every(chunk => chunk.length <= HISTORY_RECORD_CHUNK_CHARS && chunk.isWellFormed()));
  const full = chunks.join('');
  assert.equal(record.metadata.chars, full.length);
  assert.equal(record.metadata.bytes, Buffer.byteLength(full));
  assert.equal(record.metadata.hash, createHash('sha256').update(full).digest('hex'));
  assert.deepEqual(parsed(record).blocks.map(block => block.text), ['', body, 'last\nline']);
  const transmitted = [];
  for await (const batch of record.batches()) {
    assert.ok(batch.length > 0 && batch.length <= HISTORY_RECORD_BATCH_CHUNKS);
    assert.ok(batch.reduce((sum, chunk) => sum + Buffer.byteLength(chunk), 0) <= HISTORY_RECORD_BATCH_BYTES);
    transmitted.push(...batch);
  }
  assert.equal(transmitted.join(''), full);
});

test('empty content and UTF16 escaping preserve blocks, controls and lone surrogates', async () => {
  assert.deepEqual(parsed(await prepareNativeEventRecord(user(0, []))).blocks, []);
  const body = 'x'.repeat(1023) + '🙂' + '\u0000\b\r\n\t"\\\ud800x\udfff' + '🙂'.repeat(9000);
  const record = await prepareNativeEventRecord(user(1, [text(body), text('')]));
  assert.equal(parsed(record).blocks[0].text, body);
  assert.equal(parsed(record).blocks[1].text, '');
  assert.ok([...record.chunks()].every(chunk => chunk.isWellFormed()));
});

test('canonical whitelist never reads replay, stream, reasoning, authentication or request headers', async () => {
  const reasoning = poisoned({ type: 'reasoning' }, ['text', 'reasoning', 'replayState']);
  const image = poisoned({ type: 'image' }, ['attachment']);
  const event = poisoned({ seq: 4, type: 'assistant/message', data: poisoned({ message: poisoned({ content: [
    text('Visible original.'), reasoning, image,
    { type: 'tool-call', id: 'pending-call', name: 'read', arguments: '{"path":"原文"}' },
  ] }, ['source', 'replayState']) }, ['stream', 'rawOutput', 'reasoning', 'auth', 'header']) }, ['auth', 'header', 'sourceEventSeqs']);
  const data = parsed(await prepareNativeEventRecord(event));
  assert.equal(data.blocks[0].text, 'Visible original.');
  assert.deepEqual(data.blocks[1], { blockIndex: 1, type: 'reasoning', omitted: true });
  assert.deepEqual(data.blocks[2], { blockIndex: 2, type: 'image', omitted: true });
  assert.deepEqual(data.blocks[3], { blockIndex: 3, type: 'tool-call', id: 'pending-call', name: 'read', arguments: '{"path":"原文"}' });
  const normalUser = user(5, [text('Raw user sentence.')]);
  poisoned(normalUser.data.source, ['replayState', 'auth']);
  assert.equal(parsed(await prepareNativeEventRecord(normalUser)).blocks[0].text, 'Raw user sentence.');
});

test('independent tool calls, multi-block results and real native summary sources are preserved', async () => {
  const args = '{"quoted":"' + '\\"\n原文'.repeat(10000) + '"}';
  const call = parsed(await prepareNativeEventRecord({ seq: 1, type: 'tool/call', data: {
    callId: 'call-1', name: 'vault_read', arguments: args,
  } }));
  assert.equal(call.arguments, args);
  const result = parsed(await prepareNativeEventRecord({ seq: 2, type: 'tool/result', data: poisoned({ message: {
    toolCallId: 'call-1', isError: true, content: [text('First\noriginal.'), text(''), text('Second original.')],
  } }, ['meta', 'error', 'rawOutput']) }));
  assert.equal(result.callId, call.callId);
  assert.equal(result.isError, true);
  assert.deepEqual(result.blocks.map(block => block.text), ['First\noriginal.', '', 'Second original.']);
  const summary = parsed(await prepareNativeEventRecord({ seq: 100, type: 'compaction/summary', data: poisoned({
    compactionId: 'compacted', summary: [text('Summary\ntext.')],
    shadowedSeqs: [80, 2, 3], shadowedRange: { start: 80, end: 3 },
  }, ['rawOutput', 'provider', 'model', 'usage', 'header']) }));
  assert.deepEqual(summary.directSourceSeqs, [80, 2, 3]);
  assert.deepEqual(summary.shadowedRange, { start: 80, end: 3 });
  assert.equal(summary.blocks[0].text, 'Summary\ntext.');
});

test('checkpoint carriers and unindexed events expose explicit skips without traversing their bodies', async () => {
  const carrier = { seq: 7, type: 'user/message', data: poisoned({ source: { kind: 'compact-checkpoint' } }, ['content']) };
  assert.deepEqual(await prepareNativeEventRecord(carrier), { kind: 'skip', seq: 7, type: 'user/message', reason: 'checkpoint-carrier' });
  const hidden = poisoned({ seq: 8, type: 'request/header' }, ['data', 'auth', 'header']);
  assert.deepEqual(projectNativeEventRecord(hidden), { kind: 'skip', seq: 8, type: 'request/header', reason: 'unindexed-event-type' });
  const injected = { seq: 9, type: 'user/message', data: poisoned({ source: { kind: 'runtime-context' } }, ['content']) };
  assert.deepEqual(projectNativeEventRecord(injected), { kind: 'skip', seq: 9, type: 'user/message', reason: 'unindexed-user-source' });
});

test('metadata work yields for cancellation and replayed generators honor abort', async () => {
  const controller = new AbortController();
  const stopped = new Error('synthetic cancellation');
  const work = prepareNativeEventRecord(user(1, [text('x'.repeat(3 * 1024 * 1024))]),
    { signal: controller.signal, yieldEveryChars: 8192 });
  setImmediate(() => controller.abort(stopped));
  await assert.rejects(work, error => error === stopped);
  const complete = await prepareNativeEventRecord(user(2, [text('x'.repeat(100000))]));
  const later = new AbortController(), pieces = complete.pieces({ signal: later.signal });
  pieces.next(); later.abort(stopped);
  assert.throws(() => pieces.next(), error => error === stopped);
  const transport = new AbortController();
  let batches = 0;
  await assert.rejects(async () => {
    for await (const batch of complete.batches({ signal: transport.signal })) {
      batches++; assert.ok(batch.length); transport.abort(stopped);
    }
  }, error => error === stopped);
  assert.equal(batches, 1);
});

test('giant mixed assistant evidence masks retrieval calls while canonical bytes and offsets remain exact', async () => {
  const visible = 'Plain ASCII student evidence marker_38429. '.repeat(10000)
    + 'Student fact: history_search is a quoted term, not a call. 原话😀\n"\\\t\ud800 '.repeat(17000);
  const hiddenArgs = '{"query":"history_only_marker_2398 中文😀\\n"}'.repeat(20000);
  const content = [text(visible), { type: 'tool-call', id: 'ordinary_call_marker_3529', name: 'vault_read', arguments: '{"path":"ordinary_argument_marker_3530"}' },
    { type: 'tool-call', id: 'hidden_call_marker_3531', name: 'history_search', arguments: hiddenArgs },
    text('Later real student fact.'), { type: 'tool-call', id: 'hidden_call_marker_3532', name: 'history_read', arguments: '{"seq":123}' }];
  const record = await prepareNativeEventRecord({ seq: 42, type: 'assistant/message', data: { message: { content } } });
  const expected = JSON.stringify({ encoding: 'native-event-v1', seq: 42, type: 'assistant/message', role: 'assistant', blocks: content.map((block, blockIndex) => ({ blockIndex, ...block })) });
  assert.ok(Buffer.byteLength(expected) > 2 * 1024 * 1024);
  const bodies = [], searches = [], hash = createHash('sha256'), searchHash = createHash('sha256');
  for (const chunk of record.searchChunks()) {
    assert.ok(chunk.body.length <= HISTORY_RECORD_CHUNK_CHARS);
    assert.equal(chunk.body.length, chunk.search.length);
    assert.ok(chunk.body.isWellFormed() && chunk.search.isWellFormed());
    for (let index = 0; index < chunk.body.length; index++) assert.ok(chunk.search[index] === ' ' || chunk.search[index] === chunk.body[index]);
    bodies.push(chunk.body); searches.push(chunk.search); hash.update(chunk.body); searchHash.update(chunk.search);
  }
  assert.equal(bodies.join(''), expected, 'search policy never changes canonical native-event-v1 bytes');
  assert.equal(record.metadata.hash, hash.digest('hex'));
  assert.equal(record.metadata.search.hash, searchHash.digest('hex'));
  assert.equal(record.metadata.search.policy, NATIVE_HISTORY_SEARCH_POLICY);
  assert.deepEqual([...record.chunks()], bodies, 'both APIs retain identical stored chunk boundaries');
  const search = searches.join('');
  assert.ok(search.includes(maskHistoryStringEscapes(JSON.stringify(visible).slice(1, -1))), 'quoted tool names in real text remain evidence');
  assert.ok(search.includes('ordinary_call_marker_3529') && search.includes('vault_read') && search.includes('ordinary_argument_marker_3530'));
  for (const value of ['native-event-v1', 'assistant/message', 'blockIndex', 'hidden_call_marker_3531', 'hidden_call_marker_3532', 'history_only_marker_2398', 'history_read']) assert.ok(!search.includes(value), value);
  const laterTextStart = expected.indexOf('Later real student fact.');
  assert.equal(search.slice(laterTextStart, laterTextStart + 24), 'Later real student fact.');
  let index = 0, fullBytes = 0, compactBytes = 0, same = 0, spaces = 0, partial = 0;
  const transmittedHash = createHash('sha256'), transmittedSearchHash = createHash('sha256');
  for await (const batch of record.searchBatches()) {
    assert.ok(batch.length <= HISTORY_RECORD_BATCH_CHUNKS);
    assert.ok(Buffer.byteLength(JSON.stringify(batch)) + 8192 <= HISTORY_RECORD_BATCH_BYTES);
    for (const chunk of batch) {
      const expanded = expandHistorySearchProjection(chunk.body, chunk.search);
      assert.equal(chunk.body, bodies[index]);
      assert.equal(expanded, searches[index], 'compact transport retains original chunk offsets and complete mask');
      transmittedHash.update(chunk.body); transmittedSearchHash.update(expanded);
      compactBytes += Buffer.byteLength(JSON.stringify(chunk));
      fullBytes += Buffer.byteLength(JSON.stringify({ body: bodies[index], search: searches[index] }));
      if (chunk.search === null) same++;
      else if (chunk.search === '') spaces++;
      else partial++;
      index++;
    }
  }
  assert.equal(index, bodies.length);
  assert.ok(same > 0 && spaces > 0 && partial > 0, 'giant mixed text exercises all transport representations');
  assert.ok(compactBytes < fullBytes && fullBytes - compactBytes > 1024 * 1024,
    'both identical and masked giant regions avoid redundant projection payloads');
  assert.equal(transmittedHash.digest('hex'), record.metadata.hash);
  assert.equal(transmittedSearchHash.digest('hex'), record.metadata.search.hash);
});

test('escape evidence masks cross source pieces and stored chunk cuts without changing canonical positions', async () => {
  const expectedRecord = body => ({ encoding: 'native-event-v1', seq: 3, type: 'user/message', role: 'user',
    blocks: [{ blockIndex: 0, type: 'text', text: body }] });
  const emptyCanonical = JSON.stringify(expectedRecord(''));
  const textStart = emptyCanonical.indexOf('"text":"') + '"text":"'.length;
  // The newline is the last source code unit of a 1024-character source slice.
  const first = 'a'.repeat(1023) + '\nmarker_after_source_piece ' + '\\'.repeat(1030) + '中😀\ud800';
  const padding = HISTORY_RECORD_CHUNK_CHARS - 1 - textStart - JSON.stringify(first).slice(1, -1).length;
  assert.ok(padding > 0);
  // This encoded newline is split exactly between adjacent stored chunks.
  const body = first + 'p'.repeat(padding) + '\nmarker_after_chunk_cut ' + '"\\😀\u0001\t'.repeat(4000);
  const rawText = JSON.stringify(body).slice(1, -1), maskedText = maskHistoryStringEscapes(rawText);
  const record = await prepareNativeEventRecord(user(3, [text(body)]));
  const chunks = [...record.searchChunks()];
  const canonical = chunks.map(chunk => chunk.body).join('');
  const projected = chunks.map(chunk => chunk.search).join('');
  assert.equal(canonical, JSON.stringify(expectedRecord(body)));
  assert.equal(record.metadata.search.policy, NATIVE_HISTORY_SEARCH_POLICY);
  assert.equal(projected.slice(textStart, textStart + rawText.length), maskedText);
  assert.equal(projected.length, canonical.length);
  assert.equal(chunks[0].body.at(-1), '\\');
  assert.equal(chunks[1].body[0], 'n');
  assert.equal(chunks[0].search.at(-1), ' ');
  assert.equal(chunks[1].search[0], ' ');
  for (const chunk of chunks) {
    assert.ok(chunk.body.length <= HISTORY_RECORD_CHUNK_CHARS && chunk.body.isWellFormed() && chunk.search.isWellFormed());
    for (let index = 0; index < chunk.body.length; index++) assert.ok(chunk.search[index] === ' ' || chunk.search[index] === chunk.body[index]);
  }
  assert.equal(createHistoryLiteralMatcher('nmarker_after_chunk_cut')(projected, canonical), null);
  assert.deepEqual(createHistoryLiteralMatcher('\nmarker_after_chunk_cut')(projected, canonical),
    { 0: String.raw`\nmarker_after_chunk_cut`, index: HISTORY_RECORD_CHUNK_CHARS - 1 });
  assert.deepEqual([...record.chunks()], chunks.map(chunk => chunk.body));
  const oldBatches = [], expanded = [];
  for await (const batch of record.batches()) oldBatches.push(...batch);
  for await (const batch of record.searchBatches()) {
    for (const chunk of batch) expanded.push({ body: chunk.body, search: expandHistorySearchProjection(chunk.body, chunk.search) });
  }
  assert.equal(oldBatches.join(''), canonical);
  assert.deepEqual(expanded, chunks);
  assert.equal(record.metadata.hash, createHash('sha256').update(canonical).digest('hex'));
  assert.equal(record.metadata.search.hash, createHash('sha256').update(projected).digest('hex'));
});

test('projection transport sentinels distinguish same text, ASCII spaces and partial Unicode evidence', () => {
  for (const chunk of [
    { body: 'quoted\\n😀\\"\\\\', search: 'quoted\\n😀\\"\\\\' },
    { body: 'masked😀', search: ' '.repeat('masked😀'.length) },
    { body: '中🙂 visible', search: '    visible' },
    { body: ' \t\n', search: ' \t\n' },
    { body: '     ', search: '     ' },
    { body: '', search: '' },
  ]) {
    const compact = compactHistorySearchChunk(chunk);
    assert.equal(compact.body, chunk.body);
    assert.equal(expandHistorySearchProjection(compact.body, compact.search), chunk.search);
    assert.equal(expandHistorySearchProjection(compact.body, compact.search).length, chunk.body.length);
    assert.ok(expandHistorySearchProjection(compact.body, compact.search).isWellFormed());
  }
  assert.deepEqual(compactHistorySearchChunk({ body: 'literal', search: 'literal' }), { body: 'literal', search: null });
  assert.deepEqual(compactHistorySearchChunk({ body: 'hidden', search: '      ' }), { body: 'hidden', search: '' });
  assert.deepEqual(compactHistorySearchChunk({ body: ' \t', search: '  ' }), { body: ' \t', search: '' });
  assert.equal(expandHistorySearchProjection('raw', undefined), undefined, 'legacy absence remains a separate caller decision');
});

test('standalone tool descriptors come only from valid native identity; retrieval arguments are never evidence', async () => {
  assert.deepEqual(HISTORY_RETRIEVAL_TOOL_NAMES, ['history_search', 'history_read']);
  const call = { seq: 2, type: 'tool/call', data: { turn: 3, step: 4, callId: 'native-call', name: 'history_search', arguments: '{"query":"hidden_query_marker_9238"}' } };
  const prepared = await prepareNativeEventRecord(call), chunks = [...prepared.searchChunks()];
  assert.deepEqual(prepared.metadata.search.call, { callId: 'native-call', name: 'history_search', turn: 3, step: 4 });
  assert.ok(chunks.every(chunk => /^ *$/.test(chunk.search)));
  for await (const batch of prepared.searchBatches()) {
    assert.ok(batch.every(chunk => chunk.search === ''));
    assert.deepEqual(batch.map(chunk => expandHistorySearchProjection(chunk.body, chunk.search)), chunks.map(chunk => chunk.search));
  }
  assert.equal(JSON.parse(chunks.map(chunk => chunk.body).join('')).arguments, call.data.arguments);
  const ordinary = await prepareNativeEventRecord({ ...call, data: { ...call.data, name: 'vault_search' } });
  const search = [...ordinary.searchChunks()].map(chunk => chunk.search).join('');
  assert.ok(search.includes('native-call') && search.includes('vault_search') && search.includes('hidden_query_marker_9238'));
  for (const changes of [{ turn: undefined }, { step: undefined }, { turn: -0 }, { step: -1 }, { callId: 'x'.repeat(HISTORY_SEARCH_IDENTITY_LIMITS.callId + 1) }, { callId: '\ud800' }, { name: 'x'.repeat(HISTORY_SEARCH_IDENTITY_LIMITS.name + 1) }]) {
    const noIdentity = await prepareNativeEventRecord({ ...call, data: { ...call.data, ...changes } });
    assert.equal(noIdentity.metadata.search.call, undefined);
  }
  const zero = await prepareNativeEventRecord({ ...call, data: { ...call.data, turn: 0, step: 0 } });
  assert.deepEqual(zero.metadata.search.call, { callId: 'native-call', name: 'history_search', turn: 0, step: 0 });
});

test('tool result text is base evidence and carries only canonical pairing identity for worker classification', async () => {
  const event = { seq: 7, type: 'tool/result', data: { turn: 3, step: 4, name: 'history_read', message: {
    toolCallId: 'native-call', source: { kind: 'tool', callId: 'untrusted-other' }, isError: false,
    content: [text('Actual result evidence marker_822391 😀'), { type: 'reasoning', get text() { throw new Error('must not read omitted reasoning'); } }],
  } } };
  const record = await prepareNativeEventRecord(event);
  assert.deepEqual(record.metadata.search.result, { callId: 'native-call', turn: 3, step: 4 });
  assert.equal(record.metadata.search.call, undefined);
  const search = [...record.searchChunks()].map(chunk => chunk.search).join('');
  assert.ok(search.includes('Actual result evidence marker_822391 😀'));
  assert.ok(!search.includes('native-call') && !search.includes('isError') && !search.includes('reasoning'));
  const unresolved = await prepareNativeEventRecord({ ...event, data: { ...event.data, turn: undefined, step: undefined } });
  assert.equal(unresolved.metadata.search.result, undefined);
  assert.equal([...unresolved.searchChunks()].map(chunk => chunk.search).join(''), search, 'unresolved pairing preserves result evidence rather than guessing from data.name');
});

test('search batches count escaped JSON envelope bytes and their replay honours cancellation', async () => {
  const controller = new AbortController(), reason = new Error('search transport cancelled');
  const record = await prepareNativeEventRecord(user(0, [text('\0\n"\\😀'.repeat(90000))]));
  const encoded = [], search = [];
  for await (const batch of record.searchBatches()) {
    assert.ok(batch.length >= 1 && batch.length <= HISTORY_RECORD_BATCH_CHUNKS);
    // Even a maximal valid scope can fit without relying on unescaped bytes.
    const envelope = { id: Number.MAX_SAFE_INTEGER, method: 'appendEvidenceChunks', args: ['中'.repeat(512), Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, batch], deadline: Number.MAX_SAFE_INTEGER };
    assert.ok(Buffer.byteLength(JSON.stringify(envelope)) <= HISTORY_RECORD_BATCH_BYTES);
    encoded.push(...batch.map(chunk => chunk.body)); search.push(...batch.map(chunk => expandHistorySearchProjection(chunk.body, chunk.search)));
  }
  assert.equal(encoded.join(''), [...record.chunks()].join(''));
  assert.equal(createHash('sha256').update(search.join('')).digest('hex'), record.metadata.search.hash);
  let batches = 0;
  await assert.rejects(async () => {
    for await (const batch of record.searchBatches({ signal: controller.signal })) {
      batches++; assert.ok(batch.length); controller.abort(reason);
    }
  }, error => error === reason);
  assert.equal(batches, 1);
  const cancelled = new AbortController(), work = prepareNativeEventRecord(user(1, [text('😀 mask_quoted_original_92938'.repeat(150000))]), { signal: cancelled.signal, yieldEveryChars: 8192 });
  setImmediate(() => cancelled.abort(reason)); await assert.rejects(work, error => error === reason);
});
