import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import { LlmRuntime, LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { TokenMeter } from '@deepseek-ai/dsh-token-meter';
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import NativeCompactionEngine from './compaction.js';

// Real native services and transactions, synthetic adapter, no Host or user data.
async function fixture(seed) {
  const ctx = new Context(), fibers = [], events = [...(seed ?? [])], requests = [], calls = [];
  let handle;
  for (const [plugin, config] of [
    [SessionProjectionRegistry], [SessionStore], [AgentRegistry], [LlmRuntime],
    [SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false }],
    [ToolRuntime, { mode: 'native' }], [TokenMeter],
    [AgentDefaultModel, { provider: 'memory-fixture', model: 'memory-fixture' }],
    [AgentLoop], [NativeCompactionEngine, { auto: false, maxTokens: 512 }],
  ]) fibers.push(await ctx.plugin(plugin, config));
  ctx.on('session/event', (_session, event) => events.push(event));
  class Adapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return { provider, id: model, name: model, context: { contextWindow: 128000 },
        inputModalities: ['text'], defaultMaxTokens: 512 };
    }
    async *stream(request) {
      requests.push(request);
      const text = `Synthetic checkpoint ${crypto.randomUUID()}. Retrieve original records for exact earlier details.`;
      calls.push({ request, text });
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['memory-fixture'], new Adapter());
  handle = await ctx.agents.create({ sessionId: SessionId(`memory-${crypto.randomUUID()}`),
    ...(seed ? { seed } : {}), agentOptions: { provider: 'memory-fixture', model: 'memory-fixture' } });
  const session = handle.agent.session;
  return {
    ctx, session, events, requests, calls, agent: handle.agent,
    add(count, offset = 0, blocks = 1) {
      for (let i = 0; i < count; i++) session.append('user/message', createUserMessage({
        source: { kind: 'user' }, content: Array.from({ length: blocks }, (_, b) => ({
          type: 'text', text: `ORIGINAL_${offset + i}_${b}: ${'原始教学资料与未完成问题。'.repeat(8)}`,
        })),
      }), { surfaceOp: 'append' });
    },
    state: () => ctx.sessionProjections.stateOf(session, 'notaraContextTiers'),
    compact: () => ctx.compaction.compactNow(handle.agent, new AbortController().signal),
    async close() { await handle.dispose(); for (const fiber of fibers.reverse()) await fiber.dispose(); },
  };
}

function recordsOf(calls) {
  return calls.flatMap(({ request }) => {
    assert.equal(request.purpose, 'compaction');
    const text = request.messages[0].content.find(block => block.type === 'text')?.text;
    assert.equal(typeof text, 'string');
    const lines = text.split('\n');
    const start = lines.indexOf('<quoted-conversation-data>');
    assert.ok(start >= 0, 'summary request contains its quoted source-data boundary');
    const end = lines.indexOf('</quoted-conversation-data>', start + 1);
    const jsonl = lines.slice(start + 1, end < 0 ? undefined : end);
    assert.ok(jsonl.length > 0, 'summary request contains source records');
    return jsonl.map(line => JSON.parse(line));
  });
}

function assertCheckpointRound(current, result, tier, calls, previous) {
  assert.ok(result); assert.ok(calls.length);
  assert.equal(new Set(calls.map(call => call.text)).size, calls.length, 'every summary call has independent output');
  const checkpoint = current.events.find(event => event.seq === result.summarySeq + 1);
  assert.ok(checkpoint);
  assert.deepEqual([...checkpoint.sourceEventSeqs].sort((a, b) => a - b),
    [result.startSeq, result.summarySeq, ...result.shadowedSeqs].sort((a, b) => a - b));
  assert.deepEqual(current.state().checkpoints, [{ seq: checkpoint.seq, compactionId: result.compactionId, tier }]);
  assert.equal(current.session.surface.nodes.length, 2, 'completed compactions keep one original head and one current checkpoint');
  assert.ok(current.session.surface.nodes.includes(checkpoint.seq));
  const records = recordsOf(calls);
  if (previous) {
    assert.notEqual(result.summary[0].text, previous.result.summary[0].text);
    assert.ok(result.shadowedSeqs.includes(previous.checkpoint.seq));
    const priorBlocks = records.filter(record => record.recordType === 'source-block' && record.eventSeq === previous.checkpoint.seq);
    assert.ok(priorBlocks.length, 'this transaction must consume the immediate prior checkpoint event');
    const blocks = Map.groupBy(priorBlocks, record => record.blockIndex);
    const text = [...blocks.values()].map(parts => {
      parts.sort((a, b) => a.fragment.index - b.fragment.index);
      assert.equal(parts.length, parts[0].fragment.count);
      assert.deepEqual(parts.map(part => part.fragment.index), Array.from({ length: parts.length }, (_, index) => index + 1));
      return JSON.parse(parts.map(part => part.blockJsonPart).join('')).text;
    });
    for (const block of previous.result.summary) assert.ok(text.includes(block.text), 'the correct round must receive the previous actual summary text');
    assert.ok(checkpoint.sourceEventSeqs.includes(previous.checkpoint.seq));
    assert.ok(previous.result.shadowedSeqs.every(seq => !checkpoint.sourceEventSeqs.includes(seq)),
      'the new checkpoint cites its immediate carrier rather than copying historical ancestors');
  }
  return { checkpoint, result, records };
}

test('native manual checkpoints retain originals, direct edges and tier state across replay and forks', async () => {
  const first = await fixture();
  let restored, fork;
  try {
    first.add(12);
    const originals = [...first.events];
    const result1 = await first.compact();
    const round1 = assertCheckpointRound(first, result1, 1, first.calls);
    for (const seq of result1.shadowedSeqs) assert.ok(round1.records.some(record => record.eventSeq === seq), 'the first summary receives its original selected events');
    const prefix = [...first.events];
    const checkpoint1 = first.state().checkpoints[0];
    first.add(8, 12);
    const beforeSecond = first.calls.length;
    const result2 = await first.compact();
    const round2 = assertCheckpointRound(first, result2, 2, first.calls.slice(beforeSecond), round1);
    assert.deepEqual(first.events.slice(0, originals.length), originals);

    const expected = structuredClone(first.state());
    restored = await fixture([...first.events]);
    assert.deepEqual(restored.state().nodeChunks, expected.nodeChunks);
    assert.deepEqual(restored.state().checkpoints, expected.checkpoints);
    restored.add(5, 20);
    const result3 = await restored.compact();
    assertCheckpointRound(restored, result3, 3, restored.calls, round2);

    const seed = buildForkSeed(prefix, prefix.length - 1);
    fork = await fixture(seed);
    assert.deepEqual(fork.state().checkpoints, [checkpoint1]);
    fork.add(5, 100);
    const forkResult = await fork.compact();
    const forkRound = assertCheckpointRound(fork, forkResult, 2, fork.calls, round1);
    assert.ok(!forkRound.records.some(record => record.eventSeq === round2.checkpoint.seq), 'the fork consumes its inherited checkpoint, without the later parent carrier');
    assert.deepEqual(first.state(), expected, 'fork compaction cannot mutate parent state');
  } finally {
    if (fork) await fork.close();
    if (restored) await restored.close();
    await first.close();
  }
});

test('manual compaction accepts more than 512 original blocks through the bounded memory view', async () => {
  const current = await fixture();
  try {
    current.add(260, 0, 2);
    const result = await current.compact();
    assert.ok(result);
    assert.equal(result.shadowedSeqs.length, 259, 'native manual selection preserves its first surface node');
    assert.equal(current.state().checkpoints[0].tier, 1);
    assert.equal(current.events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user').length, 260);
    assert.ok(current.requests.length > 1 && current.requests.length <= 32);
    assert.equal(current.session.surface.nodes.length, 2);
  } finally { await current.close(); }
});
