import { parseFrontmatter } from './frontmatter.js';
import { embedTarget, mediaForPath, parseMediaTarget } from './media.js';

// The graph is a pure projection of the vault files: no table, no cache and no
// write path. It therefore runs unchanged in the browser bundle, which is why
// this module must not import anything from `node:*`.
//
// Node and edge endpoints are bare vault paths. The client keeps one Map keyed
// by path, so `page:` / `asset:` prefixes would only duplicate that lookup.

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const EMBED = /!\[\[([^\]]+)\]\]/g;
const EXCERPT_LENGTH = 160;
const CARD_TYPE = 'card';
// 锦囊 keeps the card identity (it can be split into sub-cards) but its own
// type, so the projection and the UI label it without guessing from the title.
const INSIGHT_TYPE = 'insight';
const KNOWLEDGE_CARD_TYPES = new Set([CARD_TYPE, INSIGHT_TYPE]);
// The two material types are the vault's own teaching material. `source` mirrors
// the original book: one page per chapter or section, its embeds carrying the
// real PDF pages. `topic` is the teacher's own summary of a subject across
// books. Both stay plain Markdown with no review lifecycle, both may hold child
// cards, and neither is ever counted as one — a topic must not look like the
// book's own table of contents, nor a book chapter like a teacher's topic.
const SOURCE_TYPE = 'source';
const TOPIC_TYPE = 'topic';
export const MATERIAL_TYPES = Object.freeze(new Set([SOURCE_TYPE, TOPIC_TYPE]));
// Plan documents describe 课序/备课. Their embeds point at material the class
// will use, so the edge is a reference: a route listing a PDF must never make
// that PDF look like a content child of the plan page, and plan relations never
// enter the knowledge split depth or the child-card count.
const PLAN_TYPES = new Set(['route', 'lesson', 'lesson-summary', 'lesson-board']);
// The graph's adjacency is exactly these two directed relations; traversal and
// slicing both read them as undirected reachability.
const RELATION_KINDS = new Set(['split', 'reference']);

// Lines the card writer adds for machine provenance; they are never excerpt
// material, whether or not the card also carries a human quote.
const PROTOCOL_LINE = /^[-*+]?\s*(文件|版本|页码|选区|区域|来源|摘录|父卡)\s*[:：]/;
// A section title labels the card, it is never preview text: the preview shows
// the fact the card was written from.
const SECTION_LABEL = /^#{1,6}\s*(?:内容|参考理解|学生理解|来源定位|原文摘录|原始区域|我的批注)\s*$/;
const COMMENT_OPEN = /<!--/, COMMENT_CLOSE = /-->/;
const DETAILS_OPEN = /^\s*<details\b/i, DETAILS_CLOSE = /^\s*<\/details\s*>/i;
// The fact sections of a card, newest contract first: 内容 is where the current
// writer puts the question, 原文摘录 is where earlier cards kept it.
const FACT_SECTIONS = ['内容', '原文摘录'];

const asText = value => typeof value === 'string' ? value.trim() : '';
const baseName = path => path.split('/').pop() ?? path;

const compareText = (left, right) => {
  const a = asText(left), b = asText(right);
  return a === b ? 0 : a < b ? -1 : 1;
};

/** The tags the projection exposes for one page. Frontmatter `tags` keeps its
 * order while losing empty entries and repeats; anything that is not a tag
 * list — a missing key, a scalar value, an asset — is simply untagged. */
function tagsOf(record) {
  const raw = record?.frontmatter?.tags;
  if (!Array.isArray(raw)) return [];
  const tags = [];
  for (const item of raw) {
    const value = asText(item);
    if (value && !tags.includes(value)) tags.push(value);
  }
  return tags;
}

function locatorFor(locator) {
  if (!locator) return undefined;
  if (locator.kind === 'pdf-page') return { kind: 'pdf-page', page: locator.page, ...(locator.revision ? { revision: locator.revision } : {}) };
  if (locator.kind === 'pdf-region') return { kind: 'pdf-region', page: locator.page, rect: [...locator.rect], ...(locator.annotationId ? { annotationId: locator.annotationId } : {}), ...(locator.revision ? { revision: locator.revision } : {}) };
  if (locator.kind === 'video-time') return locator.endMs === undefined ? { kind: 'video-time', startMs: locator.startMs } : { kind: 'video-time', startMs: locator.startMs, endMs: locator.endMs };
  if (locator.kind === 'image-region') return { kind: 'image-region', rect: [...locator.rect] };
  if (locator.kind === 'html-range') return { kind: 'html-range', anchor: locator.anchor };
  return undefined;
}

/** A fragment no locator grammar understands is still evidence that the card came
 * from that file, so a text page keeps it as an anchor hint instead of dropping
 * it. A PDF, image, video or audio file has no headings: an unusable `#page=` /
 * `#rect=` fragment stays unusable rather than turning into a locator that
 * points at text that file never had. */
function hintFor(fragment, resolvedPath) {
  if (!fragment) return undefined;
  const kind = mediaForPath(resolvedPath).kind;
  if (kind !== 'file' && kind !== 'html') return undefined;
  const separator = fragment.indexOf('=');
  if (separator <= 0) return { kind: 'html-range', anchor: fragment };
  const key = fragment.slice(0, separator), value = fragment.slice(separator + 1);
  return key === 'anchor' && value ? { kind: 'html-range', anchor: value } : undefined;
}

function resolutionKey(target) {
  const value = target.trim().replaceAll('\\', '/').replace(/^\.\//, '');
  if (!value || value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('\0')) return undefined;
  const parts = value.split('/');
  if (!parts.length || parts.some(part => part === '' || part === '.' || part === '..')) return undefined;
  return parts.join('/');
}

/** Resolve one `![[...]]` / `[[...]]` target to a vault path plus locator. A
 * missing file still resolves: the UI needs to show the broken reference even
 * though no edge may be drawn from it. */
function classify(raw) {
  const value = raw.trim().replaceAll('\\', '/').replace(/^\.\//, '');
  if (!value || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return undefined;
  const hash = value.indexOf('#');
  const target = hash < 0 ? value : value.slice(0, hash);
  const fragment = hash < 0 ? '' : value.slice(hash + 1);
  const resolved = resolutionKey(target);
  if (!resolved) return undefined;
  const parsed = parseMediaTarget(value);
  // A malformed `#page=` / `#rect=` is a locator attempt, not free text: it keeps
  // its invalid marker and never becomes a heading hint or page one of a PDF.
  if (parsed?.invalidLocator) return { path: resolved, invalidLocator: true };
  return { path: resolved, locator: locatorFor(parsed?.locator) ?? hintFor(fragment, resolved) };
}

/** Fenced blocks and inline code often *document* an embed. Those examples are
 * prose, not provenance, so they are masked out before scanning. */
function maskCode(content) {
  const lines = String(content ?? '').split(/\r?\n/);
  const kept = [];
  let fenced = false;
  for (const line of lines) {
    if (FENCE.test(line)) { fenced = !fenced; continue; }
    if (!fenced) kept.push(line);
  }
  return kept.join('\n').replace(/`[^`\n]*`/g, ' ');
}

function embedsOf(content) {
  const found = [];
  for (const match of maskCode(content).matchAll(EMBED)) found.push(match[1]);
  return found;
}

function normalizeParent(value) {
  const text = asText(value);
  return text ? resolutionKey(text) ?? null : null;
}

function cleanLine(raw) {
  return raw
    .replace(/^\s*>\s?/, '')
    .replace(/!\[\[([^\]]*)\]\]/g, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
    .replace(/\*\*|`|~~/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cleaned preview text of one run of lines. Fences, HTML comments, folded blocks
 * and machine provenance are never preview material — a folded 原文参考答案 must
 * not surface in the student-visible card preview.
 */
function previewLines(lines) {
  const values = [];
  let fenced = false, commented = false, folded = false;
  for (const raw of lines) {
    if (FENCE.test(raw)) { fenced = !fenced; continue; }
    if (fenced) continue;
    if (commented) { if (COMMENT_CLOSE.test(raw)) commented = false; continue; }
    if (COMMENT_OPEN.test(raw)) { commented = !COMMENT_CLOSE.test(raw); continue; }
    if (DETAILS_OPEN.test(raw)) { folded = true; continue; }
    if (DETAILS_CLOSE.test(raw)) { folded = false; continue; }
    if (folded) continue;
    const line = raw.trim();
    if (!line || SECTION_LABEL.test(line) || PROTOCOL_LINE.test(line.trim())) continue;
    const value = cleanLine(raw);
    if (value) values.push(value);
  }
  return values.join(' ');
}

function truncateExcerpt(value) {
  if (!value) return '';
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH - 1)}…` : text;
}

/** Card excerpts are the fact text and never the folded answers. The 内容
 * section carries the question under the current contract, 原文摘录 carries it
 * on cards written before that, and the first readable lines are the fallback,
 * so an old file never loses its preview. */
function excerptOf(content) {
  const text = String(content ?? '');
  const sections = scanSections(text);
  for (const title of FACT_SECTIONS) {
    const section = sections.find(item => item.anchor === title);
    if (!section) continue;
    const value = truncateExcerpt(previewLines(section.content.split(/\r?\n/).slice(1)));
    if (value) return value;
  }
  const { body } = parseFrontmatter(text);
  return truncateExcerpt(previewLines(body.split(/\r?\n/)));
}

function outgoingSplitEdges(edges) {
  const outgoing = new Map();
  for (const edge of edges) {
    if (edge.kind !== 'split') continue;
    const list = outgoing.get(edge.source) ?? [];
    if (!list.includes(edge.target)) list.push(edge.target);
    outgoing.set(edge.source, list);
  }
  return outgoing;
}

/** Every distinct node one step below `source` in the split hierarchy, whatever
 * its type: a 源目录 chapter and a card split out of a page are both children, so
 * `childCount` stays the whole layer below a node. Callers that need one kind read
 * `childMaterialsOf` / `childCardsOf`, which slice these same edges. */
function childCounts(edges) {
  const counts = new Map();
  for (const edge of edges) {
    if (edge.kind !== 'split') continue;
    if (!counts.has(edge.source)) counts.set(edge.source, new Set());
    counts.get(edge.source).add(edge.target);
  }
  return counts;
}

/** Depth is the number of hops from a root; nodes left in a parent cycle get
 * null. Kahn peeling keeps this linear and stack-free. */
function depthsOf(edges, keys) {
  const outgoing = outgoingSplitEdges(edges);
  const incoming = new Map(keys.map(key => [key, 0]));
  for (const [, targets] of outgoing) for (const target of targets) incoming.set(target, (incoming.get(target) ?? 0) + 1);
  const queue = keys.filter(key => incoming.get(key) === 0);
  const peeled = new Set(queue), depth = new Map(queue.map(key => [key, 0]));
  while (queue.length) {
    const key = queue.shift();
    for (const target of outgoing.get(key) ?? []) {
      depth.set(target, Math.max(depth.get(target) ?? 0, depth.get(key) + 1));
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0 && !peeled.has(target)) { peeled.add(target); queue.push(target); }
    }
  }
  for (const key of keys) if (!peeled.has(key)) depth.set(key, null);
  return depth;
}

/** Undirected split/reference adjacency and the reachable set around `focus`.
 * Rings are derived from topology alone, so a node the tag filter will drop can
 * still bridge a hop; the visited set makes a parent cycle terminate. */
function neighborhoodOf(edges, focus, hops) {
  const neighbors = new Map();
  const link = (from, to) => {
    const list = neighbors.get(from) ?? new Set();
    list.add(to);
    neighbors.set(from, list);
  };
  for (const edge of edges) {
    if (!RELATION_KINDS.has(edge.kind)) continue;
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }
  const reached = new Set([focus]);
  let frontier = [focus];
  for (let hop = 0; hop < hops && frontier.length; hop += 1) {
    const next = [];
    for (const path of frontier) {
      for (const neighbor of neighbors.get(path) ?? []) {
        if (reached.has(neighbor)) continue;
        reached.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return reached;
}

export function buildVaultGraph(documents = [], assets = []) {
  // Every file the vault knows about, keyed by its bare path. Assets are
  // first-class nodes: a PDF split edge must not be rejected as "unknown".
  const entries = new Map();
  for (const asset of Array.isArray(assets) ? assets : []) {
    const path = asText(asset?.path);
    if (path) entries.set(path, { kind: 'asset', path, record: asset });
  }
  for (const document of Array.isArray(documents) ? documents : []) {
    const path = asText(document?.path);
    if (path) entries.set(path, { kind: 'page', path, record: document });
  }
  const known = new Set(entries.keys());

  const records = [];
  for (const [path, entry] of entries) {
    if (entry.kind !== 'page') continue;
    const record = entry.record;
    const type = asText(record.type) || null;
    const sources = [];
    for (const raw of embedsOf(record.content)) {
      const resolved = classify(raw);
      if (!resolved) continue;
      // Keep missing/self references: the UI shows them as broken provenance,
      // only the edge drawing step filters them out.
      sources.push({
        path: resolved.path,
        ...(resolved.locator ? { locator: resolved.locator } : {}),
        ...(resolved.invalidLocator ? { invalidLocator: true } : {}),
      });
    }
    const links = [];
    for (const link of Array.isArray(record.links) ? record.links : []) {
      const value = asText(link);
      if (value && known.has(value) && !links.includes(value)) links.push(value);
    }
    records.push({
      path,
      record,
      type,
      parent: normalizeParent(record.parent ?? record.frontmatter?.parent),
      sources,
      links,
      isCard: KNOWLEDGE_CARD_TYPES.has(type),
      isPlan: PLAN_TYPES.has(type),
      isMaterial: MATERIAL_TYPES.has(type),
    });
  }

  const edges = [], signatures = new Set();
  const addEdge = (source, target, kind) => {
    if (!source || !target || source === target || !known.has(source) || !known.has(target)) return;
    const signature = `${kind}\u0000${source}\u0000${target}`;
    if (signatures.has(signature)) return;
    signatures.add(signature);
    edges.push({ source, target, kind });
  };

  /** A `parent` only draws a hierarchy edge onto a real node of the same kind of
   * thing: a card under a card or a material page, a 源目录/教学专题 under its own
   * material type, and a 源目录 also directly under the 原书 PDF it transcribes.
   * A plain Markdown page or an image reaches its children through an embed
   * instead, so an image parent never becomes a hierarchy edge. */
  const legalParent = record => {
    if (!record.parent || record.parent === record.path) return false;
    const entry = entries.get(record.parent);
    if (!entry) return false;
    if (entry.kind !== 'page') return record.type === SOURCE_TYPE && asText(entry.record.assetKind) === 'pdf';
    const type = asText(entry.record.type);
    return record.isCard
      ? KNOWLEDGE_CARD_TYPES.has(type) || MATERIAL_TYPES.has(type)
      : type === asText(record.type);
  };

  /** Whether one embed can be the layer *above* a 源目录: only the 原书 PDF and
   * another 源目录 belong to the book's own structure. Everything else that page
   * touches — a 教学专题, a 备课/路线 plan, a card or a plain page — is something
   * the 源目录 points at, so it stays a reference: the book must never become a
   * child of the teacher's own summary. */
  const structureParent = path => {
    const entry = entries.get(path);
    if (!entry) return false;
    if (entry.kind !== 'page') return asText(entry.record.assetKind) === 'pdf';
    return asText(entry.record.type) === SOURCE_TYPE;
  };

  for (const record of records) {
    // A plan page points at the material it plans with; that pointer is real
    // provenance, but it is not a content split.
    if (record.isPlan) {
      for (const source of record.sources) addEdge(record.path, source.path, 'reference');
      continue;
    }
    const pinnedParent = legalParent(record);
    if (record.isCard) {
      if (pinnedParent) addEdge(record.parent, record.path, 'split');
      // Every embed of an existing file is a split relation, not just the first:
      // a card may be lifted from several pages or regions, and several embeds of
      // one file still leave that file a single node.
      for (const source of record.sources) addEdge(source.path, record.path, 'split');
      continue;
    }
    if (!record.isMaterial) continue;
    if (record.type === TOPIC_TYPE) {
      // A teacher's 专题 summarizes the book; every embed is material it cites,
      // never a layer it hangs under.
      for (const source of record.sources) addEdge(record.path, source.path, 'reference');
    } else {
      // 源目录: the 原书 PDF or an upper 源目录 page is the visible layer above this
      // page, but only while no explicit parent already owns the hierarchy —
      // adding the PDF edge then would flatten the chapter back onto the book.
      // Everything else this page embeds (专题/备课/卡片/普通页/图片…) is only
      // referenced, so the book never becomes a child of a teaching summary.
      for (const source of record.sources) {
        if (!pinnedParent && structureParent(source.path)) addEdge(source.path, record.path, 'split');
        else addEdge(record.path, source.path, 'reference');
      }
    }
    if (pinnedParent) addEdge(record.parent, record.path, 'split');
  }

  for (const record of records) {
    for (const target of record.links) {
      // A wiki link that mirrors an embed is the same relationship, so it never
      // becomes a second (reference) edge in either direction.
      const mirrored = edges.some(edge => edge.kind === 'split'
        && ((edge.source === record.path && edge.target === target) || (edge.source === target && edge.target === record.path)));
      if (!mirrored) addEdge(record.path, target, 'reference');
    }
  }

  // One pair of files is one relationship, whatever wrote it: a reference that
  // mirrors an existing split pair (a 源目录 listing the card that was split out
  // of it, or a chapter naming the very PDF above it) never becomes a second
  // parallel edge. Direction is ignored here exactly like the embed/link rule.
  const splitPairs = new Set(edges.filter(edge => edge.kind === 'split').map(edge => `${edge.source}\u0000${edge.target}`));
  const mirrorsSplit = (from, to) => splitPairs.has(`${from}\u0000${to}`) || splitPairs.has(`${to}\u0000${from}`);
  for (let index = edges.length - 1; index >= 0; index -= 1) {
    const edge = edges[index];
    if (edge.kind === 'reference' && mirrorsSplit(edge.source, edge.target)) edges.splice(index, 1);
  }

  const counts = childCounts(edges);
  const connected = new Set();
  for (const edge of edges) { connected.add(edge.source); connected.add(edge.target); }
  const depths = depthsOf(edges, [...known]);

  const nodes = [];
  for (const record of records) {
    // 层级子节点（资料页与卡片合计），不是卡片数：卡片统计只走 `childCardsOf`。
    const childCount = (counts.get(record.path) ?? new Set()).size;
    // Only a card can be intermediate/leaf; every other connected file is a
    // root, and an edge-less file is isolated whatever its type.
    const role = !connected.has(record.path) ? 'isolated'
      : record.isCard ? (childCount > 0 ? 'intermediate' : 'leaf')
        : record.isPlan ? 'plan'
          : 'root';
    nodes.push({
      path: record.path,
      title: asText(record.record.title) || baseName(record.path).replace(/\.md$/i, ''),
      kind: 'page',
      type: record.type,
      tags: tagsOf(record.record),
      revision: record.record.revision,
      role,
      sources: record.sources,
      parent: record.parent,
      excerpt: excerptOf(record.record.content),
      childCount,
      depth: depths.get(record.path) ?? null,
    });
  }
  for (const [path, entry] of entries) {
    if (entry.kind !== 'asset') continue;
    const record = entry.record;
    const childCount = (counts.get(path) ?? new Set()).size;
    const role = connected.has(path) ? 'root' : 'isolated';
    nodes.push({
      path,
      title: asText(record.title) || baseName(path),
      kind: 'asset',
      type: null,
      tags: [],
      revision: record.revision,
      assetKind: record.assetKind,
      role,
      sources: [],
      parent: null,
      excerpt: '',
      childCount,
      depth: depths.get(path) ?? null,
    });
  }

  const order = new Map([...entries.keys()].map((key, index) => [key, index]));
  nodes.sort((left, right) => (order.get(left.path) ?? 0) - (order.get(right.path) ?? 0));
  edges.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
    if (left.source !== right.source) return left.source < right.source ? -1 : 1;
    return left.target === right.target ? 0 : left.target < right.target ? -1 : 1;
  });
  return { nodes, edges };
}

/**
 * A read-only slice of the projection. With a `focus` path it is the node's
 * topology neighborhood — `hops` rings (1, the default, or 2) over undirected
 * split/reference reachability; without one it is the whole graph. `tags` is an
 * AND filter over node tags, and in focus mode the focus itself stays as
 * context even when it does not match. Nodes keep the projection's order and
 * identity and edges keep their original direction, but an edge only survives
 * when both endpoints do. An unknown focus path yields an empty slice.
 */
export function filterVaultGraph(graph, { focus = null, hops = 1, tags = [] } = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const wanted = (Array.isArray(tags) ? tags : []).map(asText).filter(Boolean);
  const matches = node => wanted.every(tag => (Array.isArray(node.tags) ? node.tags : []).includes(tag));
  const focused = typeof focus === 'string' ? focus : null;
  const kept = new Set();
  if (focused === null) {
    for (const node of nodes) if (matches(node)) kept.add(node.path);
  } else {
    if (!nodes.some(node => node.path === focused)) return { nodes: [], edges: [] };
    const reached = neighborhoodOf(edges, focused, hops === 2 ? 2 : 1);
    for (const node of nodes) {
      if (node.path === focused || (reached.has(node.path) && matches(node))) kept.add(node.path);
    }
  }
  return {
    nodes: nodes.filter(node => kept.has(node.path)),
    edges: edges.filter(edge => RELATION_KINDS.has(edge.kind) && kept.has(edge.source) && kept.has(edge.target)),
  };
}

/**
 * The direct split children of `path` that `accepts` allows: existing nodes only,
 * deduped, then sorted by title and path so the order never depends on file scan
 * order. An unknown path has no children.
 */
function splitChildrenOf(graph, path, accepts) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const byPath = new Map(nodes.map(node => [node.path, node]));
  const from = typeof path === 'string' ? path : '';
  const children = new Map();
  for (const edge of edges) {
    if (edge.kind !== 'split' || edge.source !== from) continue;
    const node = byPath.get(edge.target);
    if (!node || !accepts(node.type)) continue;
    if (!children.has(node.path)) children.set(node.path, node);
  }
  return [...children.values()].sort((left, right) => compareText(left.title, right.title) || compareText(left.path, right.path));
}

/**
 * The direct child cards of `path`: split edges leaving that node whose target is
 * an existing card. A 源目录/教学专题 is not a card, so it never appears here and
 * never inflates the card counts the 卡片库 and the node details show.
 */
export function childCardsOf(graph, path) {
  return splitChildrenOf(graph, path, type => KNOWLEDGE_CARD_TYPES.has(type));
}

/**
 * The direct child material pages of `path`: split edges leaving that node whose
 * target is an existing 源目录 or 教学专题. The complement of `childCardsOf`, so
 * the two lists can be shown side by side without repeating a page.
 */
export function childMaterialsOf(graph, path) {
  return splitChildrenOf(graph, path, type => MATERIAL_TYPES.has(type));
}

/**
 * Tag aggregation for the graph view: one group per tag the projection carries,
 * with the real number of assets in it. A node that carries several tags appears
 * in each of its groups but never twice inside one group, so the group count and
 * the deduped node total can never disagree. Groups are ordered by size, then by
 * tag, so the projection order never depends on file scan order.
 */
export function tagGroups(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const groups = new Map();
  for (const node of nodes) {
    const path = asText(node?.path);
    if (!path) continue;
    for (const raw of Array.isArray(node.tags) ? node.tags : []) {
      const tag = asText(raw);
      if (!tag) continue;
      const paths = groups.get(tag) ?? [];
      if (!paths.includes(path)) paths.push(path);
      groups.set(tag, paths);
    }
  }
  return [...groups.entries()]
    .map(([tag, paths]) => ({ tag, count: paths.length, paths }))
    .sort((left, right) => right.count - left.count || compareText(left.tag, right.tag));
}

/**
 * The one section scanner. Sections, their anchors and the line each one starts
 * on all come from here, so `markdownSections` and `findAnchorLine` can never
 * disagree about fences, frontmatter or repeated headings.
 *
 * `startLine` is 1-based in the *original* file, so the frontmatter block is
 * counted even though it never becomes section content.
 */
function scanSections(content) {
  const text = typeof content === 'string' ? content : String(content ?? '');
  const { body } = parseFrontmatter(text);
  // parseFrontmatter hands back the body; the prefix it removed is exactly the
  // frontmatter block, whose line count offsets every body line number.
  const lineOffset = text.length > body.length ? text.slice(0, text.length - body.length).split(/\r?\n/).length - 1 : 0;
  const lines = body.split(/\r?\n/);
  const sections = [], seen = new Map();
  let pending = [], start = null, anchor = null, fenced = false;

  const flush = () => {
    const value = pending.join('\n').trim();
    const sectionStart = start, sectionAnchor = anchor;
    pending = []; start = null; anchor = null;
    if (!value || sectionStart === null) return;
    sections.push({ anchor: sectionAnchor ?? fallbackAnchor(value), content: value, startLine: lineOffset + sectionStart + 1 });
  };

  lines.forEach((line, index) => {
    // A fenced block is content, never structure: a `## heading` inside it must
    // not create a section that an editor could jump to.
    if (FENCE.test(line)) {
      fenced = !fenced;
      if (start === null) start = index;
      pending.push(line);
      return;
    }
    const match = !fenced && line.match(HEADING);
    if (!match) {
      if (start === null && line.trim()) start = index;
      pending.push(line);
      return;
    }
    flush();
    const heading = match[2].trim();
    const count = (seen.get(heading) ?? 0) + 1;
    seen.set(heading, count);
    anchor = count === 1 ? heading : `${heading}#${count}`;
    start = index;
    // Keep the heading line inside its section so the excerpt carries the
    // passage that gave the card its anchor.
    pending.push(line.trimEnd());
  });
  flush();
  return sections;
}

/** Split a Markdown document into heading-anchored sections. The anchor is the
 * heading text (`#N` only for a repeated heading), so it survives edits that
 * move text around — unlike a line number. */
export function markdownSections(content) {
  return scanSections(content).map(({ anchor, content: body }) => ({ anchor, content: body }));
}

/** 1-based line of `anchor` in the original file, or null when no section owns
 * it. Editors use this instead of re-implementing frontmatter/fence/duplicate
 * handling (which is how a repeat heading once resolved into a code block). */
export function findAnchorLine(content, anchor) {
  const wanted = typeof anchor === 'string' ? anchor.trim() : '';
  if (!wanted) return null;
  const section = scanSections(content).find(item => item.anchor === wanted);
  return section ? section.startLine : null;
}

const SUMMARY_BEGIN = /^<!--\s*notara:lesson-summary\s*$/;

/**
 * The stable line of a classroom summary block. Its anchor is the block id in
 * the metadata comment (`id: "ls-…"`), while the visible heading stays the human
 * `课堂小结 · 日期` title — so the identity survives editing instead of being
 * re-derived from wording, and a summary link can still land on its own block.
 * Returns the 1-based line of the block's first metadata line, or null.
 */
export function findSummaryBlockLine(content, anchor) {
  const wanted = typeof anchor === 'string' ? anchor.trim() : '';
  if (!wanted) return null;
  const lines = String(content ?? '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!SUMMARY_BEGIN.test(lines[index].trim())) continue;
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      const line = lines[scan].trim();
      if (line === '-->') break;
      const match = line.match(/^id:\s*(.+)$/);
      if (!match) continue;
      let value;
      try { value = JSON.parse(match[1].trim()); } catch { value = undefined; }
      if (value === wanted) return index + 1;
    }
  }
  return null;
}

function fallbackAnchor(value) {
  const line = value.split('\n').map(item => item.trim()).find(Boolean);
  if (!line) return '';
  const heading = line.match(HEADING);
  if (heading) return heading[2].trim();
  return line.length > 40 ? line.slice(0, 40) : line;
}

const DROP_FRONTMATTER_KEYS = new Set(['template', 'name', 'parent']);
const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Put one block of text directly under a `## heading`, leaving every other
 * section — and any guidance the template keeps inside them — exactly where the
 * template put it. Both card writers share this seam so the fact text can only
 * ever land in one place. Returns null when the template has no such section, so
 * an older or student-authored template keeps the previous append-only shape.
 */
export function insertIntoSection(body, heading, block) {
  const text = typeof body === 'string' ? body : '';
  if (!text || !block) return null;
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex(line => line.trim() === `## ${heading}`);
  if (index < 0) return null;
  lines.splice(index + 1, 0, '', ...String(block).split('\n'));
  return lines.join('\n');
}

/** Render a Markdown card that points back at the passage it was lifted from.
 * `template:` / `name:` markers are dropped because the result is a card, not a
 * template; `parent:` is replaced when the caller passes one. */
export function buildMarkdownCardContent(input) {
  const { template, title } = input ?? {};
  if (typeof template !== 'string' || !template) throw new Error('markdown_card_template_invalid');
  const source = asText(input.source);
  const anchor = asText(input.anchor);
  if (!source || !anchor) throw new Error('markdown_card_invalid');
  const finalTitle = asText(title) || '摘录卡片';
  const parent = normalizeParent(input.parent);
  const date = asText(input.date);
  const rendered = template
    .replace(/\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\s*\}\}/g, (match, key) => key === 'title' ? finalTitle : key === 'date' ? date : '')
    .replace(/\s+$/, '');
  const block = rendered.match(FRONTMATTER_BLOCK);
  const keptFrontmatter = block
    ? block[1].split(/\r?\n/)
      .filter(line => {
        const key = line.includes(':') ? line.slice(0, line.indexOf(':')).trim() : '';
        return !key || !DROP_FRONTMATTER_KEYS.has(key);
      })
      .concat(parent ? [`parent: ${parent}`] : [])
    : null;
  const body = (block ? rendered.slice(block[0].length) : rendered).replace(/^\r?\n+/, '').replace(/\s+$/, '');
  const quote = asText(input.quote)
    ? `\n## 原文摘录\n${String(input.quote).trim().split(/\r?\n/).map(line => `> ${line}`).join('\n')}\n`
    : '';
  const embed = embedTarget(source, { kind: 'html-range', anchor });
  const head = keptFrontmatter ? `---\n${keptFrontmatter.join('\n')}\n---\n` : '';
  // Current contract: the fact itself lives in 内容, so the question stays in the
  // body and remains findable by search; the source line and embed only say where
  // it came from. Older, student-authored templates keep the appended shape.
  const fact = [
    asText(input.quote) ? `${String(input.quote).trim().split(/\r?\n/).map(line => `> ${line}`).join('\n')}\n` : '',
    `- 来源：${source}#${anchor}`,
    `- 摘录：${embed}`,
    ...(parent ? [`- 父卡：${parent}`] : []),
  ].filter(Boolean).join('\n');
  const withFact = insertIntoSection(body, '内容', fact);
  if (withFact !== null) return `${head}${withFact}\n`;
  const detail = [
    '## 来源定位',
    `- 来源：${source}#${anchor}`,
    `- 摘录：${embed}`,
    ...(parent ? [`- 父卡：${parent}`] : []),
    quote,
  ].join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  return `${head}${body}\n\n${detail}\n`;
}
