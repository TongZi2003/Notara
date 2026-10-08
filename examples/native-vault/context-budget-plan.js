import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { toolPairingBalancedBefore, toolPairingBalancedAfter } from '@deepseek-ai/dsh-compaction';
import { estimateToolsTokens } from '@deepseek-ai/dsh-token-meter/estimate';
import { offloadedImageText } from '@deepseek-ai/dsh-llm';

export const latestInputProjection = {
  key: 'notaraLatestContextInput', stateVersion: 1,
  stateSchema: z.object({ seq: z.number().int().nullable() }),
  init: () => ({ seq: null }),
  apply: (state, event) => event.type === 'user/message' && event.data.source.kind === 'user'
    ? { seq: event.seq } : state,
};

const positive = (n, fallback) => Number.isSafeInteger(n) && n > 0 ? n : fallback;

export function measuredRequestPrice(measurement, header, conservative) {
  const tools = estimateToolsTokens(header);
  const fresh = measurement.surfaceTokens + tools;
  // Usage belongs to the previous request. Its heuristic delta leaves phantom
  // pressure after replacements; scaling images by old text density also fails.
  // Reprice this request, retaining native route-specific image/file prices.
  return Math.ceil(Math.max(conservative, fresh));
}

// These are planning limits, never provider capability declarations.
export function admissionPolicy(raw = {}, provider, model) {
  const keys = ['thresholdRatio', 'headroomTokens', 'retainTokens', 'retainRatio', 'maxOverflowRetries', 'compactionRetries'];
  const result = Object.fromEntries(keys.filter(key => raw[key] !== undefined).map(key => [key, raw[key]]));
  const override = raw.modelPolicies?.find(policy => policy.provider === provider && policy.model === model) ?? {};
  for (const key of keys) if (override[key] !== undefined) result[key] = override[key];
  if (override.retainTokens !== undefined) delete result.retainRatio;
  if (override.retainRatio !== undefined) delete result.retainTokens;
  return result;
}

export function planBudget({ contextWindow, maxTokens, workingInputCap = 65536, unknownInputCap = 32768, learnedCap,
  nativePolicy = {} }) {
  const output = positive(maxTokens, 8192);
  const known = positive(contextWindow, null);
  const safety = known ? Math.max(1024, Math.ceil(known * .08)) : 2048;
  const planningWindow = known ?? positive(unknownInputCap, 32768) + output + safety;
  const inputCap = Math.max(0, Math.min(positive(workingInputCap, 65536),
    known ? known - output - safety : positive(unknownInputCap, 32768),
    nativePolicy.thresholdRatio === undefined ? Infinity : Math.floor(planningWindow * nativePolicy.thresholdRatio),
    nativePolicy.headroomTokens === undefined ? Infinity : planningWindow - output - nativePolicy.headroomTokens,
    positive(learnedCap, Infinity)));
  const retain = nativePolicy.retainTokens ?? (nativePolicy.retainRatio === undefined ? undefined
    : Math.floor((planningWindow - output) * nativePolicy.retainRatio));
  if (retain !== undefined && retain >= inputCap) throw new Error('context budget: configured retention must be below the available input budget');
  return { inputCap, output, safety, known, target: Math.floor(inputCap * .60), retain,
    pressureLimit: Math.min(4, nativePolicy.compactionRetries === undefined ? 4 : 1 + nativePolicy.compactionRetries),
    overflowLimit: Math.min(4, nativePolicy.maxOverflowRetries ?? 4) };
}

export function createRequestPricer(llm) {
  const strings = new WeakMap();
  const priceText = text => Math.ceil(Buffer.byteLength(text, 'utf8') / 2);
  return options => {
    let total = priceText(JSON.stringify(options.tools ?? [])) + 32;
    if (options.system) total += priceText(options.system);
    for (const message of options.messages) {
      let price = strings.get(message);
      if (price === undefined) {
        if (message.role === 'system' && message.content.length === 0) continue;
        price = 12 + priceText(JSON.stringify({ role: message.role,
          ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}) }));
        for (const block of message.content) {
          if (block.type === 'image' || block.type === 'file') continue;
          // Provider replay signatures and duplicate streams are not part of the native message content.
          price += priceText(JSON.stringify(block));
        }
        if (Object.isFrozen(message)) strings.set(message, price);
      }
      total += price;
      for (const block of message.content) {
        if (block.type === 'file') total += priceText(llm.fileRequestText(block.attachment));
        if (block.type !== 'image') continue;
        if (block.offloaded === true) { total += priceText(offloadedImageText(block.attachment)); continue; }
        const pricing = llm.imageRequestPricing(options.provider, options.model);
        const priced = pricing?.priceImages([block])?.[0];
        if (priced && (!Number.isFinite(priced.visualTokens) || priced.visualTokens < 0 || typeof priced.text !== 'string')) {
          throw new Error('context budget: invalid image price');
        }
        total += priced ? priced.visualTokens + priceText(priced.text) : 32768;
      }
    }
    return total;
  };
}

/** Select a contiguous, tool-balanced old region without crossing the latest real user input or a system node. */
export function chooseRange(session, meter, breakdown, protectedSeq, retainTokens) {
  const nodes = meter.nodes;
  if (nodes.length !== session.surface.nodes.length || nodes.length !== breakdown.nodes.length
      || nodes.some((n, i) => n.seq !== session.surface.nodes[i] || n.seq !== breakdown.nodes[i].seq)) {
    throw new Error('context budget: native surface and price projections disagree');
  }
  let end = nodes.length - 1;
  let retained = 0;
  while (end >= 0 && retained < retainTokens) {
    retained += nodes[end].tokens;
    end--;
  }
  let best = null;
  let start = 0;
  // Native system-series normalization retains old source events as empty
  // replacements. They carry no instructions and may lie inside an old range.
  const systemBoundary = i => breakdown.nodes[i].system && (i === 0 || breakdown.nodes[i].heuristicTokens > 0);
  while (start <= end) {
    while (start <= end && (systemBoundary(start) || nodes[start].seq === protectedSeq)) start++;
    if (start > end) break;
    let stop = start;
    while (stop + 1 <= end && !systemBoundary(stop + 1) && nodes[stop + 1].seq !== protectedSeq) stop++;
    const nextStart = stop + 1;
    while (start <= stop && !toolPairingBalancedBefore(session, nodes[start].seq)) start++;
    while (stop >= start && !toolPairingBalancedAfter(session, nodes[stop].seq)) stop--;
    if (start <= stop) {
      const tokens = nodes.slice(start, stop + 1).reduce((n, node) => n + node.tokens, 0);
      if (tokens > (best?.tokens ?? 0)) best = { start: nodes[start].seq, end: nodes[stop].seq, tokens };
    }
    start = nextStart;
  }
  return best;
}
