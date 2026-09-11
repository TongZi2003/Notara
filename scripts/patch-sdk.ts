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
