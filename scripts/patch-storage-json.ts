import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STORAGE_JSON_PATCH, patchStorageJson } from './storage-json-patch.ts';
import { replaceFileAtomically } from './atomic-replace-file.ts';

// The caller imports this after npm ci. Do not install an unrecognized DSH
// artifact or silently continue with the original unguarded write path.
const file = fileURLToPath(new URL('../node_modules/' + STORAGE_JSON_PATCH.artifact, import.meta.url));
const source = readFileSync(file, 'utf8');
const patched = patchStorageJson(source);
if (patched !== source) await replaceFileAtomically(file, patched);
console.log('Verified DSH JSON storage bounded Windows rename retry');
