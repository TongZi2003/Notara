import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { generateRemotes } from './generate-remotes.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function compile(config: string): void {
  const result = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--build', config], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`TypeScript failed: ${config} (${result.status})`);
}

compile('tsconfig.host.json');
await generateRemotes();
compile('tsconfig.client.json');
await build({
  absWorkingDir: root,
  entryPoints: ['packages/client/lib/types/client/index.js'],
  outfile: 'packages/client/lib/client.js',
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2023',
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis'],
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: 'window.__ModuleLoader__.load({ id: "@studyforge/dsh-client", factory: (require) => { var module = { exports: {} }; var exports = module.exports;' },
  footer: { js: 'return module.exports; } });' },
});
