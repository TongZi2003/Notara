import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, lstat, realpath, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import { mediaForPath } from './media.js';

const WIKI_LINK = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const TASK = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;

const comparePath = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function fail(code) {
  throw new Error(code);
}

function canonicalLink(raw) {
  const value = raw.trim().replaceAll('\\', '/').replace(/^\.\//, '');
  if (!value || value.startsWith('/') || value.split('/').some(part => part === '..' || part === '.')) return undefined;
  // An embed of a media asset is a preview reference, not a page link — never
  // canonicalize it into a phantom `<asset>.md`.
  if (mediaForPath(value).kind !== 'file') return undefined;
  return value.toLowerCase().endsWith('.md') ? value : `${value}.md`;
}

export function safeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) fail('vault_path_invalid');
  const parts = value.split('/');
  if (parts.some(part => part === '' || part === '.' || part === '..')) fail('vault_path_invalid');
  return parts.join('/');
}

export function revisionFor(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 24);
}

function revisionForBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 24);
}

export function parseMarkdownDocument(path, content, revision = revisionFor(content)) {
  const normalizedPath = safeRelativePath(path);
  if (!normalizedPath.toLowerCase().endsWith('.md')) fail('vault_markdown_required');
  if (typeof content !== 'string') fail('vault_content_invalid');
  const { frontmatter, body } = parseFrontmatter(content);
  const lines = content.split(/\r?\n/);
  const headings = [];
  for (const line of lines) {
    const match = line.match(HEADING);
    if (match) headings.push(match[2]);
  }
  const links = [];
  for (const match of body.matchAll(WIKI_LINK)) {
    const link = canonicalLink(match[1]);
    if (link && !links.includes(link)) links.push(link);
  }
  const tasks = [];
  lines.forEach((line, index) => {
    const match = line.match(TASK);
    if (match) tasks.push({ checked: match[2].toLowerCase() === 'x', text: match[3].trim(), line: index + 1, page: normalizedPath });
  });
  const title = typeof frontmatter.title === 'string' && frontmatter.title.trim()
    ? frontmatter.title.trim()
    : headings[0] ?? basename(normalizedPath, '.md');
  const type = typeof frontmatter.type === 'string' ? frontmatter.type : null;
  const status = typeof frontmatter.status === 'string' ? frontmatter.status : null;
  const date = typeof frontmatter.date === 'string' || typeof frontmatter.date === 'number' ? String(frontmatter.date) : null;
  return { path: normalizedPath, revision, content, title, type, status, date, frontmatter, headings, links, tasks };
}

export function summarizeDocument(document) {
  const tags = Array.isArray(document.frontmatter.tags) ? document.frontmatter.tags.filter(item => typeof item === 'string') : [];
  return {
    kind: 'page',
    path: document.path,
    title: document.title,
    type: document.type,
    status: document.status,
    date: document.date,
    tags,
    revision: document.revision,
    taskCount: document.tasks.length,
    completedTaskCount: document.tasks.filter(task => task.checked).length,
    linkCount: document.links.length,
  };
}

export function projectTree(documents) {
  const root = { name: '', children: [] };
  for (const document of documents) {
    let node = root;
    const parts = document.path.split('/');
    parts.forEach((part, index) => {
      const last = index === parts.length - 1;
      let child = node.children.find(item => item.name === part);
      if (!child) {
        child = last ? { name: part, path: document.path, ...(document.kind ? { kind: document.kind } : {}), children: [] } : { name: part, children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = node => {
    node.children.sort((left, right) => {
      const leftFile = left.path ? 1 : 0, rightFile = right.path ? 1 : 0;
      return leftFile - rightFile || comparePath(left.name, right.name);
    });
    node.children.forEach(sort);
  };
  sort(root);
  return root;
}

function fieldValue(document, key) {
  if (key === 'title' || key === 'type' || key === 'status' || key === 'date') return document[key];
  if (key === 'path') return document.path;
  return document.frontmatter[key];
}

function matchesWhere(document, where) {
  return Object.entries(where ?? {}).every(([key, expected]) => {
    const actual = fieldValue(document, key);
    if (Array.isArray(actual)) return Array.isArray(expected) ? expected.every(item => actual.includes(item)) : actual.includes(expected);
    return actual === expected;
  });
}

export function queryDocuments(documents, where = {}, limit = 100) {
  return documents.filter(document => matchesWhere(document, where)).slice(0, limit).map(summarizeDocument);
}

export function searchDocuments(documents, query, limit = 50) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return documents.slice(0, limit).map(summarizeDocument);
  return documents.map(document => {
    const title = document.title.toLocaleLowerCase();
    const path = document.path.toLocaleLowerCase();
    const content = document.content.toLocaleLowerCase();
    const score = (title === needle ? 100 : 0) + (title.split(needle).length - 1) * 4 + (path.split(needle).length - 1) * 2 + (content.split(needle).length - 1);
    return score > 0 ? { ...summarizeDocument(document), score, snippet: buildSnippet(document.content, needle) } : undefined;
  }).filter(Boolean).sort((left, right) => right.score - left.score || comparePath(left.path, right.path)).slice(0, limit);
}

function buildSnippet(content, needle) {
  const lower = content.toLocaleLowerCase(), index = lower.indexOf(needle);
  if (index < 0) return content.split(/\r?\n/).find(Boolean) ?? '';
  const start = Math.max(0, index - 48), end = Math.min(content.length, index + needle.length + 96);
  return `${start > 0 ? '…' : ''}${content.slice(start, end).replaceAll('\n', ' ')}${end < content.length ? '…' : ''}`;
}

export function buildBacklinks(documents) {
  const result = new Map();
  for (const document of documents) {
    for (const link of document.links) {
      const incoming = result.get(link) ?? [];
      if (!incoming.includes(document.path)) incoming.push(document.path);
      result.set(link, incoming.sort(comparePath));
    }
  }
  return result;
}

export function renderTemplate(content, values) {
  return content.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\s*\}\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
}

export function toggleTaskContent(content, line, checked) {
  if (!Number.isInteger(line) || line < 1) fail('vault_task_not_found');
  const lines = content.split(/\r?\n/), index = line - 1, match = lines[index]?.match(TASK);
  if (!match) fail('vault_task_not_found');
  const marker = checked ? 'x' : ' ';
  lines[index] = lines[index].replace(/\[([ xX])\]/, `[${marker}]`);
  return lines.join('\n');
}

function inside(root, target) {
  const value = relative(root, target);
  return value === '' || (value !== '..' && !value.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(value));
}

async function rejectSymlinkPath(root, target) {
  let cursor = root;
  const parts = relative(root, target).split('/').filter(Boolean);
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

export function createVaultStore(root, templateRoot) {
  const rootPath = resolve(root);

  async function ensureRoot() {
    await mkdir(rootPath, { recursive: true });
    const info = await lstat(rootPath);
    if (info.isSymbolicLink() || !info.isDirectory()) fail('vault_path_invalid');
    return realpath(rootPath);
  }

  async function target(path, createParent = false) {
    const value = safeRelativePath(path), absolute = resolve(rootPath, value);
    if (!inside(rootPath, absolute)) fail('vault_path_invalid');
    await ensureRoot();
    await rejectSymlinkPath(rootPath, absolute);
    if (createParent) {
      await mkdir(dirname(absolute), { recursive: true });
      await rejectSymlinkPath(rootPath, absolute);
    }
    return absolute;
  }

  async function walk(directory, prefix, includeTemplates = false) {
    const entries = await readdir(directory, { withFileTypes: true });
    const result = [];
    for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      if (entry.isSymbolicLink() || (!includeTemplates && prefix === '' && entry.name === '_templates')) continue;
      const absolute = join(directory, entry.name), path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) result.push(...await walk(absolute, path, includeTemplates));
      else if (entry.isFile()) result.push(path);
    }
    return result;
  }

  async function files(includeTemplates = false) {
    await ensureRoot();
    return walk(rootPath, '', includeTemplates);
  }

  async function pagePaths() {
    return (await files()).filter(path => path.toLowerCase().endsWith('.md'));
  }

  async function assetPaths() {
    return (await files()).filter(path => !path.toLowerCase().endsWith('.md'));
  }

  async function seedTemplates() {
    if (!templateRoot) return;
    const bundledRoot = resolve(templateRoot);
    let entries;
    try { entries = await readdir(bundledRoot, { withFileTypes: true }); }
    catch (error) { if (error instanceof Error && error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      const name = safeRelativePath(entry.name), destination = await target(`_templates/${name}`, true);
      try {
        await lstat(destination);
        continue;
      } catch (error) {
        if (!(error instanceof Error) || error.code !== 'ENOENT') throw error;
      }
      const content = await readFile(join(bundledRoot, entry.name), 'utf8');
      const temporary = `${destination}.notara-template-${process.pid}-${randomUUID()}`;
      try {
        await writeFile(temporary, content, 'utf8');
        await rename(temporary, destination);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    }
  }

  async function assetSummary(path) {
    const value = safeRelativePath(path);
    if (value.toLowerCase().endsWith('.md') || value.startsWith('_templates/')) fail('vault_asset_required');
    try {
      const bytes = await readFile(await target(value));
      const media = mediaForPath(value);
      return { path: value, title: basename(value), kind: 'asset', assetKind: media.kind, mime: media.mime, extension: media.extension, size: bytes.byteLength, revision: revisionForBytes(bytes) };
    } catch (error) {
      if (error instanceof Error && error.code === 'ENOENT') fail('vault_file_not_found');
      throw error;
    }
  }

  async function readAsset(path) {
    const summary = await assetSummary(path), bytes = await readFile(await target(summary.path));
    return { ...summary, dataUrl: `data:${summary.mime};base64,${bytes.toString('base64')}` };
  }

  function decodeAsset(dataBase64) {
    if (typeof dataBase64 !== 'string' || dataBase64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64)) fail('vault_asset_data_invalid');
    const bytes = Buffer.from(dataBase64, 'base64');
    if (bytes.toString('base64') !== dataBase64) fail('vault_asset_data_invalid');
    if (bytes.byteLength > 50 * 1024 * 1024) fail('vault_asset_too_large');
    return bytes;
  }

  async function saveAsset(path, dataBase64, mime, expectedRevision) {
    const value = safeRelativePath(path);
    if (value.toLowerCase().endsWith('.md') || value.startsWith('_templates/')) fail('vault_asset_required');
    const media = mediaForPath(value), actualMime = mime || media.mime;
    if (media.kind !== 'file' && actualMime !== media.mime) fail('vault_asset_mime_invalid');
    const bytes = decodeAsset(dataBase64), absolute = await target(value, true);
    let current = null;
    try { current = revisionForBytes(await readFile(absolute)); }
    catch (error) { if (!(error instanceof Error) || error.code !== 'ENOENT') throw error; }
    if (current !== expectedRevision) fail('vault_revision_conflict');
    const temporary = `${absolute}.notara-asset-${process.pid}-${randomUUID()}`;
    try { await writeFile(temporary, bytes); await rename(temporary, absolute); }
    finally { await unlink(temporary).catch(() => undefined); }
    return readAsset(value);
  }

  async function readDocument(path) {
    const value = safeRelativePath(path);
    if (!value.toLowerCase().endsWith('.md') || value.startsWith('_templates/')) fail('vault_markdown_required');
    try {
      const content = await readFile(await target(value), 'utf8');
      return parseMarkdownDocument(value, content, revisionFor(content));
    } catch (error) {
      if (error instanceof Error && error.code === 'ENOENT') fail('vault_file_not_found');
      throw error;
    }
  }

  async function scan() {
    const result = [];
    for (const path of await pagePaths()) result.push(await readDocument(path));
    return result;
  }

  async function scanAssets() {
    const result = [];
    for (const path of await assetPaths()) result.push(await assetSummary(path));
    return result;
  }

  async function saveDocument(path, content, expectedRevision) {
    const value = safeRelativePath(path);
    if (!value.toLowerCase().endsWith('.md') || value.startsWith('_templates/')) fail('vault_markdown_required');
    const absolute = await target(value, true);
    let current = null;
    try {
      const existing = await readFile(absolute, 'utf8');
      current = revisionFor(existing);
    } catch (error) {
      if (!(error instanceof Error) || error.code !== 'ENOENT') throw error;
    }
    if (current !== expectedRevision) fail('vault_revision_conflict');
    const parsed = parseMarkdownDocument(value, content, revisionFor(content));
    const temporary = `${absolute}.notara-tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(temporary, content, 'utf8');
      await rename(temporary, absolute);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    return parsed;
  }

  return {
    async list(prefix) {
      const documents = await scan(), assets = await scanAssets(), value = prefix ? safeRelativePath(prefix) : undefined;
      const entries = [...documents.map(summarizeDocument), ...assets];
      return { files: entries.filter(document => !value || document.path === value || document.path.startsWith(`${value}/`)), tree: projectTree(entries) };
    },
    read: readDocument,
    readAsset,
    save: saveDocument,
    saveAsset,
    async search(query, limit) { return searchDocuments(await scan(), query, limit); },
    async query(where, limit) { return queryDocuments(await scan(), where, limit); },
    async links(path) {
      const document = await readDocument(path), backlinks = buildBacklinks(await scan());
      return { outgoing: document.links, incoming: backlinks.get(document.path) ?? [] };
    },
    async templates() {
      await seedTemplates();
      const paths = await files(true), result = [];
      for (const path of paths.filter(item => item.startsWith('_templates/'))) {
        const content = await readFile(await target(path), 'utf8');
        const document = parseMarkdownDocument(path.slice('_templates/'.length), content, revisionFor(content));
        const title = typeof document.frontmatter.name === 'string' && document.frontmatter.name.trim()
          ? document.frontmatter.name.trim()
          : document.title;
        result.push({ path: path.slice('_templates/'.length), title, type: document.type, content: document.content });
      }
      return result;
    },
    async createFromTemplate(templatePath, path, values, expectedRevision = null) {
      await seedTemplates();
      const template = safeRelativePath(templatePath);
      if (!template.toLowerCase().endsWith('.md')) fail('vault_template_not_found');
      let content;
      try { content = await readFile(await target(`_templates/${template}`), 'utf8'); }
      catch (error) { if (error instanceof Error && error.code === 'ENOENT') fail('vault_template_not_found'); throw error; }
      if (expectedRevision === null) {
        const value = safeRelativePath(path), absolute = resolve(rootPath, value);
        try { await lstat(absolute); fail('vault_revision_conflict'); } catch (error) { if (!(error instanceof Error) || error.code !== 'ENOENT') throw error; }
      }
      return saveDocument(path, renderTemplate(content, values), expectedRevision);
    },
    async tasks(path) { return (await readDocument(path)).tasks; },
    async toggleTask(path, line, checked, expectedRevision) {
      const document = await readDocument(path);
      if (document.revision !== expectedRevision) fail('vault_revision_conflict');
      return saveDocument(path, toggleTaskContent(document.content, line, checked), expectedRevision);
    },
  };
}
