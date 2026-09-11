import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Use the published generator; never synthesize or weaken Remote codecs. */
export async function generateRemotes(): Promise<void> {
  const artifacts = new WorkspaceTypertGenerator(root).generate(['@studyforge/host'], ['host']);
  if (artifacts.length !== 1 || !artifacts[0]?.remote) throw new Error('Expected one generated Host Remote');
  for (const artifact of artifacts) {
    const output = join(root, artifact.packageRoot, 'lib');
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'typert.host.js'), artifact.js);
    await writeFile(join(output, 'typert.host.d.ts'), artifact.dts);
    if (artifact.remote) {
      await writeFile(join(output, 'typert.remote-client.js'), artifact.remote.js);
      await writeFile(join(output, 'typert.remote-client.d.ts'), artifact.remote.dts);
      await writeFile(join(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap);
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await generateRemotes();
