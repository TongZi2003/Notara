// Learning star map: a read-only mastery projection over the Vault graph.
//
// Nothing here is a fact source. A leaf's light is recomputed from the card's
// own `review_history` every time, and a parent's light from all of its leaf
// descendants, so deleting, undoing or editing a record changes the stars on
// the next read. The projection never writes `mastery`, `review_history` or
// the review schedule back; `mastery 1–5` stays the review tier it is.
//
// Leaves: a `type: card` page with no split children. Only its new-format
// assessments count as evidence. `not_observed` never updates the state, a
// reverted record is not evidence, and a legacy `passed` row stays legacy — no
// ability is invented for it. One evaluation record is one practice
// opportunity: any `needs_practice` makes it a miss (a real difficulty was
// seen), otherwise any `demonstrated` makes it a hit.
//
// Parents: every node with split children. Mastery is the weighted geometric
// mean over *all* leaf descendants (priors included), coverage is the weighted
// share of leaves that have evidence. Filters, search and progressive
// expansion only change what is drawn, never these numbers.

import { reviewHistory } from './review-data.js';

/** Auditable defaults (Corbett & Anderson style), shared by every leaf until
 * enough real answer sequences exist to fit and compare parameters offline. */
export const BKT_DEFAULTS = Object.freeze({ prior: 0.2, learn: 0.15, slip: 0.1, guess: 0.2 });
export const MASTERY_EPSILON = 1e-3;
/** evidence records needed before a leaf reads as 较充分 rather than 初步. */
export const SUPPORTED_EVIDENCE = 3;

const clamp = value => Math.min(1, Math.max(0, value));

/** The observation one record contributes, or null when it carries none. */
export function evidenceOf(record) {
  if (!record || record.revertedAt || !Array.isArray(record.assessments)) return null;
  if (record.assessments.some(item => item?.outcome === 'needs_practice')) return 'miss';
  if (record.assessments.some(item => item?.outcome === 'demonstrated')) return 'hit';
  return null;
}

/**
 * One leaf's BKT state after its history, oldest first:
 * posterior on the observation, then the learning transition once per record.
 */
export function leafMastery(history = [], params = BKT_DEFAULTS) {
  const { prior, learn, slip, guess } = params;
  let probability = prior, evidenceCount = 0, lastEvidenceAt = '';
  for (const record of Array.isArray(history) ? history : []) {
    const evidence = evidenceOf(record);
    if (!evidence) continue;
    probability = evidence === 'hit'
      ? probability * (1 - slip) / (probability * (1 - slip) + (1 - probability) * guess)
      : probability * slip / (probability * slip + (1 - probability) * (1 - guess));
    probability += (1 - probability) * learn;
    evidenceCount += 1;
    if (typeof record.at === 'string' && record.at) lastEvidenceAt = record.at;
  }
  return {
    probability: clamp(probability),
    evidenceCount,
    observed: evidenceCount > 0,
    ...(lastEvidenceAt ? { lastEvidenceAt } : {}),
    confidence: evidenceCount === 0 ? 'prior' : evidenceCount < SUPPORTED_EVIDENCE ? 'emerging' : 'supported',
  };
}

/**
 * Weighted geometric mean and coverage over leaf states. `weight` defaults to 1:
 * the Vault has no weight field yet, so every leaf counts the same.
 */
export function aggregateLeaves(leaves = [], epsilon = MASTERY_EPSILON) {
  let weights = 0, logs = 0, covered = 0;
  for (const leaf of leaves) {
    const weight = Number.isFinite(leaf?.weight) && leaf.weight > 0 ? leaf.weight : 1;
    weights += weight;
    logs += weight * Math.log(Math.max(clamp(leaf.probability), epsilon));
    if (leaf.observed) covered += weight;
  }
  if (!weights) return null;
  return { mastery: clamp(Math.exp(logs / weights)), coverage: clamp(covered / weights) };
}

const isLeafCard = node => node?.kind === 'page' && node.type === 'card' && !(node.childCount > 0);

/**
 * The projection the star map reads, keyed by node path:
 *   leaf      a card leaf: its BKT state, or `unreadable` when its history is malformed
 *   parent    a node with split children: aggregate over all leaf descendants
 *   unlinked  anything else — it keeps its place on the map, outside mastery
 */
export function learningStars(graph, documents = [], params = BKT_DEFAULTS) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [], edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const byPath = new Map((Array.isArray(documents) ? documents : []).map(document => [document?.path, document]));
  const children = new Map();
  for (const edge of edges) {
    if (edge.kind !== 'split') continue;
    const list = children.get(edge.source) ?? [];
    if (!list.includes(edge.target)) list.push(edge.target);
    children.set(edge.source, list);
  }
  const leaves = new Map();
  for (const node of nodes) {
    if (!isLeafCard(node)) continue;
    try { leaves.set(node.path, leafMastery(reviewHistory(byPath.get(node.path)), params)); }
    catch { leaves.set(node.path, { unreadable: true }); }
  }
  /** Every distinct leaf card below `path`; the visited set ends parent cycles. */
  const leafDescendants = path => {
    const seen = new Set([path]), found = [], stack = [...(children.get(path) ?? [])];
    while (stack.length) {
      const next = stack.pop();
      if (seen.has(next)) continue;
      seen.add(next);
      if (leaves.has(next)) found.push(next);
      stack.push(...(children.get(next) ?? []));
    }
    return found;
  };
  const result = {};
  for (const node of nodes) {
    if (leaves.has(node.path)) { result[node.path] = { kind: 'leaf', ...leaves.get(node.path) }; continue; }
    if (!(children.get(node.path)?.length)) { result[node.path] = { kind: 'unlinked' }; continue; }
    const found = leafDescendants(node.path), readable = found.map(path => leaves.get(path)).filter(leaf => !leaf.unreadable);
    const aggregate = aggregateLeaves(readable);
    const stamps = readable.map(leaf => leaf.lastEvidenceAt).filter(Boolean).sort();
    result[node.path] = {
      kind: 'parent',
      leafCount: readable.length,
      observedCount: readable.filter(leaf => leaf.observed).length,
      evidenceCount: readable.reduce((sum, leaf) => sum + leaf.evidenceCount, 0),
      ...(found.length > readable.length ? { unreadableCount: found.length - readable.length } : {}),
      ...(aggregate ?? {}),
      ...(stamps.length ? { lastEvidenceAt: stamps.at(-1) } : {}),
    };
  }
  return { params: { ...params, epsilon: MASTERY_EPSILON }, nodes: result };
}
