/**
 * Offline notebook faces over the real HTTP carrier.
 *
 * The seven OFL faces must not be inlined into the browser bundle, so the
 * client package's Host entry registers one fixed route on the published
 * `ctx.webServer` service and reads the bytes from `../notebook/fonts/<name>`
 * next to its own module URL (the `lib/types/index.js` + `lib/notebook/`
 * layout `scripts/build.ts` produces). This test mounts the real
 * `@deepseek-ai/dsh-host-webserver` on an OS-assigned port and loads the real
 * Host entry from a `.runtime` sandbox whose directory shape is that built
 * layout, so no build is required and no shared artifact is touched.
 */

import { afterEach, expect, test } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import WebServer from '@deepseek-ai/dsh-host-webserver';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = fileURLToPath(new URL('../..', import.meta.url));
const FONT_PATH = '/studyforge/notebook/fonts';
const FONT_FILES = ['caveat.woff2', 'kalam.woff2', 'longcang.woff2', 'mashanzheng.woff2', 'patrickhand.woff2', 'wenkai.woff2', 'zhimangxing.woff2'];
const SOURCE_ASSETS = join(project, 'packages/client/assets/notebook');

interface Mounted {
  ctx: Context;
  origin: string;
}

const contexts: Context[] = [];
const sandboxes: string[] = [];

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose();
  for (const sandbox of sandboxes.splice(0).reverse()) await rm(sandbox, { recursive: true, force: true });
});

/** Load the real Host entry beside a copy of the real assets, as the build emits them. */
async function mount(): Promise<Mounted> {
  const sandbox = join(project, '.runtime', `notebook-fonts-${crypto.randomUUID()}`);
  await mkdir(sandbox, { recursive: true });
  await cp(join(project, 'packages/client/src'), join(sandbox, 'src'), { recursive: true });
  await cp(SOURCE_ASSETS, join(sandbox, 'notebook'), { recursive: true });
  sandboxes.push(sandbox);
  const ctx = new Context();
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 });
  contexts.push(ctx);
  const entry = await import(/* @vite-ignore */ pathToFileURL(join(sandbox, 'src/index.ts')).href) as { apply(ctx: Context): void };
  await ctx.plugin(entry);
  const origin = `http://127.0.0.1:${ctx.webServer.port}`;
  await waitForRoute(origin);
  return { ctx, origin };
}

/** The client plugin injects `webServer`, so the route lands one microtask later. */
async function waitForRoute(origin: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const response = await fetch(`${origin}${FONT_PATH}/wenkai.woff2`, { method: 'POST' });
    await response.arrayBuffer();
    if (response.status === 405) return;
    if (Date.now() > deadline) throw new Error(`notebook font route never registered (status ${response.status})`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

test('serves every allowlisted face with the real bytes and a cacheable font response', async () => {
  const { origin } = await mount();
  for (const name of FONT_FILES) {
    const response = await fetch(`${origin}${FONT_PATH}/${name}`);
    expect(response.status, name).toBe(200);
    expect(response.headers.get('content-type'), name).toBe('font/woff2');
    expect(response.headers.get('cache-control'), name).toContain('max-age=');
    const served = new Uint8Array(await response.arrayBuffer());
    const source = await readFile(join(SOURCE_ASSETS, 'fonts', name));
    expect(served.byteLength, name).toBe(source.byteLength);
    expect(digest(served), name).toBe(digest(source));
  }
});

test('HEAD answers the same headers without a body', async () => {
  const { origin } = await mount();
  const response = await fetch(`${origin}${FONT_PATH}/longcang.woff2`, { method: 'HEAD' });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('font/woff2');
  const source = await readFile(join(SOURCE_ASSETS, 'fonts', 'longcang.woff2'));
  expect(response.headers.get('content-length')).toBe(String(source.byteLength));
  expect((await response.arrayBuffer()).byteLength).toBe(0);
});

test('answers 404 for every name outside the allowlist, never by resolving a path', async () => {
  const { origin } = await mount();
  const outside = [
    `${FONT_PATH}`,
    `${FONT_PATH}/`,
    `${FONT_PATH}/missing.woff2`,
    `${FONT_PATH}/README.md`,
    `${FONT_PATH}/licenses/caveat.txt`,
    `${FONT_PATH}/%2e%2e%2f%2e%2e%2fpackage.json`,
    `${FONT_PATH}/nested/wenkai.woff2`,
  ];
  for (const path of outside) {
    const response = await fetch(origin + path);
    await response.arrayBuffer();
    expect(response.status, path).toBe(404);
  }
  // A query string is not part of the name and must not shadow the allowlist.
  const withQuery = await fetch(`${origin}${FONT_PATH}/kalam.woff2?v=1`);
  expect(withQuery.status).toBe(200);
  await withQuery.arrayBuffer();
});

test('rejects non-GET/HEAD methods and releases the route with the carrier', async () => {
  const { ctx, origin } = await mount();
  const posted = await fetch(`${origin}${FONT_PATH}/wenkai.woff2`, { method: 'POST' });
  await posted.arrayBuffer();
  expect(posted.status).toBe(405);
  expect(posted.headers.get('allow')).toBe('GET, HEAD');

  contexts.splice(contexts.indexOf(ctx), 1);
  await ctx.fiber.dispose();
  await expect(fetch(`${origin}${FONT_PATH}/wenkai.woff2`)).rejects.toThrow();
});
