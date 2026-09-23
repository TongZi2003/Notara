// Shared Vault file operations that both the Host teaching runtime and the
// native Bash CLI run. They operate on an already-authorized Vault IO
// (`createAgentVaultIO`/`createEditorVaultIO`) and never resolve a workspace,
// read environment variables or approve a write by themselves.
//
// Routes are the one teaching object whose identities may not come from model
// memory: node ids are generated here, the change-log date is stamped here, a
// parent and a prerequisite must name a node that really exists, and every
// referenced material and lesson script is read before anything is written. A
// revision validates the whole request first and writes exactly once.
import { randomUUID } from 'node:crypto';
import { parseRoute, renderRoute, validateRouteNodes } from './lesson-data.js';
import { routeBriefText, routeIdList, routeLogEntry, routeOverviewText, routePathwayValue, routeReasonText, routeStageText } from './route-plan.js';
import { validateDay } from './review-data.js';
import { safeRelativePath } from './vault.js';

// The pathway vocabulary is one list, shared with the projection and the CLI.
export { ROUTE_PATHWAYS } from './route-plan.js';

const fail = code => { throw new Error(code); };
const MAX_NODES = 100;

/** Host routing identity travels with a Remote call and is resolved into a
 * workspace before this module sees the request; it is never route content and
 * never a lesson attribute. */
const TRANSIENT_KEYS = Object.freeze(['sessionId']);
const CREATE_KEYS = Object.freeze(['title', 'overview', 'lessons']);
const LESSON_KEYS = Object.freeze(['title', 'stage', 'pathway', 'parentIndex', 'prerequisiteIndexes', 'materials', 'scriptPath', 'brief']);
const REVISE_KEYS = Object.freeze(['path', 'expectedRevision', 'reason', 'overview', 'updates', 'additions']);
const UPDATE_KEYS = Object.freeze(['nodeId', 'title', 'stage', 'pathway', 'parentId', 'prerequisiteIds', 'materials', 'scriptPath', 'brief']);
const ADDITION_KEYS = Object.freeze(['title', 'stage', 'pathway', 'parentId', 'prerequisiteIds', 'materials', 'scriptPath', 'brief']);

/** One file-name rule for user titles: reject empty/oversized titles, strip
 * path separators and control characters, and never produce a dotfile. This is
 * the rule the teaching runtime already used; it lives here so the CLI and the
 * runtime cannot drift into two folder layouts. */
export function safeTitlePath(title) {
  if (typeof title !== 'string' || !title.trim() || title.length > 200) fail('vault_title_invalid');
  return title.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/^\.+/,'').trim() || '学习笔记';
}

/** A field this entry does not accept fails instead of being dropped: a typo in
 * a model-written route must not read as a successful write. */
function rejectUnknown(value, allowed, code, {transport=false,nullable=[]}={}) {
  for (const key of Object.keys(value)) {
    if (transport&&TRANSIENT_KEYS.includes(key))continue;
    if (!allowed.includes(key))fail(code);
    if(value[key]===null&&!nullable.includes(key))fail('lesson_route_field_invalid');
  }
}

function vaultPath(value, code) {
  if (typeof value !== 'string' || !value) fail(code);
  return safeRelativePath(value);
}

function nodeRef(value) {
  if (typeof value !== 'string') fail('lesson_route_node_invalid');
  const id = value.trim();
  if (!id || /[\r\n]/.test(id)) fail('lesson_route_node_invalid');
  return id;
}

/** Declared materials must already exist: Markdown is read as a document, any
 * other asset through the asset reader, so a material that was moved or renamed
 * is refused before the route page is written. */
async function readMaterials(io, value) {
  if (!Array.isArray(value)) fail('lesson_route_materials_invalid');
  const materials = [];
  for (const raw of value) {
    const path = vaultPath(raw, 'lesson_route_materials_invalid');
    if (path.toLowerCase().endsWith('.md')) await io.read(path);
    else await io.readAsset(path);
    materials.push(path);
  }
  return materials;
}

/** A lesson script is only a `type: lesson` page the Vault really holds. */
async function lessonScript(io, value) {
  const path = vaultPath(value);
  const script = await io.read(path);
  if (script.type !== 'lesson') fail('lesson_script_required');
  return path;
}

/** The change-log date is Host input, stamped in the Host's own civil day; a
 * caller may pass one for a deterministic write, never as a route field. */
function hostDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = type => parts.find(item => item.type === type)?.value ?? '';
  return validateDay(`${part('year')}-${part('month')}-${part('day')}`);
}

/**
 * Create one `路线/<title>.md` page from declared lessons.
 *
 * Node identities and the page itself are generated here so a model never has
 * to invent them. `overview` is the course description outside the node blocks;
 * every lesson states its own `brief`, `stage` and `pathway`, and a conditional
 * branch must name the earlier node it leaves from. Main lessons continue the
 * main chain, so a remedial detour can never become the next lesson's
 * predecessor by accident. Every declared material and lesson script must
 * already exist, so an unusable route is rejected before anything is written.
 *
 * @param {{read: Function, readAsset: Function, save: Function}} io authorized Vault IO
 * @param {{title: string, overview?: string, lessons: Array}} args route content from the caller
 * @returns {Promise<{path: string, title: string, revision: string, ref: string, nodes: Array}>}
 */
export async function createRouteInVault(io, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) fail('lesson_route_invalid');
  rejectUnknown(args, CREATE_KEYS, 'lesson_route_field_unknown',{transport:true});
  const lessons = args.lessons;
  if (!Array.isArray(lessons) || !lessons.length || lessons.length > MAX_NODES) fail('lesson_route_invalid');
  const title = safeTitlePath(args.title);
  const overview = routeOverviewText(args.overview);
  const ids = lessons.map(() => randomUUID());
  const nodes = [];
  for (const [index, lesson] of lessons.entries()) {
    if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) fail('lesson_route_invalid');
    rejectUnknown(lesson, LESSON_KEYS, 'lesson_route_field_unknown',{nullable:['parentIndex']});
    const pathway = routePathwayValue(lesson.pathway);
    const stage = routeStageText(lesson.stage);
    let parent = null;
    if (lesson.parentIndex === undefined) {
      if (pathway !== 'main') fail('lesson_route_parent_invalid');
      for (let scan = index - 1; scan >= 0; scan -= 1) {
        if (nodes[scan].pathway === 'main') { parent = ids[scan]; break; }
      }
    } else if (lesson.parentIndex === null) {
      if (pathway !== 'main') fail('lesson_route_parent_invalid');
    } else {
      const value = lesson.parentIndex;
      if (!Number.isInteger(value) || value < 0 || value >= index) fail('lesson_route_parent_invalid');
      parent = ids[value];
    }
    const prerequisites = [];
    if (lesson.prerequisiteIndexes !== undefined && lesson.prerequisiteIndexes !== null) {
      if (!Array.isArray(lesson.prerequisiteIndexes)) fail('lesson_route_prerequisite_invalid');
      for (const raw of lesson.prerequisiteIndexes) {
        if (!Number.isInteger(raw) || raw < 0 || raw >= lessons.length || raw === index) fail('lesson_route_prerequisite_invalid');
        const id = ids[raw];
        if (prerequisites.includes(id)) fail('lesson_route_prerequisite_invalid');
        prerequisites.push(id);
      }
    }
    const node = {
      id: ids[index],
      title: safeTitlePath(lesson.title),
      parent,
      materials: await readMaterials(io, lesson.materials ?? []),
      stage,
      pathway,
      prerequisites,
      brief: routeBriefText(lesson.brief),
    };
    if (lesson.scriptPath !== undefined && lesson.scriptPath !== null && lesson.scriptPath !== '') node.scriptPath = await lessonScript(io, lesson.scriptPath);
    nodes.push(node);
  }
  const saved = await io.save(`路线/${title}.md`, renderRoute({ title, nodes, overview }, null), null);
  return { path: saved.path, title: saved.title, revision: saved.revision, ref: saved.ref, nodes };
}

/**
 * Revise an existing route page in one validated write.
 *
 * A revision may add nodes and change the fields a lesson may really still
 * change: nothing is ever deleted, no node id, class binding or scheduled date
 * is overwritten, and a node already bound to a real class stays as it is — a
 * new goal becomes a new node instead. An omitted field keeps its value, an
 * explicit `null` clears only `parentId`/`scriptPath`, and an empty array
 * empties `prerequisiteIds`/`materials`. The whole request is validated before
 * the page is rendered, so a rejected revision writes nothing, and a revision
 * with no real change reports `saved: false` instead of appending a log line.
 * The Host appends the change log (date, reason, affected node titles) to the
 * route page itself and never touches a classroom log.
 *
 * @param {{read: Function, readAsset: Function, save: Function}} io authorized Vault IO
 * @param {{path: string, expectedRevision: string, reason: string, overview?: string, updates?: Array, additions?: Array}} args revision from the caller
 * @param {{today?: string}} options Host seam for a deterministic log date
 * @returns {Promise<{path: string, title: string, revision: string, saved: boolean, ref?: string, changed: Array, added: Array, nodes: Array}>}
 *   `changed`/`added` are the real differences this call made — per node, the
 *   fields it really rewrote — and `nodes` is the resulting route.
 */
export async function reviseRouteInVault(io, args = {}, options = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) fail('lesson_route_invalid');
  rejectUnknown(args, REVISE_KEYS, 'lesson_route_field_unknown',{transport:true});
  if (typeof args.path !== 'string' || !args.path.trim()) fail('lesson_route_path_invalid');
  if (typeof args.expectedRevision !== 'string' || !args.expectedRevision) fail('lesson_route_revision_required');
  const reason = routeReasonText(args.reason);
  const day = options.today === undefined || options.today === null ? hostDay() : validateDay(options.today);
  const overview = args.overview === undefined || args.overview === null ? undefined : routeOverviewText(args.overview);

  const doc = await io.read(safeRelativePath(args.path), args.expectedRevision);
  const route = parseRoute(doc);
  const current = new Map(route.nodes.map(node => [node.id, { ...node }]));
  const changed = [];

  const updates = args.updates === undefined || args.updates === null ? [] : args.updates;
  if (!Array.isArray(updates) || updates.length > MAX_NODES) fail('lesson_route_update_invalid');
  const seen = new Set();
  for (const update of updates) {
    if (!update || typeof update !== 'object' || Array.isArray(update)) fail('lesson_route_update_invalid');
    rejectUnknown(update, UPDATE_KEYS, 'lesson_route_field_unknown',{nullable:['parentId','scriptPath']});
    const nodeId = typeof update.nodeId === 'string' ? update.nodeId.trim() : '';
    if (!nodeId || seen.has(nodeId)) fail('lesson_route_update_invalid');
    seen.add(nodeId);
    const node = current.get(nodeId);
    if (!node) fail('lesson_route_node_missing');
    if (node.sessionId) fail('lesson_route_node_bound');
    const fields = [];
    if (update.title !== undefined) {
      const value = safeTitlePath(update.title);
      if (value !== node.title) fields.push('title');
      node.title = value;
    }
    if (update.stage !== undefined) {
      const value = routeStageText(update.stage);
      if (value !== node.stage) fields.push('stage');
      node.stage = value;
    }
    if (update.pathway !== undefined) {
      const value = routePathwayValue(update.pathway);
      if (value !== node.pathway) fields.push('pathway');
      node.pathway = value;
    }
    if (update.parentId !== undefined) {
      const value = update.parentId === null ? null : nodeRef(update.parentId);
      if (value !== null && !current.has(value)) fail('lesson_route_missing_parent');
      if (value !== node.parent) fields.push('parentId');
      node.parent = value;
    }
    if (update.prerequisiteIds !== undefined) {
      const value = routeIdList(update.prerequisiteIds, 'lesson_route_prerequisite_invalid');
      for (const id of value) {
        if (id === nodeId) fail('lesson_route_prerequisite_invalid');
        if (!current.has(id)) fail('lesson_route_prerequisite_missing');
      }
      if (value.join('\u0000') !== node.prerequisites.join('\u0000')) fields.push('prerequisiteIds');
      node.prerequisites = value;
    }
    if (update.materials !== undefined) {
      const value = await readMaterials(io, update.materials);
      if (value.join('\u0000') !== node.materials.join('\u0000')) fields.push('materials');
      node.materials = value;
    }
    if (update.scriptPath !== undefined) {
      const value = update.scriptPath === null || update.scriptPath === '' ? null : await lessonScript(io, update.scriptPath);
      if (value !== (node.scriptPath ?? null)) fields.push('scriptPath');
      if (value === null) delete node.scriptPath;
      else node.scriptPath = value;
    }
    if (update.brief !== undefined) {
      const value = routeBriefText(update.brief);
      if (value !== node.brief) fields.push('brief');
      node.brief = value;
    }
    if (fields.length) changed.push({ nodeId, title: node.title, fields });
  }

  const additions = args.additions === undefined || args.additions === null ? [] : args.additions;
  if (!Array.isArray(additions) || additions.length > MAX_NODES) fail('lesson_route_update_invalid');
  if (route.nodes.length + additions.length > MAX_NODES) fail('lesson_route_invalid');
  const total = [...current.values()];
  const created = [];
  for (const addition of additions) {
    if (!addition || typeof addition !== 'object' || Array.isArray(addition)) fail('lesson_route_update_invalid');
    rejectUnknown(addition, ADDITION_KEYS, 'lesson_route_field_unknown',{nullable:['parentId']});
    const pathway = routePathwayValue(addition.pathway);
    const stage = routeStageText(addition.stage);
    const pool = [...total, ...created.map(entry => entry.node)];
    let parent = null;
    if (addition.parentId === undefined) {
      if (pathway !== 'main') fail('lesson_route_parent_invalid');
      for (let scan = pool.length - 1; scan >= 0; scan -= 1) {
        if (pool[scan].pathway === 'main') { parent = pool[scan].id; break; }
      }
    } else if (addition.parentId !== null) {
      const id = nodeRef(addition.parentId);
      if (!pool.some(node => node.id === id)) fail('lesson_route_missing_parent');
      parent = id;
    } else if (pathway !== 'main') fail('lesson_route_parent_invalid');
    const prerequisites = [];
    for (const id of routeIdList(addition.prerequisiteIds, 'lesson_route_prerequisite_invalid')) {
      if (!pool.some(node => node.id === id)) fail('lesson_route_prerequisite_missing');
      prerequisites.push(id);
    }
    const node = {
      id: randomUUID(),
      title: safeTitlePath(addition.title),
      parent,
      materials: await readMaterials(io, addition.materials ?? []),
      stage,
      pathway,
      prerequisites,
      brief: routeBriefText(addition.brief),
    };
    if (addition.scriptPath !== undefined && addition.scriptPath !== null && addition.scriptPath !== '') node.scriptPath = await lessonScript(io, addition.scriptPath);
    created.push({ node, fields: ADDITION_KEYS.filter(key => addition[key] !== undefined) });
  }
  const added = created.map(entry => ({ nodeId: entry.node.id, title: entry.node.title, fields: entry.fields }));
  const nodes = [...total, ...created.map(entry => entry.node)];
  validateRouteNodes(nodes);
  const nextOverview=overview===undefined?undefined:overview.trim()?overview:`# ${route.title}`;
  const overviewChanged=nextOverview!==undefined&&nextOverview!==route.overview;
  const wrote = changed.length > 0 || added.length > 0 || overviewChanged;
  if (!wrote) return { path: doc.path, title: doc.title, revision: doc.revision, saved: false, changed, added, nodes };
  const rendered = renderRoute({
    title: route.title,
    nodes,
    overview:nextOverview,
    logEntry: routeLogEntry({ date: day, reason, titles: [...(overviewChanged?[`${route.title}（课程总述）`]:[]),...changed.map(entry => entry.title), ...added.map(entry => entry.title)] }),
  }, doc.content);
  // A revision that would write the same page is reported as no change: no log
  // line is fabricated for work the file does not show.
  if (rendered === doc.content) return { path: doc.path, title: doc.title, revision: doc.revision, saved: false, changed, added, nodes };
  const saved = await io.save(doc.path, rendered, doc.revision);
  return { path: saved.path, title: saved.title, revision: saved.revision, ref: saved.ref, saved: true, changed, added, nodes };
}
