import { expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import { startVaultIsolated } from '../../scripts/dev-isolated.ts';
import { connectVault, type ScriptedReply } from '../fixtures/vault-http.ts';
import { captureNativeCut, readNativeEvents, waitForNativeTurn } from '../fixtures/vault-native-turns.ts';
import { contextContinuityScenario, createContinuityProbeReview,
  type ContinuityRoundId, type ContinuityCheckpoint, type ContinuityProbeReview } from '../fixtures/context-continuity-scenario.ts';

type NativeTurn = Awaited<ReturnType<typeof waitForNativeTurn>>;
interface SummaryData { compactionId: string; shadowedSeqs: number[]; shadowedRange: { start: number; end: number } }
interface CheckpointMessage { source: { kind: string; compactionId?: string }; content: { type: string; text?: string }[] }
interface ReadReceipt { seq: number; format: string; done: boolean; record: { seq: number; blocks: { type: string; text?: string }[] } }
interface SearchReceipt { hits: { seq: number }[] }
interface CheckpointEvidence { id: string; compactionId: string; summarySeq: number; checkpointSeq: number;
  shadowedSeqs: number[]; sourceEventSeqs: number[]; checkpointDataHash: string; depth: number }

// This test deliberately offers the observer no model capture/script methods.
// It proves the native measurement path needed by later real-model acceptance;
// scripted replies and scripted tool choices never receive a semantic PASS.
test('native observation rehearses three nested checkpoints without relying on synthetic request logs', async () => {
  const runtime = await startVaultIsolated({ testModel: true });
  let host = await connectVault(runtime);
  const pages: { throughSeq: number; beforeSeq?: number; maxMessages: number }[] = [];
  const observer = {
    async rpc<T>(method: string, args: unknown): Promise<RemoteResult<T>> {
      if (method === 'session/page') {
        const { request } = args as { request: { throughSeq: number; beforeSeq?: number; maxMessages: number } };
        pages.push({ throughSeq: request.throughSeq, maxMessages: request.maxMessages,
          ...(request.beforeSeq === undefined ? {} : { beforeSeq: request.beforeSeq }) });
      }
      return host.rpc<T>(method, args);
    },
    value<T>(result: RemoteResult<T>): T { return host.value(result); },
    sessions: () => host.sessions(),
  };
  const rounds = new Map<ContinuityRoundId, NativeTurn>();
  const checkpoints: CheckpointEvidence[] = [];
  const probes: ContinuityProbeReview[] = [];
  const transcript: { id: ContinuityRoundId; input: string; turn: number; userSeq: number; endSeq: number; answer: string }[] = [];
  const report: Record<string, unknown> = { scenario: contextContinuityScenario.id,
    runKind: 'scripted-native-integration', status: 'RUNNING', semanticQuality: 'not-run', autonomousRetrieval: 'not-run',
    checkpoints, probes, transcript };
  const reportDirectory = resolve('.runtime/context-native');

  async function prompt(sessionId: string, input: string, reply: ScriptedReply): Promise<NativeTurn> {
    await host.scriptOne(input, reply);
    const baseline = await captureNativeCut(observer, sessionId), requestId = randomUUID();
    host.value(await host.rpc('session/prompt', { request: { sessionId, requestId,
      mode: 'queue', content: [{ type: 'text', text: input }] } }));
    return waitForNativeTurn(observer, sessionId, baseline, { requestId, timeoutMs: 30_000, pollMs: 30, pageMessages: 2 });
  }

  async function compact(sessionId: string, plan: ContinuityCheckpoint): Promise<void> {
    await expect.poll(async () => (await host.sessions()).find(row => row.sessionId === sessionId)?.running).toBe(false);
    const before = await captureNativeCut(observer, sessionId);
    host.value(await host.rpc('commands/execute', { agentId: sessionId, line: '/compact', submittedAttachments: [] }));
    const events = await readNativeEvents(observer, sessionId, undefined, before.asOfSeq, { pageMessages: 2 });
    const summaries = events.filter(event => event.type === 'compaction/summary');
    expect(summaries, 'one committed summary, not merely an accepted command').toHaveLength(1);
    const summary = summaries[0]!, data = summary.data as unknown as SummaryData;
    const replacement = events.find(event => event.type === 'user/message'
      && (event.data as unknown as CheckpointMessage).source.kind === 'compact-checkpoint'
      && (event.data as unknown as CheckpointMessage).source.compactionId === data.compactionId);
    expect(replacement).toBeDefined();
    const sources = replacement!.sourceEventSeqs as number[];
    expect(sources).toEqual(expect.arrayContaining([summary.seq, ...data.shadowedSeqs]));
    expect(replacement!.surfaceOp).toMatchObject({ op: 'replace', startSeq: data.shadowedRange.start, endSeq: data.shadowedRange.end });
    for (const round of plan.requiredSourceRounds) {
      expect(data.shadowedSeqs, `source ${round} really left the active surface`).toContain(rounds.get(round)!.userSeq);
    }
    const previous = plan.requiredPriorCheckpoint === undefined ? undefined
      : checkpoints.find(checkpoint => checkpoint.id === plan.requiredPriorCheckpoint);
    if (plan.requiredPriorCheckpoint !== undefined) {
      expect(previous).toBeDefined();
      expect(data.shadowedSeqs, 'new summary actually consumes the prior checkpoint').toContain(previous!.checkpointSeq);
      expect(sources).toContain(previous!.checkpointSeq);
    }
    expect(events.some(event => event.type === 'compaction/end')).toBe(true);
    checkpoints.push({ id: plan.id, compactionId: data.compactionId, summarySeq: summary.seq, checkpointSeq: replacement!.seq,
      shadowedSeqs: data.shadowedSeqs, sourceEventSeqs: sources,
      checkpointDataHash: createHash('sha256').update(JSON.stringify(replacement!.data)).digest('hex'), depth: (previous?.depth ?? 0) + 1 });
  }

  try {
    const sessionId = await host.createSession();
    for (const round of contextContinuityScenario.rounds) {
      const original = rounds.get('round-4');
      const reply: ScriptedReply = round.probeAfter ? { calls: [
        { name: 'history_search', arguments: { query: '绿色标签' } },
        { name: 'history_read', arguments: { seq: original!.userSeq } },
      ], text: `合成检查 ${round.id} 已收到原生工具结果。` } : `合成回复 ${round.id}，只用于验证事件和压缩接线。`;
      const turn = await prompt(sessionId, round.input, reply);
      expect(turn.status, JSON.stringify(turn.reason)).toBe('completed');
      expect(turn.reason).toMatchObject({ kind: 'completed' });
      expect(turn.userSeq).toBeGreaterThan(turn.startSeq);
      expect(turn.endSeq).toBeGreaterThan(turn.userSeq);
      expect(turn.unpairedToolResults).toEqual([]);
      rounds.set(round.id, turn);
      transcript.push({ id: round.id, input: round.input, turn: turn.turn, userSeq: turn.userSeq,
        endSeq: turn.endSeq, answer: turn.assistantText });
      if (round.probeAfter) {
        const search = turn.toolOutcomes.find(outcome => outcome.name === 'history_search');
        const read = turn.toolOutcomes.find(outcome => outcome.name === 'history_read');
        expect(search?.failed).toBe(false); expect(read?.failed).toBe(false);
        expect((JSON.parse(search!.text) as SearchReceipt).hits.some(hit => hit.seq === original!.userSeq)).toBe(true);
        const result = JSON.parse(read!.text) as ReadReceipt;
        expect(result).toMatchObject({ seq: original!.userSeq, format: 'canonical-record', done: true });
        const sourceRound = contextContinuityScenario.rounds.find(row => row.id === 'round-4')!;
        expect(result.record.blocks.filter(block => block.type === 'text').map(block => block.text).join('')).toBe(sourceRound.input);
        const review = createContinuityProbeReview(round.id, 'scripted-native-integration');
        review.nativeArchiveRead = { status: 'pass', originalSeq: original!.userSeq,
          searchCallSeq: search!.callSeq, readCallSeq: read!.callSeq, readResultSeq: read!.resultSeq,
          canonicalHash: createHash('sha256').update(JSON.stringify(result.record)).digest('hex'),
          notes: 'Scripted tool choice; native same-session call/result pairing and exact canonical source verified.' };
        review.modelAutonomousRetrieval.notes = 'Not evaluated: this fixture scripted the tool calls.';
        probes.push(review);
      }
      const plan = contextContinuityScenario.checkpoints.find(checkpoint => checkpoint.afterRound === round.id);
      if (plan) await compact(sessionId, plan);
      // Recheck the durable source chain and original reads after a real Host restart.
      if (round.id === 'round-11') { await host.close(); await runtime.restart(); host = await connectVault(runtime); }
    }
    expect(checkpoints.map(checkpoint => checkpoint.depth)).toEqual([1, 2, 3]);
    const log = await readNativeEvents(observer, sessionId, undefined, -1, { pageMessages: 2 });
    for (const checkpoint of checkpoints) {
      const summary = log.find(event => event.seq === checkpoint.summarySeq)!;
      expect(summary.type).toBe('compaction/summary');
      const data = summary.data as unknown as SummaryData;
      expect(data).toMatchObject({ compactionId: checkpoint.compactionId, shadowedSeqs: checkpoint.shadowedSeqs });
      const replacement = log.find(event => event.seq === checkpoint.checkpointSeq)!;
      expect(replacement.type).toBe('user/message');
      expect(replacement.sourceEventSeqs).toEqual(checkpoint.sourceEventSeqs);
      expect(replacement.surfaceOp).toMatchObject({ op: 'replace', startSeq: data.shadowedRange.start, endSeq: data.shadowedRange.end });
      expect(createHash('sha256').update(JSON.stringify(replacement.data)).digest('hex')).toBe(checkpoint.checkpointDataHash);
    }
    for (const [id, turn] of rounds) {
      const original = log.find(event => event.seq === turn.userSeq)!;
      expect(original.type).toBe('user/message');
      expect((original.data as unknown as CheckpointMessage).content.map(block => block.text ?? '').join(''))
        .toBe(contextContinuityScenario.rounds.find(round => round.id === id)!.input);
    }
    expect(pages.some(page => page.beforeSeq !== undefined), 'exercise real backwards pagination').toBe(true);
    expect(pages.every(page => page.maxMessages === 2)).toBe(true);
    expect(probes).toHaveLength(3);
    expect(probes.every(probe => probe.humanReview.status === 'not-run'
      && probe.modelAutonomousRetrieval.status === 'not-run')).toBe(true);

    const refused = await prompt(sessionId, '合成服务商拒绝请求', { fail: { message: 'Synthetic refusal.', code: 'SYNTHETIC_PROVIDER_FAILURE' } });
    expect(refused.status).toBe('failed'); expect(refused.reason).toMatchObject({ kind: 'error' });
    report.providerFailure = { status: refused.status, reason: refused.reason };

    const cancelText = '合成请求等待取消';
    await host.scriptOne(cancelText, { text: '不应完成的合成回复', pauseMs: 20_000 });
    const cancelBaseline = await captureNativeCut(observer, sessionId), cancelRequestId = randomUUID();
    host.value(await host.rpc('session/prompt', { request: { sessionId, requestId: cancelRequestId,
      mode: 'queue', content: [{ type: 'text', text: cancelText }] } }));
    await expect.poll(async () => (await readNativeEvents(observer, sessionId, undefined, cancelBaseline.asOfSeq, { pageMessages: 2 }))
      .some(event => event.type === 'user/message'
        && (event.data as unknown as { source: { rpcId?: string } }).source.rpcId === cancelRequestId), { timeout: 10_000 }).toBe(true);
    host.value(await host.rpc('session/cancel', { request: { sessionId } }));
    const canceled = await waitForNativeTurn(observer, sessionId, cancelBaseline,
      { requestId: cancelRequestId, timeoutMs: 30_000, pollMs: 30, pageMessages: 2 });
    expect(canceled.status).toBe('failed'); expect(canceled.reason).toMatchObject({ kind: 'aborted' });
    expect(canceled.assistantText).not.toContain('不应完成');
    report.cancellation = { status: canceled.status, reason: canceled.reason };
    const continued = await prompt(sessionId, '取消后继续合成验收', '取消后原生回合继续。');
    expect(continued.status).toBe('completed');
    expect(continued.assistantText).toContain('取消后原生回合继续。');
    report.status = 'PASS'; report.pageRequests = pages.length;
  } catch (error) {
    report.status = 'FAIL'; report.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    try { await host.close(); } finally { await runtime.stop(); }
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(resolve(reportDirectory, 'history-continuity-rehearsal.json'), JSON.stringify(report, null, 2) + '\n');
  }
}, 180_000);
