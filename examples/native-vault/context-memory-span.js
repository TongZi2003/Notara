// A bounded kernel view of a complete native transaction. The original input
// stays in the native serial summarizer; no source text or ancestor closure is
// copied into this view.
export const NATIVE_SPAN_ALIAS_LIMIT = 512;

const reject = reason => { throw new Error(`context memory span: ${reason}`); };
const validSeq = value => Number.isSafeInteger(value) && value >= 0;
const equal = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const atomKey = atom => `native:${atom.seq}:${atom.blockIndex}`;
const roles = new Set(['system', 'developer', 'user', 'assistant', 'tool']);

function validateBlock(block, role) {
  if (!block || typeof block !== 'object') reject('invalid native block');
  switch (block.type) {
    case 'text': case 'reasoning':
      if (typeof block.text !== 'string') reject('invalid native text block');
      break;
    case 'tool-call':
      if (role !== 'assistant' || typeof block.id !== 'string' || !block.id
        || typeof block.name !== 'string' || !block.name || typeof block.arguments !== 'string') reject('invalid native tool call');
      break;
    case 'tool-addition': case 'tool-removal':
      if (role !== 'developer' || typeof block.toolName !== 'string' || !block.toolName) reject('invalid native tool update');
      break;
    case 'image': case 'file':
      if (!block.attachment || typeof block.attachment !== 'object'
        || Array.isArray(block.attachment)) reject('invalid native attachment');
      if (block.type === 'image' && block.offloaded !== undefined && block.offloaded !== true) reject('invalid image offload flag');
      break;
    default: reject(`unsupported native block ${block.type}`);
  }
}

/**
 * Validate the complete selected native manifest, then partition whole balanced
 * event intervals into at most 512 kernel aliases. Each alias owns one direct
 * interval in manifest.events; a result/checkpoint's many blocks stay one event.
 *
 * checkpointTier(seq, compactionId) returns the current projection row
 * { seq, compactionId, tier: 1|2|3|null }. Unknown older tiers plan as T3.
 */
export function projectNativeSpan(input, options = {}) {
  const span = input?.nativeSpan;
  if (!span || !Array.isArray(input.messages) || !Array.isArray(span.messageSeqs)
    || span.messageSeqs.length !== input.messages.length || !Array.isArray(span.shadowedSeqs)
    || !Array.isArray(span.emptyNodes)) reject('invalid native manifest');
  if (!span.shadowedSeqs.length || !span.shadowedSeqs.every(validSeq)
    || new Set(span.shadowedSeqs).size !== span.shadowedSeqs.length
    || span.startSeq !== span.shadowedSeqs[0] || span.endSeq !== span.shadowedSeqs.at(-1)) reject('invalid positional native span');
  if (span.systemHeadSeq !== undefined && !validSeq(span.systemHeadSeq)) reject('invalid system head identity');
  if (span.shadowedSeqs.includes(span.systemHeadSeq)) reject('reserved system head selected');

  const selected = new Set(span.shadowedSeqs);
  const bySeq = new Map();
  const messageIds = new Set();
  for (let index = 0; index < input.messages.length; index++) {
    const seq = span.messageSeqs[index], message = input.messages[index];
    if (!validSeq(seq) || bySeq.has(seq) || !message || !roles.has(message.role)
      || typeof message.id !== 'string' || !message.id || messageIds.has(message.id)
      || !message.source || typeof message.source.kind !== 'string' || !message.source.kind
      || !Array.isArray(message.content)) reject('invalid/duplicate native message identity');
    if (!selected.has(seq) && !(seq === span.systemHeadSeq && message.role === 'system')) reject('unexpected outside native message');
    if (selected.has(seq) && message.role === 'system' && message.content.length > 0) reject('active system selected');
    messageIds.add(message.id);
    bySeq.set(seq, message);
  }
  const omitted = new Map();
  for (const empty of span.emptyNodes) {
    if (!empty || !validSeq(empty.seq) || omitted.has(empty.seq) || bySeq.has(empty.seq)
      || !selected.has(empty.seq) || !roles.has(empty.nativeRole) || empty.nativeRole === 'tool') reject('invalid empty native node');
    omitted.set(empty.seq, empty.nativeRole);
  }
  if (span.shadowedSeqs.some(seq => !bySeq.has(seq) && !omitted.has(seq))) reject('missing native node');
  if (!equal(span.messageSeqs.filter(seq => selected.has(seq)), span.shadowedSeqs.filter(seq => bySeq.has(seq)))) reject('native messages are out of surface order');

  const events = [];
  const units = [];
  const seenCalls = new Set();
  const openCalls = new Map();
  const seenCheckpoints = new Set();
  let unitStart = 0;
  let unitTier = 0;
  let totalBlocks = 0;
  let highestTier = 0;
  for (const seq of span.shadowedSeqs) {
    const message = bySeq.get(seq);
    const event = { seq, blockCount: message?.content.length ?? 0,
      nativeRole: message?.role ?? omitted.get(seq) };
    totalBlocks += event.blockCount;
    if (!Number.isSafeInteger(totalBlocks)) reject('native block count overflow');
    if (message) {
      for (const block of message.content) {
        validateBlock(block, message.role);
        if (block.type === 'tool-call') {
          if (seenCalls.has(block.id)) reject('duplicate native tool call');
          seenCalls.add(block.id);
          openCalls.set(block.id, block.name);
        }
      }
      if (message.role === 'tool') {
        if (message.source.kind !== 'tool' || typeof message.toolCallId !== 'string' || !message.toolCallId
          || message.source.callId !== message.toolCallId || !openCalls.has(message.toolCallId)) reject('unpaired/mismatched native result');
        // One tool-role event closes one invocation, regardless of content size.
        openCalls.delete(message.toolCallId);
      }
      if (message.source.kind === 'compact-checkpoint') {
        const compactionId = message.source.compactionId;
        if (message.role !== 'user' || typeof compactionId !== 'string' || !compactionId
          || seenCheckpoints.has(compactionId) || !message.content.length
          || message.content.some(block => block.type !== 'text')) reject('invalid/duplicate native checkpoint');
        const known = options.checkpointTier?.(seq, compactionId);
        if (!known || known.seq !== seq || known.compactionId !== compactionId
          || ![1, 2, 3, null].includes(known.tier)) reject('checkpoint tier projection unavailable');
        seenCheckpoints.add(compactionId);
        event.checkpoint = { compactionId, tier: known.tier };
        const planningTier = known.tier ?? 3;
        unitTier = Math.max(unitTier, planningTier);
        highestTier = Math.max(highestTier, planningTier);
      }
    }
    events.push(event);
    if (!openCalls.size) {
      units.push({ start: unitStart, end: events.length - 1, highestTier: unitTier });
      unitStart = events.length;
      unitTier = 0;
    }
  }
  if (openCalls.size || unitStart !== events.length) reject('selection splits native tool pair');

  const atoms = [];
  const covers = new Map();
  const unitsPerAlias = Math.max(1, Math.ceil(units.length / NATIVE_SPAN_ALIAS_LIMIT));
  for (let first = 0; first < units.length; first += unitsPerAlias) {
    const last = Math.min(units.length - 1, first + unitsPerAlias - 1);
    const start = units[first].start, end = units[last].end;
    let blockCount = 0, aliasTier = 0;
    for (let index = start; index <= end; index++) blockCount += events[index].blockCount;
    for (let index = first; index <= last; index++) aliasTier = Math.max(aliasTier, units[index].highestTier);
    const atom = { seq: events[start].seq, blockIndex: 0, role: 'user', contentType: 'text',
      text: `Native positions ${start}..${end}; ${end - start + 1} complete events; ${blockCount} source blocks; planning tier ${aliasTier}.` };
    if (aliasTier) atom.checkpoint = { compactionId: `native-span-alias:${start}:${end}`, tier: aliasTier };
    atoms.push(atom);
    covers.set(atomKey(atom), { ranges: [{ start, end }], eventCount: end - start + 1, blockCount });
  }
  const tier = Math.min(3, highestTier + 1);
  const manifest = { events, shadowedSeqs: [...span.shadowedSeqs], startSeq: span.startSeq, endSeq: span.endSeq,
    systemHeadSeq: span.systemHeadSeq, blockCount: totalBlocks, highestTier, tier };
  return { atoms, covers, manifest, tier,
    kernelSelection: { startSeq: atoms[0].seq, endSeq: atoms.at(-1).seq } };
}

/** Verify the kernel's aliases partition every complete original event once. */
export function verifyNativeSpanCoverage(projected, kernelPlan) {
  if (!kernelPlan || !Array.isArray(kernelPlan.atomIds)
    || !equal(kernelPlan.atomIds, projected.atoms.map(atomKey))
    || new Set(kernelPlan.atomIds).size !== kernelPlan.atomIds.length) reject('kernel omitted, added, duplicated, or reordered alias');
  if (kernelPlan.tier !== projected.manifest.tier) reject('kernel output tier differs from native span');
  let cursor = 0, blockCount = 0;
  for (const id of kernelPlan.atomIds) {
    const coverage = projected.covers.get(id);
    if (!coverage || !Array.isArray(coverage.ranges) || coverage.ranges.length !== 1) reject('invalid direct alias range');
    const { start, end } = coverage.ranges[0];
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start !== cursor
      || end < start || end >= projected.manifest.events.length) reject('alias range splits, overlaps, or omits native span');
    let aliasBlocks = 0;
    for (let index = start; index <= end; index++) aliasBlocks += projected.manifest.events[index].blockCount;
    if (coverage.eventCount !== end - start + 1 || coverage.blockCount !== aliasBlocks) reject('alias coverage count mismatch');
    blockCount += aliasBlocks;
    cursor = end + 1;
  }
  if (cursor !== projected.manifest.events.length || blockCount !== projected.manifest.blockCount
    || !equal(projected.manifest.events.map(event => event.seq), projected.manifest.shadowedSeqs)) reject('incomplete native event coverage');
  return { shadowedSeqs: [...projected.manifest.shadowedSeqs],
    shadowedRange: { start: projected.manifest.startSeq, end: projected.manifest.endSeq },
    eventCount: cursor, blockCount, tier: kernelPlan.tier };
}
