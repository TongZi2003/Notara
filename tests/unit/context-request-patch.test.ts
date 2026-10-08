import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { CONTEXT_REQUEST_PATCH as patch, patchContextRequest } from '../../scripts/patch-context-request.ts';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
function original(): string {
  let source = readFileSync('node_modules/' + patch.artifact, 'utf8');
  if (sha(source) === patch.originalSha) return source;
  if (sha(source) !== patch.patchedSha) throw new Error('Unexpected agent-loop artifact');
  for (const change of [...patch.changes].reverse()) source = source.replace(change.after, change.before);
  expect(sha(source)).toBe(patch.originalSha);
  return source;
}

test('request admission patch only accepts the locked SDK and is idempotent', () => {
  const source = original();
  const fixed = patchContextRequest(source);
  expect(sha(fixed)).toBe(patch.patchedSha);
  expect(patchContextRequest(fixed)).toBe(fixed);
  expect(() => patchContextRequest(source + '\n')).toThrow(/Unknown DSH/);
  expect(() => patchContextRequest(source.replace('let firstAttempt = true;', 'let firstAttempt = false;'))).toThrow(/Unknown DSH/);
});

test('admission runs after input commitment and before any assistant attempt', () => {
  const source = patchContextRequest(original());
  const step = source.slice(source.indexOf('async step(decision)'), source.indexOf('async prepareRequest('));
  expect(step.indexOf('firstAttempt = false;')).toBeLessThan(step.indexOf('agent/request-check'));
  expect(step.indexOf('this.buildRequest(')).toBeLessThan(step.indexOf('agent/request-check'));
  expect(step.indexOf('agent/request-check')).toBeLessThan(step.indexOf('new AssistantStreamAttempt'));
  expect(step).toContain('++requestCheckRetries > 4');
});
