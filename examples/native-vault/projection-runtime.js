import { createHash } from 'node:crypto';

// A producer may key a pure projection by the revisions of its sources. This
// avoids serializing scenes/bodies again just to answer an unchanged poll.
const revisions = new WeakMap();
export const projectionRevision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function markProjection(value, sources) {
  revisions.set(value, projectionRevision(sources));
  return value;
}
export function conditionalProjection(input, value, scope) {
  if (!Object.hasOwn(input, 'projectionRevision')) return value;
  const previous = input.projectionRevision;
  if (previous !== null && (typeof previous !== 'string' || !/^[a-f0-9]{64}$/.test(previous))) throw Error('vault_projection_invalid');
  const revision = projectionRevision([scope, revisions.get(value) ?? projectionRevision(value)]);
  return previous === revision
    ? { kind: 'notara-projection', revision, unchanged: true }
    : { kind: 'notara-projection', revision, value };
}

/** A bounded memo of pure projections. Source revisions, including scan
 * errors/deletions, are checked afresh before a cached value can be reused. */
export function createProjectionMemo(limit = 32, maxBytes = 16 * 1024 * 1024) {
  const entries = new Map();
  let retainedBytes=0;
  const freeze = value => { if (value&&typeof value==='object'&&!Object.isFrozen(value)) { for(const child of Object.values(value))freeze(child);Object.freeze(value); } return value; };
  return (scope, sources, build) => {
    const revision = projectionRevision(sources), prior = entries.get(scope);
    entries.delete(scope);
    if(prior)retainedBytes-=prior.bytes;
    if (prior?.revision === revision) { entries.set(scope, prior);retainedBytes+=prior.bytes;return prior.value; }
    const value = markProjection(freeze(build()), sources);
    const bytes=JSON.stringify(value).length*2;
    if(bytes<=maxBytes){entries.set(scope,{revision,value,bytes});retainedBytes+=bytes;}
    while (entries.size > limit||retainedBytes>maxBytes) { const key=entries.keys().next().value;retainedBytes-=entries.get(key).bytes;entries.delete(key); }
    return value;
  };
}
