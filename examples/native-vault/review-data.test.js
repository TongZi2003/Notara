import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarkdownDocument, revisionFor } from './vault.js';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { reviewState, reviewHistory, recordReviewContent, undoReviewContent, reviewQueue } from './review-data.js';
import { calendarProjection } from './calendar-data.js';

const body = '# 选法\n\n## 学生理解\n曾经倾向用极点极线；后来能根据结构判断适用范围。\n';
const doc = content => parseMarkdownDocument('卡片/选法.md', content, revisionFor(content));
const card = fields => doc(serializeFrontmatter({ type: 'card', tags: ['数学'], ...fields }) + body);
const observed = (outcome = 'demonstrated', ability = '判断方法适用范围') => ({ ability, outcome });
const request = (day, assessments = [observed()], extra = {}) => ({ id: `review-${day}`, at: day+'T04:00:00.000Z', day, assessments,
  note: '老师问极点极线是否适用；学生自行指出缺少对称结构，并提出参数方程。', actor: 'teacher', sessionId: 'synthetic-lesson', ...extra });
const record = (document, req) => doc(recordReviewContent(document, req));
const active = () => card({ learned: true, mastery: 3, interval: 7, last_review: '2026-09-20', next_review: '2026-09-27' });

test('Socratic elicitation can demonstrate cognition; early and same-day successes do not extend review', () => {
  const initial = card({});
  const first = record(initial, request('2026-09-20'));
  assert.equal(reviewState(first).mastery, 1);
  const repeated = record(first, request('2026-09-20', [observed()], { id: 'another-actual-attempt' }));
  assert.deepEqual(reviewState(repeated), reviewState(first));
  const due = record(repeated, request('2026-09-21'));
  assert.equal(reviewState(due).mastery, 2);
  assert.equal(reviewState(due).next_review, '2026-09-24');
  const early = record(due, request('2026-09-22'));
  assert.deepEqual(reviewState(early), reviewState(due));
  assert.equal(reviewHistory(early).length, 4);
  assert.equal(parseFrontmatter(early.content).body, body);
});

test('unobserved ability is neither failure nor a fresh schedule, including a mixed observation', () => {
  const assessments = [observed('demonstrated', '执行参数方程计算'), observed('not_observed', '自主选法')];
  for (const initial of [card({}), active()]) {
    const saved = record(initial, request('2026-09-28', assessments));
    assert.deepEqual(reviewState(saved), reviewState(initial));
    assert.deepEqual(reviewHistory(saved)[0].assessments, assessments);
    assert.equal('passed' in reviewHistory(saved)[0], false);
    const queue = reviewQueue([saved], { today: '2026-09-28', status: 'all' });
    assert.equal(queue.invalid.length, 0);
    assert.equal(queue.counts.pending, reviewState(initial).learned ? 0 : 1);
  }
});

test('only observed difficulty lowers the tier; other unknown abilities do not hide that evidence', () => {
  const next = record(active(), request('2026-09-22', [observed('needs_practice'), observed('not_observed', '迁移到新题')]));
  assert.equal(reviewState(next).mastery, 2);
  assert.equal(reviewState(next).next_review, '2026-09-25');
  const max = card({ learned: true, mastery: 5, interval: 35, last_review: '2026-08-01', next_review: '2026-09-05' });
  assert.equal(reviewState(record(max, request('2026-09-22'))).mastery, 5);
});

test('assessment contract rejects missing, ambiguous and invented outcome fields', () => {
  for (const assessments of [undefined, [], [observed('hinted')], [observed(), observed()], [{ ...observed(), hints: 2 }], [observed('not_observed', ' ')], Array.from({length:9}, (_, i) => observed('demonstrated', String(i)))]) {
    assert.throws(() => record(card({}), request('2026-09-20', assessments, { assessments })), /review_assessments_invalid/);
  }
  assert.throws(() => record(card({}), request('2026-09-20', [observed()], { passed: true })), /review_request_invalid/);
  assert.throws(() => record(card({}), request('2026-09-20', [observed()], { note: ' ' })), /review_note_required/);
});

test('same evaluation retries are idempotent; changing cognition under the same identity conflicts', () => {
  const req = request('2026-09-20');
  const saved = record(card({}), req);
  assert.equal(recordReviewContent(saved, { ...req, at: '2026-09-20T05:00:00.000Z' }), saved.content);
  assert.throws(() => recordReviewContent(saved, { ...req, assessments: [observed('not_observed')] }), /review_conflict/);
});

test('legacy pass/fail history stays literal, and new history-only evaluations can be undone', () => {
  const before = reviewState(card({}));
  const after = { learned: true, mastery: 1, interval: 1, last_review: '2026-09-20', next_review: '2026-09-21' };
  const old = { id: 'old', at: '2026-09-20T04:00:00.000Z', day: '2026-09-20', passed: false, note: '旧版说明', actor: 'self', sessionId: null, before, after, source_note: '原有附加证据' };
  const legacy = card({ ...after, review_history: [old] });
  const saved = record(legacy, request('2026-09-21', [observed('not_observed')]));
  assert.deepEqual(reviewHistory(saved)[0], old);
  const projected = calendarProjection([saved], { from: '2026-09-01', to: '2026-09-30', today: '2026-09-21', timeZone: 'UTC' });
  const oldEvent = projected.events.find(event => event.key.endsWith(':old'));
  assert.equal(oldEvent.passed, false);
  assert.equal('outcome' in oldEvent, false);
  const undone = doc(undoReviewContent(saved, { at: '2026-09-21T05:00:00.000Z' }));
  assert.deepEqual(reviewState(undone), after);
  assert.ok(reviewHistory(undone)[1].revertedAt);
  const allUndone = doc(undoReviewContent(undone, { at: '2026-09-21T06:00:00.000Z' }));
  assert.deepEqual(reviewState(allUndone), before);
  assert.throws(() => undoReviewContent(allUndone, { at: '2026-09-21T07:00:00.000Z' }), /review_undo_unavailable/);
  const changed = card({ ...reviewState(saved), mastery: 2, interval: 3, next_review: '2026-09-23', review_history: reviewHistory(saved) });
  assert.throws(() => undoReviewContent(changed, { at: '2026-09-21T06:00:00.000Z' }), /review_state_mismatch/);
});

test('corrupt history stays explicit and cannot be silently overwritten or assigned new evidence', () => {
  const saved = record(card({}), request('2026-09-20'));
  const broken = card({ ...reviewState(saved), review_history: [{ ...reviewHistory(saved)[0], day: '2026-02-30' }] });
  assert.throws(() => reviewHistory(broken), /review_history_invalid/);
  assert.throws(() => record(broken, request('2026-09-21')), /review_history_invalid/);
  assert.deepEqual(reviewQueue([broken], { today: '2026-09-21' }).invalid, [{ path: broken.path }]);
});

test('calendar preserves unknown and mixed observations instead of displaying them as failure', () => {
  const assessments = [observed('not_observed'), observed('demonstrated', '执行计算')];
  const saved = record(card({}), request('2026-09-20', assessments));
  const calendar = calendarProjection([saved], { from: '2026-09-01', to: '2026-09-30', today: '2026-09-20', timeZone: 'UTC' });
  assert.equal(calendar.events.length, 1);
  assert.equal(calendar.events[0].kind, 'review');
  assert.deepEqual(calendar.events[0].assessments, assessments);
  assert.equal(calendar.events[0].outcome, 'not_observed');
});
