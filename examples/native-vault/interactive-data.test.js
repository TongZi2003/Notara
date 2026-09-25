import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInteractiveRef, validateMathScene, mathSceneSummary } from './interactive-data.js';

test('accepts a bounded parabola scene and normalizes defaults', () => {
  const scene = validateMathScene({ preset: 'parabola', parameters: { a: 0.8 } });
  assert.deepEqual(scene, {
    kind: 'math',
    preset: 'parabola',
    viewport: [-5, 5, 5, -5],
    parameters: { a: 0.8, h: 0, k: 0 },
    observation: '',
  });
  assert.equal(mathSceneSummary(scene), 'y = 0.8(x - 0)² + 0');
});

test('rejects arbitrary HTML, scripts, external URLs and invalid parameters', () => {
  assert.throws(() => validateMathScene({ preset: 'parabola', html: '<script>1</script>' }), /interactive_scene_invalid/);
  assert.throws(() => validateMathScene({ preset: 'parabola', parameters: { a: 0 } }), /interactive_scene_invalid/);
  assert.throws(() => validateMathScene({ preset: 'parabola', parameters: { a: 4 } }), /interactive_scene_invalid/);
  assert.throws(() => validateMathScene({ preset: 'parabola', links: ['https://example.com'] }), /interactive_scene_invalid/);
});

test('rejects an interaction reference with a non-whitelisted provider', () => {
  assert.throws(() => validateInteractiveRef({ provider: 'html', interactionId: 'x', revision: 0, preset: 'parabola' }), /interactive_ref_invalid/);
});

test('accepts a Host content revision in an interaction reference', () => {
  assert.deepEqual(validateInteractiveRef({
    provider: 'math', interactionId: '123e4567-e89b-12d3-a456-426614174000', revision: 'a'.repeat(24), preset: 'parabola',
  }), {
    provider: 'math', interactionId: '123e4567-e89b-12d3-a456-426614174000', revision: 'a'.repeat(24), preset: 'parabola',
  });
});
