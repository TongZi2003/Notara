import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { unzipSync } from 'fflate';
import { expect, test } from 'vitest';
import { writePortableArchive } from '../../scripts/build-portable-release.ts';

test('portable ZIP records Unicode names with UTF-8 flags and preserves multi-chunk contents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'notara-zip-'));
  try {
    const root = join(directory, 'source'), nested = '中文🧪 & مرحبا';
    await mkdir(join(root, nested), { recursive: true });
    const payload = randomBytes(800_000);
    await writeFile(join(root, '启动 Notara.cmd'), '@echo off\r\n');
    await writeFile(join(root, nested, '资料.bin'), payload);
    const archive = join(directory, 'portable.zip');
    await writePortableArchive(root, archive);
    const bytes = await readFile(archive), extracted = unzipSync(bytes);
    expect(Object.keys(extracted).sort()).toEqual([`notara/${nested}/资料.bin`, 'notara/启动 Notara.cmd'].sort());
    expect(Buffer.from(extracted[`notara/${nested}/资料.bin`]!)).toEqual(payload);
    expect(Buffer.from(extracted['notara/启动 Notara.cmd']!).toString()).toBe('@echo off\r\n');
    // Check the ZIP contract, independently of fflate's name decoder: Windows
    // extractors must know these central-directory names are UTF-8, not ANSI.
    const end = bytes.length - 22;
    expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
    let offset = bytes.readUInt32LE(end + 16);
    for (let entry = 0; entry < bytes.readUInt16LE(end + 10); entry++) {
      expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
      expect(bytes.readUInt16LE(offset + 8) & 0x800).toBe(0x800);
      offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
