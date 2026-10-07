import { test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MODEL_DISCOVERY_UI_PATCH as patch, patchModelDiscovery } from '../../scripts/patch-model-discovery.ts';
test('locked discovery UI patch is reversible, idempotent and rejects partial/unknown changes', () => {
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const installed = readFileSync(`node_modules/${patch.artifact}`, 'utf8');
  expect(hash(installed)).toBe(patch.patchedSha);
  const original = [...patch.replacements].reverse().reduce((source, replacement) => source.replace(replacement.after, replacement.before), installed);
  expect(hash(original)).toBe(patch.originalSha);
  expect(patchModelDiscovery(original)).toBe(installed);
  expect(patchModelDiscovery(installed)).toBe(installed);
  expect(() => patchModelDiscovery(original + '\n')).toThrow(/Unknown/);
});
