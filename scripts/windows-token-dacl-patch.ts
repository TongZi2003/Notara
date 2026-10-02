import { createHash } from 'node:crypto';

const before = '\tconst newDaclSlot = allocPtrSlot();\n\tconst result = api.setEntriesInAclW(1, buildExplicitAccess(sidPtr, 1, FILE_ALL_ACCESS), currentDacl, newDaclSlot);';
const after = `\t// An elevated token may grant only Administrators in its default DACL.
\t// That group is deny-only after restriction: give the unchanged TokenUser
\t// normal access, while the private capability SID still gates pass two.
\tconst userSizeSlot = allocUint32();
\tapi.getTokenInformation(token, 1, null, 0, userSizeSlot);
\tconst userSize = decodeUint32(userSizeSlot);
\tif (userSize === 0) throwLastError$1(api, "GetTokenInformation", "TokenUser size query");
\tif (userSize < 16) throw new Error("setTokenDefaultDaclGrant: invalid TokenUser record size");
\tconst user = Buffer.alloc(userSize);
\tif (api.getTokenInformation(token, 1, user, user.length, userSizeSlot) === 0) throwLastError$1(api, "GetTokenInformation", "TokenUser");
\tconst userSid = decodePtrAt(user, 0);
\tif (userSid === null) throw new Error("setTokenDefaultDaclGrant: null TokenUser SID");
\tconst entries = Buffer.concat([buildExplicitAccess(sidPtr, 1, FILE_ALL_ACCESS), buildExplicitAccess(userSid, 1, FILE_ALL_ACCESS)]);
\t// Both embedded pointers borrow their query Buffers. Keep those Buffers
\t// reachable from the FFI argument until the synchronous merge returns.
\tentries.backing = [buffer, user];
\tconst newDaclSlot = allocPtrSlot();
\tconst result = api.setEntriesInAclW(2, entries, currentDacl, newDaclSlot);`;

/** Exact locked DSH 0.2.0-rc.1 artifact and the sole permitted transformation. */
export const WINDOWS_TOKEN_DACL_PATCH = Object.freeze({
  artifact: '@deepseek-ai/dsh-sandbox-windows-acl/lib/types-Cl_DXjhk.js',
  originalSha: '0bb3a34508785bdc34626542f9358d398fd9f60fdaf4b48201dfdff2122f25fc',
  patchedSha: '0e19c2483ad1ba84fd9bc92627252708fb75b0dbcea50fa1ed8cf2a90b25c5ad',
  before,
  after,
});
const sha = (source: string): string => createHash('sha256').update(source).digest('hex');

/** Repair only the restricted token's default DACL; never its authority or directory grants. */
export function patchWindowsTokenDacl(source: string): string {
  const digest = sha(source);
  if (digest === WINDOWS_TOKEN_DACL_PATCH.patchedSha) return source;
  if (digest !== WINDOWS_TOKEN_DACL_PATCH.originalSha) throw new Error('Unknown DSH Windows ACL artifact; review the TokenDefaultDacl patch');
  if (source.split(before).length !== 2) throw new Error('DSH TokenDefaultDacl patch anchor changed');
  const patched = source.replace(before, after);
  if (sha(patched) !== WINDOWS_TOKEN_DACL_PATCH.patchedSha) throw new Error('DSH TokenDefaultDacl patch digest mismatch');
  return patched;
}
