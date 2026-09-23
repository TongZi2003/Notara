import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClassroomHandler, apply, CLASSROOM_PATH } from './index.js';

test('plugin serves nested assets with same-origin framing and rejects escapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'classroom-route-'));
  try {
    const site = join(root, 'site'); await mkdir(join(site, 'assets'), { recursive: true });
    await writeFile(join(site, 'index.html'), '<main>classroom</main>');
    await writeFile(join(site, 'assets/character.png'), Buffer.from([137, 80, 78, 71]));
    await writeFile(join(root, 'outside.txt'), 'outside');
    const handler = createClassroomHandler(site);
    const request = async (url, method = 'GET') => {
      const response = {};
      await handler({ url, method }, { writeHead(status, headers) { Object.assign(response, { status, headers }); }, end(body) { response.body = body; } });
      return response;
    };
    const html = await request(`${CLASSROOM_PATH}/`);
    assert.equal(html.status, 200); assert.equal(html.body.toString(), '<main>classroom</main>');
    assert.match(html.headers['Content-Security-Policy'], /frame-ancestors 'self'/);
    const image = await request(`${CLASSROOM_PATH}/assets/character.png`);
    assert.equal(image.headers['Content-Type'], 'image/png'); assert.equal(image.body.length, 4);
    assert.equal((await request(`${CLASSROOM_PATH}/`, 'HEAD')).body, undefined);
    assert.equal((await request(CLASSROOM_PATH)).headers.location, `${CLASSROOM_PATH}/`);
    assert.equal((await request(`${CLASSROOM_PATH}/missing`)).status, 404);
    assert.equal((await request(`${CLASSROOM_PATH}/`, 'POST')).status, 405);
    assert.equal((await request(`${CLASSROOM_PATH}/%2e%2e%2foutside.txt`)).status, 403);
    assert.equal((await request(`${CLASSROOM_PATH}/%ZZ`)).status, 400);
    assert.equal((await request('/elsewhere')).status, 404);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('native plugin registers a disposable DSH route without opening a server', () => {
  let registration, disposed = false;
  apply({ plugin(plugin) {
    assert.deepEqual(plugin.inject, ['webServer']);
    plugin.apply({ webServer: { register(route) { registration = route; return () => { disposed = true; }; } }, effect(start) { start()(); } });
  } });
  assert.equal(registration.path, CLASSROOM_PATH); assert.equal(registration.kind, 'prefix'); assert.equal(disposed, true);
});
