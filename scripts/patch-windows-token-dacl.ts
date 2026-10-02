import { readFileSync, writeFileSync } from 'node:fs';
import { WINDOWS_TOKEN_DACL_PATCH, patchWindowsTokenDacl } from './windows-token-dacl-patch.ts';

// Run on every platform: release bundles must install the same verified source.
const file = new URL('../node_modules/' + WINDOWS_TOKEN_DACL_PATCH.artifact, import.meta.url);
const source = readFileSync(file, 'utf8');
const patched = patchWindowsTokenDacl(source);
if (patched !== source) writeFileSync(file, patched);
console.log('Verified DSH Windows restricted-token creator default DACL');
