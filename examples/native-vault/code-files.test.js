import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODE_LANGUAGES, isCodePath, mediaForPath } from './media.js';
import { createVaultStore } from './vault.js';

test('code files are text the Vault lists, each with a known editor language', () => {
  for (const [path, language] of [['代码/hog.py', 'python'], ['lab/scheme.scm', 'scheme'], ['q.sql', 'sql'], ['os/proc.c', 'c'], ['a.cpp', 'cpp'],
    ['Main.java', 'java'], ['web/app.js', 'javascript'], ['types.ts', 'typescript'], ['main.go', 'go'], ['lib.rs', 'rust'], ['run.sh', 'shell'],
    ['adder.v', 'verilog'], ['alu.vhd', 'vhdl'], ['boot.s', 'asm'], ['notes.txt', 'text']]) {
    const media = mediaForPath(path);
    assert.equal(media.kind, 'code', path);
    assert.equal(media.language, language, path);
    assert.equal(media.mime, 'text/plain', path);
    assert.ok(CODE_LANGUAGES[language], language);
    assert.equal(isCodePath(path), true, path);
  }
  for (const path of ['知识/向量.md', 'media/a.png', 'book.pdf', 'no-extension', '', undefined, 42]) assert.equal(isCodePath(path), false, String(path));
});

test('a code file is listed and saved through the asset path with its version check', async t => {
  const root = await mkdtemp(join(tmpdir(), 'notara-code-files-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '代码'), { recursive: true });
  await writeFile(join(root, '代码', 'hog.py'), 'def roll(n):\n    return n\n');
  const store = createVaultStore(root);
  const listed = await store.list();
  const entry = JSON.stringify(listed);
  assert.match(entry, /代码\/hog\.py/, 'the tree shows the code file');
  const asset = await store.readAsset('代码/hog.py');
  assert.equal(asset.assetKind, 'code');
  assert.equal(Buffer.from(asset.dataUrl.split(',')[1], 'base64').toString('utf8'), 'def roll(n):\n    return n\n');
  const next = Buffer.from('def roll(n):\n    return n + 1\n').toString('base64');
  await assert.rejects(store.saveAsset('代码/hog.py', next, 'text/plain', 'stale'), /vault_revision_conflict/);
  const saved = await store.saveAsset('代码/hog.py', next, 'text/plain', asset.revision);
  assert.notEqual(saved.revision, asset.revision);
});
