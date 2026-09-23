import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

test('the browser entry has no unresolved identifiers in deferred event handlers', () => {
  const entry = fileURLToPath(new URL('./client-source.ts', import.meta.url));
  // esbuild can bundle an unbound name successfully: a missing import only
  // throws later when a reader sends a PDF reference through the composer.
  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true, checkJs: false, noEmit: true, skipLibCheck: true,
  });
  const unresolved = program.getSemanticDiagnostics()
    .filter(item => item.file?.fileName === entry && [2304, 2552].includes(item.code))
    .map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n'));
  assert.deepEqual(unresolved, []);
});
