import test from 'node:test';
import assert from 'node:assert/strict';
import { responsesRequest, responseEvents, ChatgptAdapter } from './chatgpt-provider.js';
import { QUOTA_EXCEEDED_CODE, CONTEXT_WINDOW_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm';

const sse = (events, headers = {}) => new Response(events.map(event => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join(''), { headers: { 'content-type': 'text/event-stream', ...headers } });
const completed = { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 } } };
const options = { provider: 'notara-chatgpt-account', model: 'model-from-catalog', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] };
const httpProvider = (error, status, headers = {}) => new ChatgptAdapter({ track: () => () => {}, access: async () => 'synthetic', request: async () => Response.json({ error }, { status, headers }) });

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

function adapter(events, headers = {}) {
  const requests = [];
  const accounts = { data: { accounts: [{ id: 'account', email: 'test@example.com' }] }, track: () => () => {}, access: async () => 'synthetic-private-token', request: async (url, request) => { requests.push({ url, request }); return sse(events, headers); } };
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
  const fixture = adapter([
    { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'reasoning_1', summary: [], status: 'in_progress' } },
    { type: 'response.output_item.done', output_index: 0, item: output[0] },
    { type: 'response.output_item.added', output_index: 1, item: { type: 'message', role: 'assistant', content: [], status: 'in_progress' } },
    { type: 'response.output_text.delta', output_index: 1, content_index: 0, delta: 'Hello' },
    { type: 'response.output_item.done', output_index: 1, item: output[1] },
    { ...completed, response: { ...completed.response, output } },
  ]);
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

test('finalized SSE output items recover empty or omitted completed output and preserve paired tool history', async () => {
  const callId = 'call_synthetic_123456789012345';
  const argumentsText = '{"action":"list"}';
  const reasoning = { type: 'reasoning', id: 'rs_synthetic', summary: [], encrypted_content: 'opaque-synthetic-reasoning' };
  const call = { type: 'function_call', id: 'fc_synthetic', call_id: callId, namespace: 'notara', name: 'write_lesson_board', arguments: argumentsText, status: 'completed' };
  const output = [reasoning, call];
  const itemEvents = [
    { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: reasoning.id, summary: [], status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 1, item: { ...call, arguments: '', status: 'in_progress' } },
    { type: 'response.function_call_arguments.delta', output_index: 1, delta: argumentsText },
    { type: 'response.output_item.done', output_index: 1, item: call },
    { type: 'response.output_item.done', output_index: 0, item: reasoning },
  ];
  const tool = { role: 'tool', source: { callId }, content: [{ type: 'text', text: 'synthetic result' }] };
  const toolOptions = { ...options, tools: [{ name: 'write_lesson_board', description: 'Synthetic tool', parameters: { type: 'object' } }] };

  for (const response of [
    { status: 'completed', output: [] },
    { status: 'completed' },
  ]) {
    const fixture = adapter([...itemEvents, { type: 'response.completed', response }]);
    const chunks = await collect(fixture.adapter.stream(options));
    const finish = chunks.at(-1), nativeCall = chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call').block;
    assert.deepEqual(finish.replayState.response.output, output);
    assert.deepEqual(nativeCall, { type: 'tool-call', id: callId, name: 'write_lesson_board', arguments: argumentsText });

    const assistant = { role: 'assistant', source: { kind: 'model', provider: options.provider, model: options.model, replayState: finish.replayState }, content: [nativeCall] };
    const replayed = await responsesRequest({ ...toolOptions, messages: [...options.messages, assistant, tool] });
    assert.deepEqual(replayed.input.slice(1), [
      ...output,
      { type: 'function_call_output', call_id: callId, output: [{ type: 'input_text', text: 'synthetic result' }] },
    ]);

    // A 0.24.3 empty replay with a matching content hash must fall back to native blocks.
    const staleAssistant = { ...assistant, source: { ...assistant.source, replayState: { response: { ...finish.replayState.response, output: [] } } } };
    const recovered = await responsesRequest({ ...toolOptions, messages: [...options.messages, staleAssistant, tool] });
    assert.deepEqual(recovered.input.slice(1), [
      { type: 'function_call', call_id: callId, namespace: 'notara', name: 'write_lesson_board', arguments: argumentsText },
      { type: 'function_call_output', call_id: callId, output: [{ type: 'input_text', text: 'synthetic result' }] },
    ]);
  }
});

test('partial completed output that mismatches visible tool calls is not saved as replay', async () => {
  const callId = 'call_synthetic_partial';
  const argumentsText = '{"action":"list"}';
  const call = { type: 'function_call', id: 'fc_partial', call_id: callId, namespace: 'notara', name: 'write_lesson_board', arguments: argumentsText, status: 'completed' };
  for (const prefix of [
    [],
    [{ type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_partial', summary: [], status: 'in_progress' } }],
  ]) {
    const callIndex = prefix.length;
    const partialOutput = prefix.length ? [call] : [{ type: 'reasoning', id: 'rs_partial', summary: [], encrypted_content: 'opaque-partial' }];
    const fixture = adapter([
      ...prefix,
      { type: 'response.output_item.added', output_index: callIndex, item: { ...call, arguments: '', status: 'in_progress' } },
      { type: 'response.function_call_arguments.delta', output_index: callIndex, delta: argumentsText },
      { type: 'response.completed', response: { status: 'completed', output: partialOutput } },
    ]);
    const chunks = await collect(fixture.adapter.stream(options)), finish = chunks.at(-1);
    const nativeCall = chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call').block;
    assert.equal(finish.replayState, undefined);
    const assistant = { role: 'assistant', source: { kind: 'model', provider: options.provider, model: options.model }, content: [nativeCall] };
    const tool = { role: 'tool', source: { callId }, content: [{ type: 'text', text: 'synthetic result' }] };
    const request = await responsesRequest({ ...options, messages: [...options.messages, assistant, tool] });
    assert.deepEqual(request.input.slice(1), [
      { type: 'function_call', call_id: callId, namespace: 'notara', name: 'write_lesson_board', arguments: argumentsText },
      { type: 'function_call_output', call_id: callId, output: [{ type: 'input_text', text: 'synthetic result' }] },
    ]);
  }
});

test('Responses usage separates cached input without changing total or counting it twice', async () => {
  for (const [raw, expected] of [
    [{ input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 80 } }, { inputTokens: 20, outputTokens: 20, cacheReadTokens: 80, totalTokens: 120 }],
    [{ input_tokens: 100, output_tokens: 20, total_tokens: 120 }, { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, totalTokens: 120 }],
    [{ input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 100 } }, { inputTokens: 0, outputTokens: 20, cacheReadTokens: 100, totalTokens: 120 }],
    [{}, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0 }],
  ]) {
    const fixture = adapter([{ ...completed, response: { ...completed.response, usage: raw } }]);
    const chunks = await collect(fixture.adapter.stream(options)), usage = chunks.find(chunk => chunk.type === 'usage').usage;
    assert.deepEqual(usage, expected);
    assert.equal(usage.inputTokens + usage.cacheReadTokens + usage.outputTokens, usage.totalTokens);
  }
});

test('malformed usage never finishes successfully and inconsistent aggregate totals are omitted', async () => {
  for (const raw of [
    { input_tokens: -1 }, { output_tokens: -1 }, { input_tokens: '100' }, { input_tokens: 1.5 },
    { input_tokens: 100, input_tokens_details: { cached_tokens: -1 } },
    { input_tokens: 100, input_tokens_details: { cached_tokens: 101 } },
    { input_tokens: 100, input_tokens_details: { cached_tokens: 1.5 } },
    { total_tokens: -1 }, { total_tokens: '120' },
    { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 }, null, [],
  ]) {
    const fixture = adapter([{ ...completed, response: { ...completed.response, usage: raw } }]), chunks = [];
    await assert.rejects(async () => { for await (const chunk of fixture.adapter.stream(options)) chunks.push(chunk); }, { code: 'MALFORMED_RESPONSE' });
    assert.equal(chunks.some(chunk => chunk.type === 'finish'), false);
  }
  const fixture = adapter([{ ...completed, response: { ...completed.response, usage: { input_tokens: 100, output_tokens: 20, total_tokens: 999 } } }]);
  const usage = (await collect(fixture.adapter.stream(options))).find(chunk => chunk.type === 'usage').usage;
  assert.deepEqual(usage, { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0 });
});

test('HTTP and SSE context overflow and quota failures use native recovery and notice codes', async () => {
  for (const client of [
    httpProvider({ code: 'context_length_exceeded' }, 400),
    httpProvider({ type: 'context_length_exceeded' }, 400),
    httpProvider({ message: 'This input exceeds the model context window.' }, 400),
    adapter([{ type: 'response.failed', response: { error: { code: 'context_length_exceeded' } } }]).adapter,
    adapter([{ type: 'response.failed', response: { error: { type: 'context_length_exceeded' } } }]).adapter,
    adapter([{ type: 'error', message: 'Maximum context length exceeded.' }]).adapter,
  ]) await assert.rejects(collect(client.stream(options)), { code: CONTEXT_WINDOW_EXCEEDED_CODE });
  for (const client of [
    httpProvider({ code: 'subscription_sharing_usage_limit_exceeded' }, 429),
    adapter([{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }]).adapter,
  ]) await assert.rejects(collect(client.stream(options)), { code: QUOTA_EXCEEDED_CODE });
  await assert.rejects(collect(httpProvider({ code: 'server_error' }, 500).stream(options)), { code: 'PROVIDER_ERROR' });
});

test('generic HTTP errors retain safe status and request id without exposing provider message', async () => {
  const secret = 'PRIVATE_INPUT_OR_KEY_MUST_NOT_APPEAR';
  const client = httpProvider({ code: 'invalid_request_error', type: 'invalid_request_error', message: secret }, 400, { 'x-request-id': 'req-synthetic-400' });
  await assert.rejects(collect(client.stream(options)), error => {
    assert.equal(error.code, 'PROVIDER_ERROR');
    assert.match(error.message, /HTTP 400/);
    assert.doesNotMatch(error.message, /PRIVATE_INPUT_OR_KEY_MUST_NOT_APPEAR/);
    assert.deepEqual(error.failure, { message: error.message, code: 'PROVIDER_ERROR', status: 400, requestId: 'req-synthetic-400' });
    assert.doesNotMatch(JSON.stringify(error.failure), /PRIVATE_INPUT_OR_KEY_MUST_NOT_APPEAR/);
    return true;
  });

  const streamClient = adapter([{ type: 'response.failed', response: { error: { type: 'invalid_request_error', message: secret } } }], { 'x-request-id': 'req-synthetic-sse' }).adapter;
  await assert.rejects(collect(streamClient.stream(options)), error => {
    assert.equal(error.code, 'PROVIDER_ERROR');
    assert.doesNotMatch(error.message, /PRIVATE_INPUT_OR_KEY_MUST_NOT_APPEAR/);
    assert.deepEqual(error.failure, { message: error.message, code: 'PROVIDER_ERROR', status: 200, requestId: 'req-synthetic-sse' });
    return true;
  });
});
