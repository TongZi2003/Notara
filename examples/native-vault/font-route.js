import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { LAZY_FILES, LAZY_PATH } from './lazy-assets.js';

/**
 * Files the client fetches only when a feature needs them, each on its own Host
 * route so the startup bundle never carries them: the notebook's handwriting
 * face (only the 手帐 look references it) and the large lazy modules — the PDF
 * reader and its worker, the figure engine. The build copies them into
 * `fonts/` and `lazy/` beside this file; every route is an explicit allowlist.
 */
export const FONT_PATH = '/notara/vault/fonts';
const FONT_FILES = { 'wenkai.woff2': 'font/woff2' };
export const NOTEBOOK_FONT_URL = `${FONT_PATH}/wenkai.woff2`;
const FONT_ROOT = fileURLToPath(new URL('./fonts/', import.meta.url));

const LAZY_ROOT = fileURLToPath(new URL('./lazy/', import.meta.url));

function createStaticHandler(prefix, files, root) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return; }
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const name = pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length + 1) : '';
    if (!Object.hasOwn(files, name)) { res.writeHead(404); res.end(); return; }
    let bytes;
    try { bytes = await readFile(join(root, name)); } catch { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': files[name], 'content-length': String(bytes.byteLength), 'cache-control': 'public, max-age=31536000', 'x-content-type-options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  };
}

/** GET/HEAD one allowlisted face; every other method answers 405, every other path 404. */
export function createFontHandler(root = FONT_ROOT) {
  return createStaticHandler(FONT_PATH, FONT_FILES, root);
}

/** GET/HEAD one allowlisted lazy module, under the same rules as the fonts. */
export function createLazyHandler(root = LAZY_ROOT) {
  return createStaticHandler(LAZY_PATH, LAZY_FILES, root);
}

/** The routes wait for the web carrier only; other carriers load the plugin without them. */
export function installFontRoute(ctx) {
  ctx.plugin({
    name: 'notara-vault-fonts', inject: ['webServer'],
    apply(scope) {
      scope.effect(() => scope.webServer.register({ kind: 'prefix', path: FONT_PATH, handler: createFontHandler() }));
      scope.effect(() => scope.webServer.register({ kind: 'prefix', path: LAZY_PATH, handler: createLazyHandler() }));
    },
  });
}
