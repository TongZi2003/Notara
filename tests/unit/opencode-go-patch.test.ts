import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { OPENCODE_GO_PATCH, patchOpenCodeGo } from '../../scripts/patch-opencode-go.ts';

const sha = (source: string): string => createHash('sha256').update(source).digest('hex');

test('OpenCode Go compatibility rejects unknown or partially patched dependency artifacts', () => {
  const installed = readFileSync(resolve('node_modules', OPENCODE_GO_PATCH.artifact), 'utf8');
  const original = sha(installed) === OPENCODE_GO_PATCH.patchedSha
    ? [...OPENCODE_GO_PATCH.replacements].reverse().reduce((source, patch) => source.replace(patch.after, patch.before), installed)
    : installed;
  expect(sha(original)).toBe(OPENCODE_GO_PATCH.originalSha);
  const patched = patchOpenCodeGo(original);
  expect(sha(patched)).toBe(OPENCODE_GO_PATCH.patchedSha);
  expect(patchOpenCodeGo(patched)).toBe(patched);
  const headerOnly = OPENCODE_GO_PATCH.replacements.slice(0, 2).reduce((source, patch) => source.replace(patch.before, patch.after), original);
  expect(sha(headerOnly)).toBe(OPENCODE_GO_PATCH.headerOnlySha);
  expect(patchOpenCodeGo(headerOnly)).toBe(patched);
  expect(() => patchOpenCodeGo(original + '\n// upstream change')).toThrow(/Unknown DSH pi-ai artifact/);
  const first = OPENCODE_GO_PATCH.replacements[0]!;
  expect(() => patchOpenCodeGo(original.replace(first.before, first.after))).toThrow(/Unknown DSH pi-ai artifact/);
});

type Headers = Record<string, string>;
type Transform = { transformHeaders?: (headers: Headers) => Headers };

function actualTransform(): (baseUrl: unknown, sessionId: unknown) => Transform {
  // Execute the exact injected runtime function, without mutating the shared dependency.
  return new Function('attributionHeaders', `${OPENCODE_GO_PATCH.after}\nreturn openCodeGoSessionTransform;`)(
    () => ({ 'user-agent': 'deepseek-harness/test (+https://github.com/deepseek-ai/deepseek-harness)' }),
  ) as (baseUrl: unknown, sessionId: unknown) => Transform;
}

test('Go URL matching keeps other subscriptions and lookalike endpoints unchanged', () => {
  const transform = actualTransform();
  for (const url of [
    'https://api.openai.com/v1',
    'https://chatgpt.com/backend-api/codex',
    'https://openrouter.ai/api/v1',
    'https://api.githubcopilot.com',
    'https://opencode.ai/zen/v1',
    'https://opencode.ai/zen/go/v10',
    'https://opencode.ai/zen/go/v1-extra',
    'https://opencode.ai.example.invalid/zen/go/v1',
    'https://example.invalid/zen/go/v1?target=opencode.ai',
    'https://opencode.ai:8443/zen/go/v1',
    'http://opencode.ai/zen/go/v1',
    'https://user:password@opencode.ai/zen/go/v1',
    'https://opencode.ai/zen/go/v1?custom=1',
    'https://opencode.ai/zen/go/v1#custom',
    'not a URL',
  ]) expect(transform(url, 'session-test'), url).toEqual({});
  for (const id of [undefined, null, '', ' \t']) {
    expect(transform('https://opencode.ai/zen/go/v1', id)).toEqual({});
  }
});

test('Go headers preserve auth and are isolated across concurrent conversations', () => {
  const transform = actualTransform();
  const input = {
    authorization: 'Bearer synthetic-key',
    'x-client-custom': 'custom-value',
    'X-OpenCode-Session': 'old-session',
    'USER-AGENT': 'old-client',
  };
  const before = { ...input };
  const a = transform('https://OPENCODE.AI:443/zen/go/', 'session-A').transformHeaders!;
  const b = transform('https://opencode.ai/zen/go/v1', 'session-B').transformHeaders!;
  expect(a(input)['x-opencode-session']).toBe('session-A');
  expect(b(input)['x-opencode-session']).toBe('session-B');
  expect(a(input)['x-opencode-session']).toBe('session-A');
  expect(input).toEqual(before);
  expect(a(input)).toEqual({
    authorization: 'Bearer synthetic-key',
    'x-client-custom': 'custom-value',
    'x-opencode-session': 'session-A',
    'user-agent': 'Notara (+https://github.com/TongZi2003/Notara) deepseek-harness/test (+https://github.com/deepseek-ai/deepseek-harness)',
  });
});
