/**
 * The browser plugin's Host entry. Its one job is serving the offline notebook
 * faces: the client bundle must not inline seven OFL fonts as data URLs, so the
 * theme loads a face on demand from the fixed, cacheable route below.
 *
 * `scripts/build.ts` copies `assets/notebook/` to `lib/notebook/`, i.e. beside
 * the emitted `lib/types/index.js`, so `../notebook/fonts/<name>` is the built
 * layout as well as the isolated-runtime plugin layout.
 */
/// <reference types="node" />
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';

/** Fixed route prefix; a prefix seat keeps the SPA fallback away from font paths. */
const FONT_PATH = '/studyforge/notebook/fonts';
/** Built layout: `lib/types/index.js` sits beside the copied `lib/notebook/`. */
const FONT_ROOT = new URL('../notebook/fonts/', import.meta.url);
/** The complete allowlist. Nothing outside it is ever read or resolved. */
const FONT_FILES = new Set([
  'caveat.woff2',
  'kalam.woff2',
  'longcang.woff2',
  'mashanzheng.woff2',
  'patrickhand.woff2',
  'wenkai.woff2',
  'zhimangxing.woff2',
]);

/** GET/HEAD one allowlisted face; every other method, name and path answers 404/405. */
const serveFont: WebRoute['handler'] = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return;
  }
  const pathname = new URL(req.url ?? '/', 'http://x').pathname;
  const name = pathname.startsWith(`${FONT_PATH}/`) ? pathname.slice(FONT_PATH.length + 1) : '';
  if (!FONT_FILES.has(name)) {
    res.writeHead(404);
    res.end();
    return;
  }
  let bytes: Uint8Array;
  try {
    bytes = await readFile(fileURLToPath(new URL(name, FONT_ROOT)));
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    'content-type': 'font/woff2',
    'content-length': String(bytes.byteLength),
    'cache-control': 'public, max-age=31536000',
  });
  res.end(req.method === 'HEAD' ? undefined : bytes);
};

const notebookFontRoute: WebRoute = { kind: 'prefix', path: FONT_PATH, handler: serveFont };

export function apply(ctx: Context): void {
  // The child plugin waits for the web carrier only; electron and other
  // non-web carriers load this entry without waiting for `webServer`.
  ctx.plugin({
    name: 'studyforge-notebook-fonts',
    inject: ['webServer'],
    apply(scope) {
      scope.effect(() => scope.webServer.register(notebookFontRoute));
    },
  });
}
