import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildMarkdownCardContent, buildVaultGraph, childCardsOf, childMaterialsOf, filterVaultGraph, findAnchorLine, findSummaryBlockLine, markdownSections, tagGroups } from './graph.js';
import { createVaultStore, parseMarkdownDocument, revisionFor } from './vault.js';
import { embedTarget, mediaForPath, parseMediaTarget } from './media.js';
import { NotaraVaultRemote } from './index.js';

const VAULT_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)));

const cardTemplate = `---
template: true
name: 知识卡片
type: card
status: draft
---
# {{title}}

## 结论
`;

function doc(path, content, extra = {}) {
  return { ...parseMarkdownDocument(path, content, revisionFor(content)), ...extra };
}

function asset(path, assetKind, revision = 'asset-rev-1') {
  const media = mediaForPath(path);
  return { path, title: path.split('/').pop(), kind: 'asset', assetKind, mime: media.mime, extension: media.extension, size: 10, revision };
}

const nodeOf = (graph, path) => graph.nodes.find(node => node.path === path);
const edgeKeys = (graph, kind) => graph.edges.filter(edge => edge.kind === kind).map(edge => `${edge.source} -> ${edge.target}`);

test('source hierarchy preserves cross-page units while topics reference the book and cards remain separate', () => {
  const pdf=asset('媒体/数列.pdf','pdf','r1');
  const chapter=doc('资料/迭代.md','---\ntype: source\n---\n# 迭代\n![[媒体/数列.pdf#page=2&revision=r1]]');
  const example=doc('资料/例题.md','---\ntype: source\nparent: 资料/迭代.md\n---\n# 跨页例题\n![[媒体/数列.pdf#page=3&revision=r1]]\n![[媒体/数列.pdf#page=4&rect=0,0,1,0.5&revision=r1]]');
  const topic=doc('专题/选路.md','---\ntype: topic\n---\n# 选路\n![[资料/例题.md]]');
  const card=doc('卡片/界.md','---\ntype: card\nparent: 资料/例题.md\n---\n# 选择界');
  const graph=buildVaultGraph([chapter,example,topic,card],[pdf]);
  assert.ok(edgeKeys(graph,'split').includes('资料/迭代.md -> 资料/例题.md'));
  assert.ok(!edgeKeys(graph,'split').includes('媒体/数列.pdf -> 资料/例题.md'));
  assert.ok(edgeKeys(graph,'reference').includes('专题/选路.md -> 资料/例题.md'));
  assert.deepEqual(childCardsOf(graph,pdf.path),[]);
  assert.deepEqual(childMaterialsOf(graph,pdf.path).map(item=>item.path),[chapter.path]);
  assert.deepEqual(childCardsOf(graph,example.path).map(item=>item.path),[card.path]);
  assert.equal(nodeOf(graph,example.path).sources.length,2);
  assert.equal(nodeOf(graph,example.path).sources[0].locator.revision,'r1');
});

test('derives roots, intermediate cards, leaves and isolated files with bare-path edges', () => {
  const pdf = asset('媒体/向量讲义.pdf', 'pdf');
  const source = doc('知识/向量.md', '---\ntype: note\n---\n# 向量\n\n见 [[卡片/基底]]。\n');
  const card = doc('卡片/基底.md', '---\ntype: card\n---\n# 基底\n\n![[媒体/向量讲义.pdf#page=2&rect=0.1,0.2,0.3,0.4]]\n');
  const child = doc('卡片/基底推论.md', '---\ntype: card\nparent: 卡片/基底.md\n---\n# 基底推论\n');
  const orphan = doc('卡片/孤儿.md', '---\ntype: card\nparent: 卡片/不存在.md\n---\n# 孤儿\n');
  const lonely = doc('知识/孤立.md', '# 孤立\n');
  const unused = asset('媒体/未引用.png', 'image');

  const graph = buildVaultGraph([source, card, child, orphan, lonely], [pdf, unused]);

  assert.deepEqual(edgeKeys(graph, 'split'), [
    '卡片/基底.md -> 卡片/基底推论.md',
    '媒体/向量讲义.pdf -> 卡片/基底.md',
  ]);
  assert.deepEqual(edgeKeys(graph, 'reference'), ['知识/向量.md -> 卡片/基底.md']);

  assert.equal(nodeOf(graph, '媒体/向量讲义.pdf').role, 'root');
  assert.equal(nodeOf(graph, '知识/向量.md').role, 'root');
  assert.equal(nodeOf(graph, '卡片/基底.md').role, 'intermediate');
  assert.equal(nodeOf(graph, '卡片/基底推论.md').role, 'leaf');
  assert.equal(nodeOf(graph, '卡片/孤儿.md').role, 'isolated');
  assert.equal(nodeOf(graph, '知识/孤立.md').role, 'isolated');
  assert.equal(nodeOf(graph, '媒体/未引用.png').role, 'isolated');

  assert.deepEqual(nodeOf(graph, '卡片/基底.md').sources, [{ path: '媒体/向量讲义.pdf', locator: { kind: 'pdf-region', page: 2, rect: [0.1, 0.2, 0.3, 0.4] } }]);
  assert.equal(nodeOf(graph, '卡片/基底.md').childCount, 1);
  assert.equal(nodeOf(graph, '卡片/基底.md').depth, 1);
  assert.equal(nodeOf(graph, '卡片/基底推论.md').depth, 2);
  assert.equal(nodeOf(graph, '卡片/孤儿.md').parent, '卡片/不存在.md');
});

test('keeps the documented node fields and returns an empty graph for an empty vault', () => {
  assert.deepEqual(buildVaultGraph([], []), { nodes: [], edges: [] });
  assert.deepEqual(buildVaultGraph(), { nodes: [], edges: [] });

  const graph = buildVaultGraph([doc('知识/向量.md', '# 向量\n\n正文。\n')], []);
  assert.deepEqual(graph.nodes, [{
    path: '知识/向量.md',
    title: '向量',
    kind: 'page',
    type: null,
    tags: [],
    revision: revisionFor('# 向量\n\n正文。\n'),
    role: 'isolated',
    sources: [],
    parent: null,
    excerpt: '向量 正文。',
    childCount: 0,
    depth: 0,
  }]);
  assert.deepEqual(graph.edges, []);

  const withAsset = buildVaultGraph([], [asset('媒体/图.png', 'image')]);
  assert.deepEqual(withAsset.nodes[0], {
    path: '媒体/图.png',
    title: '图.png',
    kind: 'asset',
    type: null,
    tags: [],
    revision: 'asset-rev-1',
    assetKind: 'image',
    role: 'isolated',
    sources: [],
    parent: null,
    excerpt: '',
    childCount: 0,
    depth: 0,
  });
});

test('a parent cycle keeps its edges and reports null depth instead of recursing', () => {
  const first = doc('卡片/甲.md', '---\ntype: card\nparent: 卡片/乙.md\n---\n# 甲\n');
  const second = doc('卡片/乙.md', '---\ntype: card\nparent: 卡片/甲.md\n---\n# 乙\n');
  const attached = doc('卡片/丙.md', '---\ntype: card\nparent: 卡片/甲.md\n---\n# 丙\n');
  const graph = buildVaultGraph([first, second, attached], []);

  assert.deepEqual(edgeKeys(graph, 'split').sort(), [
    '卡片/乙.md -> 卡片/甲.md',
    '卡片/甲.md -> 卡片/丙.md',
    '卡片/甲.md -> 卡片/乙.md',
  ]);
  assert.equal(nodeOf(graph, '卡片/甲.md').depth, null);
  assert.equal(nodeOf(graph, '卡片/乙.md').depth, null);
  assert.equal(nodeOf(graph, '卡片/丙.md').depth, null);
  assert.equal(nodeOf(graph, '卡片/甲.md').role, 'intermediate');
  assert.equal(nodeOf(graph, '卡片/乙.md').role, 'intermediate');
  assert.equal(nodeOf(graph, '卡片/丙.md').role, 'leaf');
});

test('every embed of an existing file is a split edge and missing targets stay as broken sources', () => {
  const pdf = asset('媒体/讲义.pdf', 'pdf');
  const source = doc('知识/向量.md', '# 向量\n');
  const parentCard = doc('卡片/父卡.md', '---\ntype: card\n---\n# 父卡\n');
  const child = doc('卡片/子卡.md', '---\ntype: card\nparent: 卡片/父卡.md\n---\n# 子卡\n\n![[媒体/讲义.pdf#page=2]]\n![[知识/向量.md#anchor=向量]]\n![[媒体/缺失.pdf#page=9]]\n');
  const graph = buildVaultGraph([source, parentCard, child], [pdf]);

  assert.deepEqual(edgeKeys(graph, 'split'), [
    '卡片/父卡.md -> 卡片/子卡.md',
    '媒体/讲义.pdf -> 卡片/子卡.md',
    '知识/向量.md -> 卡片/子卡.md',
  ]);
  assert.deepEqual(nodeOf(graph, '卡片/子卡.md').sources, [
    { path: '媒体/讲义.pdf', locator: { kind: 'pdf-page', page: 2 } },
    { path: '知识/向量.md', locator: { kind: 'html-range', anchor: '向量' } },
    { path: '媒体/缺失.pdf', locator: { kind: 'pdf-page', page: 9 } },
  ]);
  assert.equal(nodeOf(graph, '卡片/子卡.md').parent, '卡片/父卡.md');
  assert.equal(nodeOf(graph, '卡片/父卡.md').role, 'intermediate');
  assert.equal(nodeOf(graph, '媒体/讲义.pdf').role, 'root');
  assert.equal(nodeOf(graph, '媒体/缺失.pdf'), undefined);
});

test('self references never become edges and a card without edges stays isolated', () => {
  const self = doc('卡片/自.md', '---\ntype: card\nparent: 卡片/自.md\n---\n# 自\n\n![[卡片/自.md#anchor=自]]\n\n[[卡片/自]]\n');
  const ghost = doc('卡片/幽灵.md', '---\ntype: card\n---\n# 幽灵\n\n![[媒体/缺失.pdf#page=1]]\n\n[[知识/缺失]]\n');
  const graph = buildVaultGraph([self, ghost], []);

  assert.deepEqual(graph.edges, []);
  assert.deepEqual(nodeOf(graph, '卡片/自.md').sources, [{ path: '卡片/自.md', locator: { kind: 'html-range', anchor: '自' } }]);
  assert.deepEqual(nodeOf(graph, '卡片/幽灵.md').sources, [{ path: '媒体/缺失.pdf', locator: { kind: 'pdf-page', page: 1 } }]);
  assert.equal(nodeOf(graph, '卡片/自.md').role, 'isolated');
  assert.equal(nodeOf(graph, '卡片/幽灵.md').role, 'isolated');
  assert.equal(nodeOf(graph, '卡片/幽灵.md').excerpt, '幽灵 [[知识/缺失]]');
});

test('an embed plus a wiki link to the same file stays one split edge', () => {
  const source = doc('知识/向量.md', '# 向量\n');
  const card = doc('卡片/基底.md', '---\ntype: card\n---\n# 基底\n\n![[知识/向量.md#anchor=向量]]\n\n[[知识/向量]]\n');
  const graph = buildVaultGraph([source, card], []);

  assert.deepEqual(edgeKeys(graph, 'split'), ['知识/向量.md -> 卡片/基底.md']);
  assert.deepEqual(edgeKeys(graph, 'reference'), []);
});

test('embeds written inside fenced or inline code are examples, not provenance', () => {
  const real = asset('媒体/真.pdf', 'pdf');
  const card = doc('卡片/示例.md', '---\ntype: card\n---\n# 示例\n\n```md\n![[媒体/假.pdf#page=1]]\n```\n\n行内 `![[媒体/假2.pdf#page=2]]` 只是说明。\n\n![[媒体/真.pdf#page=3]]\n');
  const graph = buildVaultGraph([card], [real]);

  assert.deepEqual(nodeOf(graph, '卡片/示例.md').sources, [{ path: '媒体/真.pdf', locator: { kind: 'pdf-page', page: 3 } }]);
  assert.deepEqual(edgeKeys(graph, 'split'), ['媒体/真.pdf -> 卡片/示例.md']);
});

test('parent only links to an existing card; plain md and image parents never become edges', () => {
  const source = doc('知识/向量.md', '# 向量\n');
  const image = asset('媒体/图.png', 'image');
  // Counter-examples: both parents exist, but neither is a card.
  const mdParent = doc('卡片/普通页.md', '---\ntype: card\nparent: 知识/向量.md\n---\n# 普通页\n');
  const imageParent = doc('卡片/图片父.md', '---\ntype: card\nparent: 媒体/图.png\n---\n# 图片父\n');
  // A plain md source reaches a card through the embed, not through `parent:`.
  const embedCard = doc('卡片/摘录.md', '---\ntype: card\n---\n# 摘录\n\n![[知识/向量.md#anchor=向量]]\n');
  const graph = buildVaultGraph([source, mdParent, imageParent, embedCard], [image]);

  assert.deepEqual(edgeKeys(graph, 'split'), ['知识/向量.md -> 卡片/摘录.md']);
  assert.equal(nodeOf(graph, '卡片/普通页.md').parent, '知识/向量.md');
  assert.equal(nodeOf(graph, '卡片/普通页.md').role, 'isolated');
  assert.equal(nodeOf(graph, '卡片/图片父.md').parent, '媒体/图.png');
  assert.equal(nodeOf(graph, '卡片/图片父.md').role, 'isolated');
  assert.equal(nodeOf(graph, '媒体/图.png').role, 'isolated');
  assert.equal(nodeOf(graph, '知识/向量.md').role, 'root');
  assert.equal(nodeOf(graph, '知识/向量.md').childCount, 1);
  assert.equal(nodeOf(graph, '卡片/摘录.md').role, 'leaf');
});

test('a card excerpt prefers the 原文摘录 quote and strips protocol lines', () => {
  const card = doc('卡片/摘录.md', `---
type: card
---
# 摘录

## 来源定位
- 文件：媒体/讲义.pdf
- 摘录：![[媒体/讲义.pdf#page=2&rect=0,0,1,1]]

## 原文摘录
> A basis gives a coordinate language.
> 第二行。
`);
  assert.equal(nodeOf(buildVaultGraph([card], []), '卡片/摘录.md').excerpt, 'A basis gives a coordinate language. 第二行。');

  const plain = doc('卡片/普通.md', '---\ntype: card\n---\n# 普通\n\n## 来源定位\n- 文件：媒体/讲义.pdf\n\n这是正文摘要。\n');
  assert.equal(nodeOf(buildVaultGraph([plain], []), '卡片/普通.md').excerpt, '普通 这是正文摘要。');
});

test('markdownSections anchors on heading text instead of line numbers', () => {
  const sections = markdownSections('---\ntype: note\n---\n# 向量\n\n开头。\n\n## 关键联系\n\n- [ ] 能解释基底\n\n### 关键联系\n\n同名小节。\n');
  assert.deepEqual(sections.map(section => section.anchor), ['向量', '关键联系', '关键联系#2']);
  assert.match(sections[1].content, /^## 关键联系[\s\S]*能解释基底$/);
  assert.ok(sections[2].content.includes('同名小节'));

  const plain = markdownSections('第一段没有标题。\n\n第二段。\n');
  assert.deepEqual(plain.map(section => section.anchor), ['第一段没有标题。']);
  assert.deepEqual(plain.map(section => section.content), ['第一段没有标题。\n\n第二段。']);
  assert.deepEqual(markdownSections(''), []);
});

test('findAnchorLine shares the section scanner and never resolves into a code block', () => {
  const content = [
    '---',            // 1
    'type: note',     // 2
    '---',            // 3
    '# 向量',          // 4
    '',               // 5
    '```md',          // 6
    '## 关键联系',     // 7  ← a code sample, not structure
    '```',            // 8
    '',               // 9
    '## 关键联系',     // 10 ← the real heading
    '',               // 11
    '正文。',          // 12
    '',               // 13
    '### 关键联系',    // 14 ← repeated, so it is 关键联系#2
    '',               // 15
    '同名小节。',      // 16
  ].join('\n');

  assert.equal(findAnchorLine(content, '向量'), 4);
  assert.equal(findAnchorLine(content, '关键联系'), 10);
  assert.equal(findAnchorLine(content, '关键联系#2'), 14);
  assert.equal(findAnchorLine(content, '不存在'), null);
  assert.equal(findAnchorLine(content, ''), null);
  assert.equal(findAnchorLine(content, undefined), null);

  // Both exports read the same scan, so every anchor lands on its own heading line.
  for (const section of markdownSections(content)) {
    const line = content.split('\n')[findAnchorLine(content, section.anchor) - 1].trim();
    assert.ok(line.startsWith('#'), `${section.anchor} must resolve to a heading line`);
    assert.ok(line.includes(section.anchor.replace(/#\d+$/, '')));
  }
  assert.deepEqual(markdownSections(content).map(section => section.anchor), ['向量', '关键联系', '关键联系#2']);
  assert.deepEqual(Object.keys(markdownSections(content)[0]), ['anchor', 'content']);
});

test('findAnchorLine falls back to the same anchor a heading-less document gets', () => {
  const plain = '第一段没有标题。\n\n第二段。\n';
  assert.deepEqual(markdownSections(plain).map(section => section.anchor), ['第一段没有标题。']);
  assert.equal(findAnchorLine(plain, '第一段没有标题。'), 1);
  assert.equal(findAnchorLine(plain, '第二段。'), null);

  const withFrontmatter = '---\ntype: note\n---\n开头没有标题。\n\n后面。\n';
  assert.equal(findAnchorLine(withFrontmatter, '开头没有标题。'), 4);
  assert.equal(findAnchorLine('', '任何'), null);
});

test('buildMarkdownCardContent writes type card, parent and an encoded anchor embed', () => {
  const content = buildMarkdownCardContent({
    template: cardTemplate,
    title: '基底的几何意义',
    date: '2026-09-21',
    source: '知识/向量.md',
    anchor: '关键 联系',
    quote: 'A basis gives a coordinate language.',
    parent: '卡片/向量总览.md',
  });
  assert.match(content, /^---\n/);
  assert.match(content, /^type: card$/m);
  assert.match(content, /^parent: 卡片\/向量总览\.md$/m);
  assert.doesNotMatch(content, /^template:/m);
  assert.doesNotMatch(content, /^name:/m);
  assert.match(content, /# 基底的几何意义/);
  assert.ok(content.includes('![[知识/向量.md#anchor=%E5%85%B3%E9%94%AE%20%E8%81%94%E7%B3%BB]]'));
  assert.match(content, /> A basis gives a coordinate language\./);

  const withoutParent = buildMarkdownCardContent({ template: cardTemplate, title: '无父卡', source: '知识/向量.md', anchor: '关键联系' });
  assert.doesNotMatch(withoutParent, /^parent:/m);
  assert.throws(() => buildMarkdownCardContent({ template: cardTemplate, title: '缺少来源' }), /markdown_card_invalid/);
});

test('store.graph() re-reads the vault and writes nothing back', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-vault-graph-'));
  try {
    await writeFile(join(root, '讲义.pdf'), Buffer.from('%PDF-graph'));
    await writeFile(join(root, '卡片.md'), '---\ntype: card\n---\n# 卡片\n\n![[讲义.pdf#page=1]]\n');
    const store = createVaultStore(root);

    const first = await store.graph();
    assert.deepEqual(edgeKeys(first, 'split'), ['讲义.pdf -> 卡片.md']);
    assert.equal(nodeOf(first, '讲义.pdf').assetKind, 'pdf');
    assert.equal(nodeOf(first, '卡片.md').role, 'leaf');

    await writeFile(join(root, '子卡.md'), '---\ntype: card\nparent: 卡片.md\n---\n# 子卡\n');
    const second = await store.graph();
    assert.deepEqual(edgeKeys(second, 'split'), ['卡片.md -> 子卡.md', '讲义.pdf -> 卡片.md']);
    assert.equal(nodeOf(second, '卡片.md').role, 'intermediate');
    assert.deepEqual((await readdir(root)).sort(), ['卡片.md', '子卡.md', '讲义.pdf']);

    await rm(join(root, '子卡.md'));
    const third = await store.graph();
    assert.deepEqual(edgeKeys(third, 'split'), ['讲义.pdf -> 卡片.md']);
    assert.equal(nodeOf(third, '子卡.md'), undefined);
    assert.equal(nodeOf(third, '卡片.md').role, 'leaf');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the remote exposes a parameterless graph and the module stays browser-bundleable', async () => {
  const remote = await readFile(join(VAULT_DIR, 'index.js'), 'utf8');
  const method = remote.slice(remote.indexOf('async graph(input)'), remote.indexOf('async templates(input)'));
  // 图谱只接受会话 scope：图本身就是整份 Vault 投影，不接受任何数据参数。
  assert.match(method, /exactInput\(input, \[\], \['sessionId'\]\)/);
  assert.match(method, /return store\.graph\(\)/);
  const methods = NotaraVaultRemote.prototype['@deepseek-ai/dsh-typert-protocol/remote-methods'].methods;
  assert.ok(methods.some(entry => entry.method === 'graph' && entry.invocation.kind === 'direct'));

  const graph = await readFile(join(VAULT_DIR, 'graph.js'), 'utf8');
  assert.doesNotMatch(graph, /from\s+['"]node:/);
  assert.doesNotMatch(graph, /require\(/);
});

test('media target parsing survives malformed fragments and round-trips anchors', () => {
  assert.deepEqual(parseMediaTarget('知识/向量.md#anchor=关键联系'), { path: '知识/向量.md', locator: { kind: 'html-range', anchor: '关键联系' } });
  assert.equal(embedTarget('知识/向量.md', { kind: 'html-range', anchor: '关键 联系' }), '![[知识/向量.md#anchor=%E5%85%B3%E9%94%AE%20%E8%81%94%E7%B3%BB]]');
  assert.deepEqual(parseMediaTarget('知识/向量.md#anchor=%E5%85%B3%E9%94%AE%20%E8%81%94%E7%B3%BB'), { path: '知识/向量.md', locator: { kind: 'html-range', anchor: '关键 联系' } });
  // Already-written '+' links keep parsing, because URLSearchParams still decodes them.
  assert.deepEqual(parseMediaTarget('知识/向量.md#anchor=%E5%85%B3%E9%94%AE+%E8%81%94%E7%B3%BB'), { path: '知识/向量.md', locator: { kind: 'html-range', anchor: '关键 联系' } });
  // A literal percent in the heading must survive: one decode only, never two.
  assert.equal(embedTarget('知识/向量.md', { kind: 'html-range', anchor: '%E5' }), '![[知识/向量.md#anchor=%25E5]]');
  assert.deepEqual(parseMediaTarget('知识/向量.md#anchor=%25E5'), { path: '知识/向量.md', locator: { kind: 'html-range', anchor: '%E5' } });
  // A bogus escape used to throw URIError out of the preview.
  assert.deepEqual(parseMediaTarget('知识/向量.md#anchor=%ZZ'), { path: '知识/向量.md', locator: { kind: 'html-range', anchor: '%ZZ' } });
  assert.equal(parseMediaTarget('资料/100%讲义.pdf#page=1').path, '资料/100%讲义.pdf');
  assert.deepEqual(parseMediaTarget('资料/讲义.pdf#'), { path: '资料/讲义.pdf', locator: undefined });
  assert.deepEqual(parseMediaTarget('资料/讲义.pdf#page=abc'), { path: '资料/讲义.pdf', locator: undefined, invalidLocator: true });
  assert.doesNotThrow(() => parseMediaTarget('资料/讲义.pdf#rect=1,%E4'));
});

// ---------------------------------------------------------------------------
// Graph projection slice: node tags, focus filtering and child-card lookup.
// ---------------------------------------------------------------------------

const pathSet = value => new Set(value.nodes.map(node => node.path));
const edgeKeysOf = value => value.edges.map(edge => `${edge.source} -> ${edge.target}`).sort();

/** 讲义.pdf ─split→ 基底 ─split→ 基底推论 ─split→ 更深
 *                        └split→ 旁支          （知识/向量.md ─ref→ 基底）*/
function vaultFixture() {
  const pdf = asset('媒体/讲义.pdf', 'pdf');
  const note = doc('知识/向量.md', '---\ntype: note\n---\n# 向量\n\n[[卡片/基底]]\n');
  const card = doc('卡片/基底.md', '---\ntype: card\ntags: [向量]\n---\n# 基底\n\n![[媒体/讲义.pdf#page=1]]\n');
  const child = doc('卡片/基底推论.md', '---\ntype: card\nparent: 卡片/基底.md\ntags: [向量, 推论]\n---\n# 基底推论\n');
  const branch = doc('卡片/旁支.md', '---\ntype: card\nparent: 卡片/基底.md\ntags: [向量]\n---\n# 旁支\n');
  const deep = doc('卡片/更深.md', '---\ntype: card\nparent: 卡片/基底推论.md\ntags: [更深标签]\n---\n# 更深\n');
  return buildVaultGraph([note, card, child, branch, deep], [pdf]);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

test('page nodes carry frontmatter tags while assets stay untagged', () => {
  const graph = buildVaultGraph([
    doc('知识/向量.md', '---\ntype: note\ntags: [方法论, 向量]\n---\n# 向量\n'),
    doc('卡片/基底.md', '---\ntype: card\ntags: [ 卡片 , 向量 ]\n---\n# 基底\n'),
    doc('知识/去重.md', '---\ntags: [重复, 重复, 空格]\n---\n# 去重\n'),
    doc('知识/无标签.md', '# 无标签\n'),
    doc('知识/空标签.md', '---\ntags: []\n---\n# 空标签\n'),
  ], [asset('媒体/图.png', 'image')]);

  assert.deepEqual(nodeOf(graph, '知识/向量.md').tags, ['方法论', '向量']);
  assert.deepEqual(nodeOf(graph, '卡片/基底.md').tags, ['卡片', '向量']);
  assert.deepEqual(nodeOf(graph, '知识/去重.md').tags, ['重复', '空格']);
  assert.deepEqual(nodeOf(graph, '知识/无标签.md').tags, []);
  assert.deepEqual(nodeOf(graph, '知识/空标签.md').tags, []);
  assert.deepEqual(nodeOf(graph, '媒体/图.png').tags, []);
});

test('filterVaultGraph keeps the focus neighbourhood within the requested hops', () => {
  const graph = vaultFixture();

  const one = filterVaultGraph(graph, { focus: '卡片/基底.md' });
  assert.deepEqual(pathSet(one), new Set(['卡片/基底.md', '卡片/基底推论.md', '卡片/旁支.md', '媒体/讲义.pdf', '知识/向量.md']));
  assert.deepEqual(edgeKeysOf(one), [
    '卡片/基底.md -> 卡片/基底推论.md',
    '卡片/基底.md -> 卡片/旁支.md',
    '媒体/讲义.pdf -> 卡片/基底.md',
    '知识/向量.md -> 卡片/基底.md',
  ]);
  assert.deepEqual(Object.keys(one).sort(), ['edges', 'nodes']);

  const two = filterVaultGraph(graph, { focus: '卡片/基底.md', hops: 2 });
  assert.deepEqual(pathSet(two), new Set(['卡片/基底.md', '卡片/基底推论.md', '卡片/旁支.md', '卡片/更深.md', '媒体/讲义.pdf', '知识/向量.md']));
  assert.deepEqual(edgeKeysOf(two), [
    '卡片/基底.md -> 卡片/基底推论.md',
    '卡片/基底.md -> 卡片/旁支.md',
    '卡片/基底推论.md -> 卡片/更深.md',
    '媒体/讲义.pdf -> 卡片/基底.md',
    '知识/向量.md -> 卡片/基底.md',
  ]);

  // The focus node is kept as context even though its own tags miss the filter.
  const context = filterVaultGraph(graph, { focus: '卡片/基底.md', hops: 2, tags: ['不存在'] });
  assert.deepEqual(pathSet(context), new Set(['卡片/基底.md']));
  assert.deepEqual(context.edges, []);
});

test('focus tags are ANDed for every other node and never rewired', () => {
  const graph = vaultFixture();

  const anded = filterVaultGraph(graph, { focus: '卡片/基底.md', hops: 2, tags: ['向量', '推论'] });
  assert.deepEqual(pathSet(anded), new Set(['卡片/基底.md', '卡片/基底推论.md']));
  assert.deepEqual(edgeKeysOf(anded), ['卡片/基底.md -> 卡片/基底推论.md']);

  // Traversal is tag-agnostic: 基底推论 is filtered out but still bridges the
  // second hop, and its own edge is clipped because that endpoint is missing.
  const bridged = filterVaultGraph(graph, { focus: '卡片/基底.md', hops: 2, tags: ['更深标签'] });
  assert.deepEqual(pathSet(bridged), new Set(['卡片/基底.md', '卡片/更深.md']));
  assert.deepEqual(bridged.edges, []);

  // Edges keep their original source/target direction in every mode.
  for (const result of [anded, bridged]) {
    for (const edge of result.edges) {
      assert.equal(graph.edges.some(original => original.source === edge.source && original.target === edge.target && original.kind === edge.kind), true);
    }
  }
});

test('without a focus the whole projection is filtered by tags and hops are ignored', () => {
  const graph = vaultFixture();

  const whole = filterVaultGraph(graph, { tags: [] });
  assert.deepEqual(pathSet(whole), pathSet(graph));
  assert.deepEqual(edgeKeysOf(whole), edgeKeysOf(graph));
  assert.deepEqual(pathSet(filterVaultGraph(graph)), pathSet(graph));

  const tagged = filterVaultGraph(graph, { tags: ['向量'] });
  assert.deepEqual(pathSet(tagged), new Set(['卡片/基底.md', '卡片/基底推论.md', '卡片/旁支.md']));
  assert.deepEqual(edgeKeysOf(tagged), ['卡片/基底.md -> 卡片/基底推论.md', '卡片/基底.md -> 卡片/旁支.md']);

  assert.deepEqual(filterVaultGraph(graph, { tags: ['不存在'] }), { nodes: [], edges: [] });
  assert.deepEqual(filterVaultGraph(graph, { focus: '卡片/不存在.md' }), { nodes: [], edges: [] });
  assert.deepEqual(filterVaultGraph(graph, { focus: '' }), { nodes: [], edges: [] });
});

test('a parent cycle terminates and loses the edge to a filtered-out neighbour', () => {
  const alpha = doc('卡片/甲.md', '---\ntype: card\nparent: 卡片/乙.md\n---\n# 甲\n');
  const beta = doc('卡片/乙.md', '---\ntype: card\nparent: 卡片/甲.md\ntags: [环]\n---\n# 乙\n');
  const graph = buildVaultGraph([alpha, beta], []);

  assert.deepEqual(pathSet(filterVaultGraph(graph, { focus: '卡片/甲.md', hops: 2 })), new Set(['卡片/甲.md', '卡片/乙.md']));
  assert.deepEqual(pathSet(filterVaultGraph(graph, { focus: '卡片/甲.md', hops: 2, tags: ['环'] })), new Set(['卡片/甲.md', '卡片/乙.md']));
  assert.deepEqual(pathSet(filterVaultGraph(graph, { focus: '卡片/甲.md', hops: 2, tags: ['缺'] })), new Set(['卡片/甲.md']));
  assert.deepEqual(filterVaultGraph(graph, { focus: '卡片/甲.md', hops: 2, tags: ['缺'] }).edges, []);
});

test('the graph projections never mutate the input vault graph', () => {
  const graph = deepFreeze(vaultFixture());
  const before = JSON.stringify(graph);

  const filtered = filterVaultGraph(graph, { focus: '卡片/基底.md', hops: 2, tags: ['向量'] });
  const global = filterVaultGraph(graph, { tags: ['向量'] });
  const children = childCardsOf(graph, '卡片/基底.md');

  assert.notEqual(filtered.edges, graph.edges);
  assert.notEqual(filtered.nodes, graph.nodes);
  assert.ok(filtered.nodes.length && global.nodes.length && children.length);
  assert.equal(JSON.stringify(graph), before);
});

test('childCardsOf returns only direct split children that are cards, deduped and title-sorted', () => {
  const graph = vaultFixture();
  assert.deepEqual(childCardsOf(graph, '卡片/基底.md').map(node => node.path).sort(), ['卡片/基底推论.md', '卡片/旁支.md']);
  assert.deepEqual(childCardsOf(graph, '媒体/讲义.pdf').map(node => node.path), ['卡片/基底.md']);
  assert.deepEqual(childCardsOf(graph, '知识/向量.md'), []);
  assert.deepEqual(childCardsOf(graph, '卡片/更深.md'), []);
  assert.deepEqual(childCardsOf(graph, '卡片/不存在.md'), []);
  assert.deepEqual(childCardsOf(graph, undefined), []);

  // A `parent:` and an embed of the same parent are one split relation.
  const doubly = buildVaultGraph([
    doc('卡片/父.md', '---\ntype: card\n---\n# 父\n'),
    doc('卡片/子.md', '---\ntype: card\nparent: 卡片/父.md\n---\n# 子\n\n![[卡片/父.md#anchor=父]]\n'),
  ], []);
  assert.deepEqual(childCardsOf(doubly, '卡片/父.md').map(node => node.path), ['卡片/子.md']);

  const synthetic = {
    nodes: [
      { path: '卡片/父.md', type: 'card', title: '父' },
      { path: '卡片/子.md', type: 'card', title: '子' },
      { path: '知识/页.md', type: null, title: '页' },
    ],
    edges: [
      { source: '卡片/父.md', target: '卡片/子.md', kind: 'split' },
      { source: '卡片/父.md', target: '卡片/子.md', kind: 'split' },
      { source: '卡片/父.md', target: '知识/页.md', kind: 'split' },
      { source: '知识/页.md', target: '卡片/父.md', kind: 'split' },
      { source: '卡片/父.md', target: '知识/页.md', kind: 'reference' },
    ],
  };
  assert.deepEqual(childCardsOf(synthetic, '卡片/父.md').map(node => node.path), ['卡片/子.md']);

  const ordered = buildVaultGraph([
    doc('卡片/父.md', '---\ntype: card\n---\n# 父\n'),
    doc('卡片/丙.md', '---\ntype: card\nparent: 卡片/父.md\n---\n# Gamma\n'),
    doc('卡片/甲.md', '---\ntype: card\nparent: 卡片/父.md\n---\n# Alpha\n'),
    doc('卡片/乙.md', '---\ntype: card\nparent: 卡片/父.md\n---\n# Beta\n'),
  ], []);
  assert.deepEqual(childCardsOf(ordered, '卡片/父.md').map(node => node.title), ['Alpha', 'Beta', 'Gamma']);
});
test('plan pages reference their material instead of splitting it into child cards', () => {
  const pdf = asset('媒体/圆锥曲线.pdf', 'pdf');
  const route = doc('路线/圆锥曲线.md', '---\ntype: route\ntitle: 圆锥曲线\nlessons: []\n---\n# 圆锥曲线\n\n![[媒体/圆锥曲线.pdf#page=3]]\n');
  const script = doc('备课/第一课.md', '---\ntype: lesson\n---\n# 第一课\n\n![[媒体/圆锥曲线.pdf#page=3]]\n\n![[卡片/定义卡.md]]\n');
  const summary = doc('lesson_log/小结.md', '---\ntype: lesson-summary\n---\n# 小结\n\n![[卡片/定义卡.md]]\n');
  const card = doc('卡片/定义卡.md', '---\ntype: card\n---\n# 定义卡\n');

  const graph = buildVaultGraph([route, script, summary, card], [pdf]);

  // A route listing material and a script embedding it stay references: the
  // class material must never look like content extracted out of the plan.
  assert.deepEqual(edgeKeys(graph, 'split'), []);
  // Projection order is by source text, so the ASCII directory sorts first.
  assert.deepEqual(edgeKeys(graph, 'reference'), [
    'lesson_log/小结.md -> 卡片/定义卡.md',
    '备课/第一课.md -> 卡片/定义卡.md',
    '备课/第一课.md -> 媒体/圆锥曲线.pdf',
    '路线/圆锥曲线.md -> 媒体/圆锥曲线.pdf',
  ]);
  assert.equal(nodeOf(graph, '路线/圆锥曲线.md').role, 'plan');
  assert.equal(nodeOf(graph, '备课/第一课.md').role, 'plan');
  assert.equal(nodeOf(graph, 'lesson_log/小结.md').role, 'plan');
  // Nothing in a plan counts as a knowledge child, and no plan enters a split depth.
  assert.equal(nodeOf(graph, '媒体/圆锥曲线.pdf').childCount, 0);
  assert.equal(nodeOf(graph, '媒体/圆锥曲线.pdf').role, 'root');
  assert.equal(nodeOf(graph, '卡片/定义卡.md').childCount, 0);
  assert.equal(nodeOf(graph, '卡片/定义卡.md').depth, 0);
  assert.deepEqual(childCardsOf(graph, '路线/圆锥曲线.md'), []);
  assert.deepEqual(childCardsOf(graph, '备课/第一课.md'), []);
});

test('an insight stays the card it is: it can be split into, split from and counted', () => {
  const source = doc('知识/三角函数.md', '---\ntype: note\n---\n# 三角函数\n');
  const insight = doc('卡片/换元锦囊.md', '---\ntype: insight\ntags: [方法, 三角]\n---\n# 换元锦囊\n\n![[知识/三角函数.md#anchor=化简]]\n');
  const child = doc('卡片/锦囊细节.md', '---\ntype: card\nparent: 卡片/换元锦囊.md\n---\n# 锦囊细节\n');
  const named = doc('卡片/偏方.md', '---\ntype: insight\nparent: 卡片/换元锦囊.md\n---\n# 偏方\n');

  const graph = buildVaultGraph([source, insight, child, named], []);

  assert.deepEqual(edgeKeys(graph, 'split'), [
    '卡片/换元锦囊.md -> 卡片/偏方.md',
    '卡片/换元锦囊.md -> 卡片/锦囊细节.md',
    '知识/三角函数.md -> 卡片/换元锦囊.md',
  ]);
  assert.equal(nodeOf(graph, '卡片/换元锦囊.md').type, 'insight');
  assert.equal(nodeOf(graph, '卡片/换元锦囊.md').role, 'intermediate');
  assert.equal(nodeOf(graph, '卡片/换元锦囊.md').childCount, 2);
  assert.deepEqual(childCardsOf(graph, '卡片/换元锦囊.md').map(node => node.title), ['偏方', '锦囊细节']);
  assert.deepEqual(childCardsOf(graph, '知识/三角函数.md').map(node => node.path), ['卡片/换元锦囊.md']);
  assert.deepEqual(nodeOf(graph, '卡片/换元锦囊.md').tags, ['方法', '三角']);
});

test('tag groups count real assets once per tag and order by size', () => {
  const graph = buildVaultGraph([
    doc('卡片/甲.md', '---\ntype: card\ntags: [math, vector]\n---\n# 甲\n'),
    doc('卡片/乙.md', '---\ntype: card\ntags: [math]\n---\n# 乙\n'),
    doc('知识/丙.md', '---\ntags: [vector, vector, " "]\n---\n# 丙\n'),
    doc('知识/丁.md', '# 丁\n'),
  ], [asset('媒体/无标签.png', 'image')]);

  // 甲 carries both tags but appears once in each group; untagged files belong
  // to no group, and the group order never depends on scan order.
  assert.deepEqual(tagGroups(graph), [
    { tag: 'math', count: 2, paths: ['卡片/甲.md', '卡片/乙.md'] },
    { tag: 'vector', count: 2, paths: ['卡片/甲.md', '知识/丙.md'] },
  ]);
  assert.deepEqual(tagGroups({ nodes: [] }), []);
  assert.deepEqual(tagGroups(), []);
});

test('a 小结 link lands on the stable block anchor, not on the heading wording', async () => {
  const { stableLessonSummaryId, upsertLessonSummary } = await import('./lesson-data.js');
  const id = stableLessonSummaryId('session-1');
  const script = '---\ntype: lesson\n---\n# 第一课\n\n备课正文。\n';
  const content = upsertLessonSummary(script, {
    sessionId: 'session-1', learningSetRef: '数学/圆锥曲线', subjects: ['数学'],
    startedAt: '2026-09-21T01:00:00.000Z', throughAt: '2026-09-21T02:00:00.000Z', cutoff: '42',
    title: '第一课小结',
    body: '## 小结\n\n今天推进到焦点弦。\n\n## 下次从这里继续\n\n继续焦点弦的练习。\n',
  });

  const line = findSummaryBlockLine(content, id);
  assert.ok(line > 1, String(line));
  assert.equal(content.split('\n')[line - 1].trim(), '<!-- notara:lesson-summary');
  // The visible heading is human wording, so the generic heading scanner cannot
  // resolve the identity; the block's own metadata is what survives edits.
  assert.equal(findAnchorLine(content, id), null);
  assert.equal(findSummaryBlockLine(content.replace('## 小结', '## 本课小结'), id), line);
  assert.equal(findSummaryBlockLine(content, 'ls-不存在'), null);
  assert.equal(findSummaryBlockLine(content, ''), null);
  assert.equal(findSummaryBlockLine('# 没有小结的文件\n', id), null);
  // Two classrooms in one script each keep their own block.
  const second = upsertLessonSummary(content, {
    sessionId: 'session-2', learningSetRef: '数学/圆锥曲线', subjects: ['数学'],
    startedAt: '2026-09-22T01:00:00.000Z', throughAt: '2026-09-22T02:00:00.000Z', cutoff: '7',
    title: '第二课小结', body: '## 小结\n\n第二课。\n',
  });
  const otherId = stableLessonSummaryId('session-2');
  assert.ok(findSummaryBlockLine(second, otherId) > findSummaryBlockLine(second, id));
});
