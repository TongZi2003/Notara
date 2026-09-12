/**
 * P3.1 material-surface helpers (docs/superpowers/plans/2026-09-11-dsh/P3-materials.md).
 *
 * Pure functions only: what a picked file's declared type is, how its bytes
 * travel to the Host as base64, and how a refused import becomes a sentence the
 * student can act on. Nothing here invents a material, a name or a version: the
 * Host returns the only `MaterialView` the UI renders, and these helpers never
 * become a second source of metadata.
 */
import type { MaterialMediaType } from '@studyforge/contracts/material-records';

/** The one Word container the importer and the previewer both name. */
export const DOCX_MEDIA_TYPE: MaterialMediaType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Extensions the Host accepts, spelled the way its validator checks them.
 * The declared media type has to agree with the file name, so this map is the
 * single place the browser decides what it is uploading.
 */
const MEDIA_BY_EXTENSION: Readonly<Record<string, MaterialMediaType>> = {
  pdf: 'application/pdf',
  docx: DOCX_MEDIA_TYPE,
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  md: 'text/markdown',
  markdown: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
  txt: 'text/plain',
};

/** The extension of one file name, lower-case and without the dot. */
function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/** The declared type for one file name, or `undefined` for a format we do not import. */
export function mediaTypeOfName(fileName: string): MaterialMediaType | undefined {
  return MEDIA_BY_EXTENSION[extensionOf(fileName)];
}

/** The initial title of one picked file: its name without the extension. */
export function titleFromFileName(fileName: string): string {
  const extension = extensionOf(fileName);
  const title = (extension === '' ? fileName : fileName.slice(0, fileName.length - extension.length - 1)).trim();
  return title === '' ? fileName.trim() : title;
}

/** Base64 in the canonical form the Host's decoder accepts, without a data URL prefix. */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/** The bytes behind one Host base64 payload, for the standalone reader. */
export function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** One file size a student can compare, never a byte count with six digits. */
/** UTF-8 text of one version's bytes; the previews and the composer share it. */
export function decodeText(data: Uint8Array): string {
  return new TextDecoder('utf-8').decode(data);
}

export function byteLabel(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} B`;
  if (byteLength < 1024 * 1024) return `${Math.max(1, Math.round(byteLength / 1024))} KB`;
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
}

/** What kind of original this is, in the words the materials list uses. */
export function kindLabel(mediaType: MaterialMediaType): string {
  if (mediaType === 'application/pdf') return 'PDF';
  if (mediaType === DOCX_MEDIA_TYPE) return 'Word 文档';
  if (mediaType.startsWith('image/')) return '图片';
  if (mediaType === 'text/markdown') return 'Markdown';
  if (mediaType === 'text/html') return '网页';
  return '文字';
}

/** The refusal code the Host put on the wire; the code is what the UI may branch on. */
function codeIn(message: string): string {
  const match = /\b(?:material_[a-z_]+|version_conflict|operation_conflict|workspace_mismatch)\b/u.exec(message);
  return match?.[0] ?? message.trim();
}

/**
 * Turn one refused import into the next action. A name clash is the case a
 * student actually hits, and it is the only one that has two usable answers.
 */
export function importFailureCopy(message: string): string {
  switch (codeIn(message)) {
    case 'material_name_exists':
      return '同名资料已经有一份了：改个名字再导入，或者打开那份资料添加新版本。';
    case 'material_type_mismatch':
      return '文件内容和它的扩展名对不上，换一份原文件再试。';
    case 'material_content_invalid':
      return '这个文件读不出来，可能已经损坏；换一份再看。';
    case 'material_too_large':
      return '文件超过 64 MB，先压缩或换一份。';
    case 'material_encoding_invalid':
      return '上传中途的数据不完整，重新选这份文件。';
    case 'material_name_invalid':
      return '文件名里有不能用的字符，先改个名字再导入。';
    default:
      return '这份资料没有导入成功，稍后再试一次。';
  }
}

/** Turn one refused new version into the next action; a stale revision is the common one. */
export function versionFailureCopy(message: string): string {
  switch (codeIn(message)) {
    case 'version_conflict':
      return '这份资料刚在别处更新过，先重新打开这份资料，再加新版本。';
    case 'material_name_exists':
      return '这个名字或文件名已经属于另一份资料了，改一下再试。';
    case 'material_missing':
      return '这份资料已经不在了，刷新资料列表看看。';
    case 'material_type_mismatch':
      return '新版本的文件类型和扩展名对不上，换一份原文件。';
    default:
      return '新版本没有加上，稍后再试一次。';
  }
}
