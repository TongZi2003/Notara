import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarkdownDocument, revisionFor } from './vault.js';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { reviewState, reviewHistory, recordReviewContent, undoReviewContent, reviewQueue, reviewAssessmentText } from './review-data.js';
import { calendarProjection } from './calendar-data.js';

const body = '# 选法\n\n## 学生理解\n曾经倾向用极点极线；后来能根据结构判断适用范围。\n';
const doc = content => parseMarkdownDocument('卡片/选法.md', content, revisionFor(content));
const card = fields => doc(serializeFrontmatter({ type: 'card', tags: ['数学'], ...fields }) + body);
const judged = (result = 'done', extra = {}) => ({ keyStep: '判断方法适用范围', result, ...extra });
const request = (day, evidence = judged(), extra = {}) => ({ id: `review-${day}`, at: day+'T04:00:00.000Z', day, ...evidence,
  note: '老师问极点极线是否适用；学生自行指出缺少对称结构，并提出参数方程。', actor: 'teacher', sessionId: 'synthetic-lesson', ...extra });
const record = (document, req) => doc(recordReviewContent(document, req));
const active = () => card({ learned: true, mastery: 3, interval: 7, last_review: '2026-09-20', next_review: '2026-09-27' });
const stateOf = document => reviewState(document);
const fresh = () => ({ learned: false, mastery: 0, interval: null, last_review: null, next_review: null });
const tier1 = { learned: true, mastery: 1, interval: 1, last_review: '2026-09-20', next_review: '2026-09-21' };

test('the key step alone moves the tier; early and same-day successes do not extend review', () => {
  const initial = card({});
  const first = record(initial, request('2026-09-20'));
  assert.equal(stateOf(first).mastery, 1);
  const repeated = record(first, request('2026-09-20', judged(), { id: 'another-actual-attempt' }));
  assert.deepEqual(stateOf(repeated), stateOf(first));
  const due = record(repeated, request('2026-09-21'));
  assert.equal(stateOf(due).mastery, 2);
  assert.equal(stateOf(due).next_review, '2026-09-24');
  const early = record(due, request('2026-09-22'));
  assert.deepEqual(stateOf(early), stateOf(due));
  assert.equal(reviewHistory(early).length, 4);
  assert.equal(parseFrontmatter(early.content).body, body);
});

test('a missed key step lowers the tier whether or not the card is due; a new card starts at tier 1 either way', () => {
  const next = record(active(), request('2026-09-22', judged('missed')));
  assert.equal(stateOf(next).mastery, 2);
  assert.equal(stateOf(next).next_review, '2026-09-25');
  assert.equal(stateOf(record(card({}), request('2026-09-20', judged('missed')))).mastery, 1);
  const max = card({ learned: true, mastery: 5, interval: 35, last_review: '2026-08-01', next_review: '2026-09-05' });
  assert.equal(stateOf(record(max, request('2026-09-22'))).mastery, 5);
});

test('an unchecked key step keeps the schedule, and a record holds only the key step and the note', () => {
  for (const initial of [card({}), active()]) {
    const saved = record(initial, request('2026-09-28', { result: 'unchecked' }));
    assert.deepEqual(stateOf(saved), stateOf(initial));
    assert.equal(reviewQueue([saved], { today: '2026-09-28', status: 'all' }).counts.pending, stateOf(initial).learned ? 0 : 1);
  }
  const stored = reviewHistory(record(active(), request('2026-09-22', judged('missed'))))[0];
  assert.deepEqual(Object.keys(stored).filter(key => !['id', 'at', 'day', 'sessionId', 'actor', 'before', 'after'].includes(key)), ['keyStep', 'result', 'note']);
});

test('record contract names each unusable field', () => {
  const fails = (evidence, code, extra = {}) => assert.throws(() => record(card({}), request('2026-09-20', evidence, extra)), new RegExp(code));
  for (const result of [undefined, 'hinted', 'demonstrated']) fails({ keyStep: '列出样本空间', result }, 'review_result_invalid');
  fails({ result: 'done' }, 'review_key_step_required');
  fails({ result: 'missed', keyStep: '  ' }, 'review_key_step_required');
  fails(judged('done', { keyStep: 'x'.repeat(201) }), 'review_key_step_invalid');
  // Depth and the plan for next time live in the card's 学生理解, not in the record.
  for (const retired of [{ depth: [{ level: '边界', ability: '随机遇到一个孩子时答案会变', outcome: 'reached' }] }, { nextCheck: '边界' }]) {
    fails(judged(), 'review_request_invalid', retired);
  }
  fails(judged(), 'review_request_invalid', { assessments: [{ ability: '熟练：列式', outcome: 'demonstrated' }] });
  fails(judged(), 'review_request_invalid', { passed: true });
  fails(judged(), 'review_note_required', { note: ' ' });
  // Only the teacher must name the step it judged; a student's self-check and an unchecked record may omit it.
  assert.equal(stateOf(record(card({}), request('2026-09-20', { result: 'done' }, { actor: 'self' }))).mastery, 1);
  assert.equal(stateOf(record(card({}), request('2026-09-20', { result: 'unchecked' }))).learned, false);
});

test('a record written with depth and a next check (0.20.0–0.20.1) stays readable and never moves the tier', () => {
  const unlearned = { learned: false, mastery: 0, interval: null, last_review: null, next_review: null };
  const older = { id: 'four-part', at: '2026-09-20T04:00:00.000Z', day: '2026-09-20', keyStep: '列出样本空间', result: 'done',
    depth: [{ level: '推导', ability: '说清 1/3', outcome: 'reached' }], nextCheck: '边界', note: '四栏记录。', sessionId: null, actor: 'teacher', before: unlearned, after: tier1 };
  const saved = record(card({ ...tier1, review_history: [older] }), request('2026-09-21'));
  assert.deepEqual(reviewHistory(saved)[0], older);
  assert.equal(stateOf(saved).mastery, 2);
  assert.equal(reviewAssessmentText(older), '关键一步（列出样本空间）：做出来');
});

test('same evaluation retries are idempotent; changing any judged field under the same identity conflicts', () => {
  const req = request('2026-09-20');
  const saved = record(card({}), req);
  assert.equal(recordReviewContent(saved, { ...req, at: '2026-09-20T05:00:00.000Z' }), saved.content);
  for (const change of [{ result: 'missed' }, { keyStep: '换一步' }, { note: '另一段说明。' }]) {
    assert.throws(() => recordReviewContent(saved, { ...req, ...change }), /review_conflict/);
  }
});

test('both older record generations stay literal beside new ones, and new evaluations can be undone', () => {
  const passedRow = { id: 'old', at: '2026-09-18T04:00:00.000Z', day: '2026-09-18', passed: false, note: '旧版说明', actor: 'self', sessionId: null, before: fresh(), after: fresh(), source_note: '原有附加证据' };
  const listRow = { id: 'list', at: '2026-09-20T04:00:00.000Z', day: '2026-09-20', assessments: [{ ability: '熟练：列出样本空间', outcome: 'demonstrated' }, { ability: '边界：条件的来源', outcome: 'needs_practice' }],
    note: '第二代记录', actor: 'teacher', sessionId: 'lesson', before: fresh(), after: tier1 };
  const legacy = card({ ...tier1, review_history: [passedRow, listRow] });
  const saved = record(legacy, request('2026-09-21', { result: 'unchecked' }));
  assert.deepEqual(reviewHistory(saved).slice(0, 2), [passedRow, listRow]);
  const projected = calendarProjection([saved], { from: '2026-09-01', to: '2026-09-30', today: '2026-09-21', timeZone: 'UTC' });
  const event = key => projected.events.find(item => item.key.endsWith(`:${key}`));
  assert.equal(event('old').passed, false);
  assert.equal('outcome' in event('old'), false);
  assert.equal(event('list').outcome, 'needs_practice');
  assert.equal(event('review-2026-09-21').result, 'unchecked');
  const undone = doc(undoReviewContent(saved, { at: '2026-09-21T05:00:00.000Z' }));
  assert.deepEqual(stateOf(undone), tier1);
  assert.ok(reviewHistory(undone)[2].revertedAt);
  const reUndone = doc(undoReviewContent(undone, { at: '2026-09-21T06:00:00.000Z' }));
  assert.deepEqual(stateOf(reUndone), fresh());
  const changed = card({ ...stateOf(saved), mastery: 2, interval: 3, next_review: '2026-09-23', review_history: reviewHistory(saved) });
  assert.throws(() => undoReviewContent(changed, { at: '2026-09-21T06:00:00.000Z' }), /review_state_mismatch/);
  // A row may belong to one generation only.
  for (const mixed of [{ ...listRow, passed: true }, { ...listRow, result: 'done' }, { ...passedRow, result: 'done' }]) {
    assert.throws(() => reviewHistory(card({ ...tier1, review_history: [mixed] })), /review_history_invalid/);
  }
});

test('corrupt history stays explicit and cannot be silently overwritten or assigned new evidence', () => {
  const saved = record(card({}), request('2026-09-20'));
  const broken = card({ ...stateOf(saved), review_history: [{ ...reviewHistory(saved)[0], day: '2026-02-30' }] });
  assert.throws(() => reviewHistory(broken), /review_history_invalid/);
  assert.throws(() => record(broken, request('2026-09-21')), /review_history_invalid/);
  assert.deepEqual(reviewQueue([broken], { today: '2026-09-21' }).invalid, [{ path: broken.path }]);
  const badResult = card({ ...stateOf(saved), review_history: [{ ...reviewHistory(saved)[0], result: 'demonstrated' }] });
  assert.throws(() => reviewHistory(badResult), /review_history_invalid/);
});

test('the calendar carries the key step of a new record', () => {
  const saved = record(card({}), request('2026-09-20'));
  const calendar = calendarProjection([saved], { from: '2026-09-01', to: '2026-09-30', today: '2026-09-20', timeZone: 'UTC' });
  assert.equal(calendar.events.filter(event => event.kind === 'review').length, 1);
  const review = calendar.events.find(event => event.kind === 'review');
  assert.deepEqual({ keyStep: review.keyStep, result: review.result }, judged());
  assert.equal('assessments' in review, false);
});

test('each record generation reads as its own text', () => {
  assert.equal(reviewAssessmentText({ passed: true }), '旧评估 · 通过');
  assert.equal(reviewAssessmentText({ assessments: [{ ability: '熟练：列式', outcome: 'needs_practice' }] }), '熟练：列式：仍有困难');
  assert.equal(reviewAssessmentText({ keyStep: '列出样本空间', result: 'missed' }), '关键一步（列出样本空间）：没做出来');
  assert.equal(reviewAssessmentText({ result: 'unchecked' }), '关键一步：这次没考');
  assert.equal(reviewAssessmentText({}), '评估格式待检查');
});
