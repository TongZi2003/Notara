import type { Context } from '@deepseek-ai/cordis';
import type { CardView } from '@studyforge/contracts/cards';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { RouteNode, RouteNodeInputDraft, RouteNodePatchDraft, RouteView, RouteNativeLesson } from '@studyforge/contracts/routes';
import type { TeachingChoice } from '@studyforge/contracts/teaching';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CourseMapCanvas, type CourseGraphNode } from './CourseMapCanvas.tsx';
import { type MapPoint } from './map-geometry.ts';
import { RouteEditor } from './RouteEditor.tsx';
import { LessonResults } from './LessonResults.tsx';
import { civilDayIn, effectiveDecl, materialLabel, refusalCode } from './format.ts';
import type { NativeLessonRow } from './CourseMap.tsx';

interface Loaded {
  route: RouteView; native: RouteNativeLesson[]; materials: MaterialView[]; cards: CardView[];
  choices: TeachingChoice[]; timeZone: string;
}
type Range = { from: string; to: string };
interface Entry { graph: CourseGraphNode; route?: RouteNode; native?: RouteNativeLesson }
const FAILURE: Record<string, string> = {
  route_cycle: '不能把一节课接到自己的后代下面。',
  route_node_conflict: '这一节刚有修改，已重新读取。你的草稿还在，请核对后再保存。',
  workspace_mismatch: '这节课不属于当前学习空间，请重新选择。',
  route_parent_missing: '前一节已经不在，请重新选择。',
};

/** The graph is a read projection; only a deliberate placement/mount binds a native lesson. */
export function CourseRoadmap({ ctx, lessons, currentSessionId, onOpenLesson }: {
  ctx: Context; lessons: readonly NativeLessonRow[]; currentSessionId?: string; onOpenLesson(id: string): void;
}): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded>();
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState<{ node: RouteNode | null }>();
  const [range, setRange] = useState<Range>();
  const [query, setQuery] = useState(''), [line, setLine] = useState('');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const requests = useRef(new Map<string, string>()), generation = useRef(0);
  const op = (key: string): string => { let value = requests.current.get(key); if (!value) { value = crypto.randomUUID(); requests.current.set(key, value); } return value; };
  const load = useCallback(async (): Promise<Loaded | undefined> => {
    const at = ++generation.current;
    try {
      const [route, native, materials, cards, choices, calendar] = await Promise.all([
        ctx.remote.studyforgeOrganization.route(), ctx.remote.studyforgeOrganization.routeLessons(),
        ctx.remote.studyforgeMaterials.list(), ctx.remote.studyforgeLearning.cards(),
        ctx.remote.studyforgeTeaching.choices(), ctx.remote.studyforgeCalendar.settings(),
      ]);
      if (at !== generation.current) return;
      if (!route.ok || !native.ok) { setNotice('课程暂时未能读全，请重试。'); return; }
      const next: Loaded = { route: route.value, native: native.value, materials: materials.ok ? materials.value : [],
        cards: cards.ok ? cards.value : [], choices: choices.ok ? choices.value : [],
        timeZone: calendar.ok ? calendar.value.timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone };
      setLoaded(next); setNotice(''); return next;
    } catch { if (at === generation.current) setNotice('课程暂时未能读取，请重试。'); return; }
  }, [ctx]);
  const lessonSignature = lessons.map(item => item.id + ':' + item.title + ':' + String(item.running)).join('|');
  useEffect(() => { void load(); const reload = (): void => { void load(); }; window.addEventListener('focus', reload); return () => { generation.current++; window.removeEventListener('focus', reload); }; }, [load, lessonSignature]);
  const entries = loaded ? projectEntries(loaded, lessons, currentSessionId) : [];
  const byKey = new Map(entries.map(entry => [entry.graph.key, entry]));
  const rootOf = (key: string): string => { let current = key; const seen = new Set<string>(); while (!seen.has(current)) { seen.add(current); const parent = byKey.get(current)?.graph.parent; if (!parent || !byKey.has(parent)) break; current = parent; } return current; };
  const roots = entries.filter(entry => !entry.graph.parent);
  const term = query.trim().toLocaleLowerCase();
  const matches = new Set(entries.filter(({ graph }) => (!line || rootOf(graph.key) === line)
    && (!term || (graph.title + ' ' + graph.preview).toLocaleLowerCase().includes(term))
    && (!range || Boolean(graph.date && graph.date >= range.from && graph.date <= range.to))).map(entry => entry.graph.key));
  const visible = new Set(matches);
  for (const key of matches) { let parent = byKey.get(key)?.graph.parent; while (parent && !visible.has(parent)) { visible.add(parent); parent = byKey.get(parent)?.graph.parent; } }
  const nodes = entries.filter(entry => visible.has(entry.graph.key)).map(entry => ({ ...entry.graph, matches: matches.has(entry.graph.key) }));
  const active = selected ? byKey.get(selected) : undefined;

  function showRoute(route: RouteView): void { setLoaded(previous => previous ? { ...previous, route } : previous); }
  async function ensureNode(key: string, route: RouteView, ancestors = new Set<string>()): Promise<{ route: RouteView; node: RouteNode }> {
    const entry = byKey.get(key); if (!entry) throw new Error('课程已变化，请重新选择。');
    const sessionId = entry.native?.sessionId ?? entry.route?.session?.sessionId;
    const existing = route.nodes.find(node => node.id === entry.route?.id || sessionId && node.session?.sessionId === sessionId);
    if (existing) return { route, node: existing };
    if (!sessionId) throw new Error('课程已变化，请重新选择。');
    if (ancestors.has(key)) throw new Error('课程接续关系需要重新读取。');
    ancestors.add(key);
    // Binding is part of this explicit placement. Materialize the real lineage
    // first so the Host can preserve it when adding the child atomically.
    if (entry.graph.parent) await ensureNode(entry.graph.parent, route, ancestors);
    const reply = await ctx.remote.studyforgeOrganization.bindNativeLesson({ operationId: op('bind:' + sessionId), nativeSessionId: sessionId });
    if (!reply.ok) throw reply.error;
    const node = reply.value.nodes.find(item => item.session?.sessionId === sessionId);
    if (!node) throw new Error('这节课还没放进路线图，请重试。');
    showRoute(reply.value); return { route: reply.value, node };
  }
  async function change(key: string, task: () => Promise<void>): Promise<void> {
    if (busy) return; setBusy(true); setNotice('');
    try { await task(); requests.current.delete(key); }
    catch (error) {
      const code = error && typeof error === 'object' && 'message' in error ? refusalCode({ message: String(error.message) }) : '';
      await load(); setNotice(FAILURE[code] ?? '这次修改未完成，请重试；已有内容仍保留。');
    } finally { setBusy(false); }
  }
  async function place(key: string, position: MapPoint | null): Promise<void> {
    const signature = 'place:' + key + ':' + JSON.stringify(position);
    await change(signature, async () => {
      if (!loaded) return; const bound = await ensureNode(key, loaded.route);
      const reply = await ctx.remote.studyforgeOrganization.setRouteLayout({ operationId: op(signature), positions: [{ nodeId: bound.node.id, position }] });
      if (!reply.ok) throw reply.error; showRoute(reply.value);
    });
  }
  async function mount(key: string, parentKey: string): Promise<void> {
    const signature = 'mount:' + key + ':' + parentKey;
    await change(signature, async () => {
      if (!loaded) return; const bound = await ensureNode(key, loaded.route);
      const parent = parentKey ? await ensureNode(parentKey, bound.route) : undefined;
      const route = parent?.route ?? bound.route;
      const reply = await ctx.remote.studyforgeOrganization.mountRouteNode({ operationId: op(signature), nodeId: bound.node.id, expectedVersion: route.version, parent: parent?.node.id ?? null });
      if (!reply.ok) throw reply.error; showRoute(reply.value); setSelected(bound.node.id);
    });
  }
  async function tidy(): Promise<void> {
    const signature = 'tidy:' + nodes.map(node => node.key).join(',');
    await change(signature, async () => {
      if (!loaded) return;
      // Removing only visible saved positions keeps hidden branches intact.
      const placed = loaded.route.layout.filter(position => visible.has(position.nodeId));
      if (!placed.length) return;
      const reply = await ctx.remote.studyforgeOrganization.setRouteLayout({ operationId: op(signature), positions: placed.map(position => ({ nodeId: position.nodeId, position: null })) });
      if (!reply.ok) throw reply.error; showRoute(reply.value);
    });
  }
  async function open(key: string): Promise<void> {
    const entry = byKey.get(key); if (!entry) return;
    const sessionId = entry.native?.sessionId ?? entry.route?.session?.sessionId;
    if (sessionId) { onOpenLesson(sessionId); return; }
    if (!entry.route) return; const node = entry.route, signature = 'open:' + node.id;
    await change(signature, async () => {
      const reply = await ctx.remote.studyforgeOrganization.openPlannedLesson({ operationId: op(signature), nodeId: node.id });
      if (!reply.ok) throw reply.error; onOpenLesson(reply.value.sessionId);
    });
  }
  async function save(draft: RouteNodeInputDraft | RouteNodePatchDraft): Promise<void> {
    if (!loaded || !editing) return; const node = editing.node, signature = 'edit:' + (node?.id ?? 'new') + ':' + JSON.stringify(draft);
    await change(signature, async () => {
      const reply = node ? await ctx.remote.studyforgeOrganization.editRouteNode({ operationId: op(signature), nodeId: node.id, expectedVersion: loaded.route.version, patch: draft })
        : await ctx.remote.studyforgeOrganization.addRouteNode({ operationId: op(signature), node: draft as RouteNodeInputDraft });
      if (!reply.ok) throw reply.error; showRoute(reply.value); setEditing(undefined);
    });
  }
  const today = civilDayIn(loaded?.timeZone ?? 'UTC');
  return <section className="sf-course-map" data-testid="course-map" data-loading={!loaded}>
    <CourseMapCanvas nodes={nodes} {...(selected ? { selected } : {})} busy={busy || !loaded}
      onSelect={setSelected} onOpen={key => { void open(key); }} onPlace={place} onTidy={tidy} onCreate={() => { setEditing({ node: null }); setNotice(''); }}
      toolbar={<div data-testid="roadmap-filter"><div className="sf-map-filter-head"><h2>课程路线</h2><span className="sf-meta" data-testid="roadmap-filter-count">{range || term || line ? `命中 ${matches.size} 节` : `${entries.length} 节`}</span></div>
        <div className="sf-map-filter-row"><input type="search" aria-label="查找课程" placeholder="找一节课" value={query} onChange={event => setQuery(event.target.value)} />
          <select aria-label="选择学习路线" value={line} onChange={event => setLine(event.target.value)}><option value="">全部路线</option>{roots.map(entry => <option key={entry.graph.key} value={entry.graph.key}>{entry.graph.title}</option>)}</select></div>
        <div className="sf-map-filter-row"><button type="button" data-testid="roadmap-filter-all" onClick={() => setRange(undefined)}>全部日期</button><button type="button" data-testid="roadmap-filter-today" onClick={() => setRange({ from: today, to: today })}>今天</button>
          <label>从<input type="date" data-testid="roadmap-filter-from" value={range?.from ?? ''} onChange={event => setRange(event.target.value ? { from: event.target.value, to: range?.to ?? event.target.value } : undefined)} /></label>
          <label>到<input type="date" data-testid="roadmap-filter-to" value={range?.to ?? ''} onChange={event => setRange(event.target.value ? { from: range?.from ?? event.target.value, to: event.target.value } : undefined)} /></label>
          {(range || term || line) && <button type="button" data-testid="roadmap-filter-clear" onClick={() => { setRange(undefined); setQuery(''); setLine(''); }}>清除筛选</button>}</div></div>} />
    {!loaded && <p className="sf-map-notice sf-notice" role="status">{notice || '正在读取课程…'}<button className="sf-quiet" onClick={() => { void load(); }}>重试</button></p>}
    {active && !editing && <aside className="sf-map-panel" data-testid="course-node-detail" aria-label="课程详情">
      <button type="button" className="sf-map-panel-close" aria-label="关闭课程详情" onClick={() => setSelected(undefined)}>×</button><div className="sf-map-panel-body">
        <span className="sf-meta">{active.graph.planned ? '计划课程' : active.graph.archived ? '已归档课程' : '已有课堂'}</span><h3>{active.graph.title}</h3>
        {active.graph.date && <p className="sf-meta">{active.graph.date}</p>}
        <section className="sf-map-section"><h4>本课资料</h4><p>{active.graph.preview || '这节课没有指定资料。'}</p></section>
        <section className="sf-map-section"><h4>接在谁后面</h4><select aria-label="前一节课" data-testid="roadmap-mount-select" disabled={busy} value={active.graph.parent ?? ''} onChange={event => { void mount(active.graph.key, event.target.value); }}>
          <option value="">单独一支</option>{entries.filter(entry => canMount(entries, active.graph.key, entry.graph.key)).map(entry => <option key={entry.graph.key} value={entry.graph.key}>{entry.graph.title}</option>)}</select></section>
        {loaded && <section className="sf-map-section"><h4>{active.graph.planned ? '教学安排' : '本课设置'}</h4><p>{teachingLabel(loaded, active)}</p></section>}
        {(active.route?.session?.sessionId ?? active.native?.sessionId) && <LessonResults ctx={ctx} sessionId={(active.route?.session?.sessionId ?? active.native?.sessionId)!} />}
      </div><div className="sf-map-panel-actions"><button disabled={busy} onClick={() => { void open(active.graph.key); }}>{active.graph.planned ? '开这节' : '打开课堂'}</button>
        {active.route && active.graph.planned && <button disabled={busy} onClick={() => { setEditing({ node: active.route! }); setNotice(''); }}>修改安排</button>}</div>
    </aside>}
    {editing && loaded && <div className="sf-map-editor"><RouteEditor route={loaded.route} node={editing.node} materials={loaded.materials} cards={loaded.cards} choices={loaded.choices} pending={busy} notice={notice}
      onCreate={draft => { void save(draft); }} onEdit={draft => { void save(draft); }} onCancel={() => { setEditing(undefined); setNotice(''); }} /></div>}
    {loaded && notice && !editing && <p className="sf-map-notice sf-notice" role="status" data-testid="roadmap-notice">{notice}</p>}
  </section>;
}

function projectEntries(loaded: Loaded, running: readonly NativeLessonRow[], current?: string): Entry[] {
  const native = new Map(loaded.native.map(lesson => [lesson.sessionId, lesson]));
  const bound = new Map(loaded.route.nodes.flatMap(node => node.session ? [[node.session.sessionId, node.id] as const] : []));
  const positions = new Map(loaded.route.layout.map(position => [position.nodeId, { x: position.x, y: position.y }]));
  const result: Entry[] = loaded.route.nodes.map(node => {
    const lesson = node.session ? native.get(node.session.sessionId) : undefined;
    const material = lesson?.materials ?? node.materials, decl = effectiveDecl(loaded.route.nodes, node);
    const createdAt = lesson?.createdAt ?? node.session?.openedAt;
    const graph: CourseGraphNode = { key: node.id, title: lesson?.title ?? node.title,
      ...(node.parent ? { parent: node.parent } : {}), ...(positions.has(node.id) ? { position: positions.get(node.id)! } : {}),
      date: createdAt ? civilDayIn(loaded.timeZone, new Date(createdAt)) : node.date ?? '',
      preview: material.materials.map(item => materialLabel(item, loaded.materials, loaded.cards)).join(' · '),
      ...(decl.name ? { lineName: decl.name } : {}), planned: !node.session, archived: lesson?.archived ?? false,
      current: node.session?.sessionId === current, matches: true };
    return { graph, route: node, ...(lesson ? { native: lesson } : {}) };
  });
  for (const lesson of loaded.native) {
    if (bound.has(lesson.sessionId)) continue;
    const parent = lesson.parentSession ? bound.get(lesson.parentSession) ?? native.get(lesson.parentSession)?.nodeId : undefined;
    result.push({ native: lesson, graph: { key: lesson.nodeId, title: running.find(row => row.id === lesson.sessionId)?.title ?? lesson.title,
      ...(parent ? { parent } : {}), date: civilDayIn(loaded.timeZone, new Date(lesson.createdAt)),
      preview: lesson.materials.materials.map(item => materialLabel(item, loaded.materials, loaded.cards)).join(' · '),
      planned: false, archived: lesson.archived, current: lesson.sessionId === current, matches: true } });
  }
  return result;
}
function canMount(entries: readonly Entry[], child: string, candidate: string): boolean {
  const byId = new Map(entries.map(entry => [entry.graph.key, entry.graph])); const seen = new Set<string>(); let key: string | undefined = candidate;
  while (key && !seen.has(key)) { if (key === child) return false; seen.add(key); key = byId.get(key)?.parent; } return true;
}
function teachingLabel(loaded: Loaded, entry: Entry): string {
  const decl = entry.native ? { teachingRef: entry.native.teachingRef, stance: entry.native.stance } : entry.route ? effectiveDecl(loaded.route.nodes, entry.route) : {};
  return [loaded.choices.find(choice => choice.id === decl.teachingRef)?.title, decl.stance].filter(Boolean).join(' · ') || '沿用这节课的学习方式。';
}
