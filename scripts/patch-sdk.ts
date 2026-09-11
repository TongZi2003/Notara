import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(project, 'node_modules/@deepseek-ai/dsh-typert-generator/lib/index.js');
const original = "06a187cfc6c7e12eb88d260dc7a5d09029159a17cf9a9a54bea4e27939d0b009";
const patched = "59f8200e082408255a5dd64d78850b69890c288f0a85d531ad379db9f697247e";
const before = "\t\tif (this.registrationForFile(declaration.getSourceFile().fileName)?.name === \"@deepseek-ai/dsh-typert-protocol\") return true;";
const after = "\t\tif (this.registrationForFile(declaration.getSourceFile().fileName)?.name === \"@deepseek-ai/dsh-typert-protocol\") return true;\n\t\tif (externalModuleIdentityForFile(declaration.getSourceFile().fileName)?.package === \"@deepseek-ai/dsh-typert-protocol\") return true;";
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const source = readFileSync(file, 'utf8');
const digest = sha(source);
if (digest !== patched) {
  if (digest !== original) throw new Error('Unknown DSH generator artifact; review the version before patching');
  const result = source.replace(before, after);
  if (sha(result) !== patched) throw new Error('DSH generator patch digest mismatch');
  writeFileSync(file, result);
}
console.log('Verified rc.2 generator npm-declaration fix');

// The published subagent entry loads projection value types but omits their
// corresponding state augmentations from its declaration graph. TS6 then
// rejects SessionProjectionRegistry.register itself. Import the package's own
// declarations; do not duplicate SDK types or change executable runtime code.
const subagentFile = join(project, 'node_modules/@deepseek-ai/dsh-subagent/lib/types/index.d.ts');
const subagentOriginal = '069745a90031d6f5fa77250da37a062ecf1d76d5b4cce46ac602d6549fa9e0ec';
const subagentPatched = 'f5916c9aa816edab64a756af3f164319fa0e7d9eb4c85ddf04067acf9f7ebb91';
const subagentSource = readFileSync(subagentFile, 'utf8');
if (sha(subagentSource) !== subagentPatched) {
  if (sha(subagentSource) !== subagentOriginal) throw new Error('Unknown DSH subagent declaration; review the version before patching');
  const result = 'import type {} from "./projection.ts";\nimport type {} from "./catalog.ts";\n' + subagentSource;
  if (sha(result) !== subagentPatched) throw new Error('DSH subagent declaration patch digest mismatch');
  writeFileSync(subagentFile, result);
}
console.log('Verified rc.2 subagent projection declaration imports');
