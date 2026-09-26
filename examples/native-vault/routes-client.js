/**
 * The route bench: one independent view for 课序 with two ways to read the same
 * projection. 课程列表 is the default — the stages as lanes, the lessons in the
 * order the plan declares them — and 图谱 keeps the canvas with 课序/先修/条件分支
 * drawn as three different relations. Nothing here reads the file projection —
 * `routes({})` already returns real lesson nodes, their real session binding and
 * the real summary block, so a planned lesson is never mistaken for a card and
 * 课序 never becomes a knowledge split. Both views select the same node key and
 * open the same detail pane, so switching a view never changes what a lesson is.
 *
 * The plan itself is one Markdown page: the route 总述 and one brief per node.
 * This bench only projects it. 主线 is what a learner follows; 条件补练 and 拓展
 * stay folded until they are asked for; 先修 is a knowledge prerequisite and is
 * never a lock on a lesson; a 条件分支 says only that its trigger is written in
 * the brief. A classroom summary stays a record — nothing here turns it into
 * mastery, or into a claim that the next lesson has already passed.
 */
import { CANVAS_CSS, LESSON_ROLES, createVaultCanvas } from './canvas-client.js';
import { VIEW_IDS } from './views-client.js';
import { mediaLocatorSuffix, parseMediaTarget } from './media.js';
import { createVaultClient } from './remote-client.js';
import { STAR_CSS, createStarMap, routeStarLayout } from './star-map-client.js';
import { routeForestLayout } from './forest-client.js';

export const ROUTE_CSS = `
.nv-route-log{margin:0;padding:8px 18px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary)}
.nv-route-log summary{cursor:pointer}
.nv-route-log ul{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:6px}
.nv-route-log li{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.nv-route-actions{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px}
.nv-route-overview{padding:8px 18px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary)}
.nv-route-overview summary{cursor:pointer}
.nv-route-overview .nv-route-body{margin-top:8px}
.nv-route-filters{display:flex;align-items:center;flex-wrap:wrap;gap:14px;padding:8px 18px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary)}
.nv-route-filters label{display:inline-flex;align-items:center;gap:5px;cursor:pointer}
.nv-route-filters select{border:1px solid var(--dsw-alias-border-l2);border-radius:5px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;padding:3px 6px}
.nv-route-brief{margin:10px 0 0}
.nv-route-brief .cm-editor{outline:none}
/* 条件分支 reuses the canvas's dashes for a 引用-style relation — this bench never
   invents a stroke — and keeps the primary colour so a branch can never be read
   as the grey 先修 dependency. */
.nv-graph-board line[data-edge="branch"]{stroke:var(--dsw-alias-state-business-primary);stroke-dasharray:4 3}
.nv-legend svg line{stroke-width:1.4}
.nv-legend svg line[data-edge="sequence"]{stroke:var(--dsw-alias-state-business-primary)}
.nv-legend svg line[data-edge="prerequisite"]{stroke:var(--dsw-alias-label-secondary);stroke-dasharray:3 5}
.nv-legend svg line[data-edge="branch"]{stroke:var(--dsw-alias-state-business-primary);stroke-dasharray:4 3}
.nv-legend svg polygon[data-edge="sequence"]{fill:var(--dsw-alias-state-business-primary)}
/* 课程列表 / 分阶段泳道：默认入口是原型里逐阶段读课序的列表，图谱保留原来的画布
   体验。两种视图读同一份投影、共用右侧详情栏，所以「显示什么课」不会因为切换
   视图而改变。白灰底、细边界、圆角沿用既有 theme tokens。 */
.nv-route-shell{display:flex;flex:1;min-height:0;overflow:hidden}
.nv-route-rail{width:230px;flex:none;min-width:0;overflow:auto;padding:12px;display:grid;align-content:start;gap:8px;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.nv-route-card{width:100%;display:grid;gap:6px;padding:12px 14px;text-align:left;font:inherit;color:inherit;cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--nv-card-radius,16px)}
.nv-route-card:hover{border-color:var(--dsw-alias-border-l2)}
.nv-route-card[aria-current=true]{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 3px var(--dsw-alias-interactive-bg-active)}
.nv-route-card b{font-size:13px;font-weight:500;overflow-wrap:anywhere}
.nv-route-card small{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.nv-route-progress{display:flex;gap:2px;height:5px;border-radius:3px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}
.nv-route-progress i{display:block;height:100%;background:var(--dsw-alias-border-l3)}
.nv-route-progress i[data-part=logged]{background:var(--dsw-alias-label-secondary)}
.nv-route-progress i[data-part=opened]{background:var(--dsw-alias-state-business-primary)}
.nv-route-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
.nv-route-empty{flex:1;min-height:0;display:grid;place-items:center;padding:16px}
.nv-route-lanes{flex:1;min-height:0;overflow:auto;padding:14px 16px 22px;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(220px,1fr);align-content:start;background-image:radial-gradient(var(--dsw-alias-border-l1) .7px,transparent .7px);background-size:20px 20px}
.nv-route-lane{min-width:0;padding:0 12px;border-left:1px dashed var(--dsw-alias-border-l2)}
.nv-route-lane:first-child{border-left:0}
.nv-route-lane-head{display:flex;align-items:center;gap:6px;margin:2px 0 12px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.nv-route-lane-head b{font-weight:500;color:var(--dsw-alias-label-secondary)}
.nv-route-node{position:relative;display:grid;gap:6px;width:100%;margin-bottom:10px;padding:12px;text-align:left;font:inherit;color:inherit;cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--nv-card-radius,16px)}
.nv-route-node:hover{border-color:var(--dsw-alias-border-l2)}
.nv-route-node[aria-pressed=true]{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 3px var(--dsw-alias-interactive-bg-active)}
.nv-route-node b{font-size:13.5px;font-weight:500;line-height:1.5;overflow-wrap:anywhere}
.nv-route-kind{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.nv-route-state{display:flex;flex-wrap:wrap;gap:6px}
.nv-route-badge{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:6px;font-size:11px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1)}
.nv-route-badge[data-role="logged"]{color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}
.nv-route-badge[data-role="opened"]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.nv-route-badge[data-role="scheduled"]{color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary)}
/* 条件补练与拓展只靠虚线框和一段折角表达：它们是另一种 pathway，不是另一种课。 */
.nv-route-node[data-pathway="remedial"],.nv-route-node[data-pathway="extension"]{width:calc(100% - 14px);margin-left:14px;border-style:dashed}
.nv-route-node[data-pathway="remedial"]::before,.nv-route-node[data-pathway="extension"]::before{content:'';position:absolute;left:-11px;top:-10px;width:9px;height:26px;border-left:1.5px solid var(--dsw-alias-border-l2);border-bottom:1.5px solid var(--dsw-alias-border-l2);border-bottom-left-radius:6px}
.nv-route-main .nv-route-log{border-bottom:0;border-top:1px solid var(--dsw-alias-border-l1)}
@container (max-width:900px){.nv-route-shell{flex-direction:column}.nv-route-rail{width:auto;grid-auto-flow:column;grid-auto-columns:minmax(200px,1fr);overflow-x:auto;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1)}}
@container (max-width:650px){.nv-route-shell[data-detail=true]{flex-direction:column}.nv-route-shell[data-detail=true] .nv-route-main{min-height:180px}}
`;

/** 用户文案 for the three pathways a route can declare. */
export const PATHWAY_LABEL = { main: '主线', remedial: '条件补练', extension: '拓展' };
/** The two pathways that stay folded until a learner asks for them. */
export const FOLDED_PATHWAYS = ['remedial', 'extension'];

/** 已开课且已有小结 > 已开课 > 尚未开课：the legend the route bench draws. */
export function routeRoleOf(node) {
  if (node?.summary && (node.summary.path || node.summary.anchor)) return 'logged';
  return node?.sessionId ? 'opened' : 'lesson';
}

/** A summary lives in a real Markdown file at a stable block anchor. */
export function summaryTarget(summary) {
  if (!summary?.path) return '';
  return `${summary.path}${summary.anchor ? mediaLocatorSuffix({ kind: 'html-range', anchor: summary.anchor }) : ''}`;
}

/**
 * A node's pathway, defaulted instead of guessed: a route page written before
 * the field existed keeps the main line, so an older plan never turns into a
 * branch it never declared. An unknown value is the same kind of gap.
 */
export function pathwayOf(node) {
  const value = typeof node?.pathway === 'string' ? node.pathway.trim() : '';
  return Object.hasOwn(PATHWAY_LABEL, value) ? value : 'main';
}

/** 阶段名称, kept verbatim: it is the planner's own word, not a number to derive. */
export function stageOf(node) {
  return typeof node?.stage === 'string' ? node.stage.trim() : '';
}

/**
 * 课序在课程列表里的分阶段泳道. 阶段名称 is the planner's own word and the lanes keep
 * the order the plan declares them; a lesson with no stage is grouped as it is,
 * never renumbered into a 阶段 the plan never wrote.
 */
export function routeLanes(rows) {
  const lanes = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const stage = typeof row?.stage === 'string' ? row.stage : '';
    if (!lanes.has(stage)) lanes.set(stage, []);
    lanes.get(stage).push(row);
  }
  return [...lanes.entries()].map(([stage, items]) => ({ stage, items }));
}

/** One route card's real counts: 阶段 stops at the stage names the plan declares,
 * and 已有小结 counts real summary blocks — never a claim that a lesson is
 * mastered. A route with no lesson yet says so by counting zero. */
export function routeRailSummary(route, nodes) {
  const rows = (Array.isArray(nodes) ? nodes : []).filter(node => node && node.routePath === route?.path);
  return {
    total: rows.length,
    stages: new Set(rows.map(node => stageOf(node)).filter(Boolean)).size,
    logged: rows.filter(node => routeRoleOf(node) === 'logged').length,
    opened: rows.filter(node => routeRoleOf(node) === 'opened').length,
  };
}

/** What one node is, in the learner's words: which path it belongs to and which
 * stage it sits in. Rendered as the canvas node's own hint. */
export function nodeHint(item) {
  return [PATHWAY_LABEL[item?.pathway] ?? PATHWAY_LABEL.main, item?.stage ? `阶段 ${item.stage}` : ''].filter(Boolean).join(' · ');
}

/**
 * One route's lessons and their relations, ready for the canvas. Node ids are
 * route-local, so 课序 is read from each lesson's own `parent` whenever the route
 * declares one: two routes that both name a lesson `l1` can never borrow each
 * other's edges. Duplicate ids inside one route stay visible under a distinct
 * key instead of collapsing into a single node.
 *
 * Three relations stay three relations: 课序 is the order a learner follows,
 * 先修 is knowledge that makes a node easier to follow (declared on the node or
 * already projected as an edge — both spell the same single relation), and a
 * 条件分支 only says which node it leaves from; its trigger stays in the brief.
 */
export function routeProjection(payload, routePath) {
  const all = Array.isArray(payload?.nodes) ? payload.nodes : [];
  const lessons = all.filter(node => node && node.routePath === routePath);
  const keyOf = new Map(), nodes = [];
  for (const node of lessons) {
    const id = typeof node.id === 'string' && node.id ? node.id : '';
    if (!id) continue;
    const seen = keyOf.get(id) ?? 0;
    keyOf.set(id, seen + 1);
    const pathway = pathwayOf(node), stage = stageOf(node);
    nodes.push({ key: seen === 0 ? id : `${id}~${seen}`, title: node.title || id, role: routeRoleOf(node), pathway, stage, hint: nodeHint({ pathway, stage }), node });
  }
  const edges = [], signatures = new Set();
  const add = (kind, source, target) => {
    if (!keyOf.has(source) || !keyOf.has(target) || source === target) return;
    const signature = `${kind}\u0000${source}\u0000${target}`;
    if (signatures.has(signature)) return;
    signatures.add(signature);
    edges.push({ source, target, kind });
  };
  const declared = Array.isArray(payload?.edges) ? payload.edges.filter(edge=>!edge.routePath||edge.routePath===routePath) : [];
  // Braces keep the dangling `else` from binding to the inner `if`.
  if (lessons.some(node => node.parent)) {
    for (const node of lessons) if (node.parent) add(pathwayOf(node)==='main'?'sequence':'branch', node.parent, node.id);
  } else {
    for (const edge of declared) if (edge?.kind === 'sequence') add('sequence', edge.source, edge.target);
  }
  for (const node of lessons) for (const id of Array.isArray(node.prerequisites) ? node.prerequisites : []) add('prerequisite', id, node.id);
  // These relations come from this route's own nodes. The merged payload may
  // contain another route with the same legacy ids; never borrow its edges.
  return { nodes, edges };
}

/** One log row opens the real summary block it was indexed from. */
export function lessonLogTarget(hit) {
  return hit?.path ? summaryTarget({ path: hit.path, anchor: hit.anchor }) : '';
}

export function createVaultRoutes(React, { STYLE, IconButton, Dialog, CodeMirrorMarkdown,askTeacher:requestTeacher }) {
  const h = React.createElement;
  const { useState, useEffect, useMemo, useRef } = React;
  const { useRemembered, NodeMark, Board } = createVaultCanvas(React, { STYLE, IconButton });
  const { StarMap, StarLegend, StarReading, useSky } = createStarMap(React, { STYLE, IconButton });
  const sessions = new Map();
  const stateFor = sessionId => { if (!sessions.has(sessionId)) sessions.set(sessionId, {}); return sessions.get(sessionId); };
  const btn = (label, onClick, { className, ...extra } = {}) => h('button', { className: ['nv-quiet', className].filter(Boolean).join(' '), onClick, ...extra }, label);
  const day = value => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : ''; };
  /** One legend swatch carries the same `data-edge` the canvas line does, so the
   * legend and the drawn edge cannot drift apart. */
  const edgeSwatch = kind => h('svg', { width: 26, height: 10, viewBox: '0 0 26 10', 'aria-hidden': true },
    h('line', { x1: 0, y1: 5, x2: kind === 'sequence' ? 17 : 24, y2: 5, 'data-edge': kind }),
    kind === 'sequence' && h('polygon', { points: '17,2.5 25,5 17,7.5', 'data-edge': kind }));

  function useRoutes(vault, visible) {
    const [state, setState] = useState({ data: { routes: [], nodes: [], edges: [] }, loading: true, error: '', tick: 0 });
    const call = useRef(async () => {});
    call.current = async () => {
      try {
        const result = await vault.routes({});
        if (!result?.ok) throw new Error('read');
        setState(previous => ({ data: JSON.stringify(previous.data) === JSON.stringify(result.value) ? previous.data : result.value, loading: false, error: '', tick: previous.tick + 1 }));
      } catch { setState(previous => ({ ...previous, loading: false, error: '暂时无法读取学习路线，请稍后重试。' })); }
    };
    useEffect(() => {
      if (!visible) return;
      void call.current();
      const timer = setInterval(() => { void call.current(); }, 2500);
      const refresh = () => { void call.current(); };
      window.addEventListener('notara-vault-changed', refresh);
      window.addEventListener('focus', refresh);
      return () => { clearInterval(timer); window.removeEventListener('notara-vault-changed', refresh); window.removeEventListener('focus', refresh); };
    }, [vault, visible]);
    return [state, () => call.current()];
  }

  return function RoutesView(props) {
    // 路线、课堂日志和开课都读同一份本课工作区，不跨工作区借用根。
    const vault = useMemo(() => createVaultClient(props.ctx, props.sessionId), [props.ctx, props.sessionId]);
    const [state, refresh] = useRoutes(vault, props.visible);
    const store = stateFor(props.sessionId);
    const [selectedPath, setSelectedPath] = useRemembered(store, 'route', '');
    const [selected, setSelected] = useRemembered(store, 'lesson', '');
    // 主线 is the default view; 条件补练 and 拓展 are asked for explicitly.
    const [pathways, setPathways] = useRemembered(store, 'pathways', ['main']);
    const [stage, setStage] = useRemembered(store, 'stage', '');
    // 课程列表 reads 课序 as stages and lessons; 图谱 keeps the canvas. The list is
    // what a learner opens the bench for, so it is the default and the canvas
    // stays one press away — both read the same projection.
    const [view, setView] = useRemembered(store, 'routeView', 'list');
    const [paneWidth, setPaneWidth] = useRemembered(store, 'paneWidth', 320);
    const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [creating, setCreating] = useState(false), [overview, setOverview] = useState(false);
    const [title, setTitle] = useState(''), [lines, setLines] = useState('');
    const [log, setLog] = useState({ status: 'loading', hits: [], total: 0 });
    const [media, setMedia] = useState({});
    const root = useRef(null), resize = useRef(null);
    const routes = state.data?.routes ?? [];
    const route = routes.find(item => item.path === selectedPath) ?? routes[0];
    useEffect(() => { if (route && route.path !== selectedPath) setSelectedPath(route.path); }, [route?.path]);
    useEffect(() => {
      let live = true;
      const load = async () => {
        try {
          const result = await vault.lessonLog({ limit: 8 });
          if (live) setLog(result?.ok ? { status: 'ready', hits: result.value.hits ?? [], total: result.value.total ?? 0 } : { status: 'failed', hits: [], total: 0 });
        } catch { if (live) setLog({ status: 'failed', hits: [], total: 0 }); }
      };
      if (props.visible) void load();
      window.addEventListener('notara-vault-changed', load);
      return () => { live = false; window.removeEventListener('notara-vault-changed', load); };
    }, [vault, props.visible, state.tick]);

    const projection = useMemo(() => routeProjection(state.data, route?.path), [state.data, route?.path]);
    const byKey = useMemo(() => new Map(projection.nodes.map(row => [row.key, row])), [projection]);
    const byId = useMemo(() => { const map = new Map(); for (const row of projection.nodes) if (!map.has(row.node.id)) map.set(row.node.id, row); return map; }, [projection]);
    const hidden = row => (row.pathway !== 'main' && !pathways.includes(row.pathway)) || (stage !== '' && row.stage !== stage);
    const visibleNodes = useMemo(() => projection.nodes.filter(row => !hidden(row)), [projection, pathways, stage]);
    // The board keeps positions for the whole session, so an edge is only drawn
    // when both of its ends are really on screen.
    const visibleKeys = useMemo(() => new Set(visibleNodes.map(row => row.key)), [visibleNodes]);
    const visibleEdges = useMemo(() => projection.edges.filter(edge => visibleKeys.has(edge.source) && visibleKeys.has(edge.target)), [projection, visibleKeys]);
    // 星图 lights a lesson only from its real summary; the sky is laid out over
    // the whole route so folding a pathway never moves the main line.
    const forest = useSky() === 'forest';
    const starLayout = useMemo(() => view === 'stars' ? (forest ? routeForestLayout : routeStarLayout)(projection.nodes, projection.edges) : null, [projection, view, forest]);
    const courseStar = row => ({ key: row.key, title: row.title, kind: 'course', hint: row.hint, light: { role: row.role, savedAt: row.node?.summary?.savedAt ?? null }, node: row.node });
    const starNodes = useMemo(() => visibleNodes.map(courseStar), [visibleNodes]);
    // The 课程列表 reads the same 已筛选 rows, grouped by the stage names the plan
    // declares, and the route rail counts real summaries/sessions per route.
    const lanes = useMemo(() => routeLanes(visibleNodes), [visibleNodes]);
    const railRows = useMemo(() => (state.data?.routes ?? []).map(entry => ({ route: entry, summary: routeRailSummary(entry, state.data?.nodes) })), [state.data]);
    const item = byKey.get(selected);
    const lesson = item?.node;
    const parent = lesson?.parent ? byId.get(lesson.parent) : undefined;
    const prerequisites = (Array.isArray(lesson?.prerequisites) ? lesson.prerequisites : []).map(id => byId.get(typeof id === 'string' ? id : '')).filter(Boolean);
    const reachedByBranch = lesson ? projection.edges.filter(edge => edge.kind === 'branch' && edge.target === lesson.id).map(edge => byId.get(edge.source)).filter(Boolean) : [];
    const branchTargets = lesson ? projection.edges.filter(edge => edge.kind === 'branch' && edge.source === lesson.id).map(edge => byId.get(edge.target)).filter(Boolean) : [];
    const materials = Array.isArray(lesson?.materials) ? lesson.materials : [];
    // 正文只为真的 Markdown 渲染：缺字段是缺字段，不是一段被猜出来的内容。
    const overviewBody = typeof route?.overview === 'string' ? route.overview : '';
    const briefBody = typeof lesson?.brief === 'string' ? lesson.brief : '';
    // 规划正文里嵌的媒体按 revision 读一次，并作为编辑器 key 的一部分：资源换版
    // 后预览重建，而不是停在「媒体加载中…」。
    const embeds = useMemo(() => [...new Set([...`${overviewBody}\n${briefBody}`.matchAll(/!\[\[([^\]\n]+)\]\]/g)]
      .map(match => parseMediaTarget(match[1]).path).filter(path => path && !/\.md$/i.test(path)))], [overviewBody, briefBody]);
    useEffect(() => {
      if (!embeds.length) { setMedia({}); return undefined; }
      let live = true;
      void Promise.all(embeds.map(async path => { try { const result = await vault.readAsset({ path }); return [path, result?.ok ? result.value : null]; } catch { return [path, null]; } }))
        .then(rows => { if (!live) return; const next = {}; for (const [path, value] of rows) if (value) next[path] = value; setMedia(next); });
      return () => { live = false; };
    }, [vault, embeds]);
    const assetStamp = embeds.map(path => media[path]?.revision ?? '').join('|');
    // 恢复上次的选中、或跳到先修节点时，被选中的课必须真的看得见。
    useEffect(() => {
      const row = byKey.get(selected);
      if (!row || !hidden(row)) return;
      if (row.pathway !== 'main' && !pathways.includes(row.pathway)) setPathways(previous => previous.includes(row.pathway) ? previous : [...previous, row.pathway]);
      if (stage !== '' && row.stage !== stage) setStage(row.stage);
    }, [selected, projection, pathways, stage]);
    const reveal = row => {
      if (!row) return;
      if (row.pathway !== 'main' && !pathways.includes(row.pathway)) setPathways(previous => previous.includes(row.pathway) ? previous : [...previous, row.pathway]);
      if (stage !== '' && row.stage !== stage) setStage(row.stage);
    };
    const select = row => { if (!row) return; reveal(row); setNotice(''); setSelected(row.key); };
    /** A filter that hides the open lesson clears that selection instead of
     * leaving a detail pane the learner can no longer see the reason for. */
    const filter = (nextPathways, nextStage) => {
      if (item && ((item.pathway !== 'main' && !nextPathways.includes(item.pathway)) || (nextStage !== '' && item.stage !== nextStage))) setSelected('');
      setPathways(nextPathways); setStage(nextStage);
    };
    const togglePathway = (id, checked) => filter(checked ? [...pathways, id] : pathways.filter(value => value !== id), stage);
    // 路线改版后旧的阶段筛选可能不再匹配任何节点：读到节点后清掉它，而不是让画布
    // 只剩空态而看不出原因。还没有读到路线时不动用户的选择。
    useEffect(() => {
      if (!projection.nodes.length) return;
      if (stage && !projection.nodes.some(row => row.stage === stage)) setStage('');
    }, [stage, projection]);

    const openLesson = async (repeat=false) => {
      if (!lesson || busy) return;
      setNotice('');
      if (lesson.sessionId&&!repeat) { props.ctx.sessions.open(lesson.sessionId); return; }
      setBusy(true);
      try {
        const result = await vault.openRouteLesson({ path: route.path, nodeId: lesson.id, expectedRevision: route.revision, repeat });
        if (!result?.ok) { setNotice('这节课暂时打不开，请稍后重试。'); return; }
        await props.ctx.sessions.refresh();
        props.ctx.sessions.open(result.value.sessionId);
      } catch { setNotice('这节课暂时打不开，请稍后重试。'); }
      finally { setBusy(false); }
    };
    const create = async event => {
      event.preventDefault();
      const name = title.trim(), lessons = lines.split('\n').map(line => line.trim()).filter(Boolean);
      if (!name || !lessons.length) return;
      setBusy(true); setNotice('');
      try {
        const result = await vault.createRoute({ title: name, lessons: lessons.map((lessonTitle, index) => ({ title: lessonTitle, ...(index > 0 ? { parentIndex: index - 1 } : {}) })) });
        if (!result?.ok) { setNotice('路线没有建成，请检查名称后重试。'); return; }
        setCreating(false); setTitle(''); setLines('');
        setSelectedPath(result.value.path); setSelected('');
        await refresh();
      } catch { setNotice('路线没有建成，请稍后重试。'); }
      finally { setBusy(false); }
    };

    /** 请老师规划或调整这条路线: 走既有的输入框引用入口（和资产页「带入对话」
     * 同一条），把路线页面与一句要求放进草稿，由学习者自己按下发送。这里不新增
     * 写接口，也不列出任何工具名。 */
    const askTeacher = () => {
      if (!route || typeof requestTeacher !== 'function') return;
      const sent = requestTeacher(props.ctx, props.sessionId, { path: route.path, revision: route.revision, title: route.title },
        '请结合真实学习记录检查这份路线的目标、顺序、先修和练习安排，按需要局部调整未来课程，保留已开展课堂与原有记录。', props.openView);
      setNotice(sent ? '' : '当前对话输入框正在变化，请稍后重试。');
    };

    const tools = h(React.Fragment, null,
      // 课程列表 is the reading surface and 图谱 keeps the canvas interaction the
      // bench already had; the switch never changes which lessons are visible.
      h('div', { className: 'nv-route-views', role: 'group', 'aria-label': '路线视图' },
        [['list', '课程列表'], ['graph', '图谱'], ['stars', forest ? '森林' : '星图']].map(([id, label]) => h('button', {
          key: id, type: 'button', 'aria-pressed': view === id, onClick: () => setView(id),
        }, label))),
      routes.length ? h('select', { 'aria-label': '学习路线', style: { ...STYLE.templateInput, width: 200, margin: 0 }, value: route?.path ?? '', onChange: event => { setSelectedPath(event.target.value); setSelected(''); } }, routes.map(option => h('option', { key: option.path, value: option.path }, option.title || option.path))) : null,
      h(IconButton, { icon: 'plus', label: '新建路线', onClick: () => setCreating(true) }),
      h(IconButton, { icon: 'refresh', label: '刷新路线', onClick: () => { void refresh(); } }),
      // 查看规划 opens the real route page; a stable block anchor is not invented
      // when the projection does not name one.
      route && h(IconButton, { icon: 'book', label: '查看规划', onClick: () => props.openView(VIEW_IDS.assets, route.path) }),
      route && typeof requestTeacher === 'function' && h(IconButton, { icon: 'chat', label: '请老师规划或调整', onClick: askTeacher }));

    const stageOptions = [...new Set(projection.nodes.map(row => row.stage).filter(Boolean))];
    const foldedCounts = FOLDED_PATHWAYS.map(id => [id, projection.nodes.filter(row => row.pathway === id).length]);
    const filters = foldedCounts.some(([, count]) => count > 0) || stageOptions.length > 1
      ? h('div', { className: 'nv-route-filters', role: 'group', 'aria-label': '路线筛选' },
          h('span', null, `显示：${PATHWAY_LABEL.main}`),
          foldedCounts.map(([id, count]) => count > 0 && h('label', { key: id },
            h('input', { type: 'checkbox', checked: pathways.includes(id), onChange: event => togglePathway(id, event.target.checked) }),
            `${PATHWAY_LABEL[id]} ${count}`)),
          stageOptions.length > 1 && h('label', null, '阶段', h('select', { 'aria-label': '阶段筛选', value: stage, onChange: event => filter(pathways, event.target.value) },
            h('option', { value: '' }, '全部阶段'), stageOptions.map(value => h('option', { key: value, value }, value)))))
      : null;

    const sequenceCount = projection.edges.filter(edge => edge.kind === 'sequence').length;
    const edgeKinds = new Set(projection.edges.map(edge => edge.kind));
    const status = notice || state.error || (state.loading && !routes.length ? '正在读取…' : route
      ? `${projection.nodes.length} 节课 · ${sequenceCount} 段接续${projection.nodes.length > visibleNodes.length ? ` · 显示 ${visibleNodes.length} 节` : ''}`
      : '还没有学习路线');

    // 路线总述 comes from the route page itself and is folded by default: one
    // body, no second copy of the plan in local state.
    const overviewBlock = overviewBody.trim() ? h('details', { className: 'nv-route-overview', open: overview, onToggle: event => setOverview(event.target.open) },
      h('summary', null, '路线总述'),
      overview && h('div', { className: 'nv-route-body' },
        h(CodeMirrorMarkdown, { key: `overview:${route.path}:${route.revision}:${assetStamp}`, content: overviewBody, assets: media, readOnly: true,
          onOpenPage: path => props.openView(VIEW_IDS.assets, path), onTag: tag => props.openView(VIEW_IDS.graph, 'tag:' + encodeURIComponent(tag)) }))) : null;
    const logBlock = h('details', { className: 'nv-route-log' },
      h('summary', null, log.status === 'loading' ? '课堂日志' : log.status === 'failed' ? '课堂日志暂时读不出来' : `课堂日志 · ${log.total} 次课堂`),
      log.status === 'failed'
        ? h('p', { role: 'alert', style: { margin: '8px 0 0' } }, '课堂日志暂时读不出来。')
        : !log.hits.length
          ? h('p', { style: { margin: '8px 0 0' } }, '还没有已归档的课堂小结。')
          : h('ul', null, log.hits.map(hit => h('li', { key: `${hit.sessionId}:${hit.path}:${hit.anchor}` },
              h('button', { className: 'nv-link', style: STYLE.link, onClick: () => props.openView(VIEW_IDS.assets, lessonLogTarget(hit)) }, hit.title || '课堂小结'),
              h('span', null, [day(hit.throughAt), (hit.subjects ?? []).join('、')].filter(Boolean).join(' · ')),
              hit.continuation && h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, hit.continuation)))));
    /** 三种真实的空态各有各的说法，也能各自新建一条路线。 */
    const emptyState = !routes.length && !state.loading
      ? h('div', { style: STYLE.empty }, h('p', { style: { marginBottom: 14 } }, '还没有学习路线。'), btn('新建路线', () => setCreating(true)))
      : !projection.nodes.length
        ? h('div', { style: STYLE.empty }, h('p', { style: { marginBottom: 14 } }, '这条路线还没有课程。'), btn('新建路线', () => setCreating(true)))
        : !visibleNodes.length
          ? h('div', { style: STYLE.empty }, h('p', null, '当前筛选下没有课程。可以切换阶段，或展开补练与拓展。'))
          : null;
    // 详情栏 is one pane for both views, opened by the same selected node key and
    // closed the same way, so a lesson never has two different readings.
    const detailPane = !lesson ? null : h(React.Fragment, null,
      h('div', { className: 'nv-resize', role: 'separator', 'aria-label': '调整详情宽度', 'aria-orientation': 'vertical', 'aria-valuenow': paneWidth, tabIndex: 0,
        onKeyDown: event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setPaneWidth(width => Math.max(240, Math.min(800, width + (event.key === 'ArrowLeft' ? 20 : -20)))); } },
        onPointerDown: event => { resize.current = { x: event.clientX, width: paneWidth }; event.currentTarget.setPointerCapture(event.pointerId); },
        onPointerMove: event => { if (resize.current) setPaneWidth(Math.max(240, Math.min(root.current.clientWidth - 200, resize.current.width + resize.current.x - event.clientX))); },
        onPointerUp: event => { resize.current = null; event.currentTarget.releasePointerCapture(event.pointerId); },
        onPointerCancel: () => { resize.current = null; } }),
      h('aside', { className: 'nv-graph-pane', 'aria-label': '课程详情' },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
          h('span', { style: STYLE.notice }, [LESSON_ROLES[item?.role], item?.hint].filter(Boolean).join(' · ')),
          h(IconButton, { icon: 'close', label: '关闭详情', onClick: () => setSelected('') })),
        h('h2', null, lesson.title), h('p', { style: STYLE.path }, route.title || route.path),
        view === 'stars' && item && h(StarReading, { star: courseStar(item) }),
        // 课序、先修、条件分支 keep three different sentences: a 先修 list is
        // knowledge to have, and never a lock on opening this lesson.
        parent && h('p', { style: STYLE.notice }, '接续：', h('button', { className: 'nv-link', style: STYLE.link, onClick: () => select(parent) }, parent.title)),
        prerequisites.length > 0 && h('p', { style: STYLE.notice },
          '先修：',
          prerequisites.map((row, index) => h('button', { key: row.key, className: 'nv-link', style: STYLE.link, onClick: () => select(row) }, `${index ? '、' : ''}${row.title}`)),
          '（需要先具备的知识，不限制开课。）'),
        reachedByBranch.length > 0 && h('p', { style: STYLE.notice },
          `条件分支：从《${reachedByBranch.map(row => row.title).join('、')}》满足条件时才走这里；具体条件写在下面的课程说明里。`),
        branchTargets.length > 0 && h('p', { style: STYLE.notice },
          '分支：',
          branchTargets.map(row => h('button', { key: row.key, className: 'nv-link', style: STYLE.link, onClick: () => select(row) }, `${PATHWAY_LABEL[row.pathway]}《${row.title}》`)),
          '（满足课程说明里的条件时再走。）'),
        h('h3', { style: { fontSize: 13, margin: '18px 0 8px' } }, '课程说明'),
        briefBody
          ? h('div', { className: 'nv-route-brief' },
              h(CodeMirrorMarkdown, { key: `brief:${lesson.id}:${assetStamp}`, content: briefBody, assets: media, readOnly: true,
                onOpenPage: path => props.openView(VIEW_IDS.assets, path), onTag: tag => props.openView(VIEW_IDS.graph, 'tag:' + encodeURIComponent(tag)) }))
          : h('p', { style: STYLE.notice }, '这条路线的这节课还没有规划说明。'),
        materials.length > 0 && h(React.Fragment, null,
          h('h3', { style: { fontSize: 13, margin: '18px 0 8px' } }, `材料 ${materials.length}`),
          h('ul', { style: { listStyle: 'none', margin: 0, padding: 0 } },
            materials.map(path => h('li', { key: path }, h('button', { className: 'nv-link', style: { ...STYLE.link, textAlign: 'left', fontSize: 12 }, onClick: () => props.openView(VIEW_IDS.assets, path) }, path))))),
        lesson.scriptPath && h('p', { style: STYLE.notice }, '剧本：', h('button', { className: 'nv-link', style: STYLE.link, onClick: () => props.openView(VIEW_IDS.assets, lesson.scriptPath) }, lesson.scriptPath)),
        h('div', { className: 'nv-route-actions', style: { marginTop: 16 } },
          h('button', { className: 'nv-quiet', disabled: busy, onClick: () => openLesson() }, lesson.sessionId ? '回到这节课' : '开始这节课'),
          lesson.sessionId&&h(IconButton,{icon:'plus',label:'再学一次',disabled:busy,onClick:()=>openLesson(true)}),
          lesson.scheduledOn&&h(IconButton,{icon:'calendar',label:'在日历中查看',onClick:()=>props.openView(VIEW_IDS.calendar,lesson.scheduledOn)}),
          lesson.scriptPath && h(IconButton, { icon: 'book', label: '查看剧本', onClick: () => props.openView(VIEW_IDS.assets, lesson.scriptPath) }),
          h(IconButton, { icon: 'log', label: '查看小结', disabled: !lesson.summary?.path, onClick: () => props.openView(VIEW_IDS.assets, summaryTarget(lesson.summary)) })),
        h('label', { style: { display:'block', marginTop:16, fontSize:12, color:'var(--dsw-alias-label-secondary)' } }, '安排日期', h('input', { type:'date', 'aria-label':'课程安排日期', disabled:busy, value:lesson.scheduledOn??'', style:{...STYLE.templateInput,marginTop:6}, onChange:async event=>{
          const date=event.target.value||null;setBusy(true);setNotice('');
          try{const result=await vault.scheduleLesson({path:route.path,nodeId:lesson.id,date,expectedRevision:route.revision});if(!result?.ok)throw new Error('write');await refresh();window.dispatchEvent(new Event('notara-vault-changed'));}
          catch{setNotice('日期没有保存，资料可能已修改，请刷新后重试。');}
          finally{setBusy(false);}
        } })),
        lesson.summary?.path
          ? h('div', null,
              h('h3', { style: { fontSize: 13, margin: '18px 0 8px' } }, lesson.summary.title || '本课小结'),
              lesson.summary.continuation && h('p', { style: STYLE.notice }, lesson.summary.continuation))
          : h('p', { style: STYLE.notice }, '这节课还没有小结。')));
    /** One lesson card in 课程列表: the same accessible name the canvas node
     * carries, so both views name the same lesson the same way. */
    const nodeCard = row => {
      const scheduled = typeof row.node?.scheduledOn === 'string' ? row.node.scheduledOn : '';
      const prerequisiteCount = Array.isArray(row.node?.prerequisites) ? row.node.prerequisites.length : 0;
      return h('button', { key: row.key, type: 'button', className: 'nv-route-node', 'data-pathway': row.pathway,
        'aria-label': `路线节点 ${row.title}`, 'aria-pressed': selected === row.key, onClick: () => select(row) },
        h('span', { className: 'nv-route-kind' }, [PATHWAY_LABEL[row.pathway], prerequisiteCount ? `先修 ${prerequisiteCount}` : ''].filter(Boolean).join(' · ')),
        h('b', null, row.title),
        h('span', { className: 'nv-route-state' },
          h('span', { className: 'nv-route-badge', 'data-role': row.role }, LESSON_ROLES[row.role] ?? LESSON_ROLES.lesson),
          // 已安排 is a date the plan really carries; a lesson that already has a
          // classroom keeps 已开课 instead of claiming a future appointment.
          scheduled && !row.node?.sessionId && h('span', { className: 'nv-route-badge', 'data-role': 'scheduled' }, `已安排 ${day(scheduled)}`)));
    };
    const percent = (count, total) => total ? `${Math.round(count / total * 100)}%` : '0';
    /** 路线列表 keeps every route visible with its real counts, so 已有小结 can
     * never be read as 已掌握 and an empty route says 0 节课. */
    const rail = railRows.length ? h('nav', { className: 'nv-route-rail', 'aria-label': '路线列表' },
      railRows.map(row => h('button', { key: row.route.path, type: 'button', className: 'nv-route-card',
        'aria-current': route?.path === row.route.path, onClick: () => { setSelectedPath(row.route.path); setSelected(''); } },
        h('b', null, row.route.title || row.route.path),
        h('small', null, [row.summary.stages ? `${row.summary.stages} 个阶段` : '', `${row.summary.total} 节课`, row.summary.logged ? `已有小结 ${row.summary.logged}` : ''].filter(Boolean).join(' · ')),
        h('span', { className: 'nv-route-progress', 'aria-hidden': true },
          h('i', { 'data-part': 'logged', style: { width: percent(row.summary.logged, row.summary.total) } }),
          h('i', { 'data-part': 'opened', style: { width: percent(row.summary.opened, row.summary.total) } }))))) : null;
    const listLayout = h('div', { className: 'nv-route-shell', 'data-detail': !!lesson },
      rail,
      h('div', { ref: root, className: 'nv-graph-layout', 'data-detail': !!lesson, style: { '--nv-pane-width': paneWidth + 'px', position: 'relative', minWidth: 0 } },
      h('div', { className: 'nv-route-main' },
        overviewBlock,
        filters,
        emptyState ? h('div', { className: 'nv-route-empty' }, emptyState) : h('div', { className: 'nv-route-lanes' },
          lanes.map((lane, index) => h('div', { key: lane.stage || `lane-${index}`, className: 'nv-route-lane' },
            (lanes.length > 1 || lane.stage) && h('div', { className: 'nv-route-lane-head' }, h('b', null, lane.stage ? `阶段 ${index + 1}` : '课程'), lane.stage || null),
            lane.items.map(nodeCard)))),
        logBlock),
      detailPane));
    const graphLayout = h(React.Fragment, null,
      overviewBlock, filters, logBlock,
      h('div', { ref: root, className: 'nv-graph-layout', 'data-detail': !!lesson, style: { '--nv-pane-width': paneWidth + 'px', position: 'relative' } },
        emptyState ?? h(Board, { nodes: visibleNodes, edges: visibleEdges, selected, state: store, nodeName: '路线节点', label: '学习路线课序', onSelect: node => select(byKey.get(node.key)) }),
        detailPane));
    const starsLayout = h(React.Fragment, null,
      overviewBlock, filters, logBlock,
      h('div', { ref: root, className: 'nv-graph-layout', 'data-detail': !!lesson, style: { '--nv-pane-width': paneWidth + 'px', position: 'relative' } },
        emptyState ?? h(StarMap, { nodes: starNodes, edges: visibleEdges, layout: starLayout, selected, state: store, fitKey: `${route?.path ?? ''}|${pathways.join(',')}|${stage}`, nodeName: '路线节点', label: forest ? '课程森林' : '课程星图', onSelect: node => select(byKey.get(node.key)) }),
        detailPane));
    const legend = view === 'stars' ? h(StarLegend, { mode: 'course' }) : h('div', { className: 'nv-legend' },
      Object.entries(LESSON_ROLES).map(([role, label]) => h('span', { key: role }, h('svg', { width: 24, height: 26, viewBox: '-20 -20 40 40', 'aria-hidden': true }, h(NodeMark, { role })), label)),
      // 条件补练/拓展 are drawn as dashed cards and 先修 as a count on the card, so
      // the edge swatches belong to the canvas where those lines really exist.
      view === 'graph' && edgeKinds.has('sequence') && h('span', { key: 'sequence', title: '课序：接着上面这一节继续' }, edgeSwatch('sequence'), '课序'),
      view === 'graph' && edgeKinds.has('prerequisite') && h('span', { key: 'prerequisite', title: '先修：需要先具备的知识前提，不限制开课' }, edgeSwatch('prerequisite'), '先修'),
      view === 'graph' && edgeKinds.has('branch') && h('span', { key: 'branch', title: '条件分支：满足课程说明里的条件时才走' }, edgeSwatch('branch'), '条件分支'),
      view === 'list' && h('span', { key: 'folded' }, '虚线框：条件补练 / 拓展'),
      view === 'list' && h('span', { key: 'record' }, '有小结不等于已掌握'));

    return h('div', { className: 'nv-views', style: STYLE.page }, h('style', null, ROUTE_CSS), h('style', null, CANVAS_CSS), h('style', null, STAR_CSS),
      h('header', { className: 'nv-view-top' }, h('strong', { style: STYLE.brand }, '路线'), tools,
        h('span', { role: 'status', style: { ...STYLE.notice, marginLeft: 'auto' } }, status)),
      view === 'list' ? listLayout : view === 'stars' ? starsLayout : graphLayout,
      legend,
      creating && h(Dialog, { title: '新建路线', onClose: () => setCreating(false) },
        h('form', { onSubmit: create },
          h('label', null, '路线名称', h('input', { 'aria-label': '路线名称', style: STYLE.templateInput, value: title, onChange: event => setTitle(event.target.value) })),
          h('label', null, '课程名称（每行一节，按上课顺序）', h('textarea', { 'aria-label': '课程名称', style: { ...STYLE.templateInput, minHeight: 120 }, value: lines, onChange: event => setLines(event.target.value) })),
          h('p', { style: STYLE.notice }, '课程按填写顺序排成接续关系；也可以直接在对话里让老师按资料规划路线。'),
          h('button', { type: 'submit', className: 'nv-quiet', disabled: busy || !title.trim() || !lines.split('\n').some(line => line.trim()) }, busy ? '正在创建…' : '创建路线'))));
  };
}
