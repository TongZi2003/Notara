import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FONT_PATH, NOTEBOOK_FONT_URL, createFontHandler, createLazyHandler, createPdfResourceHandler } from './font-route.js';
import { PDF_RESOURCE_FILES, PDF_RESOURCE_PATH } from './pdf-resources.js';
import { LAZY_FILES, LAZY_PATH, lazyUrl } from './lazy-assets.js';
import { access, readFile } from 'node:fs/promises';

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

test('lazy modules are served only from their allowlist, as JavaScript', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notara-lazy-'));
  await writeFile(join(dir, 'pdf.min.mjs'), 'export const ok = 1;');
  await writeFile(join(dir, 'secret.mjs'), 'nope');
  const handler = createLazyHandler(dir);
  const got = await call(handler, 'GET', lazyUrl('pdf.min.mjs'));
  assert.equal(got.status, 200);
  assert.equal(got.headers['content-type'], 'text/javascript');
  for (const url of [`${LAZY_PATH}/secret.mjs`, `${LAZY_PATH}/../index.js`, `${LAZY_PATH}/`, `${LAZY_PATH}/sub/pdf.min.mjs`]) assert.equal((await call(handler, 'GET', url)).status, 404, url);
  assert.equal((await call(handler, 'GET', lazyUrl('pdf.worker.min.mjs'))).status, 404, 'a missing build file is a 404, not a crash');
  assert.throws(() => lazyUrl('other.mjs'), /lazy_module_unknown/);
});

test('the build ships every lazy module and the bundle no longer carries pdfjs', async () => {
  for (const name of Object.keys(LAZY_FILES)) await access(new URL(`./lazy/${name}`, import.meta.url));
  const bundle = await readFile(new URL('./client.js', import.meta.url), 'utf8');
  assert.ok(Buffer.byteLength(bundle) < 3_000_000, 'the startup bundle stays well under the old 6 MB');
  assert.doesNotMatch(bundle, /pdfjsVersion|PDFWorker\b.*WorkerMessageHandler/);
});

test('PDF resources serve only exact packaged names and preserve WASM and font MIME types', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notara-pdf-resources-'));
  await mkdir(join(dir, 'cmaps')); await mkdir(join(dir, 'wasm')); await mkdir(join(dir, 'standard_fonts'));
  const files = ['cmaps/Adobe-GB1-UCS2.bcmap', 'wasm/openjpeg.wasm', 'standard_fonts/LiberationSans-Regular.ttf'];
  for (const name of files) await writeFile(join(dir, name), 'trusted test resource');
  const handler = createPdfResourceHandler(dir);
  for (const name of files) {
    const got = await call(handler, 'GET', `${PDF_RESOURCE_PATH}/${name}`);
    assert.equal(got.status, 200); assert.equal(got.headers['content-type'], PDF_RESOURCE_FILES[name]);
    assert.equal(got.headers['x-content-type-options'], 'nosniff');
    assert.equal((await call(handler, 'HEAD', `${PDF_RESOURCE_PATH}/${name}`)).body, undefined);
  }
  for (const name of ['cmaps/unknown.bcmap','../index.js','cmaps/%2e%2e/index.js','cmaps%2fAdobe-GB1-UCS2.bcmap','wasm/openjpeg.wasm/extra',''])
    assert.equal((await call(handler, 'GET', `${PDF_RESOURCE_PATH}/${name}`)).status, 404, name);
  assert.equal((await call(handler, 'POST', `${PDF_RESOURCE_PATH}/wasm/openjpeg.wasm`)).status, 405);
  assert.equal((await call(handler, 'GET', `${PDF_RESOURCE_PATH}/wasm/jbig2.wasm`)).status, 404, 'missing build resources must fail clearly');
});

test('every reviewed PDF resource including decoder licenses is shipped by the build', async () => {
  for (const name of Object.keys(PDF_RESOURCE_FILES)) await access(new URL(`./pdf-resources/${name}`, import.meta.url));
});
