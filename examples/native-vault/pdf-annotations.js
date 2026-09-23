import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

/**
 * PDF 图层 / 矩形高亮批注持久化（native vault 配套模块）。
 *
 * 契约：
 *   const store = createPdfAnnotationStore(vaultRoot);
 *   await store.read(path)        -> { path, pdfRevision, revision, layers, annotations, stale }
 *   await store.mutate(input)     -> 同 read 的返回形状（写入后的新状态）
 *
 * - `path` 是 vault 相对路径，必须是真实存在的 `.pdf` 文件（走 lstat/软链校验，
 *   拒绝点目录、`_templates/`、`node_modules/`、`..` 穿越与任意软链；vaultRoot 自身
 *   也不能是软链）。
 * - 存储文件 `vault/.notara/pdf-annotations/<sha256(path)>.json`（路径 utf8 的
 *   完整 sha256 十六进制）。存储链路的每一段（`.notara`、`pdf-annotations`、
 *   JSON 文件本身）都在读写前做软链校验，`mkdir` 之后再校验一次，避免软链把
 *   批注写到 vault 之外。
 * - `pdfRevision` 是 PDF 字节的 24 位 sha256，与 vault.js 的 `revisionForBytes`
 *   / `readAsset` 同口径（不是 media.js 的 FNV）。
 * - `revision` 不落盘，由存储 JSON 的规范序列化（对象键排序）算 24 位 sha256；
 *   文件不存在时为 `null`。
 * - 稳定错误码：`vault_path_invalid` / `vault_pdf_required` / `vault_file_not_found` /
 *   `vault_annotations_invalid` / `vault_annotations_conflict` /
 *   `vault_pdf_revision_conflict` / `vault_layer_not_found` / `vault_layer_not_empty` /
 *   `vault_layer_required` / `vault_annotation_not_found` / `vault_annotations_too_large`。
 */

const SCHEMA_VERSION = 1;
const COLORS = ['yellow', 'green', 'blue', 'pink'];
const DEFAULT_LAYER = { id: 'default', name: '默认图层', color: 'yellow' };
const STORE_DIR = ['.notara', 'pdf-annotations'];
const MAX_LAYERS = 64;
const MAX_ANNOTATIONS = 2000;
const MAX_NAME_LENGTH = 80;
const MAX_NOTE_LENGTH = 4000;
const MAX_PAGE = 100000;
const MAX_STORE_BYTES = 8 * 1024 * 1024;
const REVISION = /^[0-9a-f]{24}$/;

const COMMON_KEYS = ['path', 'action', 'expectedRevision', 'expectedPdfRevision'];
const ACTION_FIELDS = {
  'add-layer': ['name', 'color'],
  'update-layer': ['layerId', 'name', 'color'],
  'remove-layer': ['layerId'],
  'add-annotation': ['layerId', 'page', 'rect', 'note'],
  'update-annotation': ['annotationId', 'note', 'rect', 'page', 'layerId'],
  'remove-annotation': ['annotationId'],
};

function fail(code) {
  throw new Error(code);
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function revisionForBytes(bytes) {
  return sha256Hex(bytes).slice(0, 24);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function revisionForRecord(record) {
  return revisionForBytes(Buffer.from(JSON.stringify(canonicalize(record)), 'utf8'));
}

function normalizeVaultPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || value.includes('\\')
    || value.startsWith('/') || /^[A-Za-z]:/.test(value)) fail('vault_path_invalid');
  const parts = value.split('/');
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') fail('vault_path_invalid');
    if (part.startsWith('.')) fail('vault_path_invalid');
    if (part === '_templates' || part === 'node_modules') fail('vault_path_invalid');
  }
  if (!parts[parts.length - 1].toLowerCase().endsWith('.pdf')) fail('vault_pdf_required');
  return parts.join('/');
}

function inside(root, target) {
  const value = relative(root, target);
  return value === '' || (value !== '..' && !value.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(value));
}

function normalizeName(value) {
  if (typeof value !== 'string') fail('vault_annotations_invalid');
  const name = value.trim();
  if (!name || name.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) fail('vault_annotations_invalid');
  return name;
}

function normalizeColor(value) {
  if (typeof value !== 'string' || !COLORS.includes(value)) fail('vault_annotations_invalid');
  return value;
}

function normalizePage(value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE) fail('vault_annotations_invalid');
  return value;
}

function normalizeRect(value) {
  if (!Array.isArray(value) || value.length !== 4 || value.some(item => !Number.isFinite(item))) fail('vault_annotations_invalid');
  const [x, y, w, h] = value;
  const round = item => Math.round(item * 1_000_000) / 1_000_000;
  const rect = [round(x), round(y), round(w), round(h)];
  const [rx, ry, rw, rh] = rect;
  if (rx < 0 || ry < 0 || rw <= 0 || rh <= 0) fail('vault_annotations_invalid');
  if (rx + rw > 1 + 1e-9 || ry + rh > 1 + 1e-9) fail('vault_annotations_invalid');
  return rect;
}

function normalizeNote(value) {
  if (typeof value !== 'string' || value.length > MAX_NOTE_LENGTH) fail('vault_annotations_invalid');
  return value;
}

function normalizeAnnotationId(value) {
  if (typeof value !== 'string' || value.length === 0) fail('vault_annotations_invalid');
  return value;
}

function cloneLayer(layer) {
  return { id: layer.id, name: layer.name, color: layer.color };
}

function cloneAnnotation(annotation) {
  return { id: annotation.id, layerId: annotation.layerId, page: annotation.page, rect: [...annotation.rect], note: annotation.note };
}

/** Stored-file shape is trusted only after full validation — a hand-edited or
 *  truncated JSON must surface as `vault_annotations_invalid`, never as a
 *  silently half-loaded layer list. */
function parseStoreRecord(raw, expectedPath) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail('vault_annotations_invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('vault_annotations_invalid');
  if (value.schemaVersion !== SCHEMA_VERSION || value.path !== expectedPath) fail('vault_annotations_invalid');
  if (typeof value.pdfRevision !== 'string' || !REVISION.test(value.pdfRevision)) fail('vault_annotations_invalid');
  if (!Array.isArray(value.layers) || value.layers.length === 0 || value.layers.length > MAX_LAYERS) fail('vault_annotations_invalid');
  if (!Array.isArray(value.annotations) || value.annotations.length > MAX_ANNOTATIONS) fail('vault_annotations_invalid');
  const layerIds = new Set();
  const layers = value.layers.map(layer => {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) fail('vault_annotations_invalid');
    const id = normalizeAnnotationId(layer.id);
    if (layerIds.has(id)) fail('vault_annotations_invalid');
    layerIds.add(id);
    return { id, name: normalizeName(layer.name), color: normalizeColor(layer.color) };
  });
  const annotationIds = new Set();
  const annotations = value.annotations.map(annotation => {
    if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation)) fail('vault_annotations_invalid');
    const id = normalizeAnnotationId(annotation.id);
    if (annotationIds.has(id)) fail('vault_annotations_invalid');
    annotationIds.add(id);
    const layerId = normalizeAnnotationId(annotation.layerId);
    if (!layerIds.has(layerId)) fail('vault_annotations_invalid');
    return { id, layerId, page: normalizePage(annotation.page), rect: normalizeRect(annotation.rect), note: normalizeNote(annotation.note) };
  });
  return { schemaVersion: SCHEMA_VERSION, path: expectedPath, pdfRevision: value.pdfRevision, layers, annotations };
}

function parseMutation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('vault_annotations_invalid');
  const fields = ACTION_FIELDS[input.action];
  if (!fields) fail('vault_annotations_invalid');
  const allowed = new Set([...COMMON_KEYS, ...fields]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail('vault_annotations_invalid');
  for (const key of COMMON_KEYS) if (!Object.hasOwn(input, key)) fail('vault_annotations_invalid');

  const path = normalizeVaultPath(input.path);
  const { action } = input;
  const expectedRevision = input.expectedRevision;
  if (expectedRevision !== null && (typeof expectedRevision !== 'string' || !REVISION.test(expectedRevision))) fail('vault_annotations_invalid');
  if (typeof input.expectedPdfRevision !== 'string' || !REVISION.test(input.expectedPdfRevision)) fail('vault_annotations_invalid');

  const plan = { action, path, expectedRevision, expectedPdfRevision: input.expectedPdfRevision };
  const layerId = () => {
    if (!Object.hasOwn(input, 'layerId')) fail('vault_annotations_invalid');
    return normalizeAnnotationId(input.layerId);
  };

  if (action === 'add-layer') {
    if (Object.hasOwn(input, 'name')) plan.name = normalizeName(input.name);
    if (Object.hasOwn(input, 'color')) plan.color = normalizeColor(input.color);
  } else if (action === 'update-layer') {
    plan.layerId = layerId();
    const hasName = Object.hasOwn(input, 'name'), hasColor = Object.hasOwn(input, 'color');
    if (!hasName && !hasColor) fail('vault_annotations_invalid');
    if (hasName) plan.name = normalizeName(input.name);
    if (hasColor) plan.color = normalizeColor(input.color);
  } else if (action === 'remove-layer') {
    plan.layerId = layerId();
  } else if (action === 'add-annotation') {
    plan.layerId = layerId();
    plan.page = normalizePage(input.page);
    plan.rect = normalizeRect(input.rect);
    plan.note = Object.hasOwn(input, 'note') ? normalizeNote(input.note) : '';
  } else if (action === 'update-annotation') {
    if (!Object.hasOwn(input, 'annotationId')) fail('vault_annotations_invalid');
    plan.annotationId = normalizeAnnotationId(input.annotationId);
    const hasNote = Object.hasOwn(input, 'note'), hasRect = Object.hasOwn(input, 'rect');
    const hasPage = Object.hasOwn(input, 'page'), hasLayer = Object.hasOwn(input, 'layerId');
    if (!hasNote && !hasRect && !hasPage && !hasLayer) fail('vault_annotations_invalid');
    if (hasNote) plan.note = normalizeNote(input.note);
    if (hasRect) plan.rect = normalizeRect(input.rect);
    if (hasPage) plan.page = normalizePage(input.page);
    if (hasLayer) plan.layerId = layerId();
  } else if (Object.hasOwn(input, 'annotationId')) {
    plan.annotationId = normalizeAnnotationId(input.annotationId);
  } else {
    fail('vault_annotations_invalid');
  }
  return plan;
}

function layerIndex(record, id) {
  const index = record.layers.findIndex(layer => layer.id === id);
  if (index < 0) fail('vault_layer_not_found');
  return index;
}

function applyAction(record, plan) {
  const next = {
    schemaVersion: SCHEMA_VERSION,
    path: record.path,
    pdfRevision: record.pdfRevision,
    layers: record.layers.map(cloneLayer),
    annotations: record.annotations.map(cloneAnnotation),
  };

  if (plan.action === 'add-layer') {
    if (next.layers.length >= MAX_LAYERS) fail('vault_annotations_too_large');
    next.layers.push({
      id: randomUUID(),
      name: plan.name ?? `图层 ${next.layers.length + 1}`,
      color: plan.color ?? 'yellow',
    });
  } else if (plan.action === 'update-layer') {
    const layer = next.layers[layerIndex(next, plan.layerId)];
    if (plan.name !== undefined) layer.name = plan.name;
    if (plan.color !== undefined) layer.color = plan.color;
  } else if (plan.action === 'remove-layer') {
    const index = layerIndex(next, plan.layerId);
    if (next.layers[index].id === DEFAULT_LAYER.id && next.layers.length === 1) fail('vault_layer_required');
    if (next.annotations.some(annotation => annotation.layerId === plan.layerId)) fail('vault_layer_not_empty');
    if (next.layers.length <= 1) fail('vault_layer_required');
    next.layers.splice(index, 1);
  } else if (plan.action === 'add-annotation') {
    if (next.annotations.length >= MAX_ANNOTATIONS) fail('vault_annotations_too_large');
    layerIndex(next, plan.layerId);
    next.annotations.push({ id: randomUUID(), layerId: plan.layerId, page: plan.page, rect: [...plan.rect], note: plan.note });
  } else if (plan.action === 'update-annotation') {
    const index = next.annotations.findIndex(annotation => annotation.id === plan.annotationId);
    if (index < 0) fail('vault_annotation_not_found');
    const annotation = next.annotations[index];
    if (plan.layerId !== undefined) {
      layerIndex(next, plan.layerId);
      annotation.layerId = plan.layerId;
    }
    if (plan.page !== undefined) annotation.page = plan.page;
    if (plan.rect !== undefined) annotation.rect = [...plan.rect];
    if (plan.note !== undefined) annotation.note = plan.note;
  } else {
    const index = next.annotations.findIndex(annotation => annotation.id === plan.annotationId);
    if (index < 0) fail('vault_annotation_not_found');
    next.annotations.splice(index, 1);
  }
  return next;
}

export function createPdfAnnotationStore(vaultRoot) {
  const rootPath = resolve(vaultRoot);
  const locks = new Map();

  async function ensureRoot() {
    let info;
    try {
      info = await lstat(rootPath);
    } catch (error) {
      if (error instanceof Error && error.code === 'ENOENT') fail('vault_path_invalid');
      throw error;
    }
    if (info.isSymbolicLink() || !info.isDirectory()) fail('vault_path_invalid');
    return rootPath;
  }

  async function rejectSymlinkPath(target) {
    let cursor = rootPath;
    const parts = relative(rootPath, target).split('/').filter(Boolean);
    for (const [index, part] of parts.entries()) {
      cursor = join(cursor, part);
      try {
        const info = await lstat(cursor);
        if (info.isSymbolicLink()) fail('vault_path_invalid');
        if (index < parts.length - 1 && !info.isDirectory()) fail('vault_path_invalid');
      } catch (error) {
        if (error instanceof Error && error.code === 'ENOENT') break;
        throw error;
      }
    }
  }

  async function resolvePdf(value) {
    const absolute = resolve(rootPath, value);
    if (!inside(rootPath, absolute)) fail('vault_path_invalid');
    await ensureRoot();
    await rejectSymlinkPath(absolute);
    let info;
    try {
      info = await lstat(absolute);
    } catch (error) {
      if (error instanceof Error && error.code === 'ENOENT') fail('vault_file_not_found');
      throw error;
    }
    if (info.isSymbolicLink() || !info.isFile()) fail('vault_path_invalid');
    return absolute;
  }

  function storeFile(value) {
    return join(storeDirectory(), `${sha256Hex(Buffer.from(value, 'utf8'))}.json`);
  }

  function storeDirectory() {
    return join(rootPath, ...STORE_DIR);
  }

  /** `.notara/` 与 `pdf-annotations/` 允许尚不存在，但存在时必须是真实目录，
   *  不能是软链。`rejectSymlinkPath` 在 ENOENT 处停止，因此首次写入也安全。 */
  async function guardStorePath(file) {
    await ensureRoot();
    await rejectSymlinkPath(storeDirectory());
    await rejectSymlinkPath(file);
  }

  async function readRecord(value) {
    const file = storeFile(value);
    await guardStorePath(file);
    let info;
    try {
      info = await lstat(file);
    } catch (error) {
      if (error instanceof Error && error.code === 'ENOENT') return null;
      throw error;
    }
    if (info.isSymbolicLink() || !info.isFile()) fail('vault_annotations_invalid');
    // 先按 stat 大小封顶再读，避免把一个无界的 JSON 整个读进内存。
    if (info.size > MAX_STORE_BYTES) fail('vault_annotations_too_large');
    const raw = await readFile(file, 'utf8');
    // stat 与 read 之间文件可能变大，读完再核一次字节数。
    if (Buffer.byteLength(raw, 'utf8') > MAX_STORE_BYTES) fail('vault_annotations_too_large');
    return parseStoreRecord(raw, value);
  }

  async function writeRecord(value, record) {
    const file = storeFile(value);
    const payload = JSON.stringify(record, null, 2);
    if (Buffer.byteLength(payload, 'utf8') > MAX_STORE_BYTES) fail('vault_annotations_too_large');
    await guardStorePath(file);
    await mkdir(storeDirectory(), { recursive: true });
    // mkdir 会跟随已存在的软链，创建之后必须重新校验整条路径。
    await guardStorePath(file);
    const temporary = `${file}.notara-annotations-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(temporary, payload, 'utf8');
      await rename(temporary, file);
      // rename 理论上覆盖软链本身而非其目标；再校验一次，让中间目录在写入
      // 窗口内被换成软链的情况显式失败，而不是静默写到 vault 之外。
      await rejectSymlinkPath(file);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  function withLock(key, task) {
    const previous = locks.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.then(() => undefined, () => undefined);
    locks.set(key, settled);
    settled.then(() => { if (locks.get(key) === settled) locks.delete(key); });
    return run;
  }

  function shape(value, pdfRevision, record) {
    if (!record) {
      return { path: value, pdfRevision, revision: null, layers: [cloneLayer(DEFAULT_LAYER)], annotations: [], stale: false };
    }
    return {
      path: value,
      pdfRevision,
      revision: revisionForRecord(record),
      layers: record.layers.map(cloneLayer),
      annotations: record.annotations.map(cloneAnnotation),
      stale: record.pdfRevision !== pdfRevision,
    };
  }

  async function read(path) {
    const value = normalizeVaultPath(path);
    const absolute = await resolvePdf(value);
    const pdfRevision = revisionForBytes(await readFile(absolute));
    return shape(value, pdfRevision, await readRecord(value));
  }

  async function mutate(input) {
    const plan = parseMutation(input);
    const value = plan.path;
    return withLock(storeFile(value), async () => {
      const absolute = await resolvePdf(value);
      const pdfRevision = revisionForBytes(await readFile(absolute));
      const record = await readRecord(value);
      const currentRevision = record ? revisionForRecord(record) : null;
      if (plan.expectedRevision !== currentRevision) fail('vault_annotations_conflict');
      if (plan.expectedPdfRevision !== pdfRevision) fail('vault_pdf_revision_conflict');
      // Stored highlights belong to the page images they were drawn on. When
      // the PDF bytes moved, keep returning them on read (stale=true) but never
      // write them forward onto a different revision.
      if (record && record.pdfRevision !== pdfRevision) fail('vault_pdf_revision_conflict');
      const base = record ?? {
        schemaVersion: SCHEMA_VERSION,
        path: value,
        pdfRevision,
        layers: [cloneLayer(DEFAULT_LAYER)],
        annotations: [],
      };
      const next = applyAction({ ...base, pdfRevision }, plan);
      await writeRecord(value, next);
      return shape(value, pdfRevision, await readRecord(value));
    });
  }

  return { read, mutate };
}
