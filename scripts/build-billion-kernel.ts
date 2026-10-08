import { build } from 'esbuild';
import { readFile, mkdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/** Build only pinned, integrity-checked vendored code. No install hooks or network. */
export async function buildBillionKernel(): Promise<void> {
  const root = resolve('vendor/billion-context');
  const lock = JSON.parse(await readFile(resolve(root, 'upstream-lock.json'), 'utf8')) as {
    commit: string; files: Record<string, string>;
  };
  for (const [path, expected] of Object.entries(lock.files)) {
    if (!/^(kernel\/src\/[^:]+\.(?:ts|md)|kernel\/package\.json|(?:kernel\/)?LICENSE)$/.test(path)
      || path.split('/').includes('..')) throw new Error('Invalid Billion source manifest path');
    const actual = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
    if (actual !== expected) throw new Error(`Billion source integrity mismatch: ${path}`);
  }
  const destination = resolve('examples/native-vault/billion-kernel');
  await mkdir(destination, { recursive: true });
  await build({ entryPoints: [resolve('scripts/billion-kernel-entry.mjs')],
    outfile: resolve(destination, 'index.js'), bundle: true, platform: 'node', format: 'esm',
    target: 'node24', logLevel: 'silent',
    banner: { js: `// Billion-context/acp-kernel ${lock.commit}; see LICENSE and upstream-lock.json beside this file.` },
    plugins: [{ name: 'locked-billion-inputs', setup(builder) {
      builder.onLoad({ filter: /[\\/]vendor[\\/]billion-context[\\/]/ }, async args => {
        const path = args.path.slice(root.length + 1).replaceAll('\\', '/');
        if (!(path in lock.files)) return { errors: [{ text: `Unpinned Billion input: ${path}` }] };
        return undefined;
      });
    } }],
  });
  for (const [from, to] of [['kernel/LICENSE', 'LICENSE'], ['LICENSE', 'BILLION-LICENSE'],
    ['upstream-lock.json', 'upstream-lock.json']]) await cp(resolve(root, from!), resolve(destination, to!));
}
