// Bounded read-side projections for the two long-term teaching memories
// (learner profile + insight) and for reading one real section of any Vault
// Markdown file.
//
// Everything here is derived from the documents the caller was allowed to read:
// no cache, no table, no write path. Markdown stays the single source of truth,
// and the Host decides which documents exist in the input at all.
//
// These functions deliberately return evidence — the real title, type, recall
// text, tags, revision and offsets — and never a relevance or teaching-quality
// claim. Ordering by matched terms is a candidate-generation hint for the
// teaching Agent to filter semantically; "本页没有命中" never means "学生没有
// 这段经历".

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const HAN = /[\u3040-\u30ff\u3400-\u9fff]/;
const TOKEN_SPLIT = /[\s,，、;；|/\\()[\]{}"'“”‘’!！?？:：.。…~@#$%^&*+=<>_-]+/;

const RECALL_TITLE = '何时想起';
const RECALL_BUDGET = 180;
const READ_BUDGET = 4000;
const FIND_BUDGET = 6;
const MAX_FIND_LIMIT = 50;
const MAX_TOKENS = 8;

const PROFILE_TYPE = 'learner-profile';
const INSIGHT_TYPE = 'insight';
const KIND_TYPE = { profile: PROFILE_TYPE, insight: INSIGHT_TYPE };
const TYPE_KIND = { [PROFILE_TYPE]: 'profile', [INSIGHT_TYPE]: 'insight' };

function fail(code) { throw new Error(code); }
function asText(value) { return typeof value === 'string' ? value : ''; }

function requestOffset(value) {
  if (!Number.isInteger(value) || value < 0) fail('learning_request_invalid');
  return value;
}

function requestLimit(value, max) {
  if (!Number.isInteger(value) || value <= 0) fail('learning_request_invalid');
  return Math.min(value, max);
}

/** Lines with their exact character range, so section and page offsets stay
 * real offsets into the file the caller will edit. */
export function markdownLines(content) {
  const text = asText(content);
  const lines = [], pattern = /\r?\n/g;
  let start = 0, match;
  while ((match = pattern.exec(text))) {
    lines.push({ text: text.slice(start, match.index), start, end: match.index });
    start = match.index + match[0].length;
  }
  lines.push({ text: text.slice(start), start, end: text.length });
  return lines;
}

/** Headings with their character ranges. Keys follow the Vault asset locator
 * convention (`标题`, then `标题#2`) so a section returned here can be used
 * with the existing anchor lookups; a repeated heading therefore gets its own
 * stable key instead of being merged. */
export function markdownSectionIndex(content) {
  const text = asText(content), sections = [], seen = new Map();
  let fenced = false;
  for (const [index, line] of markdownLines(text).entries()) {
    if (FENCE.test(line.text)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const match = line.text.match(HEADING);
    if (!match) continue;
    const title = match[2].trim();
    const count = (seen.get(title) ?? 0) + 1;
    seen.set(title, count);
    sections.push({ key: count === 1 ? title : `${title}#${count}`, title, level: match[1].length, line: index + 1, start: line.start, end: text.length });
  }
  for (const [index, section] of sections.entries()) {
    const next = sections[index + 1];
    if (next) section.end = next.start;
  }
  return sections;
}

/** The recall text is the original `## 何时想起` passage, never a separate
 * model summary: it is what the projection shows a candidate by. */
function recallOf(content) {
  const section = markdownSectionIndex(content).find(item => item.title === RECALL_TITLE);
  if (!section) return null;
  const raw = content.slice(section.start, section.end);
  const breakIndex = raw.indexOf('\n');
  const text = (breakIndex < 0 ? '' : raw.slice(breakIndex + 1)).trim();
  return text || null;
}

function tagsOf(document) {
  const raw = document?.frontmatter?.tags;
  if (!Array.isArray(raw)) return [];
  const tags = [];
  for (const item of raw) {
    const value = asText(item).trim();
    if (value && !tags.includes(value)) tags.push(value);
  }
  return tags;
}

function typeOf(document) {
  return asText(document?.type).trim() || asText(document?.frontmatter?.type).trim();
}

function boundCodePoints(text, limit) {
  const points = Array.from(text);
  if (points.length <= limit) return { text, truncated: false };
  return { text: points.slice(0, limit).join(''), truncated: true };
}

/** A query may carry several related expressions. Chinese questions usually
 * arrive without spaces, so a longer Han token that the haystack does not
 * contain literally is still a candidate when enough of its bigrams do; the
 * teaching Agent, not this projection, decides what actually matches. */
export function queryTokens(query) {
  const seen = new Set(), tokens = [];
  for (const raw of asText(query).split(TOKEN_SPLIT)) {
    const token = raw.trim().toLocaleLowerCase();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
    if (tokens.length >= MAX_TOKENS) break;
  }
  return tokens;
}

function bigramsOf(token) {
  if (token.length < 4 || !HAN.test(token)) return [];
  const grams = new Set();
  for (let index = 0; index + 2 <= token.length; index += 1) grams.add(token.slice(index, index + 2));
  return [...grams];
}

export function matchedQueryTerms(haystack, tokens) {
  const matched = [];
  for (const token of tokens) {
    if (haystack.includes(token)) { matched.push(token); continue; }
    const grams = bigramsOf(token);
    if (grams.length && grams.filter(gram => haystack.includes(gram)).length >= 2) matched.push(token);
  }
  return matched;
}

const compareText = (left, right) => left === right ? 0 : left < right ? -1 : 1;

/**
 * Bounded candidate index over the learner profile and insight records.
 *
 * `documents` are records produced by `parseMarkdownDocument`. Entries that are
 * not one of the two memory types — including media assets handed in by
 * mistake — are skipped, never read as teaching memory.
 */
export function findLearning(documents, { query = '', kind, offset = 0, limit = FIND_BUDGET } = {}) {
  if (!Array.isArray(documents)) fail('learning_documents_invalid');
  const wanted = kind === undefined || kind === null || kind === '' ? null : Object.hasOwn(KIND_TYPE, kind) ? KIND_TYPE[kind] : fail('learning_kind_invalid');
  const start = requestOffset(offset), size = requestLimit(limit, MAX_FIND_LIMIT);
  const tokens = queryTokens(query);

  const records = [];
  for (const document of documents) {
    const type = typeOf(document);
    if (!Object.hasOwn(TYPE_KIND, type)) continue;
    if (wanted && type !== wanted) continue;
    const content = asText(document?.content);
    if (!content) continue;
    const recall = recallOf(content);
    const tags = tagsOf(document);
    const haystack = [asText(document?.title), recall ?? '', tags.join(' '), content].join('\n').toLocaleLowerCase();
    const matched = matchedQueryTerms(haystack, tokens);
    if (tokens.length && !matched.length) continue;
    records.push({ path: asText(document?.path), revision: asText(document?.revision), title: asText(document?.title), type, kind: TYPE_KIND[type], recall, tags, matched, content });
  }

  const order = (left, right) => right.matched.length - left.matched.length
    || compareText(left.title, right.title)
    || compareText(left.path, right.path);
  if (tokens.length) records.sort(order);
  else records.sort((left, right) => compareText(left.title, right.title) || compareText(left.path, right.path));

  const hits = records.slice(start, start + size).map(record => {
    const recall = record.recall ? boundCodePoints(record.recall, RECALL_BUDGET) : null;
    return {
      path: record.path,
      revision: record.revision,
      title: record.title,
      type: record.type,
      kind: record.kind,
      recall: recall ? recall.text : null,
      ...(recall?.truncated ? { recallTruncated: true } : {}),
      tags: record.tags,
      terms: tokens,
      matchedTerms: record.matched,
    };
  });
  const consumed = start + hits.length;
  return { hits, nextOffset: consumed < records.length ? consumed : null, total: records.length };
}

/**
 * Bounded read of one real section of a Markdown file, with the section table
 * the caller used to get there. `content` is the original text of the selected
 * range; `nextOffset` continues inside that same range, and a returned page
 * always says whether more text follows instead of pretending to be complete.
 */
export function readLearningSection(document, { section, offset = 0, limit = READ_BUDGET } = {}) {
  const content = typeof document?.content === 'string' ? document.content : fail('learning_document_invalid');
  const sections = markdownSectionIndex(content);
  const wanted = section === undefined || section === null || section === '' ? null : asText(section).trim() || null;
  const start = requestOffset(offset), size = requestLimit(limit, READ_BUDGET);

  let range = { start: 0, end: content.length }, located = null;
  if (wanted) {
    located = sections.find(item => item.key === wanted) ?? null;
    if (!located) fail('learning_section_not_found');
    range = { start: located.start, end: located.end };
  }

  const points = Array.from(content.slice(range.start, range.end));
  const page = points.slice(start, start + size).join('');
  const consumed = Math.min(size, Math.max(0, points.length - start));
  const nextOffset = start + consumed < points.length ? start + consumed : null;
  return {
    path: asText(document?.path),
    revision: asText(document?.revision),
    title: asText(document?.title),
    type: typeOf(document) || null,
    content: page,
    sections,
    nextOffset,
    length: points.length,
    truncated: nextOffset !== null,
    section: located ? { key: located.key, title: located.title, level: located.level, line: located.line } : null,
  };
}
