/**
 * Code the Vault edits as plain text (no toolchain here: running and testing use
 * the learner's own system). One table drives the file tree, the editor's
 * language and the teacher's native read/write/edit boundary.
 */
export const CODE_LANGUAGES = Object.freeze({
  python: Object.freeze({ label: 'Python', extensions: ['py', 'pyw'], indent: 4 }),
  scheme: Object.freeze({ label: 'Scheme', extensions: ['scm', 'ss', 'rkt'], indent: 2 }),
  sql: Object.freeze({ label: 'SQL', extensions: ['sql'], indent: 2 }),
  c: Object.freeze({ label: 'C', extensions: ['c', 'h'], indent: 4 }),
  cpp: Object.freeze({ label: 'C++', extensions: ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx'], indent: 4 }),
  java: Object.freeze({ label: 'Java', extensions: ['java'], indent: 4 }),
  javascript: Object.freeze({ label: 'JavaScript', extensions: ['js', 'mjs', 'cjs', 'jsx'], indent: 2 }),
  typescript: Object.freeze({ label: 'TypeScript', extensions: ['ts', 'tsx', 'mts', 'cts'], indent: 2 }),
  go: Object.freeze({ label: 'Go', extensions: ['go'], indent: 4 }),
  rust: Object.freeze({ label: 'Rust', extensions: ['rs'], indent: 4 }),
  shell: Object.freeze({ label: 'Shell', extensions: ['sh', 'bash', 'zsh'], indent: 2 }),
  verilog: Object.freeze({ label: 'Verilog', extensions: ['v', 'sv', 'svh'], indent: 2 }),
  vhdl: Object.freeze({ label: 'VHDL', extensions: ['vhd', 'vhdl'], indent: 2 }),
  asm: Object.freeze({ label: '汇编', extensions: ['s', 'asm'], indent: 8 }),
  lua: Object.freeze({ label: 'Lua', extensions: ['lua'], indent: 2 }),
  ruby: Object.freeze({ label: 'Ruby', extensions: ['rb'], indent: 2 }),
  yaml: Object.freeze({ label: 'YAML', extensions: ['yaml', 'yml'], indent: 2 }),
  toml: Object.freeze({ label: 'TOML', extensions: ['toml'], indent: 2 }),
  json: Object.freeze({ label: 'JSON', extensions: ['json'], indent: 2 }),
  text: Object.freeze({ label: '纯文本', extensions: ['txt'], indent: 4 }),
});
const CODE_TYPES = Object.fromEntries(Object.entries(CODE_LANGUAGES).flatMap(([language, row]) =>
  row.extensions.map(extension => [extension, Object.freeze({ kind: 'code', mime: 'text/plain', language })])));

const MEDIA_TYPES = Object.freeze({
  ...CODE_TYPES,
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

/** Directories that running code leaves behind. Like dot directories they are
 * never Vault content: not in the file tree, search, assets or the graph. */
const TOOL_CACHE_DIRECTORIES = new Set(['__pycache__', 'node_modules']);
export const isToolCacheDirectory = name => TOOL_CACHE_DIRECTORIES.has(name);

/** Whether a path names a code file: the only files the teacher's native read/write/edit may touch. */
export function isCodePath(path) {
  return typeof path === 'string' && Object.hasOwn(CODE_TYPES, extensionOf(path));
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
  if (locator.kind === 'pdf-page') return `#page=${encodeURIComponent(locator.page)}${locator.revision ? `&revision=${encodeURIComponent(locator.revision)}` : ''}`;
  if (locator.kind === 'pdf-region') return `#page=${encodeURIComponent(locator.page)}&rect=${locator.rect.map(value => encodeURIComponent(value)).join(',')}${locator.annotationId ? `&annotation=${encodeURIComponent(locator.annotationId)}` : ''}${locator.revision ? `&revision=${encodeURIComponent(locator.revision)}` : ''}`;
  if (locator.kind === 'video-time') return `#t=${encodeURIComponent(locator.startMs)}${locator.endMs === undefined ? '' : `,${encodeURIComponent(locator.endMs)}`}`;
  if (locator.kind === 'image-region') return `#rect=${locator.rect.map(value => encodeURIComponent(value)).join(',')}`;
  if (locator.kind === 'html-range' && locator.anchor) return `#anchor=${encodeURIComponent(locator.anchor)}`;
  return '';
}

export function embedTarget(path, locator) {
  return `![[${path}${mediaLocatorSuffix(locator)}]]`;
}

/** Float noise a writer may carry: the same tolerance `normalizeRect` in
 * `pdf-annotations.js` uses when it proves a box fits inside the page. */
const REGION_TOLERANCE = 1e-9;

/** The strict `pdf-region` reader: four finite numbers normalized to the page
 * with a top-left origin, each inside `[0, 1]` and the whole box inside the page.
 * Clamping an out-of-range value would repair a writer bug by quietly moving a
 * student to text the card never quoted, so such a locator is rejected, not
 * repaired. Rounding to six decimals matches `normalizeRect` in
 * `pdf-annotations.js`, so a locator the writer accepted round-trips unchanged. */
function regionRect(rect) {
  if (!Array.isArray(rect) || rect.length !== 4 || rect.some(value => !Number.isFinite(value))) return undefined;
  const [x, y, width, height] = rect.map(value => Math.round(value * 1_000_000) / 1_000_000);
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return undefined;
  if (x + width > 1 + REGION_TOLERANCE || y + height > 1 + REGION_TOLERANCE) return undefined;
  return [x, y, width, height];
}

/** Four comma-separated numbers, or nothing. `Number('')` is `0`, so a
 * blank field is rejected here instead of silently becoming a coordinate at the
 * page origin. */
function rectNumbers(value) {
  const parts = String(value ?? '').split(',');
  if (parts.length !== 4) return undefined;
  const numbers = [];
  for (const part of parts) {
    const text = part.trim();
    if (!text) return undefined;
    const number = Number(text);
    if (!Number.isFinite(number)) return undefined;
    numbers.push(number);
  }
  return numbers;
}

/** The `revision` a PDF locator carries pins the exact bytes the reference was
 * taken from, so both locator shapes keep it instead of silently dropping it. */
function revisionParam(params) {
  const revision = params.get('revision');
  return revision ? { revision } : {};
}

/** A `#page=` / `#rect=` fragment the locator grammar cannot read: the reference
 * to the file is real, its position is not. The marker travels with the target so
 * no consumer quietly falls back to page one or to a heading hint — a reader that
 * ignores it would point a student at text this reference never quoted. */
function invalidLocator(path) {
  return { path, locator: undefined, invalidLocator: true };
}

export function parseMediaTarget(target) {
  const separator = target.indexOf('#');
  const path = separator < 0 ? target : target.slice(0, separator);
  const fragment = separator < 0 ? '' : target.slice(separator + 1);
  if (!fragment) return { path, locator: undefined };
  const params = new URLSearchParams(fragment);
  const key = fragment.includes('=') ? fragment.slice(0, fragment.indexOf('=')) : fragment;
  const raw = params.get(key) ?? '';
  if (key === 'page') {
    // A page number is a real 1-based page: `#page=0`, `#page=1.5`, a blank or an
    // unreadable page is a malformed locator, never page one.
    const page = Number(raw);
    if (!Number.isSafeInteger(page) || page < 1) return invalidLocator(path);
    // A bare `#page=N` claims the whole page. Adding `rect` turns the reference
    // into a region and is then held to the region's own contract: a malformed
    // rectangle yields no locator instead of silently widening the claim to the
    // whole page, which would point a student at text the card never quoted.
    if (params.has('rect')) {
      const rect = regionRect(rectNumbers(params.get('rect')));
      if (!rect) return invalidLocator(path);
      return { path, locator: { kind: 'pdf-region', page, rect, ...(params.get('annotation') ? { annotationId: params.get('annotation') } : {}), ...revisionParam(params) } };
    }
    return { path, locator: { kind: 'pdf-page', page, ...revisionParam(params) } };
  }
  if (key === 't') {
    const [start, end] = (raw ?? '').split(',');
    if (/^\d+$/.test(start ?? '') && (end === undefined || /^\d+$/.test(end))) return { path, locator: { kind: 'video-time', startMs: Number(start), ...(end === undefined ? {} : { endMs: Number(end) }) } };
  }
  if (key === 'rect') {
    const rect = rectNumbers(raw);
    if (rect) return { path, locator: { kind: 'image-region', rect } };
    return invalidLocator(path);
  }
  // `raw` comes from URLSearchParams, which already decoded exactly once.
  if (key === 'anchor' && raw) return { path, locator: { kind: 'html-range', anchor: raw } };
  return { path, locator: undefined };
}
