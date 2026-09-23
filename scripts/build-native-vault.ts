import './patch-session-extension.ts';
import './patch-input-source-filter.ts';
import './patch-skill-menu.ts';
import { build } from 'esbuild';
import { readFile, writeFile, cp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const KATEX_STYLES = resolve('node_modules/katex/dist/katex.min.css');
const LATEX_STYLES_PLACEHOLDER = '__NOTARA_VAULT_LATEX_CSS__';

/**
 * KaTeX ships a stylesheet that points at local webfont files. Inline the woff2
 * bytes as data URLs so formulas keep the real math fonts with no CDN request
 * and no second file to ship; the woff/ttf fallbacks drop out with it.
 */
async function inlineFonts(css: string, baseDir: string): Promise<string> {
  let inlined = css;
  for (const match of [...inlined.matchAll(/url\(([^)]+)\)/g)]) {
    const reference = match[1]!.trim().replace(/^["']|["']$/g, '');
    if (!reference.endsWith('.woff2') || reference.includes('://') || reference.startsWith('data:')) continue;
    const bytes = await readFile(resolve(baseDir, reference));
    inlined = inlined.replaceAll(match[0], `url(data:font/woff2;base64,${bytes.toString('base64')})`);
  }
  return inlined.replace(/,url\([^)]+\) format\("(?:woff|truetype)"\)/g, '');
}

const latexStyles = await inlineFonts(await readFile(KATEX_STYLES, 'utf8'), dirname(KATEX_STYLES));

const result = await build({
  entryPoints: [resolve('examples/native-vault/client-source.ts')],
  outfile: resolve('examples/native-vault/client.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  external: ['react'],
  legalComments: 'none',
  write: false,
  plugins: [
    { name: 'local-pdf-worker', setup(builder) {
      builder.onLoad({ filter: /pdf\.worker(?:\.min)?\.mjs$/ }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
    } },
    // A stylesheet belongs to the module that injects it (math-latex.js); the
    // default esbuild CSS output would be a file this plugin cannot ship, so
    // stylesheets enter the bundle as text and never as a sibling artifact.
    { name: 'vault-stylesheets', setup(builder) {
      builder.onLoad({ filter: /\.css$/ }, async args => ({ contents: await inlineFonts(await readFile(args.path, 'utf8'), dirname(args.path)), loader: 'text' }));
    } },
  ],
});

const outputs = result.outputFiles ?? [];
const script = outputs.find(file => file.path.endsWith('.js'));
if (!script) throw new Error('native-vault client build produced no JavaScript');
const unbundled = outputs.filter(file => !file.path.endsWith('.js')).map(file => file.path);
if (unbundled.length) throw new Error(`native-vault client build emitted an unshipped artifact: ${unbundled.join(', ')}`);
if (!script.text.includes(LATEX_STYLES_PLACEHOLDER)) throw new Error(`native-vault client build lost the LaTeX styles placeholder ${LATEX_STYLES_PLACEHOLDER}`);
const output = script.text
  .replace(/[ \t]+$/gm, '')
  .replace(JSON.stringify(LATEX_STYLES_PLACEHOLDER), () => JSON.stringify(latexStyles));
if (!output.includes('data:font/woff2;base64')) throw new Error('native-vault LaTeX webfonts were not inlined into the client bundle');
await writeFile(resolve('examples/native-vault/client.js'), output);
// This directory is generated. Retired prompts must not survive a rebuild.
await rm(resolve('examples/native-vault/teaching'), { recursive: true, force: true });
await cp(resolve('resources/vault-teaching'),resolve('examples/native-vault/teaching'),{recursive:true});
console.log(`native-vault client: ${Buffer.byteLength(output)} bytes`);
