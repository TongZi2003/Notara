import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, stat } from 'node:fs/promises';

const here = new URL('./', import.meta.url);
const exists = async path => stat(new URL(path, here)).then(() => true, () => false);

/** Relative modules one Host file imports, statically or dynamically. */
async function relativeImports(path) {
  const source = await readFile(new URL(path, here), 'utf8');
  return [...source.matchAll(/(?:from|import)\s*\(?\s*['"]\.\/([^'"]+)['"]/g)].map(match => match[1]);
}

test('the published package carries every module its Host entries import', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', here), 'utf8'));
  const files = new Set(pkg.files);
  const covered = path => files.has(path) || files.has(path.split('/')[0]);
  // client.js is a bundle; every other listed module runs in the Host.
  const pending = [...files].filter(path => path.endsWith('.js') && path !== 'client.js');
  const seen = new Set(), missing = [];
  while (pending.length) {
    const path = pending.pop();
    if (seen.has(path) || !(await exists(path))) continue;
    seen.add(path);
    for (const target of await relativeImports(path)) {
      if (!covered(target)) missing.push(`${target} (imported by ${path})`);
      pending.push(target);
    }
  }
  assert.deepEqual(missing, []);
});
