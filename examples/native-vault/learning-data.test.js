import assert from 'node:assert/strict';
import test from 'node:test';

import { findLearning, readLearningSection } from './learning-data.js';
import { parseMarkdownDocument, revisionFor } from './vault.js';

const doc = (path, content) => parseMarkdownDocument(path, content, revisionFor(content));
const asset = path => ({ path, title: path.split('/').pop(), kind: 'asset', assetKind: 'image', revision: 'asset-rev-1' });

const insight = `---
type: insight
status: draft
tags: [解析几何, 选路]
---
# 极点极线的选路经历

## 何时想起

学生在解析几何中优先尝试极点极线、因未找到预期结构而卡住时。

## 方法

先找极点极线的结构；找不到就回到参数方程。
`;

const profile = `---
type: learner-profile
tags: [解析几何]
---
# 解析几何的学习进度

## 观察

近期完成圆锥曲线综合题，参数方程的使用仍需提示。
`;

test('finds both memory kinds with bounded pages and recall text', () => {
  const documents = [doc('锦囊/极点极线.md', insight), doc('学情/解析几何.md', profile), doc('卡片/无关.md', '---\ntype: card\n---\n# 无关\n\n一张卡。\n')];

  const first = findLearning(documents, { limit: 1 });
  assert.equal(first.total, 2);
  assert.equal(first.hits.length, 1);
  assert.equal(first.nextOffset, 1);
  const second = findLearning(documents, { limit: 1, offset: first.nextOffset });
  assert.equal(second.hits.length, 1);
  assert.equal(second.nextOffset, null);
  assert.notEqual(first.hits[0].path, second.hits[0].path);

  const insights = findLearning(documents, { kind: 'insight' });
  assert.deepEqual(insights.hits.map(hit => hit.path), ['锦囊/极点极线.md']);
  assert.equal(insights.hits[0].type, 'insight');
  assert.equal(insights.hits[0].kind, 'insight');
  assert.equal(insights.hits[0].revision, revisionFor(insight));
  assert.equal(insights.hits[0].recall, '学生在解析几何中优先尝试极点极线、因未找到预期结构而卡住时。');
  assert.deepEqual(insights.hits[0].tags, ['解析几何', '选路']);

  // A record without the recall section still matches by full text and says so.
  const profiles = findLearning(documents, { kind: 'profile', query: '参数方程' });
  assert.deepEqual(profiles.hits.map(hit => hit.path), ['学情/解析几何.md']);
  assert.equal(profiles.hits[0].recall, null);
  assert.deepEqual(profiles.hits[0].matchedTerms, ['参数方程']);

  assert.deepEqual(findLearning(documents, { query: '不存在的词' }), { hits: [], nextOffset: null, total: 0 });
  assert.throws(() => findLearning(documents, { kind: 'method' }), /learning_kind_invalid/);
  assert.throws(() => findLearning(documents, { kind: 'constructor' }), /learning_kind_invalid/);
  assert.throws(() => findLearning(documents, { limit: 0 }), /learning_request_invalid/);
});

test('never treats media assets or media embeds as memory records', () => {
  const documents = [
    asset('媒体/向量讲义.png'),
    asset('媒体/向量讲义.pdf'),
    doc('锦囊/向量法.md', '---\ntype: insight\ntags: []\n---\n# 向量法\n\n![[媒体/向量讲义.png]]\n\n## 何时想起\n\n题目出现垂直与长度比较时。\n'),
  ];

  const result = findLearning(documents, { query: '向量' });
  assert.deepEqual(result.hits.map(hit => hit.path), ['锦囊/向量法.md']);
  assert.equal(result.hits[0].recall, '题目出现垂直与长度比较时。');
  assert.deepEqual(findLearning([asset('媒体/向量讲义.png')], {}), { hits: [], nextOffset: null, total: 0 });
});

test('matches several query terms and orders candidates by matched terms only', () => {
  const card = heading => doc(`锦囊/${heading}.md`, `---\ntype: insight\ntags: []\n---\n# ${heading}\n\n## 何时想起\n\n${heading}。\n`);
  const documents = [
    card('极点极线'),
    card('参数方程'),
    doc('锦囊/两者.md', '---\ntype: insight\ntags: []\n---\n# 两者\n\n## 何时想起\n\n极点极线与参数方程都试过。\n'),
  ];

  const result = findLearning(documents, { query: '极点极线 参数方程' });
  assert.equal(result.total, 3);
  assert.equal(result.hits[0].title, '两者');
  assert.deepEqual(result.hits[0].matchedTerms, ['极点极线', '参数方程']);
  // Single-term candidates keep a deterministic title order; that order is not
  // a claim about which one teaches better.
  assert.deepEqual(result.hits.slice(1).map(hit => hit.matchedTerms), [['参数方程'], ['极点极线']]);
  assert.ok(!Object.hasOwn(result.hits[0], 'score'), 'the projection must not expose a relevance score');
});

test('reads one bounded section and locates duplicate headings with stable keys', () => {
  const content = '---\ntype: insight\n---\n# 卡片\n\n## 记录\n\n第一段。\n\n## 记录\n\n第二段。\n';
  const document = doc('锦囊/记录.md', content);

  const overview = readLearningSection(document, { limit: 12 });
  assert.equal(overview.path, '锦囊/记录.md');
  assert.equal(overview.revision, revisionFor(content));
  assert.equal(overview.type, 'insight');
  assert.equal(overview.content, content.slice(0, 12));
  assert.equal(overview.nextOffset, 12);
  assert.equal(overview.section, null);
  assert.deepEqual(overview.sections.map(section => section.key), ['卡片', '记录', '记录#2']);
  assert.deepEqual(overview.sections.map(section => section.level), [1, 2, 2]);

  const tail = readLearningSection(document, { offset: overview.nextOffset, limit: 12 });
  assert.equal(tail.content, content.slice(12, 24));
  assert.equal(tail.nextOffset, 24);

  const first = readLearningSection(document, { section: '记录' });
  assert.deepEqual(first.section, { key: '记录', title: '记录', level: 2, line: 6 });
  assert.equal(first.content, '## 记录\n\n第一段。\n\n');
  assert.equal(first.nextOffset, null);

  const duplicate = readLearningSection(document, { section: '记录#2' });
  assert.equal(duplicate.section.key, '记录#2');
  assert.equal(duplicate.content, '## 记录\n\n第二段。\n');

  assert.throws(() => readLearningSection(document, { section: '记录#3' }), /learning_section_not_found/);
  assert.throws(() => readLearningSection({ path: '无内容.md' }, {}), /learning_document_invalid/);

  const plain = readLearningSection(doc('随手.md', '# 随手\n\n正文。\n'), {});
  assert.equal(plain.type, null);
  assert.equal(plain.sections.length, 1);
  assert.equal(plain.content, '# 随手\n\n正文。\n');
});
