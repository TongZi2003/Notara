import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { VAULT_REMOTE_METHODS } from './remote-client.js';

import {
  buildBacklinks,
  createVaultStore,
  parseMarkdownDocument,
  projectTree,
  queryDocuments,
  renderTemplate,
  revisionFor,
  resolveVaultRoot,
  safeRelativePath,
  searchDocuments,
  toggleTaskContent,
} from './vault.js';
import { embedTarget, mediaForPath, parseMediaTarget } from './media.js';
import { buildPdfCardContent, cardPathFor, quoteFromItems } from './pdf.js';

const lesson = `---
type: lesson
status: draft
tags: [math, vector]
---
# 向量

先理解 [[知识/基底|基底]]，再进入 [[路线/向量路线]]。

## 目标
- [ ] 能说出基底的作用
- [x] 看过例题
`;

const documents = [
  parseMarkdownDocument('知识/向量.md', lesson, revisionFor(lesson)),
  parseMarkdownDocument('知识/基底.md', '# 基底\n\n向量的基本语言。', revisionFor('# 基底\n\n向量的基本语言。')),
  parseMarkdownDocument('路线/向量路线.md', '# 向量路线\n\n- [ ] 完成向量基础', revisionFor('# 向量路线\n\n- [ ] 完成向量基础')),
];

test('parses frontmatter, headings, wiki links and checkbox tasks', () => {
  assert.deepEqual(documents[0], {
    path: '知识/向量.md',
    revision: revisionFor(lesson),
    content: lesson,
    title: '向量',
    type: 'lesson',
    status: 'draft',
    date: null,
    frontmatter: { type: 'lesson', status: 'draft', tags: ['math', 'vector'] },
    headings: ['向量', '目标'],
    links: ['知识/基底.md', '路线/向量路线.md'],
    tasks: [
      { checked: false, text: '能说出基底的作用', line: 11, page: '知识/向量.md' },
      { checked: true, text: '看过例题', line: 12, page: '知识/向量.md' },
    ],
  });
});

test('rejects unsafe relative paths', () => {
  assert.equal(safeRelativePath('知识/向量.md'), '知识/向量.md');
  for (const value of ['/tmp/a.md', '../a.md', 'a/../../b.md', './a.md', 'a\\b.md', 'a\0b.md']) {
    assert.throws(() => safeRelativePath(value), /vault_path_invalid/);
  }
});

test('the legacy vault wins until material is already visible in the selected directory', async () => {
  const base = await mkdtemp(join(tmpdir(), 'notara-vault-roots-'));
  try {
    // 旧布局：资料在 vault/ 下，工作区根另有 README.md 与第二个工作区目录，
    // 这些外层条目都不能把资料根移走。
    const legacy = join(base, 'legacy');
    await mkdir(join(legacy, 'vault', '卡片'), { recursive: true });
    await writeFile(join(legacy, 'vault', '卡片', 'a.md'), '# A\n');
    await writeFile(join(legacy, 'README.md'), '# 说明\n');
    await mkdir(join(legacy, 'other'), { recursive: true });
    assert.equal(resolveVaultRoot(legacy), join(legacy, 'vault'));

    // 直接根：用户选中的目录自己有 Markdown/PDF；旧版本误建的空 vault/
    // （哪怕只剩 _templates）必须直接读取选中目录本身。
    const direct = join(base, 'direct');
    await mkdir(join(direct, 'vault', '_templates'), { recursive: true });
    await writeFile(join(direct, 'note.md'), '# 直接根\n');
    await writeFile(join(direct, 'document.pdf'), 'pdf');
    assert.equal(resolveVaultRoot(direct), direct);

    // 资料在约定目录里（知识/卡片/媒体/…）而不是根上时，同样是直接根。
    const nested = join(base, 'nested');
    await mkdir(join(nested, 'vault'), { recursive: true });
    await mkdir(join(nested, '知识'), { recursive: true });
    await writeFile(join(nested, '知识', '向量.md'), '# 向量\n');
    assert.equal(resolveVaultRoot(nested), nested);

    // 有歧义的空目录：vault/ 空、外层也没有资料文件时保留旧布局，
    // 这样已经写在 vault/ 下的路径不会因为一次空工作区而改变。
    const ambiguous = join(base, 'ambiguous');
    await mkdir(join(ambiguous, 'vault', '_templates'), { recursive: true });
    await mkdir(join(ambiguous, 'other'), { recursive: true });
    await writeFile(join(ambiguous, 'README.txt'), '不是资料文件\n');
    assert.equal(resolveVaultRoot(ambiguous), join(ambiguous, 'vault'));

    // 没有 vault/ 的空目录直接作根，包括还不存在的目录。
    const empty = join(base, 'empty');
    await mkdir(empty, { recursive: true });
    assert.equal(resolveVaultRoot(empty), empty);
    assert.equal(resolveVaultRoot(join(empty, 'missing')), join(empty, 'missing'));

    // 运行中出现的新资料不改变已经确定的根。
    await writeFile(join(legacy, '新学期计划.md'), '# 计划\n');
    assert.equal(resolveVaultRoot(legacy), join(legacy, 'vault'));
    await writeFile(join(direct, '新卡.md'), '# 新卡\n');
    assert.equal(resolveVaultRoot(direct), direct);

    // vault/ 是符号链接时不被跟随，资料根不会绕出注册的工作区。
    const outside = join(base, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'a.md'), '# 外部\n');
    const linked = join(base, 'linked');
    await mkdir(linked, { recursive: true });
    await symlink(outside, join(linked, 'vault'));
    assert.equal(resolveVaultRoot(linked), linked);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('projects a sorted tree and query/search results from documents', () => {
  assert.deepEqual(projectTree(documents), {
    name: '',
    children: [
      { name: '知识', children: [
        { name: '向量.md', path: '知识/向量.md', children: [] },
        { name: '基底.md', path: '知识/基底.md', children: [] },
      ] },
      { name: '路线', children: [
        { name: '向量路线.md', path: '路线/向量路线.md', children: [] },
      ] },
    ],
  });
  assert.deepEqual(queryDocuments(documents, { status: 'draft' }, 10).map(item => item.path), ['知识/向量.md']);
  assert.deepEqual(searchDocuments(documents, '基底', 10).map(item => item.path), ['知识/基底.md', '知识/向量.md']);
});

test('builds incoming links from canonical page paths', () => {
  const links = buildBacklinks(documents);
  assert.deepEqual(links.get('知识/基底.md'), ['知识/向量.md']);
  assert.deepEqual(links.get('路线/向量路线.md'), ['知识/向量.md']);
});

test('toggles one task without changing unrelated lines', () => {
  const changed = toggleTaskContent(lesson, 11, true);
  assert.match(changed, /- \[x\] 能说出基底的作用/);
  assert.match(changed, /- \[x\] 看过例题/);
  assert.equal(changed.split('\n')[10], '- [x] 能说出基底的作用');
  assert.throws(() => toggleTaskContent(lesson, 10, true), /vault_task_not_found/);
});

test('renders a template with explicit values and preserves unknown placeholders', () => {
  assert.equal(renderTemplate('# {{title}}\n\n创建于 {{date}}\n{{unknown}}', { title: '新课', date: '2026-09-20' }), '# 新课\n\n创建于 2026-09-20\n{{unknown}}');
});

test('stores Markdown as the only source of truth and uses revision guarded atomic writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-vault-test-'));
  try {
    await mkdir(join(root, '_templates'), { recursive: true });
    await writeFile(join(root, '知识.md'), '# 旧页面\n\n- [ ] 待办\n');
    await writeFile(join(root, '_templates', 'lesson.md'), '# {{title}}\n\n- [ ] 准备资料\n');
    const store = createVaultStore(root);

    assert.deepEqual((await store.list()).files.map(item => item.path), ['知识.md']);
    assert.deepEqual((await store.templates()).map(item => item.path), ['lesson.md']);
    const current = await store.read('知识.md');
    const saved = await store.save('知识.md', '# 新页面\n\n正文\n', current.revision);
    assert.equal((await readFile(join(root, '知识.md'), 'utf8')), saved.content);
    await assert.rejects(() => store.save('知识.md', '# 冲突\n', current.revision), /vault_revision_conflict/);

    const created = await store.createFromTemplate('lesson.md', '路线/新课.md', { title: '新课' }, null);
    assert.match(created.content, /# 新课/);
    const toggled = await store.toggleTask('路线/新课.md', 3, true, created.revision);
    assert.match(toggled.content, /- \[x\] 准备资料/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('declares strict client codecs for the native Remote contribution', async () => {
  const source = await readFile(new URL('./client-source.ts', import.meta.url), 'utf8');
  assert.match(source, /mode: 'strict'/);
  assert.doesNotMatch(source, /mode: 'src-json'/);
  assert.match(source, /schema: strictJsonSchema/);
  assert.ok(VAULT_REMOTE_METHODS.includes('readAsset'));
  assert.ok(VAULT_REMOTE_METHODS.includes('saveAsset'));
  assert.match(source, /const REMOTE_METHODS = VAULT_REMOTE_METHODS/);
});

test('seeds missing built-in templates into _templates without indexing them as pages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-vault-template-root-'));
  const bundled = await mkdtemp(join(tmpdir(), 'notara-vault-template-bundle-'));
  try {
    await writeFile(join(bundled, 'lesson.md'), `---\nname: 备课页\ntype: lesson\n---\n# {{title}}\n`);
    await writeFile(join(bundled, 'route.md'), `---\nname: 路线页\ntype: route\n---\n# {{title}}\n`);
    const store = createVaultStore(root, bundled);
    const templates = await store.templates();
    assert.deepEqual(templates.map(item => [item.path, item.title, item.type]), [
      ['lesson.md', '备课页', 'lesson'],
      ['route.md', '路线页', 'route'],
    ]);
    assert.deepEqual((await store.list()).files, []);
    await writeFile(join(root, '_templates', 'lesson.md'), `---\nname: 用户版备课页\ntype: lesson\n---\n# {{title}}\n`);
    assert.equal((await store.templates()).find(item => item.path === 'lesson.md').title, '用户版备课页');
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(bundled, { recursive: true, force: true }),
    ]);
  }
});

test('uses an inline Live Preview editor instead of a split textarea preview', async () => {
  const source = await readFile(new URL('./client-source.ts', import.meta.url), 'utf8');
  assert.match(source, /CodeMirrorMarkdown/);
  assert.match(source, /EditorState\.create/);
  assert.match(source, /@codemirror/);
  assert.doesNotMatch(source, /contentEditable/);
  assert.doesNotMatch(source, /<textarea/);
});

test('bridges vault pages and selections into the native conversation reference codec', async () => {
  const source = await readFile(new URL('./client-source.ts', import.meta.url), 'utf8');
  assert.match(source, /const VAULT_REFERENCE = 'notara-vault'/);
  assert.match(source, /insertReference\(/);
  assert.match(source, /async serialize\(ref\)/);
  assert.match(source, /openView\('chat', ''\)/);
  assert.match(source, /selection/);
});

test('bridges tag-filtered card batches through the same native input reference path', async () => {
  const [client, views, workspace] = await Promise.all([
    readFile(new URL('./client-source.ts', import.meta.url), 'utf8'),
    readFile(new URL('./views-client.js', import.meta.url), 'utf8'),
    readFile(new URL('./workspace-client.js', import.meta.url), 'utf8'),
  ]);
  assert.match(client, /function insertVaultReferences\(/);
  assert.match(client, /onBringMany:/);
  assert.match(workspace, /onBringMany/);
  assert.match(views, /taggedCardNodes\(graph,tags\)/);
  assert.match(views, /icon:'chat',label:`带入当前筛选的/);
  assert.match(views, /props\.onBringMany\(pins,intent\)/);
});

test('refreshes external vault changes without overwriting an unsaved editor draft', async () => {
  const source = await readFile(new URL('./assets-client.js', import.meta.url), 'utf8');
  assert.match(source, /setInterval\(syncExternal/);
  assert.match(source, /当前页面在外部发生变化/);
  assert.match(source, /页面已从文件刷新/);
});

test('asset context actions use a menu list and expose a whole-file bring-in action', async () => {
  const source = await readFile(new URL('./assets-client.js', import.meta.url), 'utf8');
  assert.match(source, /className:'nv-context-menu'/);
  assert.match(source, /role:'menuitem'/);
  assert.match(source, /将整个文件带入对话/);
  assert.match(source, /复制并带入对话/);
  assert.match(source, /bringIntoConversation\(chosen\)/);
  assert.doesNotMatch(source, /contextPath && h\(Dialog/);
});

test('leaf knowledge cards keep bring-in but hide split actions', async () => {
  const source = await readFile(new URL('./views-client.js', import.meta.url), 'utf8');
  assert.match(source, /splitAllowed/);
  assert.match(source, /splitAllowed \? '带入对话拆分' : '带入对话'/);
  assert.match(source, /splitAllowed \? '带入对话拆分' : '带入对话'/);
});

test('classifies common media assets and round-trips locators in Markdown embeds', () => {
  assert.deepEqual(mediaForPath('资料/讲义.pdf'), { kind: 'pdf', mime: 'application/pdf', extension: 'pdf' });
  assert.deepEqual(mediaForPath('图片/图.png'), { kind: 'image', mime: 'image/png', extension: 'png' });
  assert.deepEqual(mediaForPath('页面/说明.html'), { kind: 'html', mime: 'text/html', extension: 'html' });
  assert.deepEqual(mediaForPath('视频/课堂.mp4'), { kind: 'video', mime: 'video/mp4', extension: 'mp4' });
  assert.equal(embedTarget('资料/讲义.pdf', { kind: 'pdf-page', page: 3 }), '![[资料/讲义.pdf#page=3]]');
  assert.deepEqual(parseMediaTarget('资料/讲义.pdf#page=3'), { path: '资料/讲义.pdf', locator: { kind: 'pdf-page', page: 3 } });
  assert.equal(embedTarget('资料/讲义.pdf', { kind: 'pdf-region', page: 3, rect: [0.1, 0.2, 0.4, 0.3] }), '![[资料/讲义.pdf#page=3&rect=0.1,0.2,0.4,0.3]]');
  assert.deepEqual(parseMediaTarget('资料/讲义.pdf#page=3&rect=0.1,0.2,0.4,0.3'), { path: '资料/讲义.pdf', locator: { kind: 'pdf-region', page: 3, rect: [0.1, 0.2, 0.4, 0.3] } });
  assert.deepEqual(parseMediaTarget('视频/课堂.mp4#t=1200,4500'), { path: '视频/课堂.mp4', locator: { kind: 'video-time', startMs: 1200, endMs: 4500 } });
  assert.deepEqual(parseMediaTarget('图片/图.png#rect=10,20,300,180'), { path: '图片/图.png', locator: { kind: 'image-region', rect: [10, 20, 300, 180] } });
  assert.deepEqual(parseMediaTarget('页面/说明.html#anchor=目标段落'), { path: '页面/说明.html', locator: { kind: 'html-range', anchor: '目标段落' } });
  const withEmbed = parseMarkdownDocument('页面/摘记.md', '# 摘记\n\n看图 ![[媒体/图.png#rect=0,0,1,1]] 和 [[知识/向量]]。\n');
  assert.deepEqual(withEmbed.links, ['知识/向量.md']);
});

test('lists, reads and revision-saves binary assets beside Markdown pages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-vault-assets-'));
  try {
    await writeFile(join(root, '讲义.pdf'), Buffer.from('%PDF-asset'));
    await writeFile(join(root, '图.png'), Buffer.from([137, 80, 78, 71]));
    await writeFile(join(root, '说明.html'), '<h1>说明</h1>');
    await writeFile(join(root, '课堂.md'), '# 课堂\n');
    const store = createVaultStore(root);
    const listed = await store.list();
    assert.deepEqual(listed.files.map(item => [item.path, item.kind]), [
      ['课堂.md', 'page'], ['图.png', 'asset'], ['讲义.pdf', 'asset'], ['说明.html', 'asset'],
    ]);
    const pdf = await store.readAsset('讲义.pdf');
    assert.equal(pdf.assetKind, 'pdf');
    assert.equal(pdf.mime, 'application/pdf');
    assert.match(pdf.dataUrl, /^data:application\/pdf;base64,/);
    const saved = await store.saveAsset('新资料.html', Buffer.from('<h1>新资料</h1>').toString('base64'), 'text/html', null);
    assert.equal(saved.assetKind, 'html');
    await assert.rejects(() => store.saveAsset('新资料.html', Buffer.from('冲突').toString('base64'), 'text/html', null), /vault_revision_conflict/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('falls back from Markdown read errors to the media reader without crashing the view', async () => {
  const source = await readFile(new URL('./assets-client.js', import.meta.url), 'utf8');
  assert.match(source, /try \{\s*read = await vault\.read\(\{ path \}\)/);
  assert.match(source, /try \{\s*media = await vault\.readAsset\(\{ path \}\)/);
});

test('writes a visual PDF region and annotation reference without copying extracted text', () => {
  const content = buildPdfCardContent('---\ntemplate: true\nname: 知识卡片\ntype: card\n---\n# {{title}}\n\n## 结论\n', {
    title: '基底的几何意义',
    date: '2026-09-21',
    source: '媒体/向量讲义.pdf',
    revision: 'pdf-revision-1',
    page: 2,
    rect: [0.125, 0.2, 0.5, 0.25],
    quote: 'A basis gives a coordinate language.',
    annotationId: 'annotation-1',
    note: '核对原页中的公式。',
  });
  assert.match(content, /# 基底的几何意义/);
  assert.match(content, /媒体\/向量讲义\.pdf/);
  assert.match(content, /pdf-revision-1/);
  assert.match(content, /第 2 页/);
  assert.match(content, /!\[\[媒体\/向量讲义\.pdf#page=2&rect=0\.125,0\.2,0\.5,0\.25&annotation=annotation-1&revision=pdf-revision-1\]\]/);
  assert.doesNotMatch(content, /A basis gives/);
  assert.match(content, /核对原页中的公式/);
  assert.doesNotMatch(content, /^template:/m);
  assert.doesNotMatch(content, /^name:/m);
  assert.equal(cardPathFor('基底的几何意义'), '卡片/基底的几何意义.md');
});

test('uses a dedicated PDF reader with a drawable selection layer', async () => {
  const source = await readFile(new URL('./client-source.ts', import.meta.url), 'utf8');
  assert.match(source, /getDocument\(/);
  assert.doesNotMatch(source, /new TextLayer/);
  assert.match(source, /onPointerDown/);
  assert.match(source, /pdfSelectLayer/);
  assert.match(source, /创建区域引用卡片/);
  assert.doesNotMatch(source, /createElement\('object'/);
});

test('collects the text a PDF rectangle selection covers, in reading order', () => {
  const items = [
    { rect: [0.05, 0.10, 0.60, 0.03], str: 'Vector foundations' },
    { rect: [0.05, 0.16, 0.55, 0.02], str: 'A basis gives' },
    { rect: [0.60, 0.16, 0.30, 0.02], str: 'a coordinate language.' },
    { rect: [0.05, 0.50, 0.50, 0.02], str: 'Unrelated footnote' },
  ];
  const quote = quoteFromItems(items, [0.04, 0.08, 0.90, 0.12]);
  assert.match(quote, /Vector foundations/);
  assert.match(quote, /A basis gives/);
  assert.match(quote, /a coordinate language\./);
  assert.doesNotMatch(quote, /Unrelated footnote/);
  assert.equal(quoteFromItems(items, [0.80, 0.80, 0.10, 0.10]), '');
  assert.equal(quoteFromItems(items, [0.04, 0.15, 0.20, 0.04]).trim(), 'A basis gives');
  assert.equal(quoteFromItems(undefined, [0, 0, 1, 1]), '');
  assert.equal(quoteFromItems(items, 'bad'), '');
});
