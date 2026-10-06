import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EXCALIDRAW_ASSETS, EXCALIDRAW_FONT_LICENSES, EXCALIDRAW_FONT_NOTICE_FILE } from './excalidraw-assets.js';
import { LAZY_FILES } from './lazy-assets.js';

const root = resolve(import.meta.dirname, '../..');

test('every locked Excalidraw font family has a packaged third-party notice', async () => {
  const manifestFamilies = [...new Set(Object.keys(EXCALIDRAW_ASSETS)
    .filter(name => name.startsWith('excalidraw/fonts/'))
    .map(name => name.split('/')[2]))].sort();
  const licensedFamilies = Object.values(EXCALIDRAW_FONT_LICENSES).flat().sort();
  assert.deepEqual(licensedFamilies, manifestFamilies);

  const notice = await readFile(resolve(root, 'resources/licenses/excalidraw-fonts-notices.txt'), 'utf8');
  const packagedNotice = await readFile(resolve(import.meta.dirname, 'lazy/excalidraw/fonts', EXCALIDRAW_FONT_NOTICE_FILE), 'utf8');
  assert.equal(packagedNotice, notice, 'generated plugin snapshot must carry the exact source notice');
  for (const family of manifestFamilies) assert.match(notice, new RegExp(`### ${family}\\b`));
  assert.match(notice, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(notice, /MIT License/);
  assert.match(notice, /Cascadia Code repository license/);
  assert.match(notice, /Liberation Sans license evidence gap/);
  assert.match(notice, /license agreement under which you accepted the Liberation font software/);

  const packageManifest = JSON.parse(await readFile(resolve(import.meta.dirname, 'package.json'), 'utf8'));
  assert.ok(packageManifest.files.includes('lazy'), 'plugin package must include generated lazy resources');
  assert.equal(EXCALIDRAW_FONT_NOTICE_FILE, 'THIRD-PARTY-NOTICES.txt');
  assert.ok(!Object.hasOwn(LAZY_FILES, `excalidraw/fonts/${EXCALIDRAW_FONT_NOTICE_FILE}`), 'font notices are packaged beside assets, not exposed as a lazy browser route');
});
