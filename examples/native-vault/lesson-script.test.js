import assert from 'node:assert/strict';
import test from 'node:test';
import { cardUnderstandingSections, lessonOutline, readLessonStage, teacherBlocks } from './lesson-script.js';
import { parseMarkdownDocument } from './vault.js';
import { upsertLessonSummary } from './lesson-data.js';

const source = `---
type: lesson
---
# 迭代数列

<details data-notara="teacher">
<summary>本课备课说明</summary>

关注学生如何提出不变区间。
</details>

## 找候选极限

先写你的猜测。

<details data-notara="teacher">
<summary>教师参考</summary>

## 不应进入目录的答案标题
答案：先证明有界，不能预设收敛。
</details>

## 检查边界

解释区间为什么不变。😀
`;

test('outline excludes teacher headings and appended classroom logs without copying answers', () => {
  const content=upsertLessonSummary(source,{sessionId:'script-test',title:'本课',body:'实际进度\n\n## 下次从这里继续\n做第二题。'});
  const document=parseMarkdownDocument('备课/迭代.md',content);
  const outline=lessonOutline(document);
  assert.deepEqual(outline.sections.map(row=>row.title),['本课导览','找候选极限','检查边界']);
  assert.deepEqual(outline.sections.map(row=>row.teacherCount),[1,1,0]);
  assert.doesNotMatch(JSON.stringify(outline),/答案|实际进度|先证明有界/);
  const stage=readLessonStage(document,{section:outline.sections[1].key,expectedRevision:document.revision});
  assert.match(stage.content,/先写你的猜测/);
  assert.match(stage.content,/先证明有界/);
  assert.doesNotMatch(stage.content,/解释区间|实际进度/);
});

test('only real disclosures fold: fenced examples remain text and nested blocks stay with their owner', () => {
  const content='```html\n<details>\n<summary>代码示例</summary>\n</details>\n```\n\n<details>\n<summary>外层</summary>\n\n<details>\n<summary>内层</summary>\n\n说明\n</details>\n</details>';
  const blocks=teacherBlocks(content);
  assert.equal(blocks.length,1);
  assert.equal(blocks[0].summary,'外层');
  assert.equal(blocks[0].closed,true);
  const inner=content.slice(blocks[0].bodyFrom,blocks[0].bodyTo);
  assert.equal(teacherBlocks(inner)[0].summary,'内层');
  assert.equal(teacherBlocks('~~~\n<details>\n</details>\n~~~').length,0);
  assert.equal(teacherBlocks('<!--\n<details>\n</details>\n-->').length,0);
});

test('stage reads pin the directory revision and paginate Unicode without dropping text', () => {
  const document=parseMarkdownDocument('备课/迭代.md',source), args={section:'section-3',expectedRevision:document.revision};
  const full=readLessonStage(document,args);
  let content='',offset=0;
  do {const chunk=readLessonStage(document,{...args,offset,limit:3});content+=chunk.content;offset=chunk.nextOffset;} while(offset!==null);
  assert.equal(content,full.content);
  assert.match(content,/😀/);
  assert.throws(()=>readLessonStage({...document,revision:'changed'},args),/vault_reference_stale/);
  assert.throws(()=>readLessonStage(document,{section:'section-3'}),/vault_reference_invalid/);
  assert.throws(()=>readLessonStage(document,{...args,section:'missing'}),/lesson_section_not_found/);
  assert.throws(()=>readLessonStage(document,{...args,offset:999999}),/vault_offset_invalid/);
});

test('unclosed teacher area stays a disclosure and is explicitly rejected by stage reader', () => {
  const document=parseMarkdownDocument('备课/坏格式.md','---\ntype: lesson\n---\n## 例题\n\n<details>\n<summary>教师参考</summary>\n\n答案');
  const [block]=teacherBlocks(document.content);
  assert.equal(block.to,document.content.length);
  assert.equal(block.closed,false);
  assert.deepEqual(lessonOutline(document).warnings,['lesson_teacher_block_unclosed']);
  assert.throws(()=>readLessonStage(document,{section:'section-1',expectedRevision:document.revision}),/lesson_teacher_block_unclosed/);
});

test('a summary written beside the <details> tag folds like the skills write it', () => {
  const shorthand = '<details><summary>教师参考</summary>\n\n答案\n</details>';
  const [block] = teacherBlocks(shorthand);
  assert.equal(block.summary, '教师参考');
  assert.equal(shorthand.slice(block.bodyFrom, block.bodyTo), '\n答案\n');
  assert.equal(block.closed, true);
  // The current skill text keeps the cite beside the tag and lets the answer run
  // on from there: both stay the same disclosure, and the file is untouched.
  const cited = '<details><summary>原文参考答案</summary>答案两行\n\n补充\n</details>';
  assert.equal(teacherBlocks(cited)[0].summary, '原文参考答案');
  assert.equal(cited.slice(teacherBlocks(cited)[0].bodyFrom, teacherBlocks(cited)[0].bodyTo), '答案两行\n\n补充\n');
  // A block that never leaves its own line is whole by itself.
  const oneLine = '前言\n\n<details><summary>原文参考答案</summary>答案</details>\n\n后文\n';
  const [inline] = teacherBlocks(oneLine);
  assert.equal(oneLine.slice(inline.from, inline.to), '<details><summary>原文参考答案</summary>答案</details>');
  assert.equal(oneLine.slice(inline.bodyFrom, inline.bodyTo), '答案');
  assert.equal(inline.closed, true);
  // Prose that merely mentions the tags never hides what follows it.
  assert.equal(teacherBlocks('前言\n\n<details> 与 <summary> 的写法说明\n\n正文仍然可见。\n').length, 0);
  assert.equal(teacherBlocks('正文 <details>\n<summary>教师参考</summary>\n</details>\n').length, 0);
});

test('a card folds its 参考理解 section while a lesson stage of the same name stays public', () => {
  const card = '---\ntype: card\n---\n## 内容\n\n题干\n\n## 参考理解\n\n独立求解。\n\n### 何时想起\n\n算加法。\n\n## 学生理解\n\n他数了数。\n';
  const [section] = cardUnderstandingSections(card);
  assert.equal(section.title, '参考理解');
  assert.equal(card.slice(section.from, section.to), '## 参考理解\n\n独立求解。\n\n### 何时想起\n\n算加法。\n\n');
  assert.equal(card.slice(section.bodyFrom, section.bodyTo), '\n独立求解。\n\n### 何时想起\n\n算加法。\n\n');
  // 教师理解 is the same section under the older name, and a card that declares
  // no type is still read as a card when it carries all three sections.
  assert.deepEqual(cardUnderstandingSections('---\ntype: card\n---\n## 内容\n\nx\n\n## 教师理解\n\ny\n').map(row => row.title), ['教师理解']);
  assert.equal(cardUnderstandingSections('## 内容\n\nx\n\n## 参考理解\n\ny\n\n## 学生理解\n\nz\n').length, 1);
  // A lesson stage called 参考理解 is public material, never teacher-only.
  assert.deepEqual(cardUnderstandingSections('---\ntype: lesson\n---\n## 内容\n\n题干\n\n## 参考理解\n\n公开答案\n\n## 学生理解\n'), []);
  assert.deepEqual(cardUnderstandingSections('---\ntype: route\n---\n## 参考理解\n\n规划说明\n'), []);
  // Sections inside a teacher note belong to that note, and a bare mention of a
  // stage name never turns a page into a card.
  assert.deepEqual(cardUnderstandingSections('## 参考理解\n\n<details>\n<summary>说明</summary>\n\n## 学生理解\n\n</details>\n'), []);
  assert.deepEqual(cardUnderstandingSections(''), []);
});
