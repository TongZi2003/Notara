import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import { installAgentTools } from './agent-tools.js';
import { projectNativeEventRecord } from './context-history-record.js';
import { HISTORY_TOOL_CONTRACTS, HISTORY_TOOL_OUTPUT_CHARS, historyReadReceipt, historySearchReceipt } from './context-history-tools.js';

function fixture(content, seq = 4) {
  const projection = projectNativeEventRecord({ seq, type: 'user/message', data: { source: { kind: 'user' }, content } });
  let start = 0;
  const rows = [...projection.chunks()].map((body, part) => { const row = { part, start, end: start + body.length, body }; start = row.end; return row; });
  return { event: { seq, type: projection.type, role: projection.role, encoding: projection.encoding, state: 'complete', chars: start, chunkCount: rows.length, scope: 'private-scope' }, rows };
}
function runtime(history) {
  const ctx = new Context();
  new SystemPrompt(ctx, { includeHarnessIdentity: true, includeRuntimeContext: true });
  new ToolRuntime(ctx, { mode: 'native' });
  const get = ctx.get.bind(ctx);
  ctx.get = (name, ...args) => name === 'notaraHistory' ? history : get(name, ...args);
  installAgentTools(ctx, { isTeaching: agent => agent?.session?.header?.agentPreset === 'notara-teacher', executeTool: async () => ({}) });
  const session = { id: 'synthetic-current', header: { agentPreset: 'notara-teacher', origin: 'user' } };
  const agent = { session }, signal = new AbortController().signal;
  const run = (name, args, overrides = {}) => ctx.tools.execute({ name, arguments: args, callId: `synthetic-${name}`, agent, signal, ...overrides });
  return { ctx, session, agent, signal, run };
}

test('history schemas bind identity in Host and allow only bounded query/cursors', () => {
  for (const tool of HISTORY_TOOL_CONTRACTS) {
    assert.equal(tool.parameters.additionalProperties, false);
    assert.equal(tool.parameters.properties.sessionId, undefined);
    assert.equal(tool.parameters.properties.root, undefined);
  }
  assert.equal(HISTORY_TOOL_CONTRACTS[0].parameters.properties.query.maxLength, 512);
  assert.equal(HISTORY_TOOL_CONTRACTS[0].parameters.properties.limit.maximum, 10);
});

test('search output contains native evidence anchors and explicitly incomplete recall, without scope identifiers', () => {
  const input = { results: [{ ref: 'private-scope:4:2', seq: 4, part: 2, preview: 'quoted native evidence', hitStart: 16400, hitEnd: 16422, windowStart: 16000, windowEnd: 24000 }],
    diagnostics: { budgetLimited: true, candidates: 128, scope: 'private-scope' } };
  const receipt = historySearchReceipt(input, 'evidence');
  assert.equal(receipt.hits[0].seq, 4);
  assert.deepEqual(receipt.hits[0].read, { seq: 4, afterPart: 1 });
  assert.equal(receipt.hits[0].previewEncoding, 'native-event-v1');
  assert.match(receipt.recall, /incomplete recall/);
  assert.equal(receipt.diagnostics.budgetLimited, true);
  assert.ok(!JSON.stringify(receipt).includes('private-scope'));
  assert.equal(historySearchReceipt({ results: [], diagnostics: {} }, 'missing').hits.length, 0);
});

test('small complete reads recover original strings and transparent omitted content', () => {
  const content = [{ type: 'text', text: '原话\n"quoted"\\路径😀' }, { type: 'image', privateAttachment: 'DO-NOT-READ' }, { type: 'reasoning', text: 'DO-NOT-READ' }];
  const receipt = historyReadReceipt(fixture(content), 4);
  assert.equal(receipt.format, 'canonical-record');
  assert.equal(receipt.record.blocks[0].text, content[0].text);
  assert.deepEqual(receipt.record.blocks.slice(1), [{ blockIndex: 1, type: 'image', omitted: true }, { blockIndex: 2, type: 'reasoning', omitted: true }]);
  assert.equal(receipt.done, true);
  assert.equal(receipt.next, null);
  assert.ok(!JSON.stringify(receipt).includes('DO-NOT-READ'));
  assert.ok(!JSON.stringify(receipt).includes('private-scope'));
});

test('large quote-heavy records page without dropping a fetched-but-unreturned chunk or joining the whole record', () => {
  const input = fixture([{ type: 'text', text: '\\"😀中\n'.repeat(120000) }]);
  let afterPart = -1;
  const restored = [];
  let calls = 0, reducedPages = 0;
  for (;;) {
    const rows = input.rows.slice(afterPart + 1, afterPart + 5);
    const receipt = historyReadReceipt({ event: input.event, rows }, 4, afterPart);
    assert.ok(JSON.stringify(receipt).length <= HISTORY_TOOL_OUTPUT_CHARS);
    assert.equal(receipt.format, 'encoded-json-fragments');
    assert.ok(receipt.fragments.length >= 1 && receipt.fragments.length <= 4);
    if (receipt.fragments.length < rows.length) reducedPages++;
    for (const fragment of receipt.fragments) {
      assert.equal(fragment.part, restored.length);
      restored.push(fragment.body);
    }
    calls++;
    if (receipt.done) { assert.equal(receipt.next, null); break; }
    assert.ok(receipt.next.afterPart > afterPart);
    afterPart = receipt.next.afterPart;
  }
  assert.ok(calls > 100);
  assert.ok(reducedPages > 0);
  assert.equal(restored.join(''), input.rows.map(row => row.body).join(''));
});

test('read and search execute on the exact current teacher session and carry cancellation', async () => {
  const calls = [], input = fixture([{ type: 'text', text: 'synthetic evidence' }]);
  const h = runtime({ search: async (owner, options) => { calls.push({ owner, options }); return { results: [], diagnostics: {} }; },
    page: async (owner, options) => { calls.push({ owner, options }); return input; } });
  assert.notEqual((await h.run('history_search', { query: 'evidence' })).isError, true);
  assert.notEqual((await h.run('history_read', { seq: 4 })).isError, true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.owner === h.session && call.options.signal === h.signal));
  assert.deepEqual(calls[1].options, { seq: 4, afterPart: -1, signal: h.signal });
  for (const args of [{ query: 'evidence', sessionId: 'other' }, { query: 'evidence', root: 'C:\\other' }, { query: '' }, { query: 'x'.repeat(513) }, { query: 'evidence', limit: 11 }]) {
    assert.equal((await h.run('history_search', args)).isError, true, JSON.stringify(args));
  }
  assert.equal(calls.length, 2);
});

test('native denial and ask, ordinary agents and all worker scopes cannot dispatch history reads', async () => {
  let calls = 0;
  const h = runtime({ search: async () => { calls++; return { results: [], diagnostics: {} }; } });
  for (const tools of ['none', 'read', 'read-only', 'workspace']) {
    const session = { header: { agentPreset: 'notara-teacher', origin: 'subagent' }, snapshotEvents: () => [{ type: 'notara/worker-capabilities', data: { tools } }] };
    assert.equal((await h.run('history_search', { query: 'evidence' }, { agent: { session } })).isError, true);
  }
  assert.equal((await h.run('history_search', { query: 'evidence' }, { agent: { session: { header: { agentPreset: 'ordinary', origin: 'user' } } } })).isError, true);
  for (const kind of ['deny', 'ask']) {
    const dispose = h.ctx.on('tools/pre-execute', () => ({ kind, reason: 'synthetic native policy' }));
    assert.equal((await h.run('history_search', { query: 'evidence' })).isError, true);
    dispose();
  }
  assert.equal(calls, 0);
});

test('model sees history tools and reminder only on a teacher with an installed history service', async () => {
  const h = runtime({});
  const result = await h.ctx.systemPrompt.assemble({ agent: h.agent });
  assert.ok(result.tools.some(tool => tool.name === 'history_search'));
  assert.ok(result.sections.some(section => section.name === 'notara-context-history'));
  const ordinary = await h.ctx.systemPrompt.assemble({ agent: { session: { header: { agentPreset: 'ordinary', origin: 'user' } } } });
  assert.ok(!ordinary.tools.some(tool => tool.name.startsWith('history_')));
  const worker = await h.ctx.systemPrompt.assemble({ agent: { session: { header: { agentPreset: 'notara-teacher', origin: 'subagent' } } } });
  assert.ok(!worker.tools.some(tool => tool.name.startsWith('history_')));
  const missing = runtime(undefined);
  assert.ok(!(await missing.ctx.systemPrompt.assemble({ agent: missing.agent })).tools.some(tool => tool.name.startsWith('history_')));
  assert.equal((await missing.run('history_search', { query: 'evidence' })).isError, true);
});

test('cancelled reads do not reach history and failed archive reads remain errors', async () => {
  let calls = 0;
  const h = runtime({ page: async () => { calls++; throw new Error('EVENT_OMITTED'); } });
  const controller = new AbortController(); controller.abort();
  assert.equal((await h.run('history_read', { seq: 4 }, { signal: controller.signal })).isError, true);
  assert.equal(calls, 0);
  assert.equal((await h.run('history_read', { seq: 4 })).isError, true);
  assert.equal(calls, 1);
});
