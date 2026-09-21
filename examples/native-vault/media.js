const MEDIA_TYPES = Object.freeze({
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  png: { kind: 'image', mime: 'image/png' },
  apng: { kind: 'image', mime: 'image/apng' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  avif: { kind: 'image', mime: 'image/avif' },
  svg: { kind: 'image', mime: 'image/svg+xml' },
  html: { kind: 'html', mime: 'text/html' },
  htm: { kind: 'html', mime: 'text/html' },
  mp4: { kind: 'video', mime: 'video/mp4' },
  webm: { kind: 'video', mime: 'video/webm' },
  mov: { kind: 'video', mime: 'video/quicktime' },
  ogv: { kind: 'video', mime: 'video/ogg' },
  mp3: { kind: 'audio', mime: 'audio/mpeg' },
  wav: { kind: 'audio', mime: 'audio/wav' },
  ogg: { kind: 'audio', mime: 'audio/ogg' },
});

function extensionOf(path) {
  const name = path.split('/').pop() ?? '';
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index + 1).toLowerCase() : '';
}

export function mediaForPath(path) {
  const extension = extensionOf(path), type = MEDIA_TYPES[extension];
  return type ? { ...type, extension } : { kind: 'file', mime: 'application/octet-stream', extension };
}

export function revisionForBytes(bytes) {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0') + bytes.length.toString(16).padStart(16, '0');
}

export function mediaLocatorSuffix(locator) {
  if (!locator) return '';
  if (locator.kind === 'pdf-page') return `#page=${encodeURIComponent(locator.page)}`;
  if (locator.kind === 'pdf-region') return `#page=${encodeURIComponent(locator.page)}&rect=${locator.rect.map(value => encodeURIComponent(value)).join(',')}`;
  if (locator.kind === 'video-time') return `#t=${encodeURIComponent(locator.startMs)}${locator.endMs === undefined ? '' : `,${encodeURIComponent(locator.endMs)}`}`;
  if (locator.kind === 'image-region') return `#rect=${locator.rect.map(value => encodeURIComponent(value)).join(',')}`;
  if (locator.kind === 'html-range' && locator.anchor) return `#anchor=${encodeURIComponent(locator.anchor)}`;
  return '';
}

export function embedTarget(path, locator) {
  return `![[${path}${mediaLocatorSuffix(locator)}]]`;
}

export function parseMediaTarget(target) {
  const separator = target.indexOf('#');
  const path = separator < 0 ? target : target.slice(0, separator);
  const fragment = separator < 0 ? '' : target.slice(separator + 1);
  if (!fragment) return { path, locator: undefined };
  const params = new URLSearchParams(fragment);
  const key = fragment.includes('=') ? fragment.slice(0, fragment.indexOf('=')) : fragment;
  const raw = params.get(key) ?? '';
  if (key === 'page' && /^\d+$/.test(raw)) {
    const rect = params.get('rect')?.split(',').map(Number);
    if (rect?.length === 4 && rect.every(value => Number.isFinite(value))) return { path, locator: { kind: 'pdf-region', page: Number(raw), rect } };
    return { path, locator: { kind: 'pdf-page', page: Number(raw) } };
  }
  if (key === 't') {
    const [start, end] = (raw ?? '').split(',');
    if (/^\d+$/.test(start ?? '') && (end === undefined || /^\d+$/.test(end))) return { path, locator: { kind: 'video-time', startMs: Number(start), ...(end === undefined ? {} : { endMs: Number(end) }) } };
  }
  if (key === 'rect') {
    const rect = (raw ?? '').split(',').map(Number);
    if (rect.length === 4 && rect.every(Number.isFinite)) return { path, locator: { kind: 'image-region', rect } };
  }
  if (key === 'anchor' && raw) return { path, locator: { kind: 'html-range', anchor: decodeURIComponent(raw) } };
  return { path, locator: undefined };
}
