import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { ACADEMY, CHARACTERS, ACADEMY_FILES, academyUrl } from './academy.js';
import { createAcademyHandler } from './font-route.js';

test('the gallery carries nine full character sheets and biographies, with no promotional posters', async () => {
  assert.equal(CHARACTERS.length, 9); assert.equal(ACADEMY.posters, undefined);
  for (const character of CHARACTERS) { assert.equal(character.sections.length, 6); assert.ok(character.age >= 18); }
  assert.equal(Object.keys(ACADEMY_FILES).filter(name => name.endsWith('.webp')).length, 9);
  for (const name of Object.keys(ACADEMY_FILES)) await access(new URL(`./academy/${name}`, import.meta.url));
});

test('gallery assets, scripts and page are served through the exact read-only allowlist', async () => {
  const handler = createAcademyHandler();
  const call = async (method, url) => {
    const got = {};
    await handler({ method, url }, { writeHead(status, headers) { Object.assign(got, { status, headers }); }, end(body) { got.body = body; } });
    return got;
  };
  for (const name of Object.keys(ACADEMY_FILES)) {
    const got = await call('GET', academyUrl(name));
    assert.equal(got.status, 200); assert.equal(got.headers['content-type'], ACADEMY_FILES[name]); assert.ok(got.body.length > 100);
  }
  assert.equal((await call('HEAD', academyUrl('gallery.html'))).body, undefined);
  for (const path of ['../index.js','%2e%2e/index.js','originals/wen-zhiqiu.png','notara-poster.webp','wen-zhiqiu-poster.webp','academy-lineup.webp','private.json']) assert.equal((await call('GET', `/notara/vault/academy/${path}`)).status, 404);
  assert.equal((await call('POST', academyUrl('gallery.html'))).status, 405);
  assert.throws(() => academyUrl('private.json'), /unknown/);
});
