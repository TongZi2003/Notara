import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { WINDOWS_TOKEN_DACL_PATCH as pin, patchWindowsTokenDacl } from '../../scripts/windows-token-dacl-patch.ts';

const installed = readFileSync(new URL('../../node_modules/' + pin.artifact, import.meta.url), 'utf8');
const original = installed.replace(pin.after, pin.before);
const patched = patchWindowsTokenDacl(original);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

interface Failure { userSize?: number; userError?: boolean; userSid?: bigint; mergeError?: number; setError?: number }
function fixture(failure: Failure = {}) {
  const functionSource = patched.match(/function setTokenDefaultDaclGrant\(api, token, sidPtr\) \{[\s\S]*?\n\}/)?.[0];
  if (!functionSource) throw new Error('Missing verified native helper');
  const queries: number[] = [], writes: { token: bigint; kind: number; pointer: bigint }[] = [], freed: bigint[] = [];
  let merge: { count: number; entries: Buffer & { backing: Buffer[] }; existing: bigint } | undefined;
  const api = {
    getTokenInformation: (_token: bigint, kind: number, value: Buffer | null, _length: number, needed: Buffer) => {
      queries.push(kind);
      const size = kind === 6 ? 8 : failure.userSize ?? 16;
      needed.writeUInt32LE(size);
      if (!value) return 0;
      if (kind === 1 && failure.userError) return 0;
      value.writeBigUInt64LE(kind === 6 ? 0x444n : failure.userSid ?? 0x555n);
      return 1;
    },
    setEntriesInAclW: (count: number, entries: Buffer & { backing: Buffer[] }, existing: bigint, result: Buffer) => {
      merge = { count, entries, existing };
      result.writeBigUInt64LE(0x666n);
      return failure.mergeError ?? 0;
    },
    setTokenInformation: (token: bigint, kind: number, value: Buffer) => {
      writes.push({ token, kind, pointer: value.readBigUInt64LE() });
      return failure.setError ? 0 : 1;
    },
    getLastError: () => failure.setError ?? 5,
    localFree: (pointer: bigint) => { freed.push(pointer); },
  };
  const decode = (value: Buffer, offset = 0) => value.readBigUInt64LE(offset) || null;
  const buildEntry = (sid: bigint, mode: number, permissions: number) => {
    const value = Buffer.alloc(48);
    value.writeUInt32LE(permissions, 0); value.writeUInt32LE(mode, 4); value.writeBigUInt64LE(sid, 40);
    return value;
  };
  const error = (_api: unknown, name: string, context: string): never => { throw new Error(`${name}: ${context}`); };
  const win32 = (_api: unknown, name: string, code: number, context: string): never => { throw new Error(`${name}: ${code}: ${context}`); };
  // Execute the exact SHA-verified upstream helper, with recorded Win32 calls.
  const run = new Function('allocUint32', 'decodeUint32', 'decodePtrAt', 'allocPtrSlot', 'decodePtr', 'buildExplicitAccess', 'FILE_ALL_ACCESS', 'throwLastError$1', 'throwWin32', functionSource + '\nreturn setTokenDefaultDaclGrant;')(
    () => Buffer.alloc(4), (value: Buffer) => value.readUInt32LE(), decode, () => Buffer.alloc(8), decode, buildEntry, 2032127, error, win32,
  ) as (nativeApi: typeof api, token: bigint, capability: bigint) => void;
  return { run: () => run(api, 0x111n, 0x777n), queries, writes, freed, get merge() { return merge; } };
}

test('the locked Windows ACL patch verifies both exact artifacts and is idempotent', () => {
  expect(sha(original)).toBe(pin.originalSha);
  expect(sha(patched)).toBe(pin.patchedSha);
  expect(patchWindowsTokenDacl(patched)).toBe(patched);
  expect(patched.replace(pin.after, pin.before)).toBe(original);
});

test('unrecognized and partially modified Windows ACL artifacts fail closed', () => {
  for (const source of [original + '\n', patched + '\n', original.replace(pin.before, pin.after.slice(0, -1))]) {
    expect(() => patchWindowsTokenDacl(source)).toThrow(/Unknown DSH Windows ACL artifact/);
  }
});

test('the native helper merges the creator and private capability into the existing default DACL only', () => {
  const f = fixture(); f.run();
  expect(f.queries).toEqual([6, 6, 1, 1]);
  expect(f.merge?.count).toBe(2); expect(f.merge?.existing).toBe(0x444n);
  const entries = f.merge!.entries;
  expect(entries.length).toBe(96);
  expect([entries.readBigUInt64LE(40), entries.readBigUInt64LE(88)]).toEqual([0x777n, 0x555n]);
  expect([entries.readUInt32LE(0), entries.readUInt32LE(48)]).toEqual([2032127, 2032127]);
  expect([entries.readUInt32LE(4), entries.readUInt32LE(52)]).toEqual([1, 1]);
  expect(entries.backing.map(value => value.readBigUInt64LE())).toEqual([0x444n, 0x555n]);
  expect(f.writes).toEqual([{ token: 0x111n, kind: 6, pointer: 0x666n }]);
  expect(f.freed).toEqual([0x666n]);
});

test('a failed or invalid TokenUser query cannot change the restricted token', () => {
  for (const failure of [{ userSize: 0 }, { userSize: 8 }, { userError: true }, { userSid: 0n }]) {
    const f = fixture(failure);
    expect(() => f.run()).toThrow(/TokenUser/);
    expect(f.merge).toBeUndefined(); expect(f.writes).toEqual([]); expect(f.freed).toEqual([]);
  }
});

test('a failed ACL merge does not publish a replacement default DACL', () => {
  const f = fixture({ mergeError: 1336 });
  expect(() => f.run()).toThrow(/SetEntriesInAclW: 1336/);
  expect(f.writes).toEqual([]);
});

test('a failed default-DACL update frees its native allocation and reports failure', () => {
  const f = fixture({ setError: 5 });
  expect(() => f.run()).toThrow(/SetTokenInformation: 5/);
  expect(f.freed).toEqual([0x666n]);
});
