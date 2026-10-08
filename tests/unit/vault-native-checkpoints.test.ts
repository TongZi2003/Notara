import { describe, expect, it } from 'vitest';
import type { SessionWireEvent } from '@deepseek-ai/dsh-api-session-controller';
import { analyzeNativeCheckpoints } from '../fixtures/vault-native-checkpoints.ts';

const text = (value: string) => ({ type: 'text', text: value });
function append(log: SessionWireEvent[], type: string, data: unknown, placement: { surfaceOp?: unknown; sourceEventSeqs?: unknown } = {}) {
  const event = { seq: log.length, time: 1000 + log.length, type, data, ...placement } as SessionWireEvent;
  log.push(event); return event;
}
const user = (log: SessionWireEvent[], value: string) => append(log, 'user/message', { source: { kind: 'user' }, content: [text(value)] }, { surfaceOp: 'append' });
function compact(log: SessionWireEvent[], id: string, sources: number[], turn: number | null = null) {
  if (turn !== null) append(log, 'turn/start', { turn });
  const start = append(log, 'compaction/start', { compactionId: id, turn });
  const range = { start: sources[0], end: sources.at(-1) }, summary = [text(`actual-summary-${id}`)];
  const summarized = append(log, 'compaction/summary', { compactionId: id, shadowedRange: range, shadowedSeqs: sources, summary });
  const checkpoint = append(log, 'user/message', { source: { kind: 'compact-checkpoint', compactionId: id },
    content: [text('native framing opens'), ...summary, text('native framing closes')] }, {
    surfaceOp: { op: 'replace', startSeq: range.start, endSeq: range.end }, sourceEventSeqs: [start.seq, summarized.seq, ...sources],
  });
  const end = append(log, 'compaction/end', { compactionId: id, turn });
  if (turn !== null) append(log, 'turn/end', { turn, reason: { kind: 'completed' } });
  return { start, summary: summarized, checkpoint, end };
}
function automaticThenManual() {
  const log: SessionWireEvent[] = [], first = user(log, 'round-one'), second = user(log, 'round-two');
  const third = user(log, 'round-three');
  const automatic = compact(log, 'automatic', [first.seq, second.seq], 2);
  const fourth = user(log, 'round-four');
  const manual = compact(log, 'manual', [automatic.checkpoint.seq, third.seq, fourth.seq]);
  return { log, first, second, third, fourth, automatic, manual };
}
function failure(log: SessionWireEvent[]) { try { analyzeNativeCheckpoints(log); } catch (error) { return (error as { code: string }).code; } return 'unexpected-pass'; }

describe('committed native checkpoint coverage at a fixed prefix', () => {
  it('recognizes original users folded by an automatic checkpoint before the planned manual checkpoint', () => {
    const f = automaticThenManual(), graph = analyzeNativeCheckpoints(f.log), committed = graph.checkpoint(f.manual.checkpoint.seq);
    expect(committed.shadowedSeqs[0]).toBeGreaterThan(committed.shadowedSeqs[1]!); // Actual surface order can be nonmonotonic in event seq.
    expect(committed.shadowedSeqs).not.toContain(f.first.seq);
    expect([...graph.coverage(committed.checkpointSeq)].sort((a, b) => a - b)).toEqual([f.first.seq, f.second.seq, f.automatic.checkpoint.seq, f.third.seq, f.fourth.seq].sort((a, b) => a - b));
    expect(committed).toMatchObject({ depth: 2, tier: 2, startSeq: f.manual.start.seq, endSeq: f.manual.end.seq });
    expect(graph.surfaceSeqs).toEqual([committed.checkpointSeq]);
    expect(graph.coverage(committed.checkpointSeq).has(f.manual.start.seq)).toBe(false);
    expect(graph.coverage(committed.checkpointSeq).has(f.manual.summary.seq)).toBe(false);
  });

  it('counts every automatic child and preserves the actual nested prior checkpoint instead of planned ordinal depth', () => {
    const f = automaticThenManual();
    const extra = user(f.log, 'new evidence'), nextAuto = compact(f.log, 'next-auto', [f.manual.checkpoint.seq, extra.seq], 3);
    const final = compact(f.log, 'second-planned-manual', [nextAuto.checkpoint.seq]), graph = analyzeNativeCheckpoints(f.log);
    expect(graph.checkpoint(final.checkpoint.seq)).toMatchObject({ depth: 4, tier: 3 });
    expect(graph.coverage(final.checkpoint.seq).has(f.manual.checkpoint.seq)).toBe(true);
    expect(graph.coverage(final.checkpoint.seq).has(f.first.seq)).toBe(true);
  });

  it('keeps an untouched raw source distinct from a checkpoint folded source', () => {
    const log: SessionWireEvent[] = [], retained = user(log, 'raw retained'), folded = user(log, 'folded');
    const committed = compact(log, 'partial', [folded.seq]), graph = analyzeNativeCheckpoints(log);
    expect(graph.surfaceSeqs).toContain(retained.seq); expect(graph.coverage(committed.checkpoint.seq).has(retained.seq)).toBe(false);
    expect(graph.coverage(committed.checkpoint.seq).has(folded.seq)).toBe(true);
    expect(() => graph.checkpoint(999)).toThrow('NATIVE_CHECKPOINT_NOT_FOUND');
  });

  it('rejects a prefix gap and a forged omitted node in the current surface span', () => {
    const gap = automaticThenManual(); gap.log.splice(1, 1); expect(failure(gap.log)).toBe('NATIVE_CHECKPOINT_PREFIX_GAP');
    const omitted = automaticThenManual();
    (omitted.manual.summary.data as { shadowedSeqs: number[] }).shadowedSeqs = [omitted.automatic.checkpoint.seq, omitted.fourth.seq];
    expect(failure(omitted.log)).toBe('NATIVE_CHECKPOINT_SURFACE_MISMATCH');
  });

  it('rejects missing direct edges, invented ancestor edges, forward references and cyclic self references', () => {
    for (const mode of ['missing', 'ancestor', 'forward', 'cycle']) {
      const f = automaticThenManual(), edges = [...f.manual.checkpoint.sourceEventSeqs as number[]];
      if (mode === 'missing') edges.splice(edges.indexOf(f.automatic.checkpoint.seq), 1);
      else edges.push(mode === 'ancestor' ? f.first.seq : mode === 'forward' ? f.manual.end.seq : f.manual.checkpoint.seq);
      (f.manual.checkpoint as { sourceEventSeqs: number[] }).sourceEventSeqs = edges;
      expect(failure(f.log), mode).toBe('NATIVE_CHECKPOINT_SOURCE_EDGE_MISMATCH');
    }
  });

  it('rejects a mismatched replacement body, failed commit and incomplete transaction', () => {
    const wrongText = automaticThenManual(); (wrongText.manual.checkpoint.data as { content: unknown[] }).content = [text('fabricated summary')];
    expect(failure(wrongText.log)).toBe('NATIVE_CHECKPOINT_REPLACEMENT_TEXT_MISMATCH');
    const failed = automaticThenManual(); (failed.manual.end.data as { error?: unknown }).error = { message: 'synthetic persistence failure' };
    expect(failure(failed.log)).toBe('NATIVE_CHECKPOINT_NOT_COMMITTED');
    const incomplete = automaticThenManual(); incomplete.log.pop(); expect(failure(incomplete.log)).toBe('NATIVE_CHECKPOINT_NOT_COMMITTED');
    const mismatched = automaticThenManual(); (mismatched.manual.end.data as { compactionId: string }).compactionId = 'foreign-transaction';
    expect(failure(mismatched.log)).toBe('NATIVE_CHECKPOINT_INVALID_END');
  });
});
