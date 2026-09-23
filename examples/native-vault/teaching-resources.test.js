import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { teachingManifest, teachingResource } from './teaching-catalog.js';
import { apply } from './teacher.js';

const sourceRoot = new URL('../../resources/vault-teaching/', import.meta.url);
const bundleRoot = new URL('./teaching/', import.meta.url);

async function files(root, prefix = '') {
  const result = [];
  for (const item of await readdir(new URL(prefix, root), { withFileTypes: true })) {
    const name = `${prefix}${item.name}`;
    if (item.isDirectory()) result.push(...await files(root, `${name}/`));
    else result.push(name);
  }
  return result.sort();
}

test('the active teaching bundle is fresh, complete and has no retired leftover files', async () => {
  const sourceFiles = await files(sourceRoot);
  assert.deepEqual(await files(bundleRoot), sourceFiles, 'build the teaching bundle before testing');
  for (const name of sourceFiles) {
    assert.equal(await readFile(new URL(name, bundleRoot), 'utf8'), await readFile(new URL(name, sourceRoot), 'utf8'), name);
  }
  assert.deepEqual(teachingManifest, JSON.parse(await readFile(new URL('manifest.json', sourceRoot), 'utf8')));
});

test('the real teacher Skill provider lists distinct locators and retrieves each selected resource', async () => {
  let provider;
  apply({ effect: fn => fn(), skills: { registerProvider: create => { provider = create(); } } });
  const listed = await provider.list({});
  const rows = [...teachingManifest.choices, ...teachingManifest.skills];
  assert.equal(new Set(listed.map(row => row.name)).size, rows.length);
  assert.equal(new Set(listed.map(row => row.locator)).size, rows.length);
  for (const item of rows) {
    const entry = listed.find(row => row.name === `notara-${item.id}`);
    assert.ok(entry, item.id);
    assert.equal(entry.locator, item.file);
    const resource = await provider.get(entry);
    assert.equal(resource.content, teachingResource(item.file));
    assert.ok(resource.content.trim(), item.id);
    assert.equal(resource.name, entry.name);
  }
  for (const id of ['math', 'physics', 'chemistry', 'computing', 'chinese', 'english', 'science', 'humanities']) {
    assert.ok(listed.some(row => row.name === `notara-subject-${id}`), id);
  }
  for (const id of ['material-search', 'teaching-reflection', 'learning-review']) {
    const entry = listed.find(row => row.name === `notara-${id}`);
    assert.ok(entry, id);
    assert.deepEqual(entry.invocation, { modelInvocable: true, userInvocable: true });
  }
  assert.equal(teachingManifest.skills.find(row => row.id === 'teaching-reflection').menu, 'more');
  assert.notEqual(teachingManifest.skills.find(row => row.id === 'learning-review').menu, 'more');
  assert.deepEqual(teachingManifest.choices.map(row => row.id), ['socratic', 'feynman', 'lecture', 'structural']);
  assert.deepEqual(await provider.list({ signal: AbortSignal.abort() }), []);
});
