import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMathScene, parabolaPath, scenePointFromPointer, sceneEquation } from './interactive-math-client.js';

const parabola = () => ({ preset: 'parabola', parameters: { a: 0.8, h: 1, k: -1 } });

test('maps the same scene into compact and expanded SVG without changing its values', () => {
  const scene = normalizeMathScene(parabola());
  assert.match(parabolaPath(scene, { width: 340, height: 210 }), /^M/);
  assert.match(parabolaPath(scene, { width: 720, height: 430 }), /^M/);
  assert.equal(scene.parameters.h, 1);
  assert.equal(sceneEquation(scene), 'y = 0.8(x - 1)² - 1');
});

test('pointer mapping clamps the vertex to the scene viewport', () => {
  const scene = normalizeMathScene(parabola());
  assert.deepEqual(scenePointFromPointer(scene, { width: 340, height: 210 }, { x: -99, y: 999 }), { h: -5, k: -5 });
});
