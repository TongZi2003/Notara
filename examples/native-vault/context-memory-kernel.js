// Transaction-local Billion adaptation. DSH owns the durable log and commits.
// NativeContextMemory validates the full event manifest and expands local aliases.
// Text atoms alone cannot prove multi-block completeness or restore images/replay.
import { createCore, createInitialState, defaultConfig, assignRefs } from './billion-kernel/index.js';

export const FRONTIER_ATOM_LIMIT = 512;
export const FRONTIER_BYTE_LIMIT = 2 * 1024 * 1024;
export const KERNEL_SUMMARY_CHAR_LIMIT = 262144;
const keyOf = atom => `native:${atom.seq}:${atom.blockIndex}`;
const fail = message => { throw new Error(`billion-native-bridge: ${message}`); };
const equalSets = (actual, expected) => actual.length === new Set(actual).size
  && actual.length === expected.length && actual.every(id => expected.includes(id));
const config = defaultConfig(128000, {
  preserveRecentMessages: 0, preserveRecentTokens: 0, protectedTools: [], protectedLatestTools: [],
  compress: { minCompressRange: 0, minSummaryLength: 0, maxSummaryLength: KERNEL_SUMMARY_CHAR_LIMIT },
  ccr: { enabled: false }, absorb: { enabled: false }, crush: { enabled: false },
});
const realCore = createCore();

/** Copy only the bounded native frontier. Archive/ancestor arrays are not an input. */
export function snapshotFrontier(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > FRONTIER_ATOM_LIMIT) fail('frontier must contain 1..512 atoms');
  const atoms = [];
  const completedSeqs = new Set();
  const identities = new Set();
  const checkpointSeqs = new Map();
  let previousSeq;
  let expectedBlockIndex = 0;
  let bytes = 0;
  for (const source of input) {
    if (!Number.isSafeInteger(source.seq) || source.seq < 0
      || !Number.isSafeInteger(source.blockIndex) || source.blockIndex < 0) fail('invalid native identity');
    if (!['user', 'assistant', 'tool', 'system'].includes(source.role) || typeof source.text !== 'string') fail('invalid native role/text');
    if (source.seq !== previousSeq) {
      if (completedSeqs.has(source.seq)) fail('one native event appears in separated frontier positions');
      if (previousSeq !== undefined) completedSeqs.add(previousSeq);
      expectedBlockIndex = 0;
    }
    if (source.blockIndex !== expectedBlockIndex++) fail('frontier must include every block of each native event');
    previousSeq = source.seq;
    const key = keyOf(source);
    if (identities.has(key)) fail('duplicate native atom');
    identities.add(key);
    bytes += Buffer.byteLength(source.text, 'utf8');
    if (bytes > FRONTIER_BYTE_LIMIT) fail('frontier text byte cap exceeded');
    const atom = { seq: source.seq, blockIndex: source.blockIndex, role: source.role, text: source.text };
    if (source.contentType !== undefined) {
      if (!['text', 'reasoning', 'tool-call', 'tool-result'].includes(source.contentType)) fail('unsupported projected content');
      atom.contentType = source.contentType;
    }
    if (source.toolPair !== undefined) {
      const pair = source.toolPair;
      if (!pair || typeof pair.id !== 'string' || !pair.id || !['call', 'result'].includes(pair.side)
        || typeof pair.name !== 'string' || !pair.name) fail('invalid tool pair metadata');
      if (pair.side === 'call' && source.role !== 'assistant' || pair.side === 'result' && source.role !== 'tool') fail('tool role/pair mismatch');
      if (source.contentType !== undefined && source.contentType !== (pair.side === 'call' ? 'tool-call' : 'tool-result')) fail('tool content/pair mismatch');
      atom.toolPair = { id: pair.id, side: pair.side, name: pair.name };
      bytes += Buffer.byteLength(pair.id, 'utf8') + Buffer.byteLength(pair.name, 'utf8');
    } else if (source.role === 'tool' || ['tool-call', 'tool-result'].includes(source.contentType)) fail('tool atom has no pairing metadata');
    if (source.checkpoint !== undefined) {
      const checkpoint = source.checkpoint;
      if (!checkpoint || typeof checkpoint.compactionId !== 'string' || !checkpoint.compactionId
        || ![1, 2, 3].includes(checkpoint.tier) || source.toolPair) fail('invalid checkpoint metadata');
      const existing = checkpointSeqs.get(checkpoint.compactionId);
      if (existing && (existing.seq !== source.seq || existing.tier !== checkpoint.tier)) fail('inconsistent checkpoint identity/tier');
      checkpointSeqs.set(checkpoint.compactionId, { seq: source.seq, tier: checkpoint.tier });
      atom.checkpoint = { compactionId: checkpoint.compactionId, tier: checkpoint.tier };
      bytes += Buffer.byteLength(checkpoint.compactionId, 'utf8');
    }
    if (bytes > FRONTIER_BYTE_LIMIT) fail('frontier metadata byte cap exceeded');
    atoms.push(atom);
  }
  for (const atom of atoms) {
    const event = atoms.filter(other => other.seq === atom.seq);
    if (event.some(other => !!other.checkpoint !== !!atom.checkpoint
      || other.checkpoint?.compactionId !== atom.checkpoint?.compactionId)) fail('native event has inconsistent checkpoint blocks');
  }
  return atoms;
}

/** Positional native range: a replacement seq may be numerically above its end seq. */
export function selectNativeFrontier(atoms, { startSeq, endSeq }) {
  const start = atoms.findIndex(atom => atom.seq === startSeq);
  const end = atoms.findLastIndex(atom => atom.seq === endSeq);
  if (start < 0 || end < start) fail('native selection is missing, reversed or stale');
  const selected = atoms.slice(start, end + 1);
  if (selected.some(atom => atom.role === 'system')) fail('a system node cannot be compressed');
  // Every selected call/result needs exactly one visible mate, in the selected range.
  for (const atom of selected) {
    if (!atom.toolPair) continue;
    const pair = atoms.filter(other => other.toolPair?.id === atom.toolPair.id);
    const calls = pair.filter(other => other.toolPair.side === 'call');
    const results = pair.filter(other => other.toolPair.side === 'result');
    if (calls.length !== 1 || results.length !== 1 || calls[0].toolPair.name !== results[0].toolPair.name
      || atoms.indexOf(calls[0]) >= atoms.indexOf(results[0])
      || !selected.includes(calls[0]) || !selected.includes(results[0])) fail('selection splits or lacks a complete native tool pair');
  }
  return { selected, start, end };
}

/**
 * Transaction-local kernel projection. Checkpoints represent themselves, never their
 * historical closure. Equal local planning tiers ensure mixed native tiers all fold.
 * Raw endpoints receive disposable aliases only when a block boundary is needed.
 */
export function projectKernelTransaction(input, selection) {
  const atoms = snapshotFrontier(input);
  const { selected, start, end } = selectNativeFrontier(atoms, selection);
  const maxTier = Math.max(0, ...selected.map(atom => atom.checkpoint?.tier ?? 0));
  const state = createInitialState();
  const seedByAtom = new Map();
  const seedIds = new Set();
  const groups = new Map();
  for (const atom of atoms) {
    if (!atom.checkpoint) continue;
    const group = groups.get(atom.checkpoint.compactionId) ?? [];
    group.push(atom);
    groups.set(atom.checkpoint.compactionId, group);
  }
  const addSeed = (group, tier) => {
    const blockId = `b${state.nextBlockId++}`;
    const ids = group.map(keyOf);
    state.blocks.push({ blockId, runId: 'r0', tier, summary: group.map(atom => atom.text).join('\n'),
      directMessageIds: [...ids], effectiveMessageIds: [...ids], directBlockIds: [],
      compressedTokens: 0, createdAt: 0, survivedCount: 0, generation: 'young', active: true });
    for (const atom of group) seedByAtom.set(keyOf(atom), blockId);
    if (group.every(atom => selected.includes(atom))) seedIds.add(blockId);
  };
  for (const group of groups.values()) {
    addSeed(group, group.every(atom => selected.includes(atom)) ? maxTier : group[0].checkpoint.tier);
  }
  if (maxTier > 0) {
    for (const atom of [atoms[start], atoms[end]]) {
      if (!seedByAtom.has(keyOf(atom))) addSeed([atom], maxTier);
    }
  }
  const messages = atoms.map(atom => ({ id: keyOf(atom), role: atom.role,
    contentType: atom.toolPair ? atom.toolPair.side === 'call' ? 'tool-call' : 'tool-result' : atom.contentType ?? 'text',
    text: atom.text, ...(atom.toolPair ? { toolCallId: atom.toolPair.id, toolName: atom.toolPair.name } : {}),
    ...(seedByAtom.has(keyOf(atom)) ? { summaryOfBlockId: seedByAtom.get(keyOf(atom)) } : {}) }));
  state.messageRefs = assignRefs(messages, { existing: state.messageRefs, nextIndex: 1 }).map;
  const ref = atom => seedByAtom.get(keyOf(atom)) ?? state.messageRefs.byRaw[keyOf(atom)];
  return { atoms, selected, state, messages, seedIds, seedByAtom,
    startRef: ref(atoms[start]), endRef: ref(atoms[end]), tier: maxTier ? Math.min(3, maxTier + 1) : 1 };
}

/** Pure plan; only the caller's successful native checkpoint may make it durable. */
export function prepareBoundedCompression(input, selection, summary, kernel = realCore) {
  if (typeof summary !== 'string' || !summary.trim() || summary.length > KERNEL_SUMMARY_CHAR_LIMIT) fail('invalid bounded summary');
  const projected = projectKernelTransaction(input, selection);
  const applied = kernel.applyCompression({ state: projected.state, messages: projected.messages,
    config, protectedMessageIds: new Set(), ranges: [{ startRef: projected.startRef, endRef: projected.endRef, summary }] });
  if (applied.result.errors.length || applied.result.warnings.length || applied.result.blocksCreated !== 1) fail('kernel refused an exact transaction');
  const created = applied.state.blocks.filter(block => !projected.state.blocks.some(seed => seed.blockId === block.blockId));
  if (created.length !== 1) fail('kernel created an unexpected number of blocks');
  const block = created[0];
  const atomIds = projected.selected.map(keyOf);
  if (!equalSets(block.effectiveMessageIds, atomIds)) fail('kernel expanded or omitted native coverage');
  if (!equalSets(block.directBlockIds, [...projected.seedIds])) fail('kernel omitted or added a direct frontier block');
  const expectedDirect = atomIds.filter(id => !projected.seedByAtom.has(id));
  if (!equalSets(block.directMessageIds, expectedDirect)) fail('kernel direct message edges differ from native frontier');
  if (block.tier !== projected.tier) fail('kernel output tier does not match highest native input tier');
  for (const seed of projected.state.blocks) {
    const current = applied.state.blocks.find(candidate => candidate.blockId === seed.blockId);
    if (!current || current.active !== !projected.seedIds.has(seed.blockId)) fail('kernel changed an outside frontier block');
  }
  const directSources = [];
  const checkpoints = new Set();
  for (const atom of projected.selected) {
    if (!atom.checkpoint) directSources.push({ kind: 'raw', seq: atom.seq, blockIndex: atom.blockIndex });
    else if (!checkpoints.has(atom.checkpoint.compactionId)) {
      checkpoints.add(atom.checkpoint.compactionId);
      directSources.push({ kind: 'checkpoint', seq: atom.seq, compactionId: atom.checkpoint.compactionId, tier: atom.checkpoint.tier });
    }
  }
  return { summary, tier: block.tier, atomIds, directSources,
    shadowedSeqs: [...new Set(projected.selected.map(atom => atom.seq))],
    shadowedRange: { start: selection.startSeq, end: selection.endSeq },
    metrics: { frontierAtoms: projected.atoms.length, kernelMessages: projected.messages.length,
      kernelSeedBlocks: projected.state.blocks.length, maxSeedEffectiveIds: Math.max(0, ...projected.state.blocks.map(seed => seed.effectiveMessageIds.length)),
      outputEffectiveIds: block.effectiveMessageIds.length } };
}

/** Confirm native direct edges before handing a tier record to an incremental index. */
export function confirmNativeCommit(plan, result, checkpointEvent) {
  if (!equalSets(result.shadowedSeqs, plan.shadowedSeqs)
    || result.shadowedSeqs.some((seq, index) => seq !== plan.shadowedSeqs[index])
    || result.shadowedRange.start !== plan.shadowedRange.start || result.shadowedRange.end !== plan.shadowedRange.end) fail('native committed a different surface range');
  if (result.summary?.length !== 1 || result.summary[0].type !== 'text' || result.summary[0].text !== plan.summary) fail('native committed a different summary');
  if (checkpointEvent?.type !== 'user/message' || checkpointEvent.data.source.kind !== 'compact-checkpoint'
    || checkpointEvent.data.source.compactionId !== result.compactionId
    || checkpointEvent.seq !== result.summarySeq + 1) fail('native checkpoint is absent or does not match its summary');
  const expectedEdges = [result.startSeq, result.summarySeq, ...plan.shadowedSeqs];
  if (!equalSets(checkpointEvent.sourceEventSeqs ?? [], expectedEdges)) fail('native checkpoint copied ancestors or lacks direct source edges');
  return { seq: checkpointEvent.seq, compactionId: result.compactionId, tier: plan.tier,
    directSources: plan.directSources.map(source => ({ ...source })), sourceEventSeqs: [...expectedEdges] };
}
