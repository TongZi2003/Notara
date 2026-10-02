import test from 'node:test';
import assert from 'node:assert/strict';
import { responsesRequest, responseEvents, ChatgptAdapter } from './chatgpt-provider.js';

const sse = events => new Response(events.map(event => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
const completed = { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 } } };
const options = { provider: 'notara-chatgpt-account', model: 'model-from-catalog', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] };

test('subscription requests preserve text/tool history, map system to developer and omit unsupported fields', async () => {
  const request = await responsesRequest({ ...options, temperature: 1, maxTokens: 99, messages: [
    { role: 'system', content: [{ type: 'text', text: 'Teach' }] },
    ...options.messages,
    { role: 'assistant', content: [{ type: 'text', text: 'Checking' }, { type: 'tool-call', id: 'call1', name: 'write_lesson_board', arguments: '{"text":"hello"}' }] },
    { role: 'tool', source: { callId: 'call1' }, content: [{ type: 'text', text: 'saved' }] },
  ], tools: [{ name: 'write_lesson_board', description: 'Write a board', parameters: { type: 'object' } }] });
  assert.equal(request.input[0].role, 'developer'); assert.equal(request.input[3].type, 'function_call'); assert.equal(request.input[4].call_id, 'call1');
  assert.equal(request.tools[0].type, 'namespace'); assert.equal(request.tools[0].tools[0].name, 'write_lesson_board');
  assert.equal(request.store, false); assert.equal(request.stream, true);
  for (const key of ['temperature', 'max_output_tokens', 'previous_response_id', 'conversation']) assert.equal(Object.hasOwn(request, key), false);
});

test('SSE parser handles split bytes, unicode and CRLF', async () => {
  const bytes = new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"数学"}\r\n\r\ndata: [DONE]\n\n');
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const events = []; for await (const event of responseEvents(body)) events.push(event);
  assert.deepEqual(events, [{ type: 'response.output_text.delta', delta: '数学' }]);
});

function adapter(events) {
  const requests = [];
  const accounts = { data: { accounts: [{ id: 'account', email: 'test@example.com' }] }, track: () => () => {}, access: async () => 'synthetic-private-token', request: async (url, request) => { requests.push({ url, request }); return sse(events); } };
  return { adapter: new ChatgptAdapter(accounts), requests };
}
const collect = async iterable => { const result = []; for await (const item of iterable) result.push(item); return result; };

test('text plus tool streaming produces native tool calls and waits for response.completed', async () => {
  const fixture = adapter([
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'Hello' },
    { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', call_id: 'call_1', name: 'write_lesson_board', arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"text":"数学"}' }, completed,
  ]);
  const chunks = await collect(fixture.adapter.stream(options));
  assert.equal(chunks.at(-1).reason.kind, 'tool-calls');
  assert.deepEqual(chunks.find(c => c.type === 'block-end' && c.block.type === 'tool-call').block, { type: 'tool-call', id: 'call_1', name: 'write_lesson_board', arguments: '{"text":"数学"}' });
  assert.ok(fixture.requests[0].request.headers['user-agent']);
  assert.equal(fixture.requests[0].url, 'https://api.openai.com/v1/responses');
});

test('partial text followed by quota error, incomplete response or EOF never succeeds', async () => {
  const text = { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'partial' };
  for (const tail of [[], [{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }], [{ type: 'response.incomplete' }]]) {
    const { adapter: client } = adapter([text, ...tail]); const chunks = [];
    await assert.rejects(async () => { for await (const chunk of client.stream(options)) chunks.push(chunk); });
    assert.equal(chunks.some(c => c.type === 'finish'), false);
  }
});

test('model discovery keeps only visible account-specific models and server ordering', async () => {
  const client = new ChatgptAdapter({ access: async () => 'test', json: async () => ({ models: [{ slug: 'b', display_name: 'B', visibility: 'list' }, { slug: 'hidden', visibility: 'hidden' }, { slug: 'a', display_name: 'A', visibility: 'list' }] }) });
  assert.deepEqual((await client.listModels(options.provider)).map(m => m.id), ['b', 'a']);
});

test('encrypted reasoning survives stateless follow-up without reviving edited content or crossing accounts', async () => {
  const output = [{ type: 'reasoning', id: 'reasoning_1', summary: [], encrypted_content: 'opaque-provider-data' }, { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Hello', annotations: [] }] }];
  const fixture = adapter([{ type: 'response.output_text.delta', output_index: 1, content_index: 0, delta: 'Hello' }, { ...completed, response: { ...completed.response, output } }]);
  const chunks = await collect(fixture.adapter.stream(options));
  const message = { role: 'assistant', source: { kind: 'model', provider: options.provider, model: options.model, replayState: chunks.at(-1).replayState }, content: [{ type: 'text', text: 'Hello' }] };
  const request = await responsesRequest({ ...options, messages: [...options.messages, message] });
  assert.deepEqual(request.input.slice(1), output);
  message.content[0].text = 'Edited';
  const edited = await responsesRequest({ ...options, messages: [message] });
  assert.doesNotMatch(JSON.stringify(edited), /opaque-provider-data|Hello/); assert.match(JSON.stringify(edited), /Edited/);
  message.content[0].text = 'Hello';
  const switched = await responsesRequest({ ...options, provider: 'notara-chatgpt-other-account', messages: [message] });
  assert.doesNotMatch(JSON.stringify(switched), /opaque-provider-data/);
});
