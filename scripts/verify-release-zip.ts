import { readFile } from 'node:fs/promises';
import { crc32, inflateRawSync } from 'node:zlib';

/** Verify our ZIP32 release files with a decoder independent of the ZIP writer.
 * Check every entry, including dependencies and fonts outside the code manifest. */
export function verifyReleaseZipBytes(bytes: Buffer): number {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557)) {
    if (bytes.readUInt32LE(end) === 0x06054b50 && end + 22 + bytes.readUInt16LE(end + 20) === bytes.length) break;
    end--;
  }
  if (end < Math.max(0, bytes.length - 65557)) throw new Error('Release ZIP end record is missing.');
  const count = bytes.readUInt16LE(end + 10);
  const directoryBytes = bytes.readUInt32LE(end + 12);
  let offset = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || offset === 0xffffffff || directoryBytes === 0xffffffff) throw new Error('Release ZIP64 is not supported by this writer.');
  const directoryEnd = offset + directoryBytes;
  if (directoryEnd !== end || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count) throw new Error('Release ZIP central directory is invalid.');
  const names = new Set<string>();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > directoryEnd || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Release ZIP entry record is invalid.');
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
    const expectedCrc = bytes.readUInt32LE(offset + 16), compressedBytes = bytes.readUInt32LE(offset + 20), originalBytes = bytes.readUInt32LE(offset + 24);
    const nameBytes = bytes.readUInt16LE(offset + 28), extraBytes = bytes.readUInt16LE(offset + 30), commentBytes = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const next = offset + 46 + nameBytes + extraBytes + commentBytes;
    if (next > directoryEnd || local + 30 > offset || bytes.readUInt32LE(local) !== 0x04034b50 || (flags & 1) || (method !== 0 && method !== 8)) throw new Error('Release ZIP entry header is invalid.');
    const nameBuffer = bytes.subarray(offset + 46, offset + 46 + nameBytes);
    const name = nameBuffer.toString('utf8');
    if (names.has(name)) throw new Error(`Release ZIP has a duplicate entry: ${name}`);
    names.add(name);
    const localNameBytes = bytes.readUInt16LE(local + 26), localExtraBytes = bytes.readUInt16LE(local + 28);
    const data = local + 30 + localNameBytes + localExtraBytes;
    if (data + compressedBytes > offset || bytes.readUInt16LE(local + 8) !== method || bytes.readUInt16LE(local + 6) !== flags || !bytes.subarray(local + 30, local + 30 + localNameBytes).equals(nameBuffer)) throw new Error(`Release ZIP local header is invalid: ${name}`);
    const compressed = bytes.subarray(data, data + compressedBytes);
    let contents: Buffer;
    try { contents = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, originalBytes) }); }
    catch (error) { throw new Error(`Release ZIP entry cannot be independently decompressed: ${name}`, { cause: error }); }
    if (contents.length !== originalBytes || crc32(contents) !== expectedCrc) throw new Error(`Release ZIP entry CRC or length mismatch: ${name}`);
    offset = next;
  }
  if (offset !== directoryEnd) throw new Error('Release ZIP directory length is invalid.');
  return count;
}

export async function verifyReleaseZip(path: string): Promise<number> {
  return verifyReleaseZipBytes(await readFile(path));
}
