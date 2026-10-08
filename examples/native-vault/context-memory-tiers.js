import { z } from 'zod';
import { isSurfaceEvent } from '@deepseek-ai/dsh-session/surface';

const seq = z.number().int().nonnegative();
const tier = z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable();
const equal = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
const NODE_CHUNK_SIZE = 256;

export const checkpointSurfaceNodes = state => state.nodeChunks.flat();
export function checkpointSurfaceMatches(state, nodes) {
  if (!state || state.nodeCount !== nodes.length) return false;
  let position = 0;
  for (const chunk of state.nodeChunks) for (const seq of chunk) if (nodes[position++] !== seq) return false;
  return position === nodes.length;
}

function appendNode(chunks, seq) {
  const last = chunks.at(-1);
  if (!last || last.length === NODE_CHUNK_SIZE) return [...chunks, [seq]];
  return [...chunks.slice(0, -1), [...last, seq]];
}

function chunkNodes(nodes) {
  const chunks = [];
  for (let i = 0; i < nodes.length; i += NODE_CHUNK_SIZE) chunks.push(nodes.slice(i, i + NODE_CHUNK_SIZE));
  return chunks;
}

function span(nodes, start, end) {
  const first = nodes.indexOf(start), last = nodes.indexOf(end);
  if (first < 0 || last < first) throw new Error('context memory: invalid native surface range');
  return { first, last, seqs: nodes.slice(first, last + 1) };
}

/** Only current carriers are cached; their historical child edges remain in DSH. */
export function applyCheckpointTiers(state, event) {
  const pending = state.pending?.summarySeq === event.seq - 1 ? state.pending : null;
  if (event.type === 'compaction/summary') {
    const data = event.data;
    const selected = span(checkpointSurfaceNodes(state), data.shadowedRange.start, data.shadowedRange.end);
    const selectedSet = new Set(selected.seqs);
    const children = state.checkpoints.filter(row => selectedSet.has(row.seq));
    const highest = Math.max(0, ...children.map(row => row.tier ?? 3));
    return { ...state, pending: { compactionId: data.compactionId, summarySeq: event.seq,
      start: data.shadowedRange.start, end: data.shadowedRange.end, count: selected.seqs.length,
      tier: equal(selected.seqs, data.shadowedSeqs) ? Math.min(3, highest + 1) : null } };
  }
  if (!isSurfaceEvent(event)) return state.pending === null ? state : { ...state, pending: null };
  const op = event.surfaceOp;
  const nodes = op === 'append' ? null : checkpointSurfaceNodes(state);
  const selected = nodes === null ? null : span(nodes, op.startSeq, op.endSeq);
  const removedSeqs = new Set(selected?.seqs ?? []);
  const removed = state.checkpoints.filter(row => removedSeqs.has(row.seq));
  const checkpoints = state.checkpoints.filter(row => !removedSeqs.has(row.seq));
  const source = event.type === 'user/message' && event.data.source.kind === 'compact-checkpoint' ? event.data.source : null;
  if (source) {
    let tier = null;
    if (selected && pending && source.compactionId === pending.compactionId
      && op.startSeq === pending.start && op.endSeq === pending.end && selected.seqs.length === pending.count
      && event.sourceEventSeqs?.includes(pending.summarySeq)
      && selected.seqs.every(seq => event.sourceEventSeqs.includes(seq))) tier = pending.tier;
    else if (selected?.seqs.length === 1 && removed.length === 1 && removed[0].compactionId === source.compactionId) tier = removed[0].tier;
    checkpoints.push({ seq: event.seq, compactionId: source.compactionId, tier });
  }
  const nodeChunks = nodes === null ? appendNode(state.nodeChunks, event.seq)
    : chunkNodes([...nodes.slice(0, selected.first), event.seq, ...nodes.slice(selected.last + 1)]);
  return { nodeChunks, nodeCount: state.nodeCount + 1 - (selected?.seqs.length ?? 0), checkpoints, pending: null };
}

export const checkpointTiersProjection = {
  key: 'notaraContextTiers', stateVersion: 2,
  stateSchema: z.object({ nodeChunks: z.array(z.array(seq).min(1).max(NODE_CHUNK_SIZE)), nodeCount: seq,
    checkpoints: z.array(z.object({ seq, compactionId: z.string(), tier })),
    pending: z.object({ compactionId: z.string(), summarySeq: seq, start: seq, end: seq,
      count: z.number().int().positive(), tier }).nullable() }),
  init: () => ({ nodeChunks: [], nodeCount: 0, checkpoints: [], pending: null }),
  apply: applyCheckpointTiers,
};
