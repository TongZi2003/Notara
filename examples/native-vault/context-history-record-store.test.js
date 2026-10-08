import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve, dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { ContextHistoryClient, createHistoryPrefixHasher } from './context-history-client.js';
import { prepareNativeEventRecord } from './context-history-record.js';

test('canonical native records stream through the worker and verify the same indexed prefix', async () => {
  const parent = resolve(tmpdir());
  const directory = await mkdtemp(join(parent, 'notara-history-record-test-'));
  const client = new ContextHistoryClient({ path: join(directory, 'history.sqlite') });
  try {
    const scope = 'synthetic-canonical-classroom';
    const { generation } = await client.openScope(scope);
    const text = 'NATIVE_MARKER_093248 中文😀\n"quote"\\slash\ud800 '.repeat(80000);
    const source = [
      { seq: 0, type: 'request/header', get data() { throw new Error('hidden headers must not be traversed'); } },
      { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [
        { type: 'text', text }, { type: 'text', text: '' }, { type: 'text', text: 'Final original block.' },
      ] } },
      { seq: 2, type: 'step/end', data: { turn: 1, step: 1 } },
    ];
    const expected = createHistoryPrefixHasher();
    let expectedPayload;
    for (const event of source) {
      const prepared = await prepareNativeEventRecord(event);
      if (prepared.kind === 'skip') {
        const { seq, type, reason } = prepared;
        await client.skipEvents(scope, generation, seq, [{ seq, type, reason }]);
        expected.append({ seq, type, reason, state: 'omitted' });
        continue;
      }
      expected.append(prepared.metadata);
      let receipt = await client.beginEvent(scope, generation, prepared.metadata);
      for await (const batch of prepared.searchBatches()) receipt = await client.appendChunks(scope, generation,
        event.seq, receipt.offset, batch);
      await client.finishEvent(scope, generation, event.seq, receipt.parts);
      expectedPayload = JSON.parse([...prepared.pieces()].join(''));
    }
    const observed = await client.inspectPrefix(scope, generation);
    assert.deepEqual({ nextSeq: observed.nextSeq, prefixHash: observed.prefixHash }, expected.digest());
    let after = -1, encoded = '';
    for (;;) {
      const page = await client.page(scope, generation, 1, after);
      assert.equal(page.event.encoding, 'native-event-v1');
      for (const row of page.rows) { assert.equal(row.start, encoded.length); encoded += row.body; after = row.part; }
      if (page.done) break;
    }
    const restored = JSON.parse(encoded);
    assert.deepEqual(restored, expectedPayload);
    assert.equal(restored.blocks[0].text, text);
    assert.equal(restored.blocks[1].text, '');
    const hits = await client.search(scope, generation, 'NATIVE_MARKER_093248');
    assert.equal(hits.results[0].seq, 1);
    assert.ok(client.maxRpcBytes <= 256 * 1024);
  } finally {
    await client.close().catch(() => client.terminate());
    if (dirname(resolve(directory)) !== parent || !basename(directory).startsWith('notara-history-record-test-')) throw new Error('unexpected temporary path');
    await rm(directory, { recursive: true, force: true });
  }
});
