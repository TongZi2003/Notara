import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const patches = [
  {
    artifact: 'dist/index.html',
    sha: 'fb9822df3c11f2c6dd6b2f7c1de51ce4f5b80e49498fcfc3f44139fa48d9964b',
    replacements: [['<title>DeepSeek Harness</title>', '<title>Notara「拾页」</title>']],
  },
  {
    artifact: 'dist/manifest.webmanifest',
    sha: '39d993c8e94ab4ce3d2c112fd4eec8c1d91ba32a11b974fdf2fd21d5e596a98b',
    replacements: [['"name": "DeepSeek Harness"', '"name": "Notara「拾页」"'], ['"short_name": "DSH"', '"short_name": "Notara「拾页」"']],
  },
] as const;

const sha = (source: string): string => createHash('sha256').update(source).digest('hex');

/** Brand the locked initial document and installed web app, before JS loads. */
export function applyProductBrandingPatch(): void {
  for (const patch of patches) {
    const path = new URL(`../node_modules/@deepseek-ai/dsh-web-frontend/${patch.artifact}`, import.meta.url);
    const source = readFileSync(path, 'utf8');
    let original = source;
    if (sha(original) !== patch.sha) {
      for (const [before, after] of [...patch.replacements].reverse()) original = original.replace(after, before);
      if (sha(original) !== patch.sha) throw new Error(`Unknown DSH frontend artifact; review product branding: ${patch.artifact}`);
    }
    let result = original;
    for (const [before, after] of patch.replacements) {
      if (result.split(before).length !== 2) throw new Error(`DSH product branding anchor changed: ${patch.artifact}`);
      result = result.replace(before, after);
    }
    if (result !== source) writeFileSync(path, result);
  }
}
