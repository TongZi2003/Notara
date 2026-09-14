import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, glob, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { generateRemotes } from './generate-remotes.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function compile(config: string): void {
  const result = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--build', config], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`TypeScript failed: ${config} (${result.status})`);
}

if (!process.argv.includes('--client-only')) {
  await import('./build-math-workbench.ts');
  await cp(join(root, 'resources/teaching'), join(root, 'packages/host/lib/teaching-resources'), { recursive: true });
  compile('tsconfig.host.json');
  await generateRemotes();
}
// The notebook faces stay out of the browser bundle: the Host entry serves them
// from `lib/notebook/`, i.e. `../notebook/fonts/<name>` next to `lib/types/index.js`.
await cp(join(root, 'packages/client/assets/notebook'), join(root, 'packages/client/lib/notebook'), { recursive: true });
compile('tsconfig.client.json');
// tsc emits imports but no stylesheets. Keep each stylesheet beside its
// emitted module before esbuild resolves the browser-facing dependency tree.
for await (const file of glob('**/*.css', { cwd: join(root, 'packages/client/src') })) {
  await cp(join(root, 'packages/client/src', file), join(root, 'packages/client/lib/types', file));
}
const client = await build({
  absWorkingDir: root,
  entryPoints: ['packages/client/lib/types/client/index.js'],
  outfile: 'packages/client/lib/client.js',
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2023',
  write: false,
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
  plugins: [{ name: 'local-pdf-worker', setup(builder) {
    builder.onLoad({ filter: /pdf\.worker(?:\.min)?\.mjs$/ }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
  } }],
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-primitives', '/studyforge/notebook/fonts/*'],
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: 'window.__ModuleLoader__.load({ id: "@studyforge/dsh-client", factory: (require) => { var module = { exports: {} }; var exports = module.exports;' },
  footer: { js: `const entry = module.exports;
return { ...entry, apply(ctx, ...args) {
  const css = __STUDYFORGE_BUNDLE_CSS__;
  if (css) { const style = document.createElement('style'); style.dataset.studyforgeStyle = 'bundle'; style.textContent = css; document.head.append(style); ctx.effect(() => () => style.remove()); }
  return entry.apply(ctx, ...args);
} }; } });` },
});
const javascript = client.outputFiles.find(file => file.path.endsWith('/client.js'));
if (!javascript) throw new Error('Client JavaScript was not built');
const stylesheet = client.outputFiles.find(file => file.path.endsWith('/client.css'))?.text ?? '';
await writeFile(join(root, 'packages/client/lib/client.js'), javascript.text.replace('__STUDYFORGE_BUNDLE_CSS__', () => JSON.stringify(stylesheet)));
