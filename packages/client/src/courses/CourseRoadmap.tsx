import type { Context } from '@deepseek-ai/cordis';
import type { CardView } from '@studyforge/contracts/cards';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { RouteNode, RouteNodeInputDraft, RouteNodePatchDraft, RouteView, RouteNativeLesson } from '@studyforge/contracts/routes';
import type { TeachingChoice } from '@studyforge/contracts/teaching';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CourseMapCanvas, type CourseGraphNode } from './CourseMapCanvas.tsx';
import { CourseTree } from './CourseTree.tsx';
import { type MapPoint } from './map-geometry.ts';
import { RouteEditor } from './RouteEditor.tsx';
import { LessonResults } from './LessonResults.tsx';
import { civilDayIn, effectiveDecl, materialLabel, refusalCode } from './format.ts';
import { LessonSettingsModal } from '../classroom/LessonSettings.tsx';
import './course-tree.css';

export interface NativeLessonRow { readonly id: string; readonly title: string; readonly running: boolean }

interface Loaded {
  route: RouteView; native: RouteNativeLesson[]; materials: MaterialView[]; cards: CardView[];
  choices: TeachingChoice[]; timeZone: string; incomplete: boolean;
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
export function CourseRoadmap({ ctx, lessons, currentSessionId, view = 'roadmap', onOpenLesson }: {
  ctx: Context; lessons: readonly NativeLessonRow[]; currentSessionId?: string; view?: 'roadmap' | 'list'; onOpenLesson(id: string): void;
}): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded>();
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState<{ node: RouteNode | null }>();
  const [range, setRange] = useState<Range>();
  const [query, setQuery] = useState(''), [line, setLine] = useState('');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [settings, setSettings] = useState<{ sessionId: string; title: string }>();
  const [scheduleDraft, setScheduleDraft] = useState<{ key: string; date: string }>();
  const readCourse = useCallback((input: { sessionId: string }) => ctx.remote.studyforgeCourses.read(input), [ctx]);
  const requests = useRef(new Map<string, string>()), generation = useRef(0);
  const op = (key: string): string => { let value = requests.current.get(key); if (!value) { value = crypto.randomUUID(); requests.current.set(key, value); } return value; };
  const load = useCallback(async (): Promise<Loaded | undefined> => {
    const at = ++generation.current;
    try {
      const [route, native, materials, cards, choices, calendar] = await Promise.all([
        ctx.remote.studyforgeOrganization.route().catch(() => undefined), ctx.remote.studyforgeOrganization.routeLessons().catch(() => undefined),
        ctx.remote.studyforgeMaterials.list(), ctx.remote.studyforgeLearning.cards(),
        ctx.remote.studyforgeTeaching.choices(), ctx.remote.studyforgeCalendar.settings(),
      ]);
      if (at !== generation.current) return;
      if (!route?.ok && !native?.ok) { setNotice('课程暂时未能读全，请重试。'); return; }
      // Partial reads are explicitly marked and never used as a write baseline.
      // Keep whichever authoritative source is available; do not reconstruct
      // missing parents or mix in the frame's unscoped session list.
      const incomplete = !route?.ok || !native?.ok;
      const next: Loaded = { route: route?.ok ? route.value : { ref: 'route:tree', version: 0, nodes: [], layout: [] }, native: native?.ok ? native.value : [], incomplete, materials: materials.ok ? materials.value : [],
        cards: cards.ok ? cards.value : [], choices: choices.ok ? choices.value : [],
        timeZone: calendar.ok ? calendar.value.timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone };
      setLoaded(next); setNotice(incomplete ? '部分课堂信息暂时无法读取，已显示可用课程。' : ''); return next;
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
    if (loaded?.incomplete) { setNotice('请先重新读取完整课程，再修改安排。'); return; }
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
  async function reschedule(node: RouteNode, date: string): Promise<void> {
    if (!loaded) return;
    const signature = 'date:' + node.id + ':' + date;
    await change(signature, async () => {
      const reply = await ctx.remote.studyforgeOrganization.editRouteNode({ operationId: op(signature), nodeId: node.id,
        expectedVersion: loaded.route.version, patch: { date: date || null } });
      if (!reply.ok) throw reply.error;
      showRoute(reply.value); setScheduleDraft(undefined);
    });
  }
  const today = civilDayIn(loaded?.timeZone ?? 'UTC');
  const filterKey = term || line || range ? JSON.stringify([term, line, range]) : '';
  const activeSession = active?.native?.sessionId ?? active?.route?.session?.sessionId;
  const blocked = busy || !loaded || loaded.incomplete;
  const scheduleDate = active && scheduleDraft?.key === active.graph.key ? scheduleDraft.date : active?.route?.date ?? '';
  return <section className="sf-course-map" data-testid="course-map" data-view={view} data-loading={!loaded}>
    <div className="sf-course-toolbar">
      <div className="sf-course-search-row">
        <input type="search" aria-label="查找课程" placeholder="搜索课程" value={query} onChange={event => setQuery(event.target.value)} />
        <span className="sf-meta" data-testid="roadmap-filter-count">{filterKey ? `${matches.size} 节匹配` : `${entries.length} 节课程`}</span>
        <button type="button" className="sf-action" data-testid="roadmap-create" disabled={blocked} onClick={() => { setEditing({ node: null }); setNotice(''); }}>新建课程</button>
      </div>
      <details className="sf-course-filters sf-route-filter"><summary>筛选{filterKey ? ' · 已启用' : ''}</summary>
        <div className="sf-course-filter-fields" data-testid="roadmap-filter">
          <label>学习路线<select aria-label="选择学习路线" value={line} onChange={event => setLine(event.target.value)}><option value="">全部路线</option>{roots.map(entry => <option key={entry.graph.key} value={entry.graph.key}>{entry.graph.title}</option>)}</select></label>
          <label>开始日期<input type="date" data-testid="roadmap-filter-from" value={range?.from ?? ''} onChange={event => setRange(event.target.value ? { from: event.target.value, to: range?.to ?? event.target.value } : undefined)} /></label>
          <label>结束日期<input type="date" data-testid="roadmap-filter-to" value={range?.to ?? ''} onChange={event => setRange(event.target.value ? { from: range?.from ?? event.target.value, to: event.target.value } : undefined)} /></label>
          <button type="button" className="sf-quiet" data-testid="roadmap-filter-today" onClick={() => setRange({ from: today, to: today })}>今天</button>
          <button type="button" className="sf-quiet" data-testid="roadmap-filter-all" onClick={() => setRange(undefined)}>全部日期</button>
          {filterKey && <button type="button" className="sf-quiet" data-testid="roadmap-filter-clear" onClick={() => { setRange(undefined); setQuery(''); setLine(''); }}>清除筛选</button>}
        </div>
      </details>
    </div>
    <div className="sf-course-view" hidden={view !== 'roadmap'}>
    <CourseMapCanvas nodes={nodes} {...(selected ? { selected } : {})} busy={blocked}
      onSelect={setSelected} onOpen={key => { void open(key); }} onPlace={place} onTidy={tidy} />
    </div>
    <div className="sf-course-view sf-course-list-view" hidden={view !== 'list'} data-testid="course-lessons">
      {loaded && <CourseTree nodes={nodes} filterKey={filterKey} {...(selected ? { selected } : {})} onSelect={setSelected} />}
      {loaded && !nodes.length && <p className="sf-course-empty" data-testid="course-tree-empty">{filterKey ? '没有匹配的课程' : '暂无课程'}</p>}
    </div>
    {!loaded && <p className="sf-map-notice sf-notice" role="status">{notice || '正在读取课程…'}<button className="sf-quiet" onClick={() => { void load(); }}>重试</button></p>}
    {active && !editing && <aside className="sf-map-panel" data-testid="course-node-detail" aria-label="课程详情">
      <button type="button" className="sf-map-panel-close" aria-label="关闭课程详情" onClick={() => setSelected(undefined)}>×</button><div className="sf-map-panel-body">
        <span className="sf-meta">{active.graph.planned ? '待开课' : active.graph.archived ? '已归档' : '已开课'}</span><h3>{active.graph.title}</h3>
        {active.graph.date && <p className="sf-meta">{active.graph.date}</p>}
        {active.route && <form className="sf-map-section sf-course-schedule" onSubmit={event => { event.preventDefault(); void reschedule(active.route!, scheduleDate); }}>
          <label>课程日期<input type="date" data-testid="course-schedule-date" aria-label="课程日期" disabled={blocked} value={scheduleDate} onChange={event => setScheduleDraft({ key: active.graph.key, date: event.target.value })} /></label>
          {scheduleDate !== (active.route.date ?? '') && <button className="sf-quiet" type="submit" disabled={blocked} data-testid="course-schedule-save">保存日期</button>}
        </form>}
        {active.graph.preview && <section className="sf-map-section"><h4>本课资料</h4><p data-testid="roadmap-node-materials">{active.graph.preview}</p></section>}
        <details className="sf-map-section sf-course-placement"><summary data-testid="roadmap-node-mount">调整位置</summary>
          <label>上级课程<select aria-label="上级课程" data-testid="roadmap-mount-select" disabled={blocked} value={active.graph.parent ?? ''} onChange={event => { void mount(active.graph.key, event.target.value); }}>
          <option value="">无上级课程</option>{entries.filter(entry => canMount(entries, active.graph.key, entry.graph.key)).map(entry => <option key={entry.graph.key} value={entry.graph.key}>{entry.graph.title}</option>)}</select></label></details>
        {loaded && <section className="sf-map-section"><h4>教学方式</h4><p data-testid="roadmap-node-decl">{teachingLabel(loaded, active)}</p></section>}
        {(active.route?.session?.sessionId ?? active.native?.sessionId) && <LessonResults ctx={ctx} sessionId={(active.route?.session?.sessionId ?? active.native?.sessionId)!} />}
      </div><div className="sf-map-panel-actions"><button className="sf-action" data-testid={active.graph.planned ? 'roadmap-node-start' : 'roadmap-node-open'} disabled={busy || active.graph.planned && blocked} onClick={() => { void open(active.graph.key); }}>{active.graph.planned ? '开始课程' : '进入对话'}</button>
        <button className="sf-quiet" data-testid="roadmap-node-edit" disabled={busy} onClick={() => {
          if (activeSession) setSettings({ sessionId: activeSession, title: active.graph.title });
          else if (active.route) { setEditing({ node: active.route }); setNotice(''); }
        }}>课堂设置</button></div>
    </aside>}
    {editing && loaded && <div className="sf-map-editor"><RouteEditor route={loaded.route} node={editing.node} materials={loaded.materials} cards={loaded.cards} choices={loaded.choices} pending={blocked} notice={notice}
      onCreate={draft => { void save(draft); }} onEdit={draft => { void save(draft); }} onCancel={() => { setEditing(undefined); setNotice(''); }} /></div>}
    {loaded && notice && !editing && <p className="sf-map-notice sf-notice" role="status" data-testid="roadmap-notice">{notice}{loaded.incomplete && <button className="sf-quiet" onClick={() => { void load(); }}>重试</button>}</p>}
    {settings && <LessonSettingsModal ctx={ctx} sessionId={settings.sessionId} title={settings.title} readCourse={readCourse} refreshToken={false} onClose={() => { setSettings(undefined); void load(); }} />}
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
      date: node.date ?? (createdAt ? civilDayIn(loaded.timeZone, new Date(createdAt)) : ''),
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
