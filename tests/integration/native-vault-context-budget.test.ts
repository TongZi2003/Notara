import { expect, test } from 'vitest';
import type { SessionPage } from '@deepseek-ai/dsh-api-session-controller';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault, type AssembledRequest, type ScriptedReply } from '../fixtures/vault-http.ts';
import { VAULT_TEST_PROVIDER, VAULT_SOLVER_PROVIDER, VAULT_SOLVER_MODEL } from '../../scripts/fixtures/vault-test-model.ts';
// @ts-expect-error Host plugin JS has focused sibling tests.
import { createRequestPricer, planBudget } from '../../examples/native-vault/context-budget-plan.js';

test('standing teacher budget owns concurrent classrooms and survives cancellation and model change', async () => {
  const runtime = await startVaultIsolated({ testModel: true });
  const host = await connectVault(runtime);
  const price = createRequestPricer({ imageRequestPricing: () => null, fileRequestText: () => '' });
  const requestPrice = (row: AssembledRequest) => price({ messages: row.messages, tools: row.toolSchemas });
  const scripts: Record<string, ScriptedReply> = {};
  async function events(sessionId: string) {
    const cut = host.value(await host.rpc<{ asOfSeq: number }>('session/projections', { request: { sessionId } }));
    return host.value(await host.rpc<SessionPage>('session/page', {
      request: { address: { kind: 'session', sessionId }, throughSeq: cut.asOfSeq, maxMessages: 1000 },
    })).records.flatMap(row => row.type === 'event' ? [row.event] : []);
  }
  try {
    const ids = await Promise.all(Array.from({ length: 12 }, () => host.createSession('notara-teacher')));
    const warmups = ids.map((_, i) => `CB-${i}-warmup`);
    for (const text of warmups) scripts[text] = '合成短回复。';
    await host.script(scripts);
    const initial = await Promise.all(ids.map((id, i) => host.ask(id, warmups[i]!)));
    const caps = initial.map(rows => planBudget({ contextWindow: 128000,
      maxTokens: (rows[0] as AssembledRequest & { maxTokens: number }).maxTokens }).inputCap);
    const sizes = initial.map((rows, i) => {
      const baseline = requestPrice(rows[0]!);
      expect(baseline).toBeLessThan(caps[i]! * .9);
      return Math.floor((caps[i]! - baseline) * .22 / 1.5);
    });
    const prompts = ids.map((_, i) => Array.from({ length: 6 }, (_, round) =>
      `CB-${i}-round-${round}:` + '合'.repeat(sizes[i]!)));
    for (const list of prompts) for (const text of list) scripts[text] = '合成短回复。';
    // All classrooms share one fixture file; write once before concurrent turns.
    await host.script(scripts);
    for (let round = 0; round < 6; round++) {
      const batches = await Promise.all(ids.map((id, i) => host.ask(id, prompts[i]![round]!)));
      for (const [i, rows] of batches.entries()) {
        expect(rows).toHaveLength(1);
        const row = rows[0]!;
        const latest = row.messages.findLast(m => m.role === 'user' && m.source?.kind === 'user');
        expect(latest?.content.map(b => b.text ?? '').join('\n')).toBe(prompts[i]![round]);
        expect(requestPrice(row)).toBeLessThanOrEqual(caps[i]!);
        for (let other = 0; other < ids.length; other++) if (other !== i) {
          expect(JSON.stringify(row.messages)).not.toContain(`CB-${other}-`);
        }
      }
    }
    const requests = await host.requests();
    for (const [i, id] of ids.entries()) {
      expect(requests.some(row => row.sessionId === id && row.purpose === 'compaction')).toBe(true);
      const log = await events(id);
      const inputs = log.filter(row => row.type === 'user/message').map(row => row.data as {
        source: { kind: string }; content: { type: string; text?: string }[];
      }).filter(row => row.source.kind === 'user');
      expect(inputs.map(row => row.content.map(b => b.text ?? '').join('\n'))).toEqual([warmups[i], ...prompts[i]!]);
      expect(log.filter(row => row.type === 'compaction/start').length)
        .toBe(log.filter(row => row.type === 'compaction/end').length);
      expect(log.some(row => row.type === 'compaction/summary')).toBe(true);
      expect(log.some(row => row.type === 'assistant/attempt')).toBe(false);
      expect(log.filter(row => row.type === 'turn/end').some(row =>
        (row.data as { reason: { kind: string } }).reason.kind === 'error')).toBe(false);
    }
    expect(requests.every(row => [VAULT_TEST_PROVIDER, VAULT_SOLVER_PROVIDER].includes(row.provider))).toBe(true);
    const canceled = ids[0]!;
    const text = 'CB-0-cancel';
    await host.scriptOne(text, { text: 'CB-0-must-not-complete', pauseMs: 20000 });
    const before = (await host.turns(canceled)).length;
    host.value(await host.rpc('session/prompt', { request: {
      sessionId: canceled, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text }],
    } }));
    await expect.poll(async () => (await host.turns(canceled)).length).toBeGreaterThan(before);
    host.value(await host.rpc('session/cancel', { request: { sessionId: canceled } }));
    await expect.poll(async () => (await host.sessions()).find(row => row.sessionId === canceled)?.running).not.toBe(true);
    host.value(await host.rpc('session/selectModel', { request: {
      sessionId: canceled, provider: VAULT_SOLVER_PROVIDER, model: VAULT_SOLVER_MODEL, reasoningEffort: 'low',
    } }));
    await host.scriptOne('__solver', '换模型后继续合成课堂。');
    const [continued] = await host.ask(canceled, 'CB-0-resume');
    expect(continued).toMatchObject({ provider: VAULT_SOLVER_PROVIDER, model: VAULT_SOLVER_MODEL });
    expect(requestPrice(continued!)).toBeLessThanOrEqual(caps[0]!);
    const log = await events(canceled);
    expect(log.filter(row => row.type === 'user/message').filter(row =>
      JSON.stringify(row.data).includes('CB-0-cancel'))).toHaveLength(1);
    expect(log.filter(row => row.type === 'assistant/message').some(row =>
      JSON.stringify(row.data).includes('CB-0-must-not-complete'))).toBe(false);
  } finally {
    await host.close();
    await runtime.stop();
  }
}, 180000);
