// Route page body: the human-read half of a `type: route` Markdown page.
//
// A route page carries machine fields in frontmatter (`lessons`) and the
// teacher's own words in the same file: one course overview outside the blocks,
// one stable block per lesson node holding that node's brief, and one change log
// block the Host appends to. A block is addressed by the node id it was written
// for, so reordering nodes, scheduling a lesson or opening a class keeps every
// brief attached to its own node instead of rewriting the page's prose.
//
// The block layout is the only place a brief is persisted; frontmatter holds
// sequencing and grouping only, never the same text twice. Nothing here reads
// the Vault, resolves a path, generates an identity or writes a file: the
// projection in `lesson-data.js` reads these helpers and the Host owns the
// write. A page written before these blocks existed has no marker at all, so its
// whole free body is returned as the overview and kept as the teacher left it.

import { markdownLines } from './learning-data.js';

export const ROUTE_PATHWAYS = Object.freeze(['main', 'remedial', 'extension']);
export const ROUTE_NODE_MARKER = 'notara:route-node';
export const ROUTE_LOG_MARKER = 'notara:route-log';
export const ROUTE_STAGE_MAX = 120;
export const ROUTE_BRIEF_MAX = 12000;
export const ROUTE_OVERVIEW_MAX = 24000;
export const ROUTE_REASON_MAX = 2000;

const NODE_BEGIN = /^<!--\s*notara:route-node\s+(.*\S)\s*-->$/;
const NODE_END = `<!-- ${ROUTE_NODE_MARKER}:end -->`;
const LOG_BEGIN = `<!-- ${ROUTE_LOG_MARKER} -->`;
const LOG_END = `<!-- ${ROUTE_LOG_MARKER}:end -->`;
const HEADING = /^#{1,6}\s+(\S.*)$/;
const MARKERS = [ROUTE_NODE_MARKER, ROUTE_LOG_MARKER];

const fail = code => { throw new Error(code); };
const asText = value => (typeof value === 'string' ? value : '');

/** A value that named a marker would be read back as a block boundary, so such
 * text is refused instead of escaped. Ordinary HTML comments stay allowed: they
 * cannot close a block this parser matches by its own exact marker line. */
function sentinelFree(value, code) {
  if (MARKERS.some(marker => value.includes(marker))) fail(code);
  return value;
}

/** A node group name: one line, short, and free of marker text. */
export function routeStageText(value, code = 'lesson_route_stage_invalid') {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > ROUTE_STAGE_MAX || /[\r\n]/.test(value)) fail(code);
  return sentinelFree(value, code).trim();
}

/** `main` is the real default of every route written before pathways existed. */
export function routePathwayValue(value, code = 'lesson_route_pathway_invalid') {
  if (value === undefined || value === null || value === '') return 'main';
  if (typeof value !== 'string' || !ROUTE_PATHWAYS.includes(value)) fail(code);
  return value;
}

export function routeBriefText(value, code = 'lesson_route_brief_invalid') {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > ROUTE_BRIEF_MAX) fail(code);
  return sentinelFree(value, code).trim();
}

export function routeOverviewText(value, code = 'lesson_route_overview_invalid') {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > ROUTE_OVERVIEW_MAX) fail(code);
  return sentinelFree(value, code).replace(/^\n+/, '').replace(/\s+$/, '');
}

/** The change-log line a revision writes: the date and reason are Host input,
 * and the affected node titles are only listed when a node really changed. */
export function routeLogEntry({ date, reason, titles = [] } = {}) {
  const day = asText(date).trim();
  const text = routeReasonText(reason);
  const affected = (Array.isArray(titles) ? titles : []).map(title => asText(title).split(/\s*\n\s*/).join(' ').trim()).filter(Boolean);
  return affected.length ? `- ${day} · 原因：${text} · 影响：${affected.join('、')}` : `- ${day} · 原因：${text}`;
}

export function routeReasonText(value, code = 'lesson_route_reason_invalid') {
  if (typeof value !== 'string') fail(code);
  const text = value.trim();
  if (!text || text.length > ROUTE_REASON_MAX || /[\r\n]/.test(text)) fail(code);
  return sentinelFree(text, code);
}

/** The same rule for one prerequisite list, kept here so the persisted ids and
 * the revision input ids are validated by one contract. */
export function routeIdList(value, code) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(code);
  const ids = [];
  for (const raw of value) {
    if (typeof raw !== 'string') fail(code);
    const id = raw.trim();
    if (!id || /[\r\n]/.test(id)) fail(code);
    if (ids.includes(id)) fail(code);
    ids.push(id);
  }
  return ids;
}

function blockOf(id, lines, raw) {
  const first = lines.findIndex(value => value.trim());
  const heading = first < 0 ? null : (lines[first].trim().match(HEADING)?.[1] ?? null);
  const rest = first < 0 ? [] : heading ? lines.slice(first + 1) : lines.slice(first);
  return { id, heading, brief: rest.join('\n').trim(), text: raw };
}

/**
 * One page body split into its course overview, its node blocks and its change
 * log. A marker that could not be opened, closed or repeated fails loudly: a
 * half-read page would otherwise be written back as a page the teacher never
 * wrote.
 */
export function parseRouteBody(content) {
  const text = asText(content);
  const lines = markdownLines(text);
  const overviewLines = [], blocks = [], logLines = [];
  let log = null, logRange = null, logSeen = false, index = 0;

  const stray = value => value.includes(ROUTE_NODE_MARKER) || value.includes(ROUTE_LOG_MARKER);

  while (index < lines.length) {
    const line = lines[index].text.trim();
    const begin = line.match(NODE_BEGIN);
    if (begin) {
      let payload;
      try { payload = JSON.parse(begin[1]); }
      catch { fail('lesson_route_marker_stray'); }
      if (typeof payload !== 'string' || !payload.trim() || /[\r\n]/.test(payload)) fail('lesson_route_marker_stray');
      const inner = [];
      let cursor = index + 1, closed = false;
      for (; cursor < lines.length; cursor += 1) {
        const value = lines[cursor].text.trim();
        if (value === NODE_END) { closed = true; cursor += 1; break; }
        if (stray(value)) fail('lesson_route_marker_stray');
        inner.push(lines[cursor].text.replace(/\r$/, ''));
      }
      if (!closed) fail('lesson_route_block_truncated');
      blocks.push({...blockOf(payload.trim(), inner, text.slice(lines[index].start, lines[cursor - 1].end)),start:lines[index].start,end:lines[cursor-1].end});
      index = cursor;
      continue;
    }
    if (line === LOG_BEGIN) {
      if (logSeen) fail('lesson_route_duplicate_block');
      let cursor = index + 1, closed = false;
      for (; cursor < lines.length; cursor += 1) {
        const value = lines[cursor].text.trim();
        if (value === LOG_END) { closed = true; cursor += 1; break; }
        if (stray(value)) fail('lesson_route_marker_stray');
        logLines.push(lines[cursor].text.replace(/\r$/, ''));
      }
      if (!closed) fail('lesson_route_block_truncated');
      logSeen = true;
      log = logLines.join('\n').trim() || '';
      logRange={start:lines[index].start,end:lines[cursor-1].end};
      index = cursor;
      continue;
    }
    if (line === NODE_END || line === LOG_END || stray(line)) fail('lesson_route_marker_stray');
    overviewLines.push(lines[index].text.replace(/\r$/, ''));
    index += 1;
  }

  const seen = new Set();
  for (const block of blocks) {
    if (seen.has(block.id)) fail('lesson_route_duplicate_block');
    seen.add(block.id);
  }
  return { overview: overviewLines.join('\n').trim(), blocks, log,logRange,source:text };
}

/** The log is one Markdown line per revision; an empty or absent block is no
 * history at all, never a fabricated entry. */
export function parseRouteLog(log) {
  return asText(log).split('\n').map(line => line.replace(/\s+$/, '').trim()).filter(Boolean);
}

export function appendRouteLogEntry(log, entry) {
  const lines = parseRouteLog(log);
  const value = asText(entry).trim();
  if (value) lines.push(value);
  return lines.join('\n');
}

/** One heading for one node, so a written heading and the heading read back are
 * compared by exactly the rule that produced it. */
export function routeBlockHeading(title, id) {
  const nodeId = asText(id).trim();
  return asText(title).replace(/\s+/g, ' ').trim() || nodeId;
}

/** The canonical block for one node: the id it belongs to, its title and its
 * brief. A node with no brief and no earlier block gets no block at all, so a
 * pre-block route page is not rewritten just because it was read. */
export function routeNodeBlock({ id, title, brief } = {}) {
  const nodeId = asText(id).trim();
  if (!nodeId || /[\r\n]/.test(nodeId)) fail('lesson_route_node_invalid');
  const heading = routeBlockHeading(title, nodeId);
  const text = routeBriefText(brief);
  const lines = [`<!-- ${ROUTE_NODE_MARKER} ${JSON.stringify(nodeId)} -->`, `## ${heading}`];
  if (text) lines.push('', text);
  lines.push('', NODE_END);
  return lines.join('\n');
}

export function routeLogBlock(log) {
  const lines = parseRouteLog(log);
  return [`<!-- ${ROUTE_LOG_MARKER} -->`, ...lines, LOG_END].join('\n');
}

/**
 * Existing pages are edited at owned block ranges, preserving free prose and
 * historical logs. New pages or explicit overview replacements compose the
 * overview, node blocks and log; blocks outside the caller's node list survive.
 */
export function composeRouteBody({ overview, nodes = [], plan = null, log,replaceOverview=false } = {}) {
  // A scheduling or class-binding write is not permission to move free prose
  // around the document. Edit only owned blocks; preserve intervening text and
  // original block order unless the overview was explicitly replaced.
  if(plan?.source&&!replaceOverview){
    const prior=new Map(plan.blocks.map(block=>[block.id,block])),edits=[],added=[];
    for(const node of nodes){
      const block=prior.get(node.id),brief=asText(node.brief).trim(),heading=routeBlockHeading(node.title,node.id);
      if(block){
        if(block.brief!==brief||block.heading!==heading)edits.push({start:block.start,end:block.end,text:routeNodeBlock({...node,brief})});
      }else if(brief)added.push(routeNodeBlock({...node,brief}));
    }
    if(plan.logRange){
      if(log!==undefined||added.length){
        const tail=log===undefined?plan.source.slice(plan.logRange.start,plan.logRange.end):routeLogBlock(log);
        edits.push({...plan.logRange,text:[...added,tail].join('\n\n')});
      }
    }else{
      const tail=[...added,...(log!==undefined&&asText(log).trim()?[routeLogBlock(log)]:[])];
      if(tail.length)edits.push({start:plan.source.length,end:plan.source.length,text:'\n\n'+tail.join('\n\n')+'\n'});
    }
    let result=plan.source;
    for(const edit of edits.sort((a,b)=>b.start-a.start))result=result.slice(0,edit.start)+edit.text+result.slice(edit.end);
    return result;
  }
  const parts = [];
  const text = asText(overview).replace(/^\n+/, '').replace(/\s+$/, '');
  if (text) parts.push(text);

  const previous = new Map((plan?.blocks ?? []).map(block => [block.id, block]));
  const covered = new Set();
  for (const node of nodes) {
    const prior = previous.get(node.id);
    if (prior) covered.add(node.id);
    const brief = asText(node.brief).trim();
    const heading = routeBlockHeading(node.title, node.id);
    // A block that already describes this node is kept byte for byte: an
    // unrelated write (a date, a class binding, a reorder) never reformats prose
    // this projection did not write. A changed brief or heading is re-rendered
    // canonically, and a node without any brief gets no empty block.
    if (prior && prior.brief === brief && prior.heading === heading) parts.push(prior.text);
    else if (brief) parts.push(routeNodeBlock({ id: node.id, title: node.title, brief }));
    else if (prior) parts.push(routeNodeBlock({ id: node.id, title: node.title, brief: '' }));
  }
  for (const block of plan?.blocks ?? []) if (!covered.has(block.id)) parts.push(block.text);

  const logText = log === undefined ? plan?.log : log;
  if (asText(logText).trim()) parts.push(routeLogBlock(logText));
  return parts.length ? `${parts.join('\n\n')}\n` : '';
}
