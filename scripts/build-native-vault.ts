import { build } from 'esbuild';
import { readFile, writeFile, cp, rm, readdir, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { outputNamed } from './package-bin.ts';
import { ACADEMY_FILES } from '../examples/native-vault/academy.js';
import { PDF_RESOURCE_FILES } from '../examples/native-vault/pdf-resources.js';
import { withVaultBuild } from './vault-build-lock.ts';
import { applySidebarReadyPatch } from './patch-sidebar-ready.ts';
import { applyProductBrandingPatch } from './patch-product-branding.ts';
import { applyOpenCodeGoPatch } from './patch-opencode-go.ts';
import { applyModelDiscoveryPatch } from './patch-model-discovery.ts';
import { applyCompactionTargetPatch } from './patch-compaction-target.ts';
import { applyContextRequestPatch } from './patch-context-request.ts';
import { buildBillionKernel } from './build-billion-kernel.ts';
import {boardReact,excalidrawLocalAssets} from './board-editor-build.ts';
import {EXCALIDRAW_FONT_LICENSES,EXCALIDRAW_FONT_NOTICE_FILE} from '../examples/native-vault/excalidraw-assets.js';

await withVaultBuild(resolve('.'), 'native-vault', async () => {
// Patches also read/write shared dependencies, so run only after acquiring the
// same lock that protects generated assets and the runtime's snapshot copy.
applySidebarReadyPatch();
applyProductBrandingPatch();
await import('./patch-layout.ts');
applyOpenCodeGoPatch();
applyModelDiscoveryPatch();
applyCompactionTargetPatch();
applyContextRequestPatch();
await buildBillionKernel();
await import('./patch-session-extension.ts');
await import('./patch-input-source-filter.ts');
await import('./patch-skill-menu.ts');
await import('./patch-student-ui.ts');

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
    // A root-relative URL is a Host route (the notebook face), fetched on demand.
    if (!reference.endsWith('.woff2') || reference.includes('://') || reference.startsWith('data:') || reference.startsWith('/')) continue;
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
  minify: true,
  write: false,
  // The version the student sees in 设置 → 学习界面 is the plugin package's own.
  define: { __NOTARA_VERSION__: JSON.stringify(JSON.parse(await readFile(resolve('examples/native-vault/package.json'), 'utf8')).version) },
  plugins: [
    // Lazy modules are Host routes, never bundle content (`lazy-assets.js`).
    { name: 'no-bundled-pdfjs', setup(builder) {
      builder.onResolve({ filter: /^pdfjs-dist(?:\/|$)/ }, args => ({ errors: [{ text: `pdfjs-dist must load through the lazy route, not be bundled (imported by ${args.importer})` }] }));
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
const script = outputNamed(outputs, 'client.js');
if (!script) throw new Error('native-vault client build produced no client.js');
const unbundled = outputs.filter(file => file !== script).map(file => file.path);
if (unbundled.length) throw new Error(`native-vault client build emitted an unshipped artifact: ${unbundled.join(', ')}`);
if (!script.text.includes(LATEX_STYLES_PLACEHOLDER)) throw new Error(`native-vault client build lost the LaTeX styles placeholder ${LATEX_STYLES_PLACEHOLDER}`);
const output = script.text
  .replace(/[ \t]+$/gm, '')
  .replace(JSON.stringify(LATEX_STYLES_PLACEHOLDER), () => JSON.stringify(latexStyles));
if (!output.includes('data:font/woff2;base64')) throw new Error('native-vault LaTeX webfonts were not inlined into the client bundle');
await writeFile(resolve('examples/native-vault/client.js'), output);
// The notebook face ships beside the plugin and is served on demand by
// `font-route.js`; it is never inlined into the client bundle.
if (!/url\(\\?["']?\/notara\/vault\/fonts\/wenkai\.woff2/.test(output)) throw new Error('native-vault notebook font must stay a Host route reference, not an inlined face');
await rm(resolve('examples/native-vault/fonts'), { recursive: true, force: true });
await cp(resolve('resources/fonts/wenkai.woff2'), resolve('examples/native-vault/fonts/wenkai.woff2'));
// The lazy route serves exactly the allowlisted modules, copied fresh each build.
const { LAZY_FILES } = await import('../examples/native-vault/lazy-assets.js');
const LAZY_SOURCES: Record<string, string> = { 'pdf.min.mjs': 'node_modules/pdfjs-dist/build/pdf.min.mjs', 'pdf.worker.min.mjs': 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs' };
// Modules without a shipped browser ES build are bundled from their ES source.
const LAZY_BUILDS: Record<string, string> = { 'jsxgraph.mjs': 'node_modules/jsxgraph/src/index.js', 'board-editors.mjs':'examples/native-vault/board/editors.jsx', 'free-drawing-editor.mjs':'examples/native-vault/board/free-drawing-editor.jsx' };
const excalidrawFontRoot=resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts');
const installedDrawingFonts=(await readdir(excalidrawFontRoot,{recursive:true,withFileTypes:true})).filter(entry=>entry.isFile()).map(entry=>'excalidraw/fonts/'+entry.parentPath.slice(excalidrawFontRoot.length+1).replaceAll('\\','/')+'/'+entry.name).sort();
const reviewedDrawingFonts=Object.keys(LAZY_FILES).filter(name=>name.startsWith('excalidraw/fonts/')).sort();
if(JSON.stringify(installedDrawingFonts)!==JSON.stringify(reviewedDrawingFonts))throw Error('Excalidraw font manifest differs from locked dependency; review it before building');
const drawingFontFamilies=[...new Set(reviewedDrawingFonts.map(name=>name.split('/')[2]))].sort();
const licensedDrawingFontFamilies=[...new Set(Object.values(EXCALIDRAW_FONT_LICENSES).flat())].sort();
if(JSON.stringify(drawingFontFamilies)!==JSON.stringify(licensedDrawingFontFamilies))throw Error('Excalidraw font notice map differs from locked dependency; review it before building');
await rm(resolve('examples/native-vault/lazy'), { recursive: true, force: true });
for (const name of Object.keys(LAZY_FILES)) {
  const source = LAZY_SOURCES[name] ?? (name.startsWith('excalidraw/fonts/') ? 'node_modules/@excalidraw/excalidraw/dist/prod/'+name.slice('excalidraw/'.length) : name==='excalidraw/LICENSE.txt' ? 'resources/licenses/excalidraw-MIT.txt' : undefined), entry = LAZY_BUILDS[name];
  if (source) await cp(resolve(source), resolve('examples/native-vault/lazy', name));
  else if (entry) await build({ entryPoints: [resolve(entry)], outfile: resolve('examples/native-vault/lazy', name), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'eof', logLevel: 'error', conditions:['production'], define:{'process.env.NODE_ENV':'"production"'},plugins:[boardReact,excalidrawLocalAssets,{name:'editor-styles',setup(builder){builder.onLoad({filter:/\.css$/},async args=>({contents:await readFile(args.path,'utf8'),loader:'text'}));}}] });
  else throw new Error(`native-vault lazy module ${name} has no build source`);
}
const fontNoticeTarget=resolve('examples/native-vault/lazy/excalidraw/fonts',EXCALIDRAW_FONT_NOTICE_FILE);
await mkdir(dirname(fontNoticeTarget),{recursive:true});
await cp(resolve('resources/licenses/excalidraw-fonts-notices.txt'),fontNoticeTarget);
// JSXGraph is dual MIT/LGPL; its notice ships beside the module it is built into.
await cp(resolve('node_modules/jsxgraph/LICENSE.MIT'), resolve('examples/native-vault/lazy/LICENSE-JSXGraph.txt'));
// CMaps, fonts and image decoders are needed only when reading a PDF. Ship
// exactly the reviewed dependency manifest, including its license notices.
const pdfResourcesRoot = resolve('examples/native-vault/pdf-resources');
const pdfResourceNames = Object.keys(PDF_RESOURCE_FILES).sort();
const installedPdfResources = (await Promise.all(['cmaps', 'standard_fonts', 'wasm'].map(async directory =>
  (await readdir(resolve('node_modules/pdfjs-dist', directory), { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => `${directory}/${entry.name}`),
))).flat().sort();
if (JSON.stringify(pdfResourceNames) !== JSON.stringify(installedPdfResources)) throw new Error('PDF resource manifest differs from locked dependency; review it before building');
await rm(pdfResourcesRoot, { recursive: true, force: true });
for (const name of pdfResourceNames) await cp(resolve('node_modules/pdfjs-dist', name), resolve(pdfResourcesRoot, name));
// This directory is generated. Retired prompts must not survive a rebuild.
await rm(resolve('examples/native-vault/teaching'), { recursive: true, force: true });
await cp(resolve('resources/vault-teaching'),resolve('examples/native-vault/teaching'),{recursive:true});
// Character art stays outside client.js and the runtime only receives its allowlist.
const academyRoot = resolve('examples/native-vault/academy');
if (dirname(academyRoot) !== resolve('examples/native-vault')) throw new Error('invalid academy output');
await rm(academyRoot, { recursive: true, force: true });
for (const name of Object.keys(ACADEMY_FILES)) {
  const source = name === 'catalog.json' ? resolve('examples/native-vault/academy-data.json')
    : resolve(name.startsWith('notara.') ? 'resources/icons' : 'resources/academy/web', name);
  await cp(source, resolve(academyRoot, name));
}
console.log(`native-vault client: ${Buffer.byteLength(output)} bytes`);
});
