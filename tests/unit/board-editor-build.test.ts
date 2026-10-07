import { expect, test } from 'vitest';
import { rewriteExcalidrawFontFallback, validateExcalidrawFontFallbackSources } from '../../scripts/board-editor-build.ts';

const anchor = ',"ASSETS_FALLBACK_URL",`https://esm.sh/@excalidraw/excalidraw/dist/prod/`)';

test('Excalidraw font fallback is rewritten and the locked package contract cannot disappear silently', () => {
  const source = `before${anchor}after`;
  validateExcalidrawFontFallbackSources([source, 'unrelated chunk']);
  expect(rewriteExcalidrawFontFallback(source)).toContain('new URL("/notara/vault/lazy/excalidraw/",location.origin).href');
  expect(rewriteExcalidrawFontFallback('unrelated chunk')).toBeNull();
  expect(() => validateExcalidrawFontFallbackSources(['unrelated chunk'])).toThrow(/expected one anchored chunk, found 0/);
  expect(() => rewriteExcalidrawFontFallback(`${source}${anchor}`)).toThrow(/contract changed/);
});
