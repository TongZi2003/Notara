// Vault review data: everything one `type: card` note needs to carry its own
// review lifecycle, and nothing else.
//
// Markdown stays the single source of truth. The review fields and the
// append-only `review_history` live in the same frontmatter block as the card
// body, so recording, undoing and calendar projection read one file instead of
// maintaining a second ledger. Only cards have a review lifecycle; every other
// document type is rejected (`review_card_required`) rather than read as an
// unlearned card.
//
// One evaluation is not a proof of mastery: a record says what the teacher
// observed about specific cognitive work and which fixed interval
// follows from the tier it moved to. There is no ease factor, no event
// database and no browsing ledger — merely opening a card writes nothing.
//
// Error codes returned here are the contract with the Host:
//   review_card_required    the document is not `type: card`
//   review_document_invalid the document carries no frontmatter / Markdown text
//   review_state_invalid    one card's review fields contradict each other
//   review_history_invalid  a stored history entry is malformed
//   review_date_invalid     a civil day is not a real `YYYY-MM-DD`
//   review_request_invalid  a query/pagination/undo argument is unusable
//   review_status_invalid   the requested queue status does not exist
//   review_note_required    an evaluation arrived without a note
//   review_note_too_long    a note exceeds the stored budget
//   review_day_regression   the evaluation day is earlier than last_review
//   review_conflict         one id was reused for a different evaluation
//   review_undo_unavailable no record is left to undo
//   review_state_mismatch   the card moved on since the record was written

import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { matchedQueryTerms, queryTokens } from './learning-data.js';

/** interval follows the mastery tier: mastery 1..5 -> 1, 3, 7, 16, 35 days. */
export const REVIEW_INTERVALS = Object.freeze([1, 3, 7, 16, 35]);
export const REVIEW_OUTCOMES = Object.freeze({ demonstrated: '已表现出来', needs_practice: '仍有困难', not_observed: '尚未观察' });

/** One observation per intended ability; assistance is evidence in the note,
 * never a machine penalty. Shared by the CLI, writer and UI. */
export function validateAssessments(value, code = 'review_assessments_invalid') {
  if (!Array.isArray(value) || !value.length || value.length > 8) fail(code);
  const seen = new Set();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some(key => !['ability', 'outcome'].includes(key))) fail(code);
    const ability = boundedText(item.ability, TEXT_BUDGET, code);
    if (typeof item.outcome !== 'string' || !Object.hasOwn(REVIEW_OUTCOMES, item.outcome) || seen.has(ability)) fail(code);
    seen.add(ability);
    return { ability, outcome: item.outcome };
  });
}

/** Derived scheduling result, not a second writable assessment. Legacy rows
 * remain legacy: no invented abilities or assistance are backfilled. */
export function reviewOutcome(record) {
  if (!record.assessments) return null;
  if (record.assessments.some(item => item.outcome === 'needs_practice')) return 'needs_practice';
  if (record.assessments.some(item => item.outcome === 'not_observed')) return 'not_observed';
  return 'demonstrated';
}

export function reviewAssessmentText(record) {
  if (!Array.isArray(record.assessments)) return typeof record.passed === 'boolean' ? `旧评估 · ${record.passed ? '通过' : '还需练习'}` : '评估格式待检查';
  return record.assessments.map(item => `${item?.ability ?? '未说明能力'}：${REVIEW_OUTCOMES[item?.outcome] ?? '无法识别'}`).join('；');
}

const CARD = 'card';
const HISTORY = 'review_history';
const ACTORS = ['self', 'teacher'];
const STATUSES = ['all', 'due', 'pending', 'learning', 'familiar'];
const FAMILIAR_MASTERY = 4;

const NOTE_BUDGET = 4000;
const TEXT_BUDGET = 200;
const STAMP_BUDGET = 64;
const MAX_QUEUE_LIMIT = 200;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INTEGER = /^-?\d+$/;

const fail = code => { throw new Error(code); };
const asText = value => (typeof value === 'string' ? value : '');
const codePoints = value => Array.from(value);
const compareText = (left, right) => (left === right ? 0 : left < right ? -1 : 1);

/** Civil days are dates, not instants: every computation below is UTC-only, so
 * a local midnight or a DST jump can never move a review to another day. */
function civilMs(year, month, day) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}

function civilText(ms) {
  const date = new Date(ms);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** A real calendar date in `YYYY-MM-DD`: `2026-02-30` and `2026-13-01` are
 * rejected instead of being normalized into the next month. */
export function validateDay(day, code = 'review_date_invalid') {
  if (typeof day !== 'string' || !DAY.test(day)) fail(code);
  const [year, month, date] = day.split('-').map(part => Number(part));
  if (civilText(civilMs(year, month, date)) !== day) fail(code);
  return day;
}

/** `day` shifted by whole civil days — the only date arithmetic review uses. */
export function addReviewDays(day, days) {
  validateDay(day);
  if (!Number.isInteger(days)) fail('review_date_invalid');
  const [year, month, date] = day.split('-').map(part => Number(part));
  return validateDay(civilText(civilMs(year, month, date + days)));
}

function frontmatterOf(document) {
  const frontmatter = document?.frontmatter;
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) fail('review_document_invalid');
  return frontmatter;
}

/** Same precedence as the other Vault projections: the document-level type the
 * reader derived from the file, else the frontmatter field handed in directly. */
function declaredType(document, frontmatter) {
  return asText(document?.type).trim() || asText(frontmatter.type).trim();
}

function requireCard(document, frontmatter) {
  if (declaredType(document, frontmatter) !== CARD) fail('review_card_required');
}

function isCard(document) {
  const frontmatter = document?.frontmatter;
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) return false;
  return declaredType(document, frontmatter) === CARD;
}

function learnedFlag(raw, code) {
  if (raw === undefined || raw === null || raw === '') return false;
  if (raw === true || raw === false) return raw;
  const text = asText(raw).trim().toLocaleLowerCase();
  if (text === 'true') return true;
  if (text === 'false') return false;
  fail(code);
}

/** A scalar field that may be missing, empty or a number; anything else is
 * `NaN` so the caller decides which contradiction it is. */
function integerOf(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : Number.NaN;
  const text = asText(raw).trim();
  return text && INTEGER.test(text) ? Number(text) : Number.NaN;
}

function optionalDay(raw, code) {
  if (raw === undefined || raw === null || raw === '') return null;
  return validateDay(asText(raw).trim(), code);
}

function boundedText(raw, limit, code) {
  if (typeof raw !== 'string') fail(code);
  const text = raw.trim();
  if (!text || codePoints(text).length > limit) fail(code);
  return text;
}

/** Host-provided instants are timestamps, never bare dates: a civil day would
 * be parsed as UTC midnight and converted through a time zone, which can land
 * the calendar projection on the wrong day. */
function stampText(raw, code) {
  if (typeof raw !== 'string') fail(code);
  const text = raw.trim();
  if (!text || text.length > STAMP_BUDGET || DAY.test(text) || Number.isNaN(Date.parse(text))) fail(code);
  return text;
}

function passedFlag(raw, code) {
  if (raw === true) return true;
  if (raw === false) return false;
  fail(code);
}

function actorText(raw, code) {
  const text = asText(raw).trim().toLocaleLowerCase();
  if (!ACTORS.includes(text)) fail(code);
  return text;
}

function sessionText(raw, code) {
  if (raw === undefined || raw === null || raw === '') return null;
  const text = asText(raw).trim();
  if (!text || codePoints(text).length > TEXT_BUDGET) fail(code);
  return text;
}

function noteText(raw, code, required) {
  if (typeof raw !== 'string') fail(code);
  if (codePoints(raw).length > NOTE_BUDGET) fail(code === 'review_note_required' ? 'review_note_too_long' : code);
  if (required && !raw.trim()) fail(code);
  return raw;
}

export function validateReviewNote(raw) { return noteText(raw, 'review_note_required', true); }

/** Read one card's review state from the flat fields the frontmatter carries.
 * `code` names the caller's contract, so a stored history snapshot reports
 * itself as a history problem instead of a card problem. */
function readState(fields, code) {
  const learned = learnedFlag(fields.learned, code);
  const mastery = integerOf(fields.mastery);
  const last = optionalDay(fields.last_review, code);
  const next = optionalDay(fields.next_review, code);
  if (!learned) {
    // Dormant inventory cannot simultaneously declare an active schedule.
    if ((mastery !== null && mastery !== 0) || integerOf(fields.interval) !== null || last || next) fail(code);
    return { learned: false, mastery: 0, interval: null, last_review: null, next_review: null };
  }
  if (mastery === null || !Number.isInteger(mastery) || mastery < 1 || mastery > REVIEW_INTERVALS.length) fail(code);
  const interval = integerOf(fields.interval);
  if (interval === null || interval !== REVIEW_INTERVALS[mastery - 1]) fail(code);
  if (!last || !next) fail(code);
  if (next !== addReviewDays(last, interval)) fail(code);
  return { learned: true, mastery, interval, last_review: last, next_review: next };
}

/** The writer derives interval/due from the tier; the reader validates those
 * persisted values. Cards with complete review fields but no history remain
 * readable, while contradictory state is surfaced rather than repaired. */
export function reviewState(document) {
  const frontmatter = frontmatterOf(document);
  requireCard(document, frontmatter);
  return readState(frontmatter, 'review_state_invalid');
}

function fieldObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function historyRecord(value) {
  const code = 'review_history_invalid';
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const assessment = value.assessments !== undefined
    ? { assessments: validateAssessments(value.assessments, code) }
    : { passed: passedFlag(value.passed, code) };
  if (value.assessments !== undefined && Object.hasOwn(value, 'passed')) fail(code);
  const record = {
    ...value,
    id: boundedText(value.id, TEXT_BUDGET, code),
    at: stampText(value.at, code),
    day: validateDay(asText(value.day).trim(), code),
    ...assessment,
    note: noteText(value.note, code, false),
    sessionId: sessionText(value.sessionId, code),
    actor: actorText(value.actor, code),
    before: { ...fieldObject(value.before, code), ...readState(value.before, code) },
    after: { ...fieldObject(value.after, code), ...readState(value.after, code) },
  };
  const revertedAt = value.revertedAt;
  if (revertedAt !== undefined && revertedAt !== null && revertedAt !== '') record.revertedAt = stampText(revertedAt, code);
  else delete record.revertedAt;
  return record;
}

function historyOf(frontmatter) {
  const raw = frontmatter[HISTORY];
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) fail('review_history_invalid');
  return raw.map(historyRecord);
}

/** The card's own review history, oldest first. A card without the field has
 * an empty history; a malformed entry fails instead of being dropped, because
 * a silently trimmed ledger is how an undo loses its audit trail. */
export function reviewHistory(document) {
  const frontmatter = frontmatterOf(document);
  requireCard(document, frontmatter);
  return historyOf(frontmatter);
}

/** The write path re-reads the Markdown text it is about to replace, so the
 * body is preserved byte for byte and the fields it validates are the fields
 * it serializes. */
function parsedCard(document) {
  const frontmatter = frontmatterOf(document);
  requireCard(document, frontmatter);
  const content = document?.content;
  if (typeof content !== 'string') fail('review_document_invalid');
  const parsed = parseFrontmatter(content);
  // The text being replaced must itself be a card: a card flag on the wrapper
  // never licenses writing review fields onto another document type.
  if (asText(parsed.frontmatter.type).trim() !== CARD) fail('review_card_required');
  return { fields: { ...parsed.frontmatter }, body: parsed.body, content };
}

function evaluationRequest(request) {
  const code = 'review_request_invalid';
  if (!request || typeof request !== 'object' || Array.isArray(request)) fail(code);
  if (Object.hasOwn(request, 'passed')) fail(code);
  return {
    id: boundedText(request.id, TEXT_BUDGET, code),
    at: stampText(request.at, code),
    day: validateDay(request.day),
    assessments: validateAssessments(request.assessments),
    note: validateReviewNote(request.note),
    sessionId: sessionText(request.sessionId, code),
    actor: actorText(request.actor, code),
  };
}

/** Unknown evidence and early success preserve the original due date. Only
 * observed difficulty lowers the tier; elicitation alone never does. */
function nextState(before, day, outcome) {
  if (outcome === 'not_observed' || (outcome === 'demonstrated' && before.learned && day < before.next_review)) return before;
  const mastery = before.learned
    ? Math.min(REVIEW_INTERVALS.length, Math.max(1, before.mastery + (outcome === 'demonstrated' ? 1 : -1)))
    : 1;
  const interval = REVIEW_INTERVALS[mastery - 1];
  return { learned: true, mastery, interval, last_review: day, next_review: addReviewDays(day, interval) };
}

/** A retry is the same evaluation when the observation itself matches; a new
 * `at` only means the Host tried again later. */
function sameEvaluation(record, entry) {
  return record.day === entry.day && JSON.stringify(record.assessments) === JSON.stringify(entry.assessments) && record.note === entry.note
    && record.sessionId === entry.sessionId && record.actor === entry.actor;
}

function writeState(fields, state) {
  fields.learned = state.learned;
  fields.mastery = state.mastery;
  fields.interval = state.interval;
  fields.last_review = state.last_review;
  fields.next_review = state.next_review;
}

function writeHistory(fields, history) {
  fields[HISTORY] = history;
}

/** Record one evaluation over the card's own Markdown. The state fields and
 * the history entry change in one frontmatter block, every other field the
 * card carries is preserved, and the history is only ever appended to. */
export function recordReviewContent(document, request = {}) {
  const { fields, body, content } = parsedCard(document);
  const before = readState(fields, 'review_state_invalid');
  const entry = evaluationRequest(request);
  const history = historyOf(fields);

  const previous = history.find(item => item.id === entry.id);
  if (previous) {
    // Replayed operation: the file already holds this evaluation, so the
    // caller gets the original text back untouched, never a second entry.
    if (!sameEvaluation(previous, entry)) fail('review_conflict');
    return content;
  }
  if ((before.learned && entry.day < before.last_review)
    || history.some(item => !item.revertedAt && entry.day < item.day)) fail('review_day_regression');

  const after = nextState(before, entry.day, reviewOutcome(entry));
  const record = {
    id: entry.id,
    at: entry.at,
    day: entry.day,
    assessments: entry.assessments,
    note: entry.note,
    sessionId: entry.sessionId,
    actor: entry.actor,
    before,
    after,
  };
  writeState(fields, after);
  writeHistory(fields, [...history, record]);
  return serializeFrontmatter(fields) + body;
}

/** Undo the most recent evaluation that has not been undone yet. The state on
 * disk must still equal that record's `after`, so a hand correction is never
 * overwritten; the record stays in the history with `revertedAt` for the audit
 * trail and for the calendar to drop the reverted day. */
export function undoReviewContent(document, request = {}) {
  const { fields, body } = parsedCard(document);
  const state = readState(fields, 'review_state_invalid');
  const history = historyOf(fields);

  let index = -1;
  for (let cursor = 0; cursor < history.length; cursor += 1) if (history[cursor].revertedAt === undefined) index = cursor;
  if (index < 0) fail('review_undo_unavailable');

  const record = history[index];
  if (!sameState(state, record.after)) fail('review_state_mismatch');
  const at = stampText(request?.at, 'review_request_invalid');
  const next = history.slice();
  next[index] = { ...record, revertedAt: at };
  writeState(fields, record.before);
  writeHistory(fields, next);
  return serializeFrontmatter(fields) + body;
}

function sameState(left, right) {
  return left.learned === right.learned && left.mastery === right.mastery && left.interval === right.interval
    && left.last_review === right.last_review && left.next_review === right.next_review;
}

function tagsOf(document) {
  const raw = document?.frontmatter?.tags;
  if (!Array.isArray(raw)) return [];
  const tags = [];
  for (const item of raw) {
    const name = asText(item).trim();
    if (name && !tags.includes(name)) tags.push(name);
  }
  return tags;
}

/** A hand-typed tag filter and a stored tag still meet without the leading `#`
 * and without case, but the rows keep the tag text the card actually uses. */
function tagName(raw) {
  if (raw === undefined || raw === null) return '';
  return asText(raw).trim().replace(/^#/, '').toLocaleLowerCase();
}

function requestOffset(value) {
  if (!Number.isInteger(value) || value < 0) fail('review_request_invalid');
  return value;
}

function requestLimit(value) {
  if (!Number.isInteger(value) || value <= 0) fail('review_request_invalid');
  return Math.min(value, MAX_QUEUE_LIMIT);
}

function matchesQuery(row, tokens) {
  if (!tokens.length) return true;
  const haystack = [asText(row.document?.title), asText(row.document?.path), ...row.tags].join('\n').toLocaleLowerCase();
  return matchedQueryTerms(haystack, tokens).length === tokens.length;
}

function inStatus(row, status, today) {
  const { state } = row;
  if (status === 'all') return true;
  if (status === 'pending') return !state.learned;
  if (status === 'due') return state.learned && state.next_review <= today;
  if (status === 'learning') return state.learned && state.mastery < FAMILIAR_MASTERY;
  return state.learned && state.mastery >= FAMILIAR_MASTERY;
}

/** Due date first; a card that has never been evaluated carries no due date
 * and sorts after the dated ones instead of pretending to be due today. */
function queueOrder(left, right) {
  const a = left.state.next_review, b = right.state.next_review;
  if (a !== b) return a === null ? 1 : b === null ? -1 : compareText(a, b);
  return compareText(asText(left.document?.path), asText(right.document?.path));
}

function facetTags(rows) {
  const counts = new Map();
  for (const row of rows) for (const name of row.tags) counts.set(name, (counts.get(name) || 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || compareText(left[0], right[0]))
    .map(entry => entry[0]);
}

/** One page over the cards the Vault can actually schedule. Cards whose review
 * data contradicts itself are reported as invalid instead of being counted as
 * due, pending or familiar, and a non-card document is not a queue row at all. */
export function reviewQueue(documents, { today, query = '', tag = '', status = 'due', offset = 0, limit = 50 } = {}) {
  if (!Array.isArray(documents)) fail('review_documents_invalid');
  validateDay(today);
  if (!STATUSES.includes(status)) fail('review_status_invalid');
  const start = requestOffset(offset), size = requestLimit(limit);
  const tokens = queryTokens(query);
  const wantedTag = tagName(tag);

  const rows = [], invalid = [];
  for (const document of documents) {
    if (!isCard(document)) continue;
    try {
      const state = reviewState(document);
      reviewHistory(document);
      rows.push({ document, state, tags: tagsOf(document) });
    } catch { invalid.push({ path: asText(document?.path) }); }
  }

  const searched = rows.filter(row => matchesQuery(row, tokens));
  const matched = wantedTag
    ? searched.filter(row => row.tags.some(name => tagName(name) === wantedTag))
    : searched;

  const counts = { due: 0, pending: 0, learning: 0, familiar: 0, all: matched.length };
  for (const row of matched) {
    if (!row.state.learned) { counts.pending += 1; continue; }
    if (row.state.next_review <= today) counts.due += 1;
    if (row.state.mastery < FAMILIAR_MASTERY) counts.learning += 1; else counts.familiar += 1;
  }

  const selected = matched.filter(row => inStatus(row, status, today)).sort(queueOrder);
  const hits = selected.slice(start, start + size).map(row => ({
    path: asText(row.document?.path),
    title: asText(row.document?.title),
    revision: asText(row.document?.revision),
    ...(asText(row.document?.ref) ? { ref: row.document.ref } : {}),
    tags: row.tags,
    state: row.state,
  }));
  const consumed = start + hits.length;
  return {
    hits,
    total: selected.length,
    nextOffset: consumed < selected.length ? consumed : null,
    counts,
    tags: facetTags(searched),
    invalid,
    today,
  };
}
