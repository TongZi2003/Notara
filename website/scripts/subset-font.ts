/**
 * Subset LXGW WenKai (resources/fonts/wenkai.woff2, OFL 1.1) to the characters
 * the website uses, so the handwriting face stays small. Re-run after changing
 * page text: `npm run site:font`. Needs `uvx` (fontTools with brotli runs in an
 * isolated, pinned environment).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(site, '../resources/fonts/wenkai.woff2');
const output = join(site, 'public/fonts/notara-hand.woff2');
const skip = new Set(['dist', 'public', 'scripts', 'node_modules']);

const htmlFiles = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return skip.has(name) ? [] : htmlFiles(path);
  return name.endsWith('.html') ? [path] : [];
});

const text = htmlFiles(site)
  .map(file => readFileSync(file, 'utf8'))
  .join('\n')
  .replace(/<(script|style|pre)\b[\s\S]*?<\/\1>/g, ' ')
  .replace(/\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/g, ' ')
  .replace(/<[^>]+>/g, ' ');

const ascii = Array.from({ length: 0x7f - 0x20 }, (_, index) => String.fromCharCode(0x20 + index)).join('');
const chars = [...new Set(ascii + '，。、；：？！“”‘’（）《》·—…→↑✓' + text)].filter(char => char.codePointAt(0)! >= 0x20).sort();

const work = mkdtempSync(join(tmpdir(), 'notara-font-'));
try {
  const list = join(work, 'chars.txt');
  writeFileSync(list, chars.join(''));
  mkdirSync(dirname(output), { recursive: true });
  execFileSync('uvx', ['--from', 'fonttools[woff]==4.60.1', 'pyftsubset', source,
    `--text-file=${list}`, '--flavor=woff2', `--output-file=${output}`,
    '--layout-features=*', '--no-hinting', '--desubroutinize', '--name-IDs=*', '--name-languages=*'], { stdio: 'inherit' });
} finally {
  rmSync(work, { recursive: true, force: true });
}
copyFileSync(resolve(site, '../resources/fonts/wenkai-license.txt'), join(dirname(output), 'notara-hand-license.txt'));
console.log(`notara-hand.woff2: ${chars.length} characters, ${(statSync(output).size / 1024).toFixed(1)} KiB`);
