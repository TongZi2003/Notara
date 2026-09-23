import assert from 'node:assert/strict';
import test from 'node:test';

import { assembleTeachingContext, CONTEXT_BUDGET } from './teaching-context.js';
import { parseMarkdownDocument, revisionFor } from './vault.js';
import { stableLessonSummaryId, upsertLessonSummary } from './lesson-data.js';

const SET = { id: 'set-math', title: '数学·圆锥曲线' };
const OTHER = { id: 'set-physics', title: '物理·力学' };

const script = `---
type: lesson
title: 圆锥曲线选路
---
# 圆锥曲线选路

## 本课目标

把条件写成两种表示后比较。

## 例题

先不看答案，写出你打算用的表示。

## 作业

第二题。
`;

const previousBody = '学生对参数方程的选择凭直觉，未比较过条件。\n\n## 下次从这里继续\n继续第二题，先确定焦点的位置。';
const previousContent = upsertLessonSummary('', { sessionId: 's-1', title: '上一课·椭圆', body: previousBody });
const previousDoc = parseMarkdownDocument('备课/上一课.md', previousContent);
const previousPointer = { scopeId: SET.id, path: '备课/上一课.md', anchor: stableLessonSummaryId('s-1'), revision: previousDoc.revision };

const long = (size, fill = '条件') => fill.repeat(Math.ceil(size / fill.length)).slice(0, size);

/** 每个 reader 都记录自己真的被读了什么，用来证明没有隐藏的扫描或检索。 */
function makeReader(scope, store, calls = []) {
  return {
    scope,
    calls,
    async read(path) {
      calls.push(path);
      const hit = store.get(path);
      if (!hit) throw new Error('vault_file_not_found');
      return parseMarkdownDocument(path, hit.content, revisionFor(hit.content));
    },
  };
}

function storeOf(entries) { return new Map(entries.map(([path, content]) => [path, { content }])); }

test('cold assembly rebuilds the same bounded context and re-reads every time', async () => {
  const store = storeOf([['备课/第一课.md', script], ['备课/上一课.md', previousContent]]);
  const build = async () => assembleTeachingContext({
    readers: [makeReader(SET, store)],
    settings: { scriptPath: '备课/第一课.md', learningGoal: { title: '能比较两种表示' }, subjects: ['数学'] },
    previousLesson: previousPointer,
  });

  const first = await build();
  const second = await build();
  assert.equal(first.text, second.text);
  assert.deepEqual(first.context, second.context);
  assert.equal(first.truncated, false);
  assert.equal(first.scope.id, SET.id);

  // 没有缓存：源文件变化后重建必须看到新的 revision 与新的正文。
  store.set('备课/第一课.md', { content: `${script.replace('## 例题', '## 变式').trimEnd()}\n\n## 追问\n\n为什么？\n` });
  const third = await build();
  assert.notEqual(third.script.revision, first.script.revision);
  assert.equal(third.script.sectionCount, 5);
  assert.match(third.text, /变式/);
  // 概览只给前三个小节标题：正文和其余小节不进入 L0。
  assert.doesNotMatch(third.text, /追问/);
});

test('over-long settings, script and summary stay inside the character budget', async () => {
  const sections = Array.from({ length: 12 }, (_, index) => `## ${long(60, `小节${index}`)}`).join('\n\n');
  const hugeScript = `---\ntype: lesson\ntitle: 超长剧本\n---\n# 超长剧本\n\n${sections}\n`;
  const hugePrevious = upsertLessonSummary('', { sessionId: 's-2', title: '超长前课', body: `正文。\n\n## 下次从这里继续\n${long(2000, '继续')}` });
  const store = storeOf([['备课/超长.md', hugeScript], ['备课/上一课.md', hugePrevious]]);

  const result = await assembleTeachingContext({
    readers: [makeReader(SET, store)],
    settings: {
      scriptPath: '备课/超长.md',
      learningGoal: { title: long(400, '目标') },
      temporaryInstructions: long(400, '要求'),
      subjects: Array.from({ length: 8 }, () => long(40, '科目')),
    },
    previousLesson: { ...previousPointer, path: '备课/上一课.md', anchor: stableLessonSummaryId('s-2'), revision: null },
  });

  assert.ok(result.length <= CONTEXT_BUDGET, `length ${result.length} must fit ${CONTEXT_BUDGET}`);
  assert.equal(result.budget, CONTEXT_BUDGET);
  assert.equal(result.truncated, true);
  assert.ok(result.dropped.length > 0);
  assert.ok(result.text.endsWith('）'));

  // 字段自己先有界，因此结构化投影永远可以完整序列化，不会被切成半截 JSON。
  assert.equal(result.context.本课目标.length, 200);
  assert.equal(result.context.临时要求.length, 200);
  assert.equal(result.context.前课.continuation.length, 400);
  assert.equal(result.context.剧本.sections.length, 3);
  assert.equal(result.script.sectionsTruncated, true);
  assert.equal(result.context.预算.used, result.length);
  assert.deepEqual(JSON.parse(JSON.stringify(result.context)), result.context);
});

test('a missing script and missing profile keep the entry points without invention', async () => {
  const store = storeOf([]);
  const reader = makeReader(SET, store);
  const result = await assembleTeachingContext({ readers: [reader], settings: { subjects: [] } });

  assert.equal(result.script, null);
  assert.equal(result.previous, null);
  assert.deepEqual(reader.calls, []);
  assert.match(result.text, /本课未绑定剧本/);
  assert.match(result.text, /本课未绑定前课小结/);
  assert.match(result.text, /本课没有显式指定的条目/);
  assert.match(result.text, /glob \/ grep/);
  assert.match(result.text, /候选触发/);
  assert.equal(result.context.画像.已显式指定, false);
  assert.deepEqual(result.failures, []);

  // 未读内容不写成已读：概览显式标注正文未读，且不出现任何小结标题。
  const withScript = await assembleTeachingContext({
    readers: [makeReader(SET, storeOf([['备课/第一课.md', script]]))],
    settings: { scriptPath: '备课/第一课.md' },
  });
  assert.match(withScript.text, /正文未读/);
  assert.match(withScript.text, /未绑定前课小结/);
  assert.doesNotMatch(withScript.text, /上一课·椭圆/);
});

test('a changed script or previous lesson is reported as stale, not silently adopted', async () => {
  const store = storeOf([['备课/第一课.md', script], ['备课/上一课.md', previousContent]]);
  const bound = {
    settings: { scriptPath: '备课/第一课.md', scriptRevision: revisionFor(script), scriptSnapshot:{content:script,revision:revisionFor(script)} },
    previousLesson: previousPointer,
    readers: [makeReader(SET, store)],
  };

  const fresh = await assembleTeachingContext(bound);
  assert.equal(fresh.script.stale, false);
  assert.equal(fresh.previous.stale, false);
  assert.deepEqual(fresh.failures, []);
  assert.match(fresh.text, /继续第二题，先确定焦点的位置/);
  assert.match(fresh.text, /当前版本/);

  // 绑定后剧本被改写、前课小结被追加：绑定快照保留，当前版本明确标注。
  store.set('备课/第一课.md', { content: script.replace('## 例题', '## 变式') });
  const stale = await assembleTeachingContext(bound);
  assert.equal(stale.script.stale, true);
  assert.equal(stale.script.boundRevision, revisionFor(script));
  assert.notEqual(stale.script.revision, stale.script.boundRevision);
  assert.ok(stale.failures.some(item => item.code === 'script_stale'));
  assert.match(stale.text, /绑定后已变动/);

  const changed = await assembleTeachingContext({
    ...bound,
    previousLesson: { ...previousPointer, revision: revisionFor('别的版本') },
  });
  assert.equal(changed.previous.stale, true);
  assert.equal(changed.previous.boundRevision, revisionFor('别的版本'));
  assert.ok(changed.failures.some(item => item.code === 'previous_lesson_stale'));
  assert.match(changed.text, /绑定后已变动/);
});

test('read failures are bounded and never abort the assembly', async () => {
  const store = storeOf([['备课/上一课.md', previousContent]]);
  const reader = {
    scope: SET,
    calls: [],
    async read(path) {
      this.calls.push(path);
      if (path === '备课/第一课.md') throw new Error('vault_file_not_found\n    at /Users/someone/private/vault.js:12:3');
      if (path === '备课/上一课.md') return parseMarkdownDocument(path, store.get(path).content);
      throw new Error(`vault_reference_stale ${'x'.repeat(200)}`);
    },
  };

  const result = await assembleTeachingContext({
    readers: [reader],
    settings: { scriptPath: '备课/第一课.md' },
    previousLesson: { scopeId: SET.id, path: '备课/缺失.md' },
  });

  assert.deepEqual(reader.calls, ['备课/第一课.md', '备课/缺失.md']);
  // 只有机器码形状的报文被保留；带堆栈或长尾的报文收敛成 read_failed，不外泄内部细节。
  assert.deepEqual(result.failures.map(item => item.code), ['read_failed', 'read_failed']);
  for (const failure of result.failures) {
    assert.ok(failure.code.length <= 48);
    assert.doesNotMatch(failure.code, /[\s/]/);
  }
  assert.equal(result.script.error, 'read_failed');
  assert.equal(result.previous.error, 'read_failed');
  assert.match(result.text, /读取失败/);
  assert.doesNotMatch(result.text, /private/);
  assert.match(result.text, /glob \/ grep/);

  // 仓库的 fail(code) 形状原样保留，方便教师按真实原因重试或重读。
  const coded = await assembleTeachingContext({
    readers: [{ scope: SET, async read() { throw new Error('vault_markdown_required'); } }],
    settings: { scriptPath: '备课/第一课.md' },
  });
  assert.equal(coded.script.error, 'vault_markdown_required');
  assert.ok(coded.failures.some(item => item.code === 'vault_markdown_required'));
  assert.match(coded.text, /vault_markdown_required/);
});

test('a cross-set previous lesson needs an explicitly injected source', async () => {
  const store = storeOf([['备课/上一课.md', previousContent]]);
  const current = makeReader(SET, store);
  const crossPointer = { ...previousPointer, scopeId: OTHER.id };

  const unresolved = await assembleTeachingContext({ readers: [current], previousLesson: crossPointer });
  assert.deepEqual(current.calls, []);
  assert.equal(unresolved.previous.error, 'scope_unavailable');
  assert.ok(unresolved.failures.some(item => item.code === 'scope_unavailable'));
  assert.match(unresolved.text, /不可用（scope_unavailable）/);
  assert.equal(unresolved.context.范围.未列出的集, '本段未读取');

  const other = makeReader(OTHER, store);
  const linked = await assembleTeachingContext({ readers: [current, other], previousLesson: crossPointer });
  assert.deepEqual(other.calls, ['备课/上一课.md']);
  assert.deepEqual(current.calls, []);
  assert.equal(linked.previous.scopeId, OTHER.id);
  assert.deepEqual(linked.context.范围.显式跨集, [OTHER.title]);
  assert.match(linked.text, /已接入范围：物理·力学/);
  assert.match(linked.text, /继续第二题/);
});

test('profile entries come only from explicit input, never from a keyword search', async () => {
  const store = storeOf([['备课/第一课.md', script]]);
  const reader = makeReader(SET, store);
  const base = { readers: [reader], settings: { scriptPath: '备课/第一课.md' } };

  const bare = await assembleTeachingContext(base);
  assert.deepEqual(reader.calls, ['备课/第一课.md']);
  assert.doesNotMatch(bare.text, /相关线索/);
  assert.deepEqual(bare.context.画像.线索, []);

  const hinted = await assembleTeachingContext({
    ...base,
    profile: {
      conventions: [{ title: '板书先写条件', ref: 'vault:convention' }],
      hints: [{ title: '极点极线的选路经历', recall: '优先尝试极点极线、因未找到预期结构而卡住时。', ref: 'vault:hint' }],
    },
  });
  assert.deepEqual(reader.calls, ['备课/第一课.md', '备课/第一课.md']);
  assert.equal(hinted.context.画像.已显式指定, true);
  assert.deepEqual(hinted.context.画像.通用约定, [{ title: '板书先写条件', ref: 'vault:convention' }]);
  assert.deepEqual(hinted.context.画像.线索.map(item => item.title), ['极点极线的选路经历']);
  assert.match(hinted.text, /极点极线的选路经历/);
});

test('the budget and the injected readers are validated instead of guessed', async () => {
  await assert.rejects(() => assembleTeachingContext({ readers: [], settings: {} }), /teaching_context_reader_required/);
  await assert.rejects(() => assembleTeachingContext({ readers: [{ scope: {} , read() {} }] }), /teaching_context_scope_invalid/);
  await assert.rejects(() => assembleTeachingContext({ readers: [{ scope: SET }] }), /teaching_context_reader_invalid/);
  await assert.rejects(() => assembleTeachingContext({ readers: [makeReader(SET, new Map())], budget: 0 }), /teaching_context_budget_invalid/);

  const result = await assembleTeachingContext({
    readers: [makeReader(SET, storeOf([['备课/第一课.md', script]]))],
    settings: { scriptPath: '备课/第一课.md', learningGoal: { title: long(400, '目标') } },
    budget: 200,
  });
  assert.equal(result.budget, 200);
  assert.ok(result.length <= 200);
  assert.equal(result.truncated, true);
  assert.ok(result.context.预算.dropped.length > 0);
});
