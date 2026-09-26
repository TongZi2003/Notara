import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, lstat, realpath, unlink, writeFile, link, open, rm } from 'node:fs/promises';
import { lstatSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parseFrontmatter } from './frontmatter.js';
import { mediaForPath } from './media.js';
import { buildVaultGraph } from './graph.js';
import { learningStars } from './mastery-data.js';

const WIKI_LINK = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const TASK = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;

const TRASH_DIRECTORY = '.trash';
const TRASH_META = 'meta.json';
const TRASH_PAYLOAD = 'payload';
/** Every id the trash hands out is a UUID, so an id is also a safe path segment. */
const TRASH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRASH_META_VERSION = 1;

const LEGACY_ROOT_DIRECTORY = 'vault';
/** Auto-created scaffolding: on its own it never proves the legacy layout. */
const LEGACY_ROOT_SCAFFOLDING = new Set(['_templates', 'node_modules']);
/** Layout directories the teaching rules already reserve for material. */
const MATERIAL_DIRECTORIES = ['知识', '卡片', '媒体', '备课', '路线', '锦囊', '学情', '日记', 'lesson_log'];

const isMaterialFile = name => name.toLowerCase().endsWith('.md') || mediaForPath(name).kind !== 'file';

/** True when this directory itself holds Markdown or media files (no recursion). */
function holdsMaterial(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .some(entry => entry.isFile() && isMaterialFile(entry.name));
  } catch {
    return false;
  }
}

/**
 * Resolve the workspace the user registered into its actual material root.
 *
 * Two layouts have to keep working. Older builds wrote every Markdown and PDF
 * under a `vault/` child, while a folder the user selected as the Vault is the
 * material root itself — but an older build still created an empty `vault/`
 * (plus its `_templates/`) inside such a folder. Only the `vault/` child decides:
 *
 * - `vault/` holds anything but scaffolding -> legacy layout, keep reading it no
 *   matter what sits beside it (`README.md`, a second workspace, ...), because
 *   that is where the existing material already lives;
 * - no `vault/` child, or a symlinked one -> the selected directory is the root;
 * - empty or scaffolding-only `vault/` -> the selected directory is the root only
 *   when material is already visible there, directly or inside one of the layout
 *   directories (`知识/卡片/媒体/...`); otherwise the legacy `vault/` root is
 *   kept, so an ambiguous empty workspace never moves paths written under it.
 *
 * Nothing is created here, so writing a new file never moves the root.
 */
export function resolveVaultRoot(workspacePath) {
  const workspace = resolve(workspacePath);
  const legacy = join(workspace, LEGACY_ROOT_DIRECTORY);
  let entries;
  try {
    // lstat: a symlinked `vault/` is never followed, so it cannot redirect the
    // material root outside the workspace the user registered.
    if (!lstatSync(legacy).isDirectory()) return workspace;
    entries = readdirSync(legacy, { withFileTypes: true });
  } catch {
    return workspace;
  }
  if (entries.some(entry => !LEGACY_ROOT_SCAFFOLDING.has(entry.name))) return legacy;
  const direct = holdsMaterial(workspace) || MATERIAL_DIRECTORIES.some(name => holdsMaterial(join(workspace, name)));
  return direct ? workspace : legacy;
}

let cachedTrashHost = null;

/**
 * The identity of the Host instance that owns this trash scope, derived from the
 * harness home the DSH runtime already resolves (`$DSH_HOME`, else `~/.dsh`).
 * Two hosts sharing one workspace therefore delete into two scopes, one host
 * keeps the same scope across restarts, and the value is never read from a
 * request — the client only ever names a file, never a scope.
 */
export function trashHostId(env = process.env) {
  const configured = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
  const home = configured ? resolve(configured.replace(/^~(?=$|[/\\])/, homedir())) : join(homedir(), '.dsh');
  if (cachedTrashHost?.home === home) return cachedTrashHost.id;
  const digest = createHash('sha256').update(home).digest('hex').slice(0, 32);
  const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
  cachedTrashHost = { home, id };
  return id;
}

const comparePath = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function fail(code, cause) {
  throw cause === undefined ? new Error(code) : new Error(code, { cause });
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

/** `parent:` is the single card->card relation. It is derived at the store
 * boundary so the parsed-document shape stays exactly what the pure parser
 * returned before cards existed. */
export function parentPathOf(document) {
  const value = document?.frontmatter?.parent;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

/**
 * Built-in templates earlier bundles shipped. A `_templates/` file is replaced
 * only while its content still matches one of these originals exactly (line
 * endings and a trailing newline aside); any other content is the student's own
 * template and is never overwritten.
 */
export const SUPERSEDED_TEMPLATES = Object.freeze({
  'lesson.md': Object.freeze(["---\ntemplate: true\nname: 备课页\ntype: lesson\nstatus: draft\ntags: []\n---\n# {{title}}\n\n创建日期：{{date}}\n\n<details data-notara=\"teacher\">\n<summary>教师参考</summary>\n\n**本课备课说明**\n\n- 目标：这节课结束时，学生自己能做到什么。\n- 证据与不确定点：查到的相关画像与锦囊、它们支持的判断，以及还没验证的部分。\n- 策略取舍：本课从哪里切入、为什么这样排，哪一步留给学生自己走。\n- 检查点：希望观察到什么，以及怎么看（独立作答 / 提示后完成 / 尚未检查）。\n- 涉及资料：真实文件、物理页码或区域引用，不复制全文。\n- 世界书互动：需要的时机与教学用途；用不上就删掉这一行。\n\n</details>\n\n## 阶段一：这一步要解决什么\n\n### 题 1\n\n把学生看到的题面、材料或问题写在这里；一次只放当前这一步要动手的内容。\n\n<details data-notara=\"teacher\">\n<summary>教师参考</summary>\n\n- 教学意图：这一步想让学生自己走出什么。\n- 递进提示：从最小提醒到接近答案的提示链，每级都留在学生能自己走的动作上。\n- 完整解答：条件、推导、结论与适用条件。\n- 诊断：答对、卡住、答错分别说明什么，下一步往哪走。\n\n</details>\n\n## 阶段二：\n\n### 题 2\n\n<details data-notara=\"teacher\">\n<summary>教师参考</summary>\n\n- 教学意图：\n- 递进提示：\n- 完整解答：\n- 诊断：\n\n</details>\n"]),
  'lesson-script.md': Object.freeze(["---\ntemplate: true\nname: 课堂剧本\ntype: lesson\nstatus: draft\ntags: []\n---\n# {{title}}\n\n创建日期：{{date}}\n\n<details data-notara=\"teacher\">\n<summary>教师参考</summary>\n\n**本课备课说明**\n\n- 目标：这节课结束时，学生自己能做到什么。\n- 证据与不确定点：查到的相关画像与锦囊、它们支持的判断，以及还没验证的部分。\n- 策略取舍：本课从哪里切入、为什么这样排，哪一步留给学生自己走。\n- 检查点：希望观察到什么，以及怎么看（独立作答 / 提示后完成 / 尚未检查）。\n- 涉及资料：真实文件、物理页码或区域引用，不复制全文。\n- 世界书互动：需要的时机与教学用途；用不上就删掉这一行。\n\n</details>\n\n## 阶段一：这一步要解决什么\n\n### 题 1\n\n把学生看到的题面、材料或问题写在这里；一次只放当前这一步要动手的内容。\n\n<details data-notara=\"teacher\">\n<summary>教师参考</summary>\n\n- 教学意图：这一步想让学生自己走出什么。\n- 递进提示：从最小提醒到接近答案的提示链，每级都留在学生能自己走的动作上。\n- 完整解答：条件、推导、结论与适用条件。\n- 诊断：答对、卡住、答错分别说明什么，下一步往哪走。\n- 易错与变式：容易漏掉的条件，以及可以检验理解的变式。\n\n</details>\n\n## 阶段二：\n\n### 题 2\n\n<details data-notara=\"teacher\">\n<summary>教师参考</summary>\n\n- 教学意图：\n- 递进提示：\n- 完整解答：\n- 诊断：\n\n</details>\n"]),
  'card.md': Object.freeze(["---\ntemplate: true\nname: 知识卡片\ntype: card\nstatus: draft\ntags: []\n---\n# {{title}}\n\n## 结论\n\n## 解释\n\n## 例子\n", "---\ntemplate: true\nname: 知识卡片\ntype: card\nstatus: draft\ntags: []\nlearned: false\nmastery: 0\ninterval: null\nlast_review: null\nnext_review: null\n---\n# {{title}}\n\n## 结论\n\n## 解释\n\n## 例子\n"]),
  'insight.md': Object.freeze(["---\ntemplate: true\nname: 锦囊\ntype: insight\nstatus: draft\ntags: []\n---\n# {{title}}\n\n## 何时想起\n\n- [ ] 什么样的题目结构、思维障碍或教学决策值得想起它\n\n## 方法\n\n## 教法\n\n## 学生经历\n\n## 适用边界\n\n## 关联题目\n"]),
  'topic.md': Object.freeze(["---\ntemplate: true\nname: 教学专题\ntype: topic\nstatus: draft\ntags: []\n---\n# {{title}}\n\n本页是教师归纳的教学专题：把几份原书里同一主题的内容汇到一处。`type: topic` 不是原书的目录，也不是复习卡片；它只引用原书，不会变成原书的一章。\n\n## 这一专题解决什么\n\n## 依据的原书\n\n- 列出真实文件与页段；下面的写法只是格式示例，换成本地真实文件后再写成正式引用：\n\n`![[资料/原书第一章.md#anchor=向量]]`\n\n`![[媒体/原书.pdf#page=12&rect=0.08,0.10,0.84,0.12]]`\n\n## 归纳\n\n## 层级\n\n- 上级专题写在 frontmatter 的 `parent:` 里，例如 `parent: 专题/解析几何.md`；专题之间只挂专题，不挂原书章节。\n\n## 待补\n\n- [ ] 还缺哪一块，下一轮补什么\n"]),
});

/** Compare templates as text, not as bytes: an editor that only normalized line
 * endings or the final newline did not change what the template says. */
function normalizedTemplate(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

function isSupersededTemplate(name, existing) {
  const value = normalizedTemplate(existing);
  return (SUPERSEDED_TEMPLATES[name] ?? []).some(candidate => normalizedTemplate(candidate) === value);
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
      // Hidden entries are not Vault content: the model's own IO has always
      // skipped them, and `vault/.trash` must never come back through the file
      // tree, search, asset listing or graph as if it were a page or asset.
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || (!includeTemplates && prefix === '' && entry.name === '_templates')) continue;
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
      let existing = null;
      try { existing = await readFile(destination, 'utf8'); }
      catch (error) { if (!(error instanceof Error) || error.code !== 'ENOENT') throw error; }
      const content = await readFile(join(bundledRoot, entry.name), 'utf8');
      // Seed a missing template; upgrade it only while it is still an untouched
      // built-in this bundle supersedes. A template the student edited stays.
      if (existing !== null && (normalizedTemplate(existing) === normalizedTemplate(content) || !isSupersededTemplate(name, existing))) continue;
      const temporary = `${destination}.notara-template-${process.pid}-${randomUUID()}`;
      try {
        await writeFile(temporary, content, 'utf8');
        if (existing === null) {
          // Missing at the first read does not mean still absent: never replace
          // a template another writer created while this seed was in flight.
          try { await link(temporary, destination); }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
        } else {
          // Match the same last-read revision before upgrading, just like the
          // store's ordinary Markdown CAS writes. Preserve intervening edits.
          const current = await readFile(await target(`_templates/${name}`, true), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
          if (current === existing) await rename(temporary, destination);
        }
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
      const document = parseMarkdownDocument(value, content, revisionFor(content));
      return { ...document, parent: parentPathOf(document) };
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
    return { ...parsed, parent: parentPathOf(parsed) };
  }

  async function statOrNull(path) {
    try { return await lstat(path); }
    catch (error) { if (error instanceof Error && error.code === 'ENOENT') return null; throw error; }
  }

  /** One shared rule for every path the trash may hold: never a dot segment
   * (which covers `.trash` itself), never `node_modules`, never `_templates`.
   * `safeRelativePath` has already refused `..`, absolute paths, drive letters,
   * empty segments and backslashes, so this is the whole traversal boundary. */
  function trashable(value) {
    const parts = value.split('/');
    if (parts.some(part => part.startsWith('.')) || parts.includes('node_modules')) fail('vault_path_invalid');
    if (value === '_templates' || value.startsWith('_templates/')) fail('vault_path_invalid');
    return value;
  }

  /** The revision the client saw for this exact file: pages hash their text,
   * media hash their bytes — the same two rules `read`/`assetSummary` hand out,
   * so a stale page and a stale asset are both caught before anything moves. */
  function currentRevision(value, bytes) {
    return value.toLowerCase().endsWith('.md') ? revisionFor(bytes.toString('utf8')) : revisionForBytes(bytes);
  }

  /** The provenance kept beside the original bytes: which file this was, what
   * the student saw it as, and which revision was actually deleted. */
  function trashMeta(value, bytes, { id, deletedAt }) {
    const base = { version: TRASH_META_VERSION, id, path: value, size: bytes.byteLength, deletedAt };
    if (value.toLowerCase().endsWith('.md')) {
      const document = parseMarkdownDocument(value, bytes.toString('utf8'));
      return { ...base, title: document.title, kind: 'page', type: document.type, revision: revisionFor(bytes.toString('utf8')) };
    }
    const media = mediaForPath(value);
    return { ...base, title: basename(value), kind: 'asset', assetKind: media.kind, mime: media.mime, extension: media.extension, revision: revisionForBytes(bytes) };
  }

  async function readTrashJson(file) {
    const info = await statOrNull(file);
    if (!info || info.isSymbolicLink() || !info.isFile()) return undefined;
    let raw;
    try { raw = await readFile(file, 'utf8'); }
    catch (error) { if (error instanceof Error && error.code === 'ENOENT') return undefined; throw error; }
    try { return JSON.parse(raw); } catch { return undefined; }
  }

  /** The `vault/.trash` root, or null when this Vault has never deleted
   * anything. It is never created by a read, and a `.trash` that is a symlink or
   * a plain file is refused instead of followed. */
  async function trashRoot() {
    await ensureRoot();
    const directory = join(rootPath, TRASH_DIRECTORY), info = await statOrNull(directory);
    if (!info) return null;
    if (info.isSymbolicLink() || !info.isDirectory()) fail('vault_path_invalid');
    return directory;
  }

  /** This Host's own scope under `.trash`. Created only by a delete. */
  async function trashScope() {
    const root = await trashRoot();
    const directory = join(root ?? join(rootPath, TRASH_DIRECTORY), trashHostId());
    await mkdir(directory, { recursive: true });
    const info = await statOrNull(directory);
    if (!info || info.isSymbolicLink() || !info.isDirectory()) fail('vault_path_invalid');
    return directory;
  }

  /** One recoverable entry: a real directory named like its own id, carrying our
   * metadata for that id and the original bytes. Anything half-written, hand
   * edited or pointing somewhere the Vault refuses is not listed at all, so the
   * trash only ever offers what `restoreFile` can really put back. */
  async function readTrashEntry(scope, id) {
    const directory = join(scope, id), meta = await readTrashJson(join(directory, TRASH_META));
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined;
    if (meta.version !== TRASH_META_VERSION || meta.id !== id) return undefined;
    if (typeof meta.path !== 'string' || typeof meta.title !== 'string' || typeof meta.deletedAt !== 'string') return undefined;
    if (!meta.title || meta.title.length > 500 || meta.path.length > 1_000) return undefined;
    if (!Number.isFinite(Date.parse(meta.deletedAt))) return undefined;
    try { trashable(safeRelativePath(meta.path)); } catch { return undefined; }
    const payload = await statOrNull(join(directory, TRASH_PAYLOAD));
    if (!payload || payload.isSymbolicLink() || !payload.isFile()) return undefined;
    return { id, directory, meta };
  }

  /** Every recoverable entry in this Vault, newest first. Entries written by
   * another Host that shares this workspace are self-describing, so they list
   * and restore here too; directories that do not look like an entry are ignored. */
  async function trashEntries() {
    const root = await trashRoot();
    if (!root) return [];
    const entries = [];
    for (const scope of await readdir(root, { withFileTypes: true })) {
      if (scope.isSymbolicLink() || !scope.isDirectory() || !TRASH_ID.test(scope.name)) continue;
      for (const item of await readdir(join(root, scope.name), { withFileTypes: true })) {
        if (item.isSymbolicLink() || !item.isDirectory() || !TRASH_ID.test(item.name)) continue;
        const entry = await readTrashEntry(join(root, scope.name), item.name);
        if (entry) entries.push(entry);
      }
    }
    return entries.sort((left, right) => left.meta.deletedAt === right.meta.deletedAt
      ? comparePath(left.id, right.id)
      : (left.meta.deletedAt < right.meta.deletedAt ? 1 : -1));
  }

  /** Restore may not take a name that already exists. Every component of the
   * target path must be a real directory — never a symlink, never a plain file —
   * and the final name must be absent. It runs again right before the move,
   * because only then do the directories this restore created exist. */
  async function assertRestoreTargetFree(value) {
    let cursor = rootPath;
    const parts = value.split('/');
    for (const [index, part] of parts.entries()) {
      cursor = join(cursor, part);
      const info = await statOrNull(cursor);
      if (!info) return;
      if (info.isSymbolicLink()) fail('vault_restore_conflict');
      if (index === parts.length - 1 || !info.isDirectory()) fail('vault_restore_conflict');
    }
  }

  /** Metadata always lands through a rename, so a reader never sees half a JSON
   * document and an interrupted write is never mistaken for an entry. */
  async function writeTrashMeta(directory, meta) {
    const staged = join(directory, `${TRASH_META}.staged`);
    await writeFile(staged, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    await rename(staged, join(directory, TRASH_META));
  }

  /**
   * Write `bytes` at a name that must not exist yet. `wx` is an exclusive create,
   * so a name that appeared after our checks fails instead of being replaced; the
   * handle is kept so a failed write can only remove the inode this call created,
   * never a file another writer has since put at that name.
   */
  async function writeExclusive(target, bytes) {
    let handle;
    try { handle = await open(target, 'wx'); }
    catch (error) {
      if (error instanceof Error && error.code === 'EEXIST') fail('vault_restore_conflict');
      fail('vault_restore_unavailable', error);
    }
    let owned = null, failure = null;
    try {
      owned = await handle.stat();
      await handle.writeFile(bytes);
      const written = await handle.stat();
      if (written.size !== bytes.byteLength) failure = new Error('vault_restore_unavailable');
    } catch (error) {
      failure = error instanceof Error ? error : new Error('vault_restore_unavailable');
    }
    await handle.close().catch(() => undefined);
    if (!failure) return;
    const current = await statOrNull(target).catch(() => null);
    if (current && owned && current.ino === owned.ino && current.dev === owned.dev) await unlink(target).catch(() => undefined);
    fail('vault_restore_unavailable', failure);
  }

  /**
   * Put `source` at `target` without ever replacing a name. A hard link is one
   * atomic create with no bytes copied; a filesystem that refuses hard links
   * falls back to the exclusive-create copy above. Either way the source is
   * dropped only after the bytes are provably at the target, and a failure leaves
   * the source exactly where it was.
   */
  async function placeExclusive(source, target) {
    let linked = false;
    try { await link(source, target); linked = true; }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      if (error.code === 'EEXIST') fail('vault_restore_conflict');
      if (error.code === 'ENOENT') fail('vault_file_not_found');
      if (!['EPERM', 'ENOSYS', 'EXDEV'].includes(error.code ?? '')) throw error;
    }
    if (!linked) {
      let bytes;
      try { bytes = await readFile(source); }
      catch (error) { if (error instanceof Error && error.code === 'ENOENT') fail('vault_file_not_found'); throw error; }
      await writeExclusive(target, bytes);
    }
    await unlink(source).catch(() => undefined);
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
    // The graph is a pure projection of the files on disk: no table, no cache,
    // no write path. Every call re-scans so external edits are visible at once.
    async graph() { return buildVaultGraph(await scan(), await scanAssets()); },
    // 星图亮度 is the same kind of projection: one scan, the same graph, and the
    // cards' own review history. Nothing is cached or written back.
    async learningStars() { const documents = await scan(); return learningStars(buildVaultGraph(documents, await scanAssets()), documents); },
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
    /**
     * Move one file into this Host's trash. The order is the whole crash story:
     * the entry directory is created, its metadata lands through a rename, the
     * bytes are renamed out of the Vault last, and the moved bytes are then proved
     * to be the ones the request validated. So a file is always at exactly one
     * address — the path the student used, or a complete and listed entry — an
     * interrupted delete leaves it where the student left it, and a file that
     * changed between the read and the move is never kept as a mislabelled entry.
     * Both `id` and `deletedAt` come from the Host; a request only ever names a
     * path and proves which revision it saw.
     */
    async trashFile(path, expectedRevision, { id, deletedAt } = {}) {
      const value = trashable(safeRelativePath(path));
      if (typeof expectedRevision !== 'string' || !expectedRevision) fail('vault_revision_conflict');
      if (typeof id !== 'string' || !TRASH_ID.test(id) || typeof deletedAt !== 'string' || !deletedAt) fail('vault_input_invalid');
      const absolute = await target(value), info = await statOrNull(absolute);
      if (!info) fail('vault_file_not_found');
      if (info.isSymbolicLink() || !info.isFile()) fail('vault_path_invalid');
      // The cheap rejection: a request that names a revision this file no longer
      // has never touches the file at all.
      const before = await readFile(absolute);
      if (currentRevision(value, before) !== expectedRevision) fail('vault_revision_conflict');
      const meta = trashMeta(value, before, { id, deletedAt });
      const directory = join(await trashScope(), id), payload = join(directory, TRASH_PAYLOAD);
      await mkdir(directory);
      try {
        await writeTrashMeta(directory, meta);
        // The move itself is atomic: whatever inode the name holds at that instant
        // lands in the trash, so a concurrent save can never be destroyed by it.
        await rename(absolute, payload);
      } catch (error) {
        // Only the directory this call just created is removed; the bytes were
        // never moved out, so the file is still exactly where it was.
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        if (error instanceof Error && error.code === 'ENOENT') fail('vault_file_not_found');
        throw error;
      }
      // The CAS half that matters: the bytes that really moved must be the bytes
      // this request proved. Metadata is never left describing a file it did not
      // hold, and the newer bytes are never lost — they go back to their own path,
      // or, when that name was taken again, stay recoverable in the trash.
      const moved = await readFile(payload);
      if (currentRevision(value, moved) === meta.revision) return { id, path: value, deletedAt, title: meta.title };
      let putBack = true;
      try { await placeExclusive(payload, absolute); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== 'vault_restore_conflict') throw error;
        putBack = false;
      }
      if (putBack) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      else await writeTrashMeta(directory, trashMeta(value, moved, { id, deletedAt }));
      fail('vault_revision_conflict');
    },
    /** The recoverable entries only: no half-written delete, no permanent purge
     * and no batch or recursive form exist anywhere in this store. */
    async listTrash() {
      const entries = await trashEntries();
      return { items: entries.map(({ id, meta }) => ({ id, path: meta.path, deletedAt: meta.deletedAt, title: meta.title })) };
    },
    /**
     * Put one entry back at the path it was deleted from. Nothing existing is
     * ever overwritten: the target path is proved free (every component a real
     * directory, the final name absent) and the placement itself is an exclusive
     * create — a hard link, or an exclusive-create copy where hard links are not
     * available. No rename is ever involved, because a POSIX rename would replace
     * a name that appeared after the check.
     */
    async restoreFile(id) {
      if (typeof id !== 'string' || !TRASH_ID.test(id)) fail('vault_path_invalid');
      const entry = (await trashEntries()).find(item => item.id === id);
      if (!entry) fail('vault_file_not_found');
      const value = entry.meta.path, absolute = resolve(rootPath, value);
      if (!inside(rootPath, absolute)) fail('vault_path_invalid');
      await ensureRoot();
      await assertRestoreTargetFree(value);
      await mkdir(dirname(absolute), { recursive: true });
      await assertRestoreTargetFree(value);
      // The entry's payload is dropped by the placement itself, and only after the
      // bytes are provably back; a failure leaves the entry whole and restorable.
      await placeExclusive(join(entry.directory, TRASH_PAYLOAD), absolute);
      // The entry is emptied of its own metadata after the bytes are back; a
      // failure here leaves an entry whose payload is gone, which is exactly the
      // state `listTrash` refuses to offer.
      await rm(entry.directory, { recursive: true, force: true }).catch(() => undefined);
      return { path: value, revision: currentRevision(value, await readFile(absolute)) };
    },
  };
}
