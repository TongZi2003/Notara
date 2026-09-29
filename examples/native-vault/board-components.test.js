import assert from 'node:assert/strict';
import test from 'node:test';
import { BOARD_ANSWER_LIMIT, answersFor, appendBoardAnswer, boardAnswerMessage, boardComponents, fingerprint, splitBoardBody, validateBoardAnswer, validateBoardComponents, validateStoredAnswers } from './board-components.js';

const fence = (type, body) => '```' + type + '\n' + body + '\n```';
const choice = fence('choice', '这条弦的斜率是正还是负？\n- 正\n- 负\n- 取决于 M 在哪个象限\nreason required');

test('a body splits into Markdown and components; other code fences stay Markdown', () => {
  const body = `题目在这里。\n\n${choice}\n\n\`\`\`python\nprint("\`\`\`choice")\n\`\`\`\n\n${fence('order', '排好\n- 乙\n- 甲')}`;
  const { segments, open } = splitBoardBody(body);
  assert.equal(open, null);
  assert.deepEqual(segments.map(segment => segment.kind === 'component' ? `${segment.type}#${segment.index}` : 'md'), ['md', 'choice#0', 'md', 'order#1']);
  assert.match(segments[2].text, /print/);
  const streaming = splitBoardBody('前文\n```choice\n问题？\n- 甲');
  assert.equal(streaming.open.type, 'choice');
  assert.deepEqual(streaming.segments.map(segment => segment.kind), ['markdown']);
});

test('choice parses its stem, options and settings, and adds no answer key', () => {
  const [component] = boardComponents(choice);
  assert.deepEqual(component.spec, { stem: '这条弦的斜率是正还是负？', options: ['正', '负', '取决于 M 在哪个象限'], multiple: false, reason: 'required' });
  assert.match(component.fingerprint, /^[a-f0-9]{16}$/);
  assert.equal(boardComponents(choice)[0].fingerprint, component.fingerprint, 'the fingerprint is stable');
  assert.notEqual(boardComponents(choice.replace('- 负', '- 负数'))[0].fingerprint, component.fingerprint, 'changing an option changes the question');
  assert.equal(boardComponents(choice.replace('reason required', 'reason optional'))[0].fingerprint, component.fingerprint, 'the reason setting is not part of the question');
});

test('the teacher write check locates the error and carries the syntax', () => {
  const cases = [
    [fence('choice', '- 甲\n- 乙'), /第1个组件（choice）缺少题干/],
    [fence('choice', '问？\n- 甲'), /至少要有两个选项/],
    [fence('choice', '问？\n- 甲\n- 不确定'), /第3行：“不确定”和“都不对，我觉得……”由系统自动加上/],
    [fence('choice', '问？\n- 甲\n- 乙\nmultipel'), /第4行：不认识的一行/],
    [fence('choice', '问？\n' + Array.from({ length: 9 }, (_, i) => `- ${i}`).join('\n')), /选项最多 8 个/],
    [fence('blank', '没有空'), /至少要留一个空/],
    [fence('blank', '一个 {{ 空'), /第1行：空要写成/],
    [fence('order', '排好\n- 甲\n- 甲'), /第3行：条目“甲”重复了/],
    [fence('order', '归类\n- 甲\n- 乙\ngroups 一'), /groups 写 2 到 4 个组名/],
    ['说明\n```order\n排好\n- 甲', /没有用单独一行 ``` 结束/],
  ];
  for (const [body, pattern] of cases) {
    assert.throws(() => validateBoardComponents(body), error => { assert.match(error.message, /^board_component_invalid：/); assert.match(error.message, pattern); assert.match(error.message, /的写法：\n```/); return true; }, body);
  }
  assert.equal(validateBoardComponents(`${choice}\n\n${fence('blank', 'code python\ndef f(x):\n    return {{ }}')}`).length, 2);
});

test('blank keeps code indentation and hints; order keeps groups', () => {
  const [blank] = boardComponents(fence('blank', 'code python\ndef twice(value):\n    return {{ 表达式 }}'));
  assert.deepEqual(blank.spec, { code: 'python', lines: ['def twice(value):', '    return {{ 表达式 }}'], blanks: ['表达式'] });
  const [order] = boardComponents(fence('order', '把条件归类\n- 中点 M\n- 斜率 k\ngroups 已知 | 所求'));
  assert.deepEqual(order.spec, { stem: '把条件归类', items: ['中点 M', '斜率 k'], groups: ['已知', '所求'] });
});

test('answers are checked against the component and become the student message', () => {
  const [component] = boardComponents(choice);
  assert.throws(() => validateBoardAnswer(component, { pick: [1] }), /board_answer_reason_required/);
  assert.throws(() => validateBoardAnswer(component, { pick: [0, 1], reason: '因为' }), /board_answer_invalid/, 'single choice takes one option');
  assert.throws(() => validateBoardAnswer(component, { pick: [5], reason: 'x' }), /board_answer_invalid/);
  assert.throws(() => validateBoardAnswer(component, { other: '  ' }), /board_answer_invalid/, '都不对 needs the student’s own words');
  const picked = validateBoardAnswer(component, { pick: [1], reason: '中点在第一象限，弦向下倾斜' });
  assert.equal(boardAnswerMessage({ sectionTitle: '第1题 中点弦的斜率', blockTitle: '题目', component, answer: picked }), '〔白板｜第1题 中点弦的斜率｜这条弦的斜率是正还是负？〕我选：B 负。理由：中点在第一象限，弦向下倾斜');
  assert.equal(boardAnswerMessage({ sectionTitle: '第1题', blockTitle: '题目', component, answer: validateBoardAnswer(component, { unsure: true }) }), '〔白板｜第1题｜这条弦的斜率是正还是负？〕我不确定。');

  const [blank] = boardComponents(fence('blank', '相减得 {{ }}，所以 $k=$ {{ }}'));
  assert.throws(() => validateBoardAnswer(blank, { fills: ['', ''] }), /board_answer_empty/);
  assert.equal(boardAnswerMessage({ sectionTitle: '第1题', blockTitle: '点差法', component: blank, answer: validateBoardAnswer(blank, { fills: ['$y_1^2-y_2^2$', ''] }) }), '〔白板｜第1题｜点差法 · 补一步〕第1空：$y_1^2-y_2^2$；第2空：（没填）');

  const [order] = boardComponents(fence('order', '排好\n- 乙\n- 甲\n- 丙'));
  assert.throws(() => validateBoardAnswer(order, { order: [0, 0, 1] }), /board_answer_invalid/);
  assert.equal(boardAnswerMessage({ blockTitle: 'x', component: order, answer: validateBoardAnswer(order, { order: [1, 0, 2] }) }), '〔白板｜排好〕我的顺序：1. 甲 2. 乙 3. 丙');
  const [groups] = boardComponents(fence('order', '归类\n- 中点\n- 斜率\n- 和\ngroups 已知 | 所求'));
  assert.throws(() => validateBoardAnswer(groups, { groups: [[0], [1]] }), /board_answer_invalid/, 'every item must be placed');
  assert.equal(boardAnswerMessage({ blockTitle: 'x', component: groups, answer: validateBoardAnswer(groups, { groups: [[0, 2], [1]] }) }), '〔白板｜归类〕我的归类：已知：中点、和；所求：斜率');
});

test('answer history keeps the latest ten per question and splits off a changed question', () => {
  const [component] = boardComponents(choice);
  let answers = [];
  for (let n = 0; n < BOARD_ANSWER_LIMIT + 3; n++) answers = appendBoardAnswer(answers, { id: `${n}`.padStart(8, 'a'), c: 0, fp: component.fingerprint, at: new Date(n * 1000).toISOString(), v: { pick: [0], reason: `${n}` } });
  answers = appendBoardAnswer(answers, { id: 'bbbbbbbb', c: 0, fp: fingerprint('old'), at: new Date().toISOString(), v: { pick: [1] } });
  const { current, stale } = answersFor(component, answers);
  assert.equal(current.length, BOARD_ANSWER_LIMIT);
  assert.equal(current[0].v.reason, '3');
  assert.equal(stale.length, 1);
  assert.equal(validateStoredAnswers(answers), answers);
  assert.throws(() => validateStoredAnswers([{ id: 'x', c: 0, fp: 'nope', at: 'now', v: {} }]), /board_format_invalid/);
});
