/**
 * What the star map and the forest both read: a stable seed per key, the light
 * a node's real projection gives it, and the split hierarchy the drawn keys
 * form. Neither renderer infers anything beyond these.
 */

/** Stable [0, 1) from a string (FNV-1a), so a map never shuffles on refresh. */
export function starHash(text, salt = 0) {
  let hash = 2166136261 ^ salt;
  for (const char of String(text)) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return ((hash >>> 0) % 100000) / 100000;
}

/**
 * What one node shows, from its real projection only:
 *   state   lit | unobserved | unreadable | unlinked | unknown | opened | planned
 *   level   0..1 (probability, mastery, or 1 for a finished course)
 */
export function starLight(star) {
  const light = star?.light;
  if (star?.kind === 'course') return light?.role === 'logged' ? { state: 'lit', level: 1 } : { state: light?.role === 'opened' ? 'opened' : 'planned', level: 0 };
  if (!light) return { state: 'unknown', level: 0 };
  if (light.kind === 'leaf') return light.unreadable ? { state: 'unreadable', level: 0 } : light.observed ? { state: 'lit', level: light.probability } : { state: 'unobserved', level: 0 };
  if (light.kind === 'parent') return !light.leafCount ? { state: 'unlinked', level: 0 } : light.coverage > 0 ? { state: 'lit', level: light.mastery, coverage: light.coverage } : { state: 'unobserved', level: 0, coverage: 0 };
  return { state: 'unlinked', level: 0 };
}

/**
 * The split hierarchy over `keys`: a node keeps its first split parent, and an
 * edge that would close a cycle is ignored. `linked` holds every key with any
 * relation to another drawn key, references included.
 */
export function splitTree(keys, edges = []) {
  const known = new Set(keys), parentOf = new Map(), children = new Map(keys.map(key => [key, []])), linked = new Set();
  const ancestorOf = (key, candidate) => { for (let at = candidate; at !== undefined; at = parentOf.get(at)) if (at === key) return true; return false; };
  for (const edge of edges) {
    if (!known.has(edge.source) || !known.has(edge.target) || edge.source === edge.target) continue;
    linked.add(edge.source); linked.add(edge.target);
    if (edge.kind !== 'split' || parentOf.has(edge.target) || ancestorOf(edge.target, edge.source)) continue;
    parentOf.set(edge.target, edge.source); children.get(edge.source).push(edge.target);
  }
  return { parentOf, children, linked };
}
