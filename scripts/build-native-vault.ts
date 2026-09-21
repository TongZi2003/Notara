import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const result = await build({
  entryPoints: [resolve('examples/native-vault/client-source.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  external: ['react'],
  legalComments: 'none',
  write: false,
  plugins: [{ name: 'local-pdf-worker', setup(builder) {
    builder.onLoad({ filter: /pdf\.worker(?:\.min)?\.mjs$/ }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
  } }],
});

const outputFile = result.outputFiles[0];
if (!outputFile) throw new Error('native-vault client build produced no output');
const output = outputFile.text.replace(/[ \t]+$/gm, '');
await writeFile(resolve('examples/native-vault/client.js'), output);
console.log(`native-vault client: ${Buffer.byteLength(output)} bytes`);
