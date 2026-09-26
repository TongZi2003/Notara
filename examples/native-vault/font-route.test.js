import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FONT_PATH, NOTEBOOK_FONT_URL, createFontHandler } from './font-route.js';

async function call(handler, method, url) {
  const response = { status: 0, headers: {}, body: undefined };
  await handler({ method, url }, {
    writeHead(status, headers = {}) { response.status = status; response.headers = headers; },
    end(body) { response.body = body; },
  });
  return response;
}

async function root(withFont = true) {
  const dir = await mkdtemp(join(tmpdir(), 'notara-fonts-'));
  if (withFont) await writeFile(join(dir, 'wenkai.woff2'), Buffer.from('wOF2-test-bytes'));
  return dir;
}

test('the one allowlisted face is served as a long-cached woff2', async () => {
  const handler = createFontHandler(await root());
  assert.equal(NOTEBOOK_FONT_URL, `${FONT_PATH}/wenkai.woff2`);
  const got = await call(handler, 'GET', NOTEBOOK_FONT_URL);
  assert.equal(got.status, 200);
  assert.equal(got.headers['content-type'], 'font/woff2');
  assert.match(got.headers['cache-control'], /max-age=31536000/);
  assert.equal(got.headers['content-length'], String(Buffer.byteLength('wOF2-test-bytes')));
  assert.equal(Buffer.from(got.body).toString(), 'wOF2-test-bytes');
  const head = await call(handler, 'HEAD', `${NOTEBOOK_FONT_URL}?v=1`);
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined, 'HEAD sends no body');
});

test('nothing else under the prefix is ever read', async () => {
  const handler = createFontHandler(await root());
  for (const url of [`${FONT_PATH}/kalam.woff2`, `${FONT_PATH}/`, FONT_PATH, `${FONT_PATH}/../index.js`, `${FONT_PATH}/%2e%2e/index.js`, `${FONT_PATH}/sub/wenkai.woff2`]) {
    assert.equal((await call(handler, 'GET', url)).status, 404, url);
  }
  const post = await call(handler, 'POST', NOTEBOOK_FONT_URL);
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
});

test('a build without the font answers 404 instead of failing', async () => {
  const handler = createFontHandler(await root(false));
  assert.equal((await call(handler, 'GET', NOTEBOOK_FONT_URL)).status, 404);
});

test('the notebook stylesheet asks for the face on exactly the route the Host serves', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('./notebook-theme.css', import.meta.url), 'utf8');
  assert.ok(css.includes(`url("${NOTEBOOK_FONT_URL}")`), 'the @font-face points at the Host route');
  const minimal = await readFile(new URL('./modern-theme.css', import.meta.url), 'utf8');
  assert.ok(!minimal.includes('woff2'), 'the minimal theme never references the notebook face');
});
