import type { SessionWireEvent } from '@deepseek-ai/dsh-api-session-controller';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { validateSurfaceMetadata } from '@deepseek-ai/dsh-session/surface';

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const position = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && !Object.is(value, -0);
const same = (left: readonly number[], right: readonly number[]) => left.length === right.length && left.every((seq, index) => seq === right[index]);
function requireFact(value: unknown, code: string): asserts value { if (!value) throw Object.assign(new Error(code), { code }); }
function sequences(value: unknown): number[] {
  requireFact(Array.isArray(value) && value.length > 0 && value.every(position) && new Set(value).size === value.length, 'NATIVE_CHECKPOINT_INVALID_SOURCES');
  return [...value];
}
function span(nodes: readonly number[], start: unknown, end: unknown) {
  requireFact(position(start) && position(end), 'NATIVE_CHECKPOINT_INVALID_RANGE');
  const first = nodes.indexOf(start), last = nodes.indexOf(end);
  requireFact(first >= 0 && last >= first, 'NATIVE_CHECKPOINT_INVALID_RANGE');
  return { first, last, seqs: nodes.slice(first, last + 1) };
}

export interface NativeCommittedCheckpoint {
  readonly compactionId: string;
  readonly startSeq: number;
  readonly summarySeq: number;
  readonly checkpointSeq: number;
  readonly endSeq: number;
  /** Actual graph depth includes automatic checkpoints; the native tier caps at 3. */
  readonly depth: number;
  readonly tier: number;
  readonly shadowedSeqs: readonly number[];
  readonly sourceEventSeqs: readonly number[];
}

/** Analyze one dense, fixed native prefix. Never add sources inferred from text or planned round numbers. */
export function analyzeNativeCheckpoints(events: readonly SessionWireEvent[]) {
  const nodes: number[] = [], checkpoints = new Map<number, NativeCommittedCheckpoint>(), ids = new Set<string>();
  let openTurn: number | null = null;
  let open: { start: SessionWireEvent; summary?: SessionWireEvent; shadowed?: number[]; replacement?: SessionWireEvent } | undefined;
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    requireFact(event.seq === index && position(event.seq), 'NATIVE_CHECKPOINT_PREFIX_GAP');
    const data = object(event.data), source = object(data.source);
    if (event.type === 'turn/start') {
      requireFact(!open && openTurn === null && position(data.turn), 'NATIVE_CHECKPOINT_TURN_MISMATCH'); openTurn = data.turn;
    } else if (event.type === 'turn/end') {
      requireFact(!open && openTurn !== null && data.turn === openTurn, 'NATIVE_CHECKPOINT_TURN_MISMATCH'); openTurn = null;
    } else if (event.type === 'compaction/start') {
      requireFact(!open && data.turn === openTurn && typeof data.compactionId === 'string' && data.compactionId.length > 0 && !ids.has(data.compactionId)
        && (data.sourceCommandId === undefined || (typeof data.sourceCommandId === 'string' && data.sourceCommandId.length > 0)), 'NATIVE_CHECKPOINT_INVALID_START');
      ids.add(data.compactionId); open = { start: event };
    } else if (event.type === 'compaction/summary') {
      requireFact(open && !open.summary && data.compactionId === object(open.start.data).compactionId
        && data.sourceCommandId === object(open.start.data).sourceCommandId, 'NATIVE_CHECKPOINT_INVALID_SUMMARY');
      const shadowed = sequences(data.shadowedSeqs), range = object(data.shadowedRange), selected = span(nodes, range.start, range.end);
      requireFact(same(shadowed, selected.seqs), 'NATIVE_CHECKPOINT_SURFACE_MISMATCH');
      requireFact(Array.isArray(data.summary) && data.summary.length > 0
        && data.summary.every(block => object(block).type === 'text' && typeof object(block).text === 'string'), 'NATIVE_CHECKPOINT_INVALID_SUMMARY');
      open.summary = event; open.shadowed = shadowed;
    } else if (event.type === 'user/message' && source.kind === 'compact-checkpoint') {
      requireFact(open?.summary && open.shadowed && !open.replacement && event.seq === open.summary.seq + 1
        && source.compactionId === object(open.start.data).compactionId
        && source.sourceCommandId === object(open.start.data).sourceCommandId, 'NATIVE_CHECKPOINT_INVALID_REPLACEMENT');
      const range = object(object(open.summary.data).shadowedRange), op = object(event.surfaceOp);
      requireFact(op.op === 'replace' && op.startSeq === range.start && op.endSeq === range.end, 'NATIVE_CHECKPOINT_REPLACEMENT_RANGE_MISMATCH');
      const sources = sequences(event.sourceEventSeqs), expected = [open.start.seq, open.summary.seq, ...open.shadowed];
      requireFact(sources.every(seq => seq < event.seq)
        && same([...sources].sort((a, b) => a - b), [...expected].sort((a, b) => a - b)), 'NATIVE_CHECKPOINT_SOURCE_EDGE_MISMATCH');
      const content = data.content;
      requireFact(Array.isArray(content) && content.every(block => object(block).type === 'text' && typeof object(block).text === 'string'), 'NATIVE_CHECKPOINT_INVALID_REPLACEMENT');
      const text = content.map(block => object(block).text), summary = object(open.summary.data).summary as unknown[];
      const summaryText = summary.map(block => object(block).text);
      requireFact(text.some((_, start) => summaryText.every((value, offset) => text[start + offset] === value)), 'NATIVE_CHECKPOINT_REPLACEMENT_TEXT_MISMATCH');
      open.replacement = event;
    } else if (event.type === 'compaction/end') {
      requireFact(open && data.compactionId === object(open.start.data).compactionId
        && data.turn === object(open.start.data).turn && data.sourceCommandId === object(open.start.data).sourceCommandId, 'NATIVE_CHECKPOINT_INVALID_END');
      if (open.summary) {
        requireFact(open.replacement && open.shadowed && event.seq === open.replacement.seq + 1 && data.error === undefined, 'NATIVE_CHECKPOINT_NOT_COMMITTED');
        let depth = 1;
        for (const seq of open.shadowed) {
          const child = events[seq]!;
          requireFact(seq < open.summary.seq && child, 'NATIVE_CHECKPOINT_INVALID_SOURCES');
          if (child.type === 'user/message' && object(object(child.data).source).kind === 'compact-checkpoint') {
            const known = checkpoints.get(seq); requireFact(known, 'NATIVE_CHECKPOINT_MISSING_CHILD'); depth = Math.max(depth, known.depth + 1);
          }
        }
        checkpoints.set(open.replacement.seq, { compactionId: data.compactionId as string, startSeq: open.start.seq,
          summarySeq: open.summary.seq, checkpointSeq: open.replacement.seq, endSeq: event.seq, depth, tier: Math.min(3, depth),
          shadowedSeqs: [...open.shadowed], sourceEventSeqs: sequences(open.replacement.sourceEventSeqs) });
      } else requireFact(data.error !== undefined && !open.replacement, 'NATIVE_CHECKPOINT_NOT_COMMITTED');
      open = undefined;
    }
    // Replay only native placement metadata: message-content projections never
    // change node positions and are not needed to establish checkpoint coverage.
    let op;
    try { op = validateSurfaceMetadata(event as unknown as SessionEvent); }
    catch { throw Object.assign(new Error('NATIVE_CHECKPOINT_INVALID_SURFACE'), { code: 'NATIVE_CHECKPOINT_INVALID_SURFACE' }); }
    if (op === 'append') nodes.push(event.seq);
    else if (op !== undefined) {
      const selected = span(nodes, op.startSeq, op.endSeq), sources = sequences(event.sourceEventSeqs);
      requireFact(selected.seqs.every(seq => sources.includes(seq)), 'NATIVE_CHECKPOINT_INVALID_SURFACE');
      nodes.splice(selected.first, selected.seqs.length, event.seq);
    }
  }
  requireFact(!open, 'NATIVE_CHECKPOINT_NOT_COMMITTED');
  const checkpoint = (seq: number) => {
    const found = checkpoints.get(seq); requireFact(found, 'NATIVE_CHECKPOINT_NOT_FOUND'); return found;
  };
  const coverage = (seq: number): ReadonlySet<number> => {
    const captured = new Set<number>(), pending = [...checkpoint(seq).shadowedSeqs];
    while (pending.length) {
      const childSeq = pending.pop()!; if (captured.has(childSeq)) continue; captured.add(childSeq);
      const child = checkpoints.get(childSeq); if (child) pending.push(...child.shadowedSeqs);
    }
    return captured;
  };
  return { checkpoints: checkpoints as ReadonlyMap<number, NativeCommittedCheckpoint>, surfaceSeqs: [...nodes] as readonly number[], checkpoint, coverage };
}
