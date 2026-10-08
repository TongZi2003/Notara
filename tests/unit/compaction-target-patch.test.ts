import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { COMPACTION_TARGET_PATCH as patch, patchCompactionTarget } from '../../scripts/patch-compaction-target.ts';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
function originalArtifact(): string {
  const s = readFileSync('node_modules/' + patch.artifact, 'utf8');
  if (hash(s) === patch.originalSha) return s;
  if (hash(s) !== patch.patchedSha) throw new Error('Unexpected compaction artifact');
  return s.replace(patch.after, patch.before).replace(patch.spanAfter, patch.spanBefore);
}

test('locked native compaction routing patch is idempotent and rejects unknown SDK code', () => {
  const original = originalArtifact(), fixed = patchCompactionTarget(original);
  expect(hash(fixed)).toBe(patch.patchedSha);
  expect(patchCompactionTarget(fixed)).toBe(fixed);
  expect(() => patchCompactionTarget(original + '\n')).toThrow(/Unknown DSH compaction artifact/);
});

test('pending selection determines pressure policy until a later request header commits the effective route', () => {
  const fixed = patchCompactionTarget(originalArtifact());
  const body = fixed.slice(fixed.indexOf('function routedTarget('), fixed.indexOf('/**\n* Output tokens'));
  const route = new Function('session', body + '\nreturn routedTarget(session);');
  const header = { provider: 'provider-a', model: 'large-window' };
  const events: { type: string; data: Record<string, unknown> }[] = [{ type: 'request/header', data: { header: { config: header } } }];
  const session = { requestHeader: () => ({ config: header }), snapshotEvents: () => events };
  expect(route(session)).toEqual(header);
  events.push({ type: 'model/selection', data: { provider: 'provider-b', model: 'small-window' } });
  expect(route(session)).toEqual({ provider: 'provider-b', model: 'small-window' });
  expect(header).toEqual({ provider: 'provider-a', model: 'large-window' });
  events.push({ type: 'request/header', data: { header: { config: header } } });
  expect(route(session)).toEqual(header);
  expect(route({ requestHeader: () => undefined, snapshotEvents: () => [] })).toBeUndefined();
});

test('native span preserves invisible boundaries without entering model-facing input fields', () => {
  const fixed = patchCompactionTarget(originalArtifact());
  const start = fixed.indexOf('function buildSummarizationInput(');
  const end = fixed.indexOf('/** Inspect open-turn', start);
  const builder = new Function('session', 'seqs', 'systemHead', 'deepFreeze',
    fixed.slice(start, end) + '\nreturn buildSummarizationInput(session, seqs);');
  const events = new Map([
    [0, { seq: 0, type: 'system/message' }], [7, { seq: 7, type: 'system/message' }],
    [2, { seq: 2, type: 'user/message' }], [9, { seq: 9, type: 'assistant/message' }],
  ]);
  const messages = new Map([[0, { id: 'head', role: 'system' }], [2, { id: 'user', role: 'user' }]]);
  let reads = 0;
  const input = builder({ surface: { nodes: [0, 7, 2, 9] }, requestHeader: () => ({ tools: [] }),
    eventAt: (seq: number) => { reads++; return events.get(seq); },
    deriveEventMessage: (event: { seq: number }) => messages.get(event.seq) ?? null,
  }, [7, 2, 9], () => events.get(0), Object.freeze);
  expect(reads).toBe(3);
  expect(input.messages).toEqual([messages.get(0), messages.get(2)]);
  expect(input.nativeSpan).toEqual({ shadowedSeqs: [7, 2, 9], startSeq: 7, endSeq: 9,
    systemHeadSeq: 0, messageSeqs: [0, 2], emptyNodes: [{ seq: 7, nativeRole: 'system' }, { seq: 9, nativeRole: 'assistant' }] });
  expect(Object.keys(input)).toEqual(['tools', 'messages']);
  expect(Object.isFrozen(input.nativeSpan)).toBe(true);
});
