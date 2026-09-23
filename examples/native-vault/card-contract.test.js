import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { calendarProjection } from './calendar-data.js';
import { buildMarkdownCardContent, buildVaultGraph, childCardsOf } from './graph.js';
import { findLearning } from './learning-data.js';
import { buildPdfCardContent, cardPathFor, UNTRANSCRIBED_REGION_NOTE } from './pdf.js';
import { createVaultStore, parseMarkdownDocument, revisionFor } from './vault.js';

const bundled = name => readFile(new URL(`./templates/${name}`, import.meta.url), 'utf8');
const doc = (path, content) => parseMarkdownDocument(path, content, revisionFor(content));
const headingLines = content => content.split(/\r?\n/).filter(line => /^##\s+\S/.test(line)).map(line => line.trim());
const nodeOf = (graph, path) => graph.nodes.find(node => node.path === path);
const edgeKeys = (graph, kind) => graph.edges.filter(edge => edge.kind === kind).map(edge => `${edge.source} -> ${edge.target}`);

for (const name of ['lesson.md', 'lesson-script.md']) {
  test(`lesson template upgrade preserves custom templates and existing lessons: ${name}`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'notara-lesson-seed-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const old = await readFile(new URL(`../../tests/fixtures/native-vault/${name.replace('.md', '-0.13.0.md')}`, import.meta.url), 'utf8');
    const current = await bundled(name);
    assert.notEqual(current.trim(), old.trim(), 'fixture must exercise a superseded template');
    const store = createVaultStore(root, fileURLToPath(new URL('./templates/', import.meta.url)));
    assert.equal((await store.templates()).find(row => row.path === name).content, current);
    await mkdir(join(root, '备课'), { recursive: true });
    const lessonPath = join(root, '备课', name);
    await writeFile(lessonPath, old);
    await writeFile(join(root, '_templates', name), old.replaceAll('\n', '\r\n'));
    assert.equal((await store.templates()).find(row => row.path === name).content, current);
    const custom = `${old}\n个人教学要求：先观察再解释。\n`;
    await writeFile(join(root, '_templates', name), custom);
    assert.equal((await store.templates()).find(row => row.path === name).content, custom);
    assert.equal(await readFile(lessonPath, 'utf8'), old);
  });
}

test('the shipped card, topic and insight templates keep tags and exactly the three contract sections', async () => {
  const card = await bundled('card.md'), topic = await bundled('topic.md'), insight = await bundled('insight.md');
  for (const template of [card, topic, insight]) {
    assert.match(template, /^template: true$/m);
    assert.match(template, /^tags: \[\]$/m);
    assert.deepEqual(headingLines(template), ['## 内容', '## 参考理解', '## 学生理解']);
  }
  assert.match(card, /^type: card$/m);
  assert.match(topic, /^type: topic$/m);
  assert.match(insight, /^type: insight$/m);
  // 锦囊不进入复习生命周期：模板只带 status/tags，没有复习字段。
  assert.doesNotMatch(insight, /^(?:learned|mastery|interval|last_review|next_review):/m);
  // 触发条件留在参考理解里，并且召回投影仍然读得到「何时想起」。
  assert.match(insight, /^#{2,3}\s+何时想起\s*$/m);
  // 空卡不显示编写协议、假参考答案和空折叠行；有答案时由正文添加。
  for (const template of [card, topic, insight]) assert.doesNotMatch(template, /<!--|<details/);
  // 专题是父节点：没有复习字段，只靠子卡的 parent 指回来。
  assert.doesNotMatch(topic, /^mastery:/m);
});

test('a Markdown card keeps the question fact inside 内容 and only cites the source', async () => {
  const content = buildMarkdownCardContent({
    template: await bundled('card.md'),
    title: '示例·两式配方求tan(x−y)',
    date: '2026-09-22',
    source: '资料/示例讲义.md',
    anchor: '题型三',
    quote: '已知 tan x + tan y = 3，tan x·tan y = 2，求 tan(x−y)。',
    parent: '专题/三角恒等变换.md',
  });
  assert.match(content, /^tags: \[\]$/m);
  assert.match(content, /^parent: 专题\/三角恒等变换\.md$/m);
  assert.doesNotMatch(content, /^template:/m);
  assert.match(content, /^## 内容$/m);
  assert.match(content, /^## 参考理解$/m);
  assert.match(content, /^## 学生理解$/m);
  const fact = content.indexOf('> 已知 tan x + tan y = 3');
  assert.ok(fact > content.indexOf('## 内容') && fact < content.indexOf('## 参考理解'));
  assert.match(content, /- 来源：资料\/示例讲义\.md#题型三/);
  assert.match(content, /!\[\[资料\/示例讲义\.md#anchor=/);
  // 新卡不再另起只做索引的段落：出处随事实一起进内容。
  assert.doesNotMatch(content, /^## (?:原文摘录|来源定位)$/m);
});

test('a PDF region card keeps the original image and marks the text as not transcribed', async () => {
  const content = buildPdfCardContent(await bundled('card.md'), {
    title: '示例·区域引用',
    date: '2026-09-22',
    source: '媒体/示例讲义.pdf',
    revision: 'pdf-revision-1',
    page: 3,
    rect: [0.125, 0.2, 0.5, 0.25],
    annotationId: 'annotation-1',
    quote: 'A basis gives a coordinate language.',
    note: '核对原页中的公式。',
  });
  assert.match(content, /^## 内容$/m);
  assert.match(content, /^## 参考理解$/m);
  assert.match(content, /^## 学生理解$/m);
  assert.ok(content.includes(UNTRANSCRIBED_REGION_NOTE));
  // 标记本身必须同时说清「没转写」和「没核对」，不能悄悄说成已核实。
  assert.match(UNTRANSCRIBED_REGION_NOTE, /尚未转写/);
  assert.match(UNTRANSCRIBED_REGION_NOTE, /未核对/);
  const image = content.indexOf('![[媒体/示例讲义.pdf#page=3&rect=0.125,0.2,0.5,0.25&annotation=annotation-1&revision=pdf-revision-1]]');
  assert.ok(image > content.indexOf('## 内容') && image < content.indexOf('## 参考理解'));
  assert.match(content, /- 文件：媒体\/示例讲义\.pdf/);
  assert.match(content, /- 版本：pdf-revision-1/);
  assert.match(content, /- 页码：第 3 页/);
  assert.match(content, /核对原页中的公式/);
  // 文字层从来不是题干：没有转写就没有可搜索的原题事实。
  assert.doesNotMatch(content, /A basis gives/);
  assert.doesNotMatch(content, /^template:/m);
  assert.doesNotMatch(content, /^name:/m);
  assert.match(cardPathFor('示例·区域引用'), /^卡片\/示例-区域引用\.md$/);
});

test('a card preview reads 内容 first, hides folds and comments, and still reads 原文摘录', () => {
  const card = doc('卡片/新卡.md', `---
type: card
tags: [math]
---
# 新卡

## 内容

<!-- 给模型看的写作提示，不进预览。 -->

> 已知 tan x + tan y = 3，求 tan(x−y)。

<details>
<summary>原文参考答案</summary>

> 由配方得 (tan x − tan y)² = 1。

</details>

- 文件：媒体/示例讲义.pdf

![[媒体/示例讲义.pdf#page=3&rect=0,0,1,1&revision=r1]]

## 参考理解

先看能不能配方。

## 学生理解
`);
  const node = nodeOf(buildVaultGraph([card], []), '卡片/新卡.md');
  assert.equal(node.excerpt, '已知 tan x + tan y = 3，求 tan(x−y)。');
  assert.deepEqual(node.tags, ['math']);

  const legacy = doc('卡片/旧卡.md', '---\ntype: card\n---\n# 旧卡\n\n## 原文摘录\n> 旧写法仍然可读。\n');
  assert.equal(nodeOf(buildVaultGraph([legacy], []), '卡片/旧卡.md').excerpt, '旧写法仍然可读。');
});

test('a topic parent indexes one-question leaf cards and carries no review lifecycle', () => {
  const topic = doc('专题/三角恒等变换.md', `---
type: topic
tags: [math]
learned: true
mastery: 100
next_review: 2026-09-25
---
# 三角恒等变换

## 内容

一类题：给函数值或正切关系求角。子卡：[[卡片/给函数值求角]]、[[卡片/两式配方求tan(x−y)]]。

## 参考理解

先定角所在象限再定符号；配方与整体代换是两条分岔。

## 学生理解
`);
  const leaf = doc('卡片/给函数值求角.md', '---\ntype: card\nparent: 专题/三角恒等变换.md\n---\n# 给函数值求角\n\n## 内容\n\n给函数值求角。\n');
  const second = doc('卡片/两式配方求tan(x−y).md', '---\ntype: card\nparent: 专题/三角恒等变换.md\n---\n# 两式配方求tan(x−y)\n\n## 内容\n\n配方后求值。\n');
  const graph = buildVaultGraph([topic, leaf, second], []);
  assert.deepEqual(edgeKeys(graph, 'split'), [
    '专题/三角恒等变换.md -> 卡片/两式配方求tan(x−y).md',
    '专题/三角恒等变换.md -> 卡片/给函数值求角.md',
  ]);
  assert.equal(nodeOf(graph, '专题/三角恒等变换.md').type, 'topic');
  assert.equal(nodeOf(graph, '专题/三角恒等变换.md').role, 'root');
  assert.equal(nodeOf(graph, '专题/三角恒等变换.md').childCount, 2);
  assert.deepEqual(childCardsOf(graph, '专题/三角恒等变换.md').map(node => node.path), [
    '卡片/两式配方求tan(x−y).md',
    '卡片/给函数值求角.md',
  ]);
  assert.equal(nodeOf(graph, '卡片/给函数值求角.md').parent, '专题/三角恒等变换.md');
  assert.equal(nodeOf(graph, '专题/三角恒等变换.md').parent, null);

  const range = { from: '2026-09-01', to: '2026-10-31', timeZone: 'Asia/Shanghai', today: '2026-09-22' };
  // 复习生命周期只属于 type: card；专题即使带 learned/mastery 字段也不排复习。
  assert.deepEqual(calendarProjection([topic], range).events, []);
  const learned = doc('卡片/已学.md', '---\ntype: card\nlearned: true\nmastery: 2\ninterval: 3\nlast_review: 2026-09-22\nnext_review: 2026-09-25\n---\n# 已学\n');
  assert.deepEqual(calendarProjection([learned], range).events.map(event => [event.kind, event.path]), [['due', '卡片/已学.md']]);
});

test('a card written from the bundled templates can be found by its question text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-card-contract-'));
  const templates = await mkdtemp(join(tmpdir(), 'notara-card-templates-'));
  try {
    await writeFile(join(templates, 'card.md'), await bundled('card.md'));
    await writeFile(join(templates, 'topic.md'), await bundled('topic.md'));
    const store = createVaultStore(root, templates);
    const template = (await store.templates()).find(item => item.type === 'card');
    assert.ok(template, '内置卡片模板应当被播种');
    const content = buildMarkdownCardContent({
      template: template.content,
      title: '示例·两式配方求tan(x−y)',
      source: '资料/示例讲义.md',
      anchor: '题型三',
      quote: '已知 tan x + tan y = 3，tan x·tan y = 2，求 tan(x−y)。',
    });
    await store.save('卡片/示例·两式配方求tan(x−y).md', content, null);
    const found = await store.search('求 tan(x−y)');
    assert.equal(found[0].path, '卡片/示例·两式配方求tan(x−y).md');
    assert.equal(found[0].type, 'card');
  } finally {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(templates, { recursive: true, force: true })]);
  }
});

test('an insight card keeps the recall passage and stays out of the review lifecycle', async () => {
  const insight = doc('锦囊/极点极线.md', `---
type: insight
tags: [math]
---
# 极点极线

## 内容

## 参考理解

### 何时想起

- [ ] 题目没有明显的对称结构、直接联立很难算时

### 方法与边界

先看有没有极点极线的对称结构。

## 学生理解

我原来特别喜欢用极点极线去做。
`);
  const found = findLearning([insight], { query: '极点极线', kind: 'insight' });
  assert.equal(found.hits.length, 1);
  assert.equal(found.hits[0].recall, '- [ ] 题目没有明显的对称结构、直接联立很难算时');
  assert.equal(nodeOf(buildVaultGraph([insight], []), '锦囊/极点极线.md').type, 'insight');
  const range = { from: '2026-09-01', to: '2026-10-31', timeZone: 'Asia/Shanghai', today: '2026-09-22' };
  assert.deepEqual(calendarProjection([insight], range).events, []);
});

test('seeding upgrades an untouched built-in template and never overwrites an edited one', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notara-card-seed-'));
  const templates = await mkdtemp(join(tmpdir(), 'notara-card-seed-bundle-'));
  try {
    await writeFile(join(templates, 'card.md'), await bundled('card.md'));
    await writeFile(join(templates, 'topic.md'), await bundled('topic.md'));
    await writeFile(join(templates, 'insight.md'), await bundled('insight.md'));
    const store = createVaultStore(root, templates);
    const shipped = (await store.templates()).find(item => item.path === 'card.md');
    assert.match(shipped.content, /## 内容/);

    // 旧内置版本：与发布时逐字节一致，可以安全升级。
    const legacy = '---\ntemplate: true\nname: 知识卡片\ntype: card\nstatus: draft\ntags: []\nlearned: false\nmastery: 0\ninterval: null\nlast_review: null\nnext_review: null\n---\n# {{title}}\n\n## 结论\n\n## 解释\n\n## 例子\n';
    await writeFile(join(root, '_templates', 'card.md'), legacy);
    const upgraded = (await store.templates()).find(item => item.path === 'card.md');
    assert.match(upgraded.content, /## 内容/);
    assert.doesNotMatch(upgraded.content, /## 结论/);
    // 最初还没有复习字段的内置模板同样升级。
    const earliest = legacy.replace('learned: false\nmastery: 0\ninterval: null\nlast_review: null\nnext_review: null\n', '');
    await writeFile(join(root, '_templates', 'card.md'), earliest);
    assert.match((await store.templates()).find(item => item.path === 'card.md').content, /## 内容/);

    // 锦囊的旧标题版本同样只在逐字未改时升级。
    const legacyInsight = '---\ntemplate: true\nname: 锦囊\ntype: insight\nstatus: draft\ntags: []\n---\n# {{title}}\n\n## 何时想起\n\n- [ ] 什么样的题目结构、思维障碍或教学决策值得想起它\n\n## 方法\n\n## 教法\n\n## 学生经历\n\n## 适用边界\n\n## 关联题目\n\n';
    await writeFile(join(root, '_templates', 'insight.md'), legacyInsight);
    const upgradedInsight = (await store.templates()).find(item => item.path === 'insight.md');
    assert.match(upgradedInsight.content, /## 参考理解/);
    assert.doesNotMatch(upgradedInsight.content, /^## 方法$/m);

    // 学生自己改过的模板：一个字的差别就不动它。
    const edited = `${legacy}\n## 我的补充\n`;
    await writeFile(join(root, '_templates', 'card.md'), edited);
    const kept = (await store.templates()).find(item => item.path === 'card.md');
    assert.equal(kept.content.trimEnd(), edited.trimEnd());
  } finally {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(templates, { recursive: true, force: true })]);
  }
});
