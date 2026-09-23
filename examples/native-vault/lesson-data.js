// Classroom material projections: lesson summaries (`lesson_log`), the
// optional lesson script they are appended to, and the route bench.
//
// Markdown stays the single source of truth. Summary blocks carry their own
// machine metadata and a stable anchor inside the same file, so one projection
// serves writing, reading, the unified log and node jumps. Route pages keep
// their lesson order in frontmatter and never reuse the knowledge graph's
// `split` relation for course sequencing.

import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { validateDay } from './review-data.js';
import { markdownLines, markdownSectionIndex, matchedQueryTerms, queryTokens } from './learning-data.js';
import { appendRouteLogEntry, composeRouteBody, parseRouteBody, routeBriefText, routeIdList, routeOverviewText, routePathwayValue, routeStageText } from './route-plan.js';

// The pathway vocabulary is one list, reused by the CLI schema, the create
// arguments and the persisted node attributes.
export { ROUTE_PATHWAYS } from './route-plan.js';

const SENTINEL = 'notara:lesson-summary';
const BEGIN_LINE = `<!-- ${SENTINEL}`;
const END_LINE = `<!-- ${SENTINEL}:end -->`;
const CLOSE_LINE = '-->';
const BLOCK_HEADING = /^#{1,6}\s*课堂小结(?:\s|$)/;
const CONTINUATION_TITLE = '下次从这里继续';
const CONTINUATION_BUDGET = 600;
const LOG_BUDGET = 20;
const MAX_LOG_LIMIT = 100;

const META_KEYS = ['id', 'session', 'learning-set', 'subjects', 'started-at', 'through-at', 'saved-at', 'route', 'node', 'cutoff', 'title'];
const REQUIRED_META_KEYS = ['id', 'session'];
const ANCHOR_PATTERN = /^ls-[0-9a-f]{16}$/;

const ROUTE_TYPE = 'route';

function fail(code) { throw new Error(code); }
function asText(value) { return typeof value === 'string' ? value : ''; }

function requestOffset(value) {
  if (!Number.isInteger(value) || value < 0) fail('lesson_request_invalid');
  return value;
}

function requestLimit(value, max) {
  if (!Number.isInteger(value) || value <= 0) fail('lesson_request_invalid');
  return Math.min(value, max);
}

/** Values live inside an HTML comment, so the only characters that could
 * inject or truncate a block are the comment delimiters and the sentinel. */
function metaText(value, code = 'lesson_summary_meta_invalid') {
  if (typeof value !== 'string') fail(code);
  if (value.includes(SENTINEL) || value.includes('<!--') || value.includes('-->')) fail(code);
  return value;
}

function optionalMetaText(value, code = 'lesson_summary_meta_invalid') {
  if (value === undefined || value === null) return '';
  return metaText(value, code).trim();
}

function textList(value, code) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(code);
  const items = [];
  for (const raw of value) {
    const item = metaText(raw, code).trim();
    if (!item) fail(code);
    if (!items.includes(item)) items.push(item);
  }
  return items;
}

/** The same relative-path rules the Vault store applies, kept local so this
 * projection stays free of Node-only imports. */
function safeVaultPath(value, code) {
  if (typeof value !== 'string' || !value.length || value.includes('\0') || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) fail(code);
  const parts = value.split('/');
  if (parts.some(part => part === '' || part === '.' || part === '..')) fail(code);
  return parts.join('/');
}

function hash64(value) {
  let left = 0x811c9dc5, right = 0x01000193;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
}

/** The stable block anchor for one real class. It is derived from the native
 * session, so a retried save updates the same block instead of appending a
 * second one, and an edit cannot move the identity. */
export function stableLessonSummaryId(sessionId) {
  const value = metaText(sessionId);
  if (!value.trim()) fail('lesson_summary_meta_invalid');
  return `ls-${hash64(`notara-lesson-summary\n${value}`)}`;
}

function continuationOf(body) {
  const section = markdownSectionIndex(body).find(item => item.title === CONTINUATION_TITLE);
  if (!section) return { text: null, truncated: false };
  const raw = body.slice(section.start, section.end);
  const breakIndex = raw.indexOf('\n');
  const text = (breakIndex < 0 ? '' : raw.slice(breakIndex + 1)).trim();
  if (!text) return { text: null, truncated: false };
  const points = Array.from(text);
  if (points.length <= CONTINUATION_BUDGET) return { text, truncated: false };
  return { text: points.slice(0, CONTINUATION_BUDGET).join(''), truncated: true };
}

function parseLessonMeta(metaLines) {
  const raw = new Map();
  for (const line of metaLines) {
    const separator = line.indexOf(':');
    if (separator <= 0) fail('lesson_summary_meta_invalid');
    const key = line.slice(0, separator).trim();
    if (!META_KEYS.includes(key) || raw.has(key)) fail('lesson_summary_meta_invalid');
    let value;
    try { value = JSON.parse(line.slice(separator + 1).trim()); }
    catch { fail('lesson_summary_meta_invalid'); }
    raw.set(key, value);
  }
  for (const key of REQUIRED_META_KEYS) if (!raw.has(key)) fail('lesson_summary_meta_invalid');

  const id = raw.get('id'), sessionId = raw.get('session');
  if (typeof id !== 'string' || !ANCHOR_PATTERN.test(id)) fail('lesson_summary_meta_invalid');
  if (typeof sessionId !== 'string' || !sessionId.trim()) fail('lesson_summary_meta_invalid');
  const read = key => (raw.has(key) ? metaText(raw.get(key)) : '').trim();
  return {
    id,
    sessionId,
    learningSetRef: read('learning-set'),
    subjects: textList(raw.get('subjects'), 'lesson_summary_meta_invalid'),
    startedAt: read('started-at'),
    throughAt: read('through-at'),
    savedAt: read('saved-at'),
    routePath: read('route'),
    nodeId: read('node'),
    cutoff: read('cutoff'),
    title: read('title'),
  };
}

/** Locate every machine block in one file. A missing end marker, a stray marker
 * or two blocks claiming the same class are reported instead of guessed at. */
function scanLessonBlocks(content) {
  const lines = markdownLines(content);
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index].text.trim();
    if (line !== BEGIN_LINE) {
      if (line.includes(SENTINEL)) fail('lesson_summary_marker_stray');
      index += 1;
      continue;
    }

    const metaLines = [];
    let cursor = index + 1, closed = false;
    for (; cursor < lines.length; cursor += 1) {
      const value = lines[cursor].text.trim();
      if (value === CLOSE_LINE) { closed = true; cursor += 1; break; }
      if (!value || value.includes(SENTINEL)) fail('lesson_summary_meta_invalid');
      metaLines.push(value);
    }
    if (!closed) fail('lesson_summary_block_truncated');

    let endIndex = -1;
    for (let scan = cursor; scan < lines.length; scan += 1) {
      const value = lines[scan].text.trim();
      if (value === END_LINE) { endIndex = scan; break; }
      if (value.includes(SENTINEL)) fail('lesson_summary_marker_stray');
    }
    if (endIndex < 0) fail('lesson_summary_block_truncated');

    const fields = parseLessonMeta(metaLines);
    if (stableLessonSummaryId(fields.sessionId) !== fields.id) fail('lesson_summary_anchor_mismatch');

    const inner = lines.slice(cursor, endIndex).map(item => item.text);
    const first = inner.findIndex(value => value.trim());
    let heading = null, bodyLines = inner;
    if (first >= 0 && BLOCK_HEADING.test(inner[first].trim())) {
      heading = inner[first].trim();
      bodyLines = inner.slice(first + 1);
    }
    const body = bodyLines.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
    const next = lines[endIndex + 1];
    blocks.push({ ...fields, heading, body, start: lines[index].start, end: next ? next.start : lines[endIndex].end });
    index = endIndex + 1;
  }

  const seen = new Set();
  for (const block of blocks) {
    if (seen.has(block.id)) fail('lesson_summary_duplicate_block');
    seen.add(block.id);
  }
  return blocks;
}

function normalizeSummary(summary) {
  if (!summary || typeof summary !== 'object') fail('lesson_summary_meta_invalid');
  const sessionId = metaText(summary.sessionId);
  if (!sessionId.trim()) fail('lesson_summary_meta_invalid');
  const body = typeof summary.body === 'string' ? summary.body.trim() : fail('lesson_summary_body_invalid');
  if (!body || body.includes(SENTINEL)) fail('lesson_summary_body_invalid');
  return {
    id: stableLessonSummaryId(sessionId),
    sessionId,
    learningSetRef: optionalMetaText(summary.learningSetRef),
    subjects: textList(summary.subjects, 'lesson_summary_meta_invalid'),
    startedAt: optionalMetaText(summary.startedAt),
    throughAt: optionalMetaText(summary.throughAt),
    savedAt: optionalMetaText(summary.savedAt),
    routePath: optionalMetaText(summary.routePath),
    nodeId: optionalMetaText(summary.nodeId),
    cutoff: optionalMetaText(summary.cutoff),
    title: optionalMetaText(summary.title),
    body,
  };
}

function summaryHeading(record) {
  const stamp = asText(record.throughAt) || asText(record.startedAt);
  const date = stamp.match(/^\d{4}-\d{2}-\d{2}/);
  return date ? `## 课堂小结 · ${date[0]}` : '## 课堂小结';
}

function summaryBlock(record) {
  return [
    BEGIN_LINE,
    `id: ${JSON.stringify(record.id)}`,
    `session: ${JSON.stringify(record.sessionId)}`,
    `learning-set: ${JSON.stringify(record.learningSetRef)}`,
    `subjects: ${JSON.stringify(record.subjects)}`,
    `started-at: ${JSON.stringify(record.startedAt)}`,
    `through-at: ${JSON.stringify(record.throughAt)}`,
    `saved-at: ${JSON.stringify(record.savedAt)}`,
    `route: ${JSON.stringify(record.routePath)}`,
    `node: ${JSON.stringify(record.nodeId)}`,
    `cutoff: ${JSON.stringify(record.cutoff)}`,
    `title: ${JSON.stringify(record.title)}`,
    CLOSE_LINE,
    summaryHeading(record),
    '',
    record.body,
    '',
    END_LINE,
    '',
  ].join('\n');
}

/**
 * Every classroom summary really written in one file, with the anchor, source
 * identity and continuation text the log needs. The file type only decides
 * whether the record is a script summary or a standalone one.
 */
export function parseLessonSummaries(document) {
  const content = typeof document?.content === 'string' ? document.content : fail('lesson_summary_document_invalid');
  const path = asText(document?.path);
  const revision = asText(document?.revision);
  const documentType = asText(document?.type).trim() || asText(document?.frontmatter?.type).trim() || null;
  const kind = documentType === 'lesson' ? 'script' : 'standalone';
  const fallbackTitle = asText(document?.title);

  return scanLessonBlocks(content).map(block => {
    const continuation = continuationOf(block.body);
    return {
      kind,
      documentType,
      path,
      revision,
      anchor: block.id,
      sessionId: block.sessionId,
      learningSetRef: block.learningSetRef,
      subjects: block.subjects,
      startedAt: block.startedAt,
      throughAt: block.throughAt,
      savedAt: block.savedAt,
      routePath: block.routePath,
      nodeId: block.nodeId,
      cutoff: block.cutoff,
      title: block.title || fallbackTitle,
      heading: block.heading,
      body: block.body,
      continuation: continuation.text,
      ...(continuation.truncated ? { continuationTruncated: true } : {}),
      start: block.start,
      end: block.end,
    };
  });
}

function appendBlock(content, block) {
  if (!content.trim()) return block;
  const separator = content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
  return `${content}${separator}${block}`;
}

/**
 * One class keeps one stable block in a file: a new cutoff for the same native
 * session replaces that block, another session's class appends a new one, and
 * the script text plus every other block — including human edits — stay byte
 * for byte. The Host decides which file this content belongs to; nothing here
 * writes to disk.
 */
export function upsertLessonSummary(existingContent, summary = {}) {
  if (typeof existingContent !== 'string') fail('lesson_summary_content_invalid');
  const record = normalizeSummary(summary);
  const block = summaryBlock(record);
  const matching = scanLessonBlocks(existingContent).filter(item => item.id === record.id);
  if (matching.length > 1) fail('lesson_summary_duplicate_block');
  if (matching.length === 1) {
    const target = matching[0];
    return `${existingContent.slice(0, target.start)}${block}${existingContent.slice(target.end)}`;
  }
  return appendBlock(existingContent, block);
}

function activityOf(entry) {
  const started = asText(entry.startedAt) ? Date.parse(entry.startedAt) : NaN;
  const through = asText(entry.throughAt) ? Date.parse(entry.throughAt) : NaN;
  const startMs = Number.isNaN(started) ? null : started;
  const endMs = Number.isNaN(through) ? startMs : through;
  return { startMs, endMs: endMs ?? startMs };
}

function activityRange(from, to) {
  const read = value => {
    if (value === undefined || value === null || value === '') return null;
    const time = typeof value === 'string' ? Date.parse(value) : NaN;
    if (Number.isNaN(time)) fail('lesson_request_invalid');
    return time;
  };
  const fromMs = read(from), end=read(to),toMs=end!==null&&/^\d{4}-\d{2}-\d{2}$/.test(to)?end+86_400_000-1:end;
  if (fromMs === null && toMs === null) return null;
  if (fromMs !== null && toMs !== null && fromMs > toMs) fail('lesson_request_invalid');
  return { fromMs, toMs };
}

/**
 * Unified `lesson_log` index over both summary places. One real class appears
 * once (native session + learning set), activity time comes from the recorded
 * range, and a class whose subject was never recorded is only left out when the
 * caller filters by a subject — it is never assigned one.
 */
export function lessonLog(documents = [], { from, to, learningSetRef, subject, query, offset = 0, limit = LOG_BUDGET } = {}) {
  if (!Array.isArray(documents)) fail('lesson_documents_invalid');
  const start = requestOffset(offset), size = requestLimit(limit, MAX_LOG_LIMIT);
  const range = activityRange(from, to);
  const setFilter = asText(learningSetRef).trim();
  const subjectFilter = asText(subject).trim().toLocaleLowerCase();
  const tokens = queryTokens(query);

  const entries = [], skipped = [];
  for (const document of documents) {
    let summaries;
    try { summaries = parseLessonSummaries(document); }
    catch (error) {
      skipped.push({ path: asText(document?.path), reason: error instanceof Error ? error.message : 'lesson_summary_invalid' });
      continue;
    }
    for (const summary of summaries) {
      if (!summary.sessionId) continue;
      if (setFilter && summary.learningSetRef !== setFilter) continue;
      if (subjectFilter && !summary.subjects.some(value => value.toLocaleLowerCase() === subjectFilter)) continue;
      const activity = activityOf(summary);
      if (range) {
        if (activity.startMs === null && activity.endMs === null) continue;
        const first = activity.startMs ?? activity.endMs, last = activity.endMs ?? activity.startMs;
        if (range.fromMs !== null && last < range.fromMs) continue;
        if (range.toMs !== null && first > range.toMs) continue;
      }
      if (tokens.length) {
        const haystack = [summary.title, summary.body, summary.continuation ?? '', summary.subjects.join(' '), summary.learningSetRef].join('\n').toLocaleLowerCase();
        if (!matchedQueryTerms(haystack, tokens).length) continue;
      }
      entries.push({ ...summary, ...activity });
    }
  }

  const unique = new Map();
  for (const entry of entries) {
    const key = `${entry.sessionId}\u0000${entry.learningSetRef}`;
    if (!unique.has(key)) unique.set(key, entry);
  }
  const records = [...unique.values()].sort((left, right) => {
    const leftTime = left.endMs ?? left.startMs ?? Number.NEGATIVE_INFINITY;
    const rightTime = right.endMs ?? right.startMs ?? Number.NEGATIVE_INFINITY;
    if (leftTime !== rightTime) return rightTime - leftTime;
    if (left.path !== right.path) return left.path < right.path ? -1 : 1;
    return left.anchor < right.anchor ? -1 : left.anchor > right.anchor ? 1 : 0;
  });

  const hits = records.slice(start, start + size).map(entry => ({
    kind: entry.kind,
    documentType: entry.documentType,
    path: entry.path,
    revision: entry.revision,
    anchor: entry.anchor,
    sessionId: entry.sessionId,
    learningSetRef: entry.learningSetRef,
    subjects: entry.subjects,
    startedAt: entry.startedAt,
    throughAt: entry.throughAt,
    savedAt: entry.savedAt,
    routePath: entry.routePath,
    nodeId: entry.nodeId,
    cutoff: entry.cutoff,
    title: entry.title,
    continuation: entry.continuation,
    ...(entry.continuationTruncated ? { continuationTruncated: true } : {}),
  }));
  const consumed = start + hits.length;
  return {
    hits,
    nextOffset: consumed < records.length ? consumed : null,
    total: records.length,
    ...(skipped.length ? { skipped } : {}),
  };
}

function routeId(value) {
  if (typeof value !== 'string') fail('lesson_route_node_invalid');
  const id = value.trim();
  if (!id || /[\r\n]/.test(id)) fail('lesson_route_node_invalid');
  return id;
}

function routeText(value, code) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || /[\r\n]/.test(value)) fail(code);
  return value.trim();
}

/** The persisted machine attributes of one lesson node. A brief is not one of
 * them: its only persistent place is the node's block in the page body, so a
 * frontmatter entry that repeats it is refused instead of silently winning or
 * losing against the block. */
const ROUTE_NODE_KEYS = Object.freeze(['id', 'title', 'parent', 'materials', 'scriptPath', 'sessionId', 'scheduledOn', 'stage', 'pathway', 'prerequisites']);

/** Nodes keep exactly the declared shape; ids and material paths are Host or
 * migration input, so an unusable value is rejected instead of repaired, and an
 * attribute this projection does not know is rejected instead of being dropped
 * on the next write. */
function routeNodes(lessons, { brief = false } = {}) {
  if (lessons === undefined || lessons === null) return [];
  if (!Array.isArray(lessons)) fail('lesson_route_lessons_invalid');
  return lessons.map(raw => {
    if (typeof raw === 'string') {
      const id = routeId(raw);
      return { id, title: id, parent: null, materials: [], stage: '', pathway: 'main', prerequisites: [], brief: '' };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('lesson_route_lessons_invalid');
    for (const key of Object.keys(raw)) {
      if (key === 'brief') {
        if (!brief) fail('lesson_route_brief_location');
        continue;
      }
      if (!ROUTE_NODE_KEYS.includes(key)) fail('lesson_route_node_unknown_field');
    }
    const id = routeId(raw.id);
    const parent = raw.parent === undefined || raw.parent === null || raw.parent === '' ? null : routeId(raw.parent);
    const materials = (Array.isArray(raw.materials) ? raw.materials : raw.materials === undefined || raw.materials === null ? [] : fail('lesson_route_lessons_invalid'))
      .map(material => safeVaultPath(material, 'lesson_route_lessons_invalid'));
    const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : id;
    const node = {
      id,
      title,
      parent,
      materials,
      stage: routeStageText(raw.stage),
      pathway: routePathwayValue(raw.pathway),
      prerequisites: routeIdList(raw.prerequisites, 'lesson_route_prerequisite_invalid'),
      brief: brief ? routeBriefText(raw.brief) : '',
    };
    const scriptPath = routeText(raw.scriptPath, 'lesson_route_lessons_invalid');
    if (scriptPath) node.scriptPath = safeVaultPath(scriptPath, 'lesson_route_lessons_invalid');
    const sessionId = routeText(raw.sessionId, 'lesson_route_lessons_invalid');
    if (sessionId) node.sessionId = sessionId;
    if (raw.scheduledOn !== undefined && raw.scheduledOn !== null && raw.scheduledOn !== '') node.scheduledOn = validateDay(raw.scheduledOn);
    return node;
  });
}

/**
 * Route relations only ever mean "after": a node's parent edge and its
 * prerequisite edges are walked together, so a parent chain that loops back
 * through a prerequisite is refused as the one illegal cycle it is. A
 * prerequisite is a teaching order, never a mastery lock.
 */
export function validateRouteNodes(nodes) {
  const ids = new Set();
  for (const node of nodes) {
    if (ids.has(node.id)) fail('lesson_route_duplicate_node');
    ids.add(node.id);
  }
  for (const node of nodes) {
    if (node.parent === node.id) fail('lesson_route_self_parent');
    if (node.parent && !ids.has(node.parent)) fail('lesson_route_missing_parent');
    if (node.pathway !== 'main' && !node.parent) fail('lesson_route_parent_invalid');
    for (const id of node.prerequisites) {
      if (id === node.id) fail('lesson_route_prerequisite_invalid');
      if (!ids.has(id)) fail('lesson_route_prerequisite_missing');
    }
  }
  const forward = new Map(nodes.map(node => [node.id, []]));
  for (const node of nodes) {
    if (node.parent) forward.get(node.parent).push(node.id);
    for (const id of node.prerequisites) forward.get(id).push(node.id);
  }
  const state = new Map();
  const walk = id => {
    const mark = state.get(id);
    if (mark === 'open') fail('lesson_route_cycle');
    if (mark === 'done') return;
    state.set(id, 'open');
    for (const next of forward.get(id)) walk(next);
    state.set(id, 'done');
  };
  for (const node of nodes) walk(node.id);
}

/** Parent edges are the course sequence; a node that branches off says so, and
 * a prerequisite is its own relation instead of a fake parent. */
function routeEdges(nodes) {
  const edges = [];
  for (const node of nodes) {
    if (node.parent) edges.push({ source: node.parent, target: node.id, kind: node.pathway === 'main' ? 'sequence' : 'branch' });
  }
  for (const node of nodes) for (const id of node.prerequisites) edges.push({ source: id, target: node.id, kind: 'prerequisite' });
  return edges;
}

function routeTitle(frontmatter, document) {
  const declared = asText(frontmatter.title).trim();
  if (declared) return declared;
  const parsed = asText(document?.title).trim();
  if (parsed) return parsed;
  const name = asText(document?.path).split('/').pop() ?? '';
  return name.replace(/\.md$/i, '');
}

/** The page body: the shared reader keeps the raw text and the frontmatter, so
 * the body is split here rather than read as a second dialect. */
function routeBody(document) {
  if (typeof document?.body === 'string') return document.body;
  if (typeof document?.content !== 'string') return '';
  return parseFrontmatter(document.content).body;
}

/**
 * Route projection for the route bench: declared lesson nodes plus the
 * sequence/branch/prerequisite edges between them, the course overview and each
 * node's brief. Lesson order and course sequencing live here only — they are
 * never projected as knowledge-graph splits.
 */
export function parseRoute(document) {
  const frontmatter = document?.frontmatter;
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) fail('lesson_route_document_invalid');
  // `lessons` comes from the shared flat frontmatter reader, which reads a
  // single-line JSON node list; no second YAML dialect lives here.
  if ((asText(frontmatter.type).trim() || asText(document?.type).trim()) !== ROUTE_TYPE) fail('lesson_route_type_required');
  const nodes = routeNodes(frontmatter.lessons);
  validateRouteNodes(nodes);
  const plan = parseRouteBody(routeBody(document));
  const blocks = new Map(plan.blocks.map(block => [block.id, block]));
  for (const node of nodes) node.brief = blocks.get(node.id)?.brief ?? '';
  return {
    path: asText(document?.path),
    revision: asText(document?.revision),
    title: routeTitle(frontmatter, document),
    overview: plan.overview,
    nodes,
    edges: routeEdges(nodes),
  };
}

/**
 * Write a route page: accurate frontmatter with the declared machine fields,
 * the node list in the caller's order, and the body as the teacher left it —
 * the overview, every brief in its own block, and the change log. Reordering
 * nodes, scheduling a lesson or binding a class therefore never rewrites one
 * node's brief into another's, and a block this projection did not write is
 * kept byte for byte. The page is serialized by the shared frontmatter module —
 * plain scalars stay plain, the node list becomes a single-line JSON array — so
 * it round-trips through `parseFrontmatter` and `parseRoute`.
 */
export function renderRoute({ title, nodes, overview, logEntry } = {}, previousContent) {
  const name = asText(title).trim();
  if (!name) fail('lesson_route_title_required');
  const previous = typeof previousContent === 'string' ? parseFrontmatter(previousContent) : null;
  const plan = parseRouteBody(previous ? previous.body.replace(/^\n+/, '') : '');
  const oldBriefs=new Map(plan.blocks.map(block=>[block.id,block.brief]));
  const input=Array.isArray(nodes)?nodes.map(node=>node&&typeof node==='object'&&node.brief===undefined&&oldBriefs.has(node.id)?{...node,brief:oldBriefs.get(node.id)}:node):nodes;
  const list = routeNodes(input, { brief: true });
  validateRouteNodes(list);

  // The previous page is read by the shared parser: its other properties and
  // its body are kept, and a page it cannot parse fails loudly.
  const frontmatter = previous ? { ...previous.frontmatter } : { type: ROUTE_TYPE, status: 'draft', tags: [] };
  frontmatter.type = ROUTE_TYPE;
  frontmatter.title = name;
  frontmatter.lessons = list.map(node => ({
    id: node.id,
    title: node.title,
    ...(node.parent ? { parent: node.parent } : {}),
    materials: [...node.materials],
    ...(node.stage ? { stage: node.stage } : {}),
    ...(node.pathway === 'main' ? {} : { pathway: node.pathway }),
    ...(node.prerequisites.length ? { prerequisites: [...node.prerequisites] } : {}),
    ...(node.scriptPath ? { scriptPath: node.scriptPath } : {}),
    ...(node.sessionId ? { sessionId: node.sessionId } : {}),
    ...(node.scheduledOn ? { scheduledOn: node.scheduledOn } : {}),
  }));

  const text = overview === undefined || overview === null ? plan.overview : routeOverviewText(overview);
  const body = composeRouteBody({
    overview: text.trim() ? text : `# ${name}`,
    nodes: list,
    plan,
    replaceOverview:overview!==undefined&&overview!==null,
    ...(logEntry === undefined ? {} : { log: appendRouteLogEntry(plan.log, logEntry) }),
  });
  return `${serializeFrontmatter(frontmatter)}${body}`;
}
