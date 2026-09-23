/**
 * The route bench: one independent view for 课序, drawn on the same canvas as
 * the knowledge graph. Nothing here reads the file projection — `routes({})`
 * already returns real lesson nodes, their real session binding and the real
 * summary block, so a planned lesson is never mistaken for a card and 课序 never
 * becomes a knowledge split.
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
  const sessions = new Map();
  const stateFor = sessionId => { if (!sessions.has(sessionId)) sessions.set(sessionId, {}); return sessions.get(sessionId); };
  const btn = (label, onClick, extra = {}) => h('button', { style: STYLE.quiet, onClick, ...extra }, label);
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

    return h('div', { className: 'nv-views', style: STYLE.page }, h('style', null, ROUTE_CSS), h('style', null, CANVAS_CSS),
      h('header', { className: 'nv-view-top' }, h('strong', { style: STYLE.brand }, '路线'), tools,
        h('span', { role: 'status', style: { ...STYLE.notice, marginLeft: 'auto' } }, status)),
      // 路线总述 comes from the route page itself and is folded by default: one
      // body, no second copy of the plan in local state.
      overviewBody.trim() ? h('details', { className: 'nv-route-overview', open: overview, onToggle: event => setOverview(event.target.open) },
        h('summary', null, '路线总述'),
        overview && h('div', { className: 'nv-route-body' },
          h(CodeMirrorMarkdown, { key: `overview:${route.path}:${route.revision}:${assetStamp}`, content: overviewBody, assets: media, readOnly: true,
            onOpenPage: path => props.openView(VIEW_IDS.assets, path), onTag: tag => props.openView(VIEW_IDS.graph, 'tag:' + encodeURIComponent(tag)) }))) : null,
      filters,
      h('details', { className: 'nv-route-log' },
        h('summary', null, log.status === 'loading' ? '课堂日志' : log.status === 'failed' ? '课堂日志暂时读不出来' : `课堂日志 · ${log.total} 次课堂`),
        log.status === 'failed'
          ? h('p', { role: 'alert', style: { margin: '8px 0 0' } }, '课堂日志暂时读不出来。')
          : !log.hits.length
            ? h('p', { style: { margin: '8px 0 0' } }, '还没有已归档的课堂小结。')
            : h('ul', null, log.hits.map(hit => h('li', { key: `${hit.sessionId}:${hit.path}:${hit.anchor}` },
                h('button', { style: STYLE.link, onClick: () => props.openView(VIEW_IDS.assets, lessonLogTarget(hit)) }, hit.title || '课堂小结'),
                h('span', null, [day(hit.throughAt), (hit.subjects ?? []).join('、')].filter(Boolean).join(' · ')),
                hit.continuation && h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, hit.continuation))))),
      h('div', { ref: root, className: 'nv-graph-layout', 'data-detail': !!lesson, style: { '--nv-pane-width': paneWidth + 'px', position: 'relative' } },
        !routes.length && !state.loading
          ? h('div', { style: STYLE.empty }, h('p', { style: { marginBottom: 14 } }, '还没有学习路线。'), btn('新建路线', () => setCreating(true)))
          : !projection.nodes.length
            ? h('div', { style: STYLE.empty }, h('p', { style: { marginBottom: 14 } }, '这条路线还没有课程。'), btn('新建路线', () => setCreating(true)))
            : !visibleNodes.length
              ? h('div', { style: STYLE.empty }, h('p', null, '当前筛选下没有课程。可以切换阶段，或展开补练与拓展。'))
              : h(Board, { nodes: visibleNodes, edges: visibleEdges, selected, state: store, nodeName: '路线节点', label: '学习路线课序', onSelect: node => select(byKey.get(node.key)) }),
        lesson && h(React.Fragment, null,
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
            // 课序、先修、条件分支 keep three different sentences: a 先修 list is
            // knowledge to have, and never a lock on opening this lesson.
            parent && h('p', { style: STYLE.notice }, '接续：', h('button', { style: STYLE.link, onClick: () => select(parent) }, parent.title)),
            prerequisites.length > 0 && h('p', { style: STYLE.notice },
              '先修：',
              prerequisites.map((row, index) => h('button', { key: row.key, style: STYLE.link, onClick: () => select(row) }, `${index ? '、' : ''}${row.title}`)),
              '（需要先具备的知识，不限制开课。）'),
            reachedByBranch.length > 0 && h('p', { style: STYLE.notice },
              `条件分支：从《${reachedByBranch.map(row => row.title).join('、')}》满足条件时才走这里；具体条件写在下面的课程说明里。`),
            branchTargets.length > 0 && h('p', { style: STYLE.notice },
              '分支：',
              branchTargets.map(row => h('button', { key: row.key, style: STYLE.link, onClick: () => select(row) }, `${PATHWAY_LABEL[row.pathway]}《${row.title}》`)),
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
                materials.map(path => h('li', { key: path }, h('button', { style: { ...STYLE.link, textAlign: 'left', fontSize: 12 }, onClick: () => props.openView(VIEW_IDS.assets, path) }, path))))),
            lesson.scriptPath && h('p', { style: STYLE.notice }, '剧本：', h('button', { style: STYLE.link, onClick: () => props.openView(VIEW_IDS.assets, lesson.scriptPath) }, lesson.scriptPath)),
            h('div', { className: 'nv-route-actions', style: { marginTop: 16 } },
              h('button', { style: STYLE.quiet, disabled: busy, onClick: () => openLesson() }, lesson.sessionId ? '回到这节课' : '开始这节课'),
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
              : h('p', { style: STYLE.notice }, '这节课还没有小结。')))),
      h('div', { className: 'nv-legend' },
        Object.entries(LESSON_ROLES).map(([role, label]) => h('span', { key: role }, h('svg', { width: 24, height: 26, viewBox: '-20 -20 40 40', 'aria-hidden': true }, h(NodeMark, { role })), label)),
        edgeKinds.has('sequence') && h('span', { key: 'sequence', title: '课序：接着上面这一节继续' }, edgeSwatch('sequence'), '课序'),
        edgeKinds.has('prerequisite') && h('span', { key: 'prerequisite', title: '先修：需要先具备的知识前提，不限制开课' }, edgeSwatch('prerequisite'), '先修'),
        edgeKinds.has('branch') && h('span', { key: 'branch', title: '条件分支：满足课程说明里的条件时才走' }, edgeSwatch('branch'), '条件分支')),
      creating && h(Dialog, { title: '新建路线', onClose: () => setCreating(false) },
        h('form', { onSubmit: create },
          h('label', null, '路线名称', h('input', { 'aria-label': '路线名称', style: STYLE.templateInput, value: title, onChange: event => setTitle(event.target.value) })),
          h('label', null, '课程名称（每行一节，按上课顺序）', h('textarea', { 'aria-label': '课程名称', style: { ...STYLE.templateInput, minHeight: 120 }, value: lines, onChange: event => setLines(event.target.value) })),
          h('p', { style: STYLE.notice }, '课程按填写顺序排成接续关系；也可以直接在对话里让老师按资料规划路线。'),
          h('button', { type: 'submit', style: STYLE.quiet, disabled: busy || !title.trim() || !lines.split('\n').some(line => line.trim()) }, busy ? '正在创建…' : '创建路线'))));
  };
}
