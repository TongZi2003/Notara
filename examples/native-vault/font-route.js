import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * The notebook's handwriting face, served by the Host on its own route so the
 * browser downloads it only when the 手帐 look is chosen; the minimal theme
 * never references it. The build copies it into `fonts/` beside this file.
 */
export const FONT_PATH = '/notara/vault/fonts';
const FONT_FILES = new Set(['wenkai.woff2']);
export const NOTEBOOK_FONT_URL = `${FONT_PATH}/wenkai.woff2`;
const FONT_ROOT = fileURLToPath(new URL('./fonts/', import.meta.url));

/** GET/HEAD one allowlisted face; every other method answers 405, every other path 404. */
export function createFontHandler(root = FONT_ROOT) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return; }
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const name = pathname.startsWith(`${FONT_PATH}/`) ? pathname.slice(FONT_PATH.length + 1) : '';
    if (!FONT_FILES.has(name)) { res.writeHead(404); res.end(); return; }
    let bytes;
    try { bytes = await readFile(join(root, name)); } catch { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'font/woff2', 'content-length': String(bytes.byteLength), 'cache-control': 'public, max-age=31536000', 'x-content-type-options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  };
}

/** The route waits for the web carrier only; other carriers load the plugin without it. */
export function installFontRoute(ctx) {
  ctx.plugin({
    name: 'notara-vault-fonts', inject: ['webServer'],
    apply(scope) { scope.effect(() => scope.webServer.register({ kind: 'prefix', path: FONT_PATH, handler: createFontHandler() })); },
  });
}
