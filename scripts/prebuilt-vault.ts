import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const PORTABLE_MARKER = 'notara-portable.json';
export interface PortableManifest { format: 1; platform: 'win32'; arch: 'x64'; version: string; nodeVersion: string; files: Record<string, string> }

/** A portable bundle is built on Windows before shipping. Never silently use
 * stale/damaged assets, or rebuild them on a machine promised a ready package. */
export async function verifyPrebuiltVault(root: string): Promise<boolean> {
  let source: string;
  try { source = await readFile(join(root, PORTABLE_MARKER), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  const manifest = JSON.parse(source) as PortableManifest;
  if (manifest.format !== 1 || manifest.platform !== process.platform || manifest.arch !== process.arch || !manifest.files || typeof manifest.files !== 'object') throw new Error('免安装包不适用于此系统或清单已损坏，请下载 Windows x64 免安装包。');
  const { version } = JSON.parse(await readFile(join(root, 'examples/native-vault/package.json'), 'utf8')) as { version: string };
  if (manifest.version !== version || !manifest.files['examples/native-vault/client.js'] || !manifest.files['runtime/node.exe']) throw new Error('免安装包版本不一致或不完整，请重新解压。');
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!/^[a-f0-9]{64}$/.test(expected) || name.split('/').some(part => !part || part === '.' || part === '..' || /[\\:]/.test(part))) throw new Error('免安装包校验清单路径无效。');
    const actual = createHash('sha256').update(await readFile(join(root, name))).digest('hex');
    if (actual !== expected) throw new Error(`免安装包文件已修改或损坏：${name}。请重新解压完整的免安装包。`);
  }
  return true;
}
