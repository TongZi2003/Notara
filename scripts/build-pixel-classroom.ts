import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function buildPixelClassroom(): Promise<string> {
  const source = resolve(project, 'examples/pixel-classroom');
  // Execute the pinned upstream build helper with its own source conventions;
  // do not pull the vendored TS project into our composite scripts project.
  const assetBuilderUrl = new URL('../examples/pixel-classroom/upstream/core/src/assets/build.ts', import.meta.url).href;
  const { buildAssetIndex, buildFurnitureCatalog } = await import(assetBuilderUrl) as {
    buildAssetIndex: (root: string) => unknown;
    buildFurnitureCatalog: (root: string) => unknown;
  };
  const output = resolve(source, 'dist');
  await mkdir(output, { recursive: true });
  await cp(resolve(source, 'public/assets'), resolve(output, 'assets'), { recursive: true });
  await writeFile(resolve(output, 'assets/asset-index.json'), JSON.stringify(buildAssetIndex(resolve(source, 'public/assets'))));
  await writeFile(resolve(output, 'assets/furniture-catalog.json'), JSON.stringify(buildFurnitureCatalog(resolve(source, 'public/assets'))));
  await cp(resolve(source, 'index.html'), resolve(output, 'index.html'));
  await cp(resolve(source, 'upstream/LICENSE'), resolve(output, 'LICENSE'));
  await cp(resolve(source, 'upstream/provenance.json'), resolve(output, 'provenance.json'));
  const result = await build({
    entryPoints: [resolve(source, 'src/main.tsx')], outfile: resolve(output, 'classroom.js'),
    bundle: true, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic',
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.BASE_URL': '"./"', 'import.meta.env.PROD': 'true', 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'classroom-local-transport', setup(builder) {
      builder.onResolve({ filter: /transport\/index(?:\.js)?$/ }, args => args.importer.startsWith(resolve(source, 'upstream/webview-ui')) ? { path: resolve(source, 'src/transport.ts') } : null);
      builder.onResolve({ filter: /sprites\/spriteCache(?:\.js)?$/ }, args => args.importer.startsWith(resolve(source, 'upstream/webview-ui')) ? { path: resolve(source, 'src/sprite-cache.ts') } : null);
    } }],
    legalComments: 'eof', metafile: true,
  });
  await writeFile(resolve(output, 'build-meta.json'), JSON.stringify(result.metafile));
  const bytes = (await readFile(resolve(output, 'classroom.js'))).length;
  console.log(`Pixel Agents classroom: ${bytes} bytes; pinned engine and bundled artwork`);
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildPixelClassroom();
