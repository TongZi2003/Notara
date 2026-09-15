import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { canonicalPath } from '@studyforge/domain/access';
import { ClassroomAvatarRefSchema, type ClassroomAvatarImage } from '@studyforge/contracts/classroom';

const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
function avatarPath(root: string, ref: string): string {
  ClassroomAvatarRefSchema.parse(ref);
  const path = join(root, '.studyforge', 'classroom-avatars', ref.slice(7) + '.webp');
  if (canonicalPath(path, root) !== path) throw new Error('avatar_path_invalid');
  return path;
}
/** Images are local presentation assets, outside worldbook text and model context. */
export async function uploadClassroomAvatar(root: string, base64: string): Promise<ClassroomAvatarImage> {
  if (!base64 || base64.length > 7_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('avatar_input_invalid');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > 5_000_000) throw new Error('avatar_too_large');
  const image = sharp(bytes, { limitInputPixels: 16_000_000, animated: false });
  const metadata = await image.metadata();
  if (!['png', 'jpeg', 'webp', 'gif'].includes(metadata.format ?? '')) throw new Error('avatar_format_unsupported');
  const normalized = await image.rotate().resize(192, 192, { fit: 'cover' }).webp({ quality: 88 }).toBuffer();
  const ref = 'avatar:' + digest(normalized), path = avatarPath(root, ref);
  await mkdir(join(root, '.studyforge', 'classroom-avatars'), { recursive: true, mode: 0o700 });
  try { await writeFile(path, normalized, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  return readClassroomAvatar(root, ref);
}
export async function readClassroomAvatar(root: string, ref: string): Promise<ClassroomAvatarImage> {
  const path = avatarPath(root, ref), info = await stat(path);
  if (!info.isFile() || info.size > 200_000) throw new Error('avatar_invalid');
  const bytes = await readFile(path);
  if ('avatar:' + digest(bytes) !== ref) throw new Error('avatar_corrupt');
  return { ref, mediaType: 'image/webp', base64: bytes.toString('base64') };
}
