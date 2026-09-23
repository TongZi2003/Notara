import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';

export const CLASSROOM_PATH = '/notara/pixel-classroom';
const SITE_ROOT = fileURLToPath(new URL('./dist/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

/** DSH owns authentication and the listening socket; this plugin serves only
 * its built demo and artwork. It has no tools, model route or Vault access. */
export function createClassroomHandler(root = SITE_ROOT) {
  const site = resolve(root);
  return async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method ?? '')) {
      res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname); }
    catch { res.writeHead(400); res.end(); return; }
    if (pathname === CLASSROOM_PATH) {
      res.writeHead(302, { location: `${CLASSROOM_PATH}/` }); res.end(); return;
    }
    if (!pathname.startsWith(`${CLASSROOM_PATH}/`)) {
      res.writeHead(404); res.end(); return;
    }
    const relative = pathname.slice(CLASSROOM_PATH.length + 1) || 'index.html';
    const path = resolve(site, relative);
    if (!path.startsWith(site + sep)) { res.writeHead(403); res.end(); return; }
    try {
      const body = await readFile(path);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(path)] ?? 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'",
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404); res.end('Not found'); }
  };
}

export function apply(ctx) {
  ctx.plugin({
    name: 'notara-pixel-classroom-web', inject: ['webServer'],
    apply(scope) {
      scope.effect(() => scope.webServer.register({ kind: 'prefix', path: CLASSROOM_PATH, handler: createClassroomHandler() }));
    },
  });
}
