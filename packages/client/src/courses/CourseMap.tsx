/**
 * P6.2/P6.5 the course page: the native lessons that really exist, plus the
 * roadmap the student planned.
 *
 * Two sources, both real. The lesson list comes from the native Session list
 * the frame already owns; the roadmap comes from `studyforgeOrganization.route`.
 * A date range is answered by the Host's own `studyforgeCalendar.roadmap`, so
 * the same nodes match here and in the calendar, and a filter only changes what
 * is visible — clearing it restores the stored tree untouched.
 *
 * Opening a planned node goes through `openPlannedLesson`; a double click, a
 * second tab and a restart therefore answer with the one lesson the node really
 * opened instead of starting a second one.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { RoadmapDateFilter, RoadmapFilterResult } from '@studyforge/contracts/calendar';
import type { CardView } from '@studyforge/contracts/cards';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { RouteNode, RouteNodeInputDraft, RouteNodePatchDraft, RouteView } from '@studyforge/contracts/routes';
import type { TeachingChoice } from '@studyforge/contracts/teaching';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RouteEditor } from './RouteEditor.tsx';
import { linearTreeRows } from '../shell/linear-tree.tsx';
import { civilDayIn, dayLabel, effectiveDecl, materialLabel, refusalCode, walkRoute } from './format.ts';

/** One native lesson, as the frame's own Session list spells it. */
export interface NativeLessonRow {
  readonly id: string;
  readonly title: string;
  readonly running: boolean;
}

export interface CourseMapProps {
  readonly ctx: Context;
  readonly lessons: readonly NativeLessonRow[];
  readonly lessonsLoaded: boolean;
  onOpenLesson(id: string): void;
}

interface Loaded {
  readonly route: RouteView;
  readonly materials: readonly MaterialView[];
  readonly cards: readonly CardView[];
  readonly choices: readonly TeachingChoice[];
  readonly timeZone: string;
}

type Range = { readonly from: string; readonly to: string };

const REFUSAL_COPY: Readonly<Record<string, string>> = {
  route_node_conflict: '这一节刚被别人改过，已经读到最新的一版；你的改动还在，可以再存一次。',
  route_cycle: '不能把一节课挂到它自己的下面。',
  route_parent_missing: '上一节已经不在这条路线上，重新选一个。',
  route_teaching_ref_missing: '这种教学方式这版还没有，换一个再存。',
  route_opening_pending: '这一节正在开课，稍等一下再改。',
  route_node_missing: '这一节已经不在了，重新读一下课程。',
  material_missing: '这份资料已经不在了，换一份再排。',
};

/** The course page's roadmap half; the native lesson list is the other half. */
export function CourseMap({ ctx, lessons, lessonsLoaded, onOpenLesson }: CourseMapProps): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const [range, setRange] = useState<Range | undefined>(undefined);
  const [match, setMatch] = useState<RoadmapFilterResult | undefined>(undefined);
  const [editing, setEditing] = useState<{ node: RouteNode | null } | undefined>(undefined);
  const [mounting, setMounting] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const ids = useRef<{ signature: string; value: string }>({ signature: '', value: '' });

  const load = useCallback(async (): Promise<RouteView | undefined> => {
    try {
      const [route, materials, cards, choices] = await Promise.all([
        ctx.remote.studyforgeOrganization.route(),
        ctx.remote.studyforgeMaterials.list(),
        ctx.remote.studyforgeLearning.cards(),
        ctx.remote.studyforgeTeaching.choices(),
      ]);
      if (!route.ok) { setNotice('课程暂时读不出来。'); return undefined; }
      // The calendar Remote answers the workspace zone the Host really uses; a
      // build without it still reads the tree, just with the browser's own zone.
      let timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      try {
        const settings = await ctx.remote.studyforgeCalendar.settings();
        if (settings.ok) timeZone = settings.value.timeZone;
      } catch { /* no calendar surface here */ }
      setLoaded({
        route: route.value,
        materials: materials.ok ? materials.value : [],
        cards: cards.ok ? cards.value : [],
        choices: choices.ok ? choices.value : [],
        timeZone,
      });
      setNotice('');
      return route.value;
    } catch { setNotice('课程暂时读不出来。'); return undefined; }
  }, [ctx]);

  useEffect(() => { void load(); }, [load]);

  const applyRange = useCallback(async (next: Range | undefined): Promise<void> => {
    setRange(next);
    if (next === undefined) { setMatch(undefined); setNotice(''); return; }
    const timeZone = loaded?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const filter: RoadmapDateFilter = { from: next.from, to: next.to, timeZone };
    try {
      const reply = await ctx.remote.studyforgeCalendar.roadmap({ filter });
      if (reply.ok) { setMatch(reply.value); setNotice(''); }
      else { setMatch(undefined); setNotice('这个时间段没能算出来，先显示全部。'); }
    } catch { setMatch(undefined); setNotice('这个时间段没能算出来，先显示全部。'); }
  }, [ctx, loaded]);

  /** One operation id per draft: retrying the same effect never plans twice. */
  function operationId(signature: string): string {
    if (ids.current.signature === signature && ids.current.value !== '') return ids.current.value;
    const value = crypto.randomUUID();
    ids.current = { signature, value };
    return value;
  }

  async function createNode(draft: RouteNodeInputDraft): Promise<void> {
    setBusy(true); setNotice('');
    try {
      const reply = await ctx.remote.studyforgeOrganization.addRouteNode({ operationId: operationId('add:' + JSON.stringify(draft)), node: draft });
      if (reply.ok) { setLoaded(current => current === undefined ? current : { ...current, route: reply.value }); setEditing(undefined); return; }
      setNotice(refusalCopy(refusalCode(reply.error), '这次没排上，请再试一次。'));
    } catch { setNotice('这次没排上，请再试一次。'); }
    finally { setBusy(false); }
  }

  async function editNode(nodeId: string, patch: RouteNodePatchDraft): Promise<void> {
    const route = loaded?.route;
    if (route === undefined) return;
    setBusy(true); setNotice('');
    try {
      const reply = await ctx.remote.studyforgeOrganization.editRouteNode({ operationId: operationId('edit:' + nodeId + ':' + JSON.stringify(patch)), nodeId, expectedVersion: route.version, patch });
      if (reply.ok) { setLoaded(current => current === undefined ? current : { ...current, route: reply.value }); setEditing(undefined); return; }
      await load();
      setNotice(refusalCopy(refusalCode(reply.error), '这次没存上，请再试一次。'));
    } catch { setNotice('这次没存上，请再试一次。'); }
    finally { setBusy(false); }
  }

  async function mount(node: RouteNode, parent: string): Promise<void> {
    const route = loaded?.route;
    if (route === undefined) return;
    setBusy(true); setNotice('');
    try {
      const reply = await ctx.remote.studyforgeOrganization.mountRouteNode({
        operationId: operationId('mount:' + node.id + ':' + parent), nodeId: node.id, expectedVersion: route.version, parent: parent === '' ? null : parent,
      });
      if (reply.ok) { setLoaded(current => current === undefined ? current : { ...current, route: reply.value }); setMounting(undefined); return; }
      await load();
      setNotice(refusalCopy(refusalCode(reply.error), '这次没挪动，请再试一次。'));
    } catch { setNotice('这次没挪动，请再试一次。'); }
    finally { setBusy(false); }
  }

  async function open(node: RouteNode): Promise<void> {
    setBusy(true); setNotice('');
    try {
      const reply = await ctx.remote.studyforgeOrganization.openPlannedLesson({ operationId: operationId('open:' + node.id), nodeId: node.id });
      if (!reply.ok) { setNotice(refusalCopy(refusalCode(reply.error), '这节课现在开不了。')); return; }
      setLoaded(current => current === undefined ? current : { ...current, route: { ...current.route, nodes: current.route.nodes.map(item => item.id === node.id ? reply.value.node : item) } });
      await ctx.sessions.refresh();
      onOpenLesson(reply.value.sessionId);
    } catch { setNotice('这节课现在开不了。'); }
    finally { setBusy(false); }
  }

  if (loaded === undefined) {
    return <section className="sf-courses-block" data-testid="course-map">
      <div className="sec-head"><h2>排课</h2><div className="line" /></div>
      <p className="sf-note" role="status">{notice === '' ? '正在看你的课…' : notice}</p>
    </section>;
  }

  const today = civilDayIn(loaded.timeZone);
  const matched = new Set((match?.matched ?? []).map(stripRoute));
  const context = new Set((match?.context ?? []).map(stripRoute));
  const visible = loaded.route.nodes.filter(node => match === undefined || matched.has(node.id) || context.has(node.id));
  const ordered = walkRoute(visible);
  return <section className="sf-courses-block" data-testid="course-map">
    <div className="sec-head sf-schedule-heading"><h2>学习安排</h2>{loaded.route.nodes.length > 0 && <span className="cnt">{loaded.route.nodes.length} 节</span>}
      <button type="button" className="btn primary" data-testid="roadmap-create" disabled={busy} onClick={() => { setEditing({ node: null }); setNotice(''); }}>安排一节课</button></div>
    {loaded.route.nodes.length > 0 && <details className="sf-route-filter"><summary>筛选日期</summary><div className="sf-roadmap-filter" data-testid="roadmap-filter">
      <div className="sf-chip-row">
        <button type="button" className={chipClass(range === undefined)} data-testid="roadmap-filter-all" onClick={() => { void applyRange(undefined); }}>全部</button>
        <button type="button" className={chipClass(range !== undefined && range.from === today && range.to === today)} data-testid="roadmap-filter-today"
          onClick={() => { void applyRange({ from: today, to: today }); }}>今天</button>
        <button type="button" className={chipClass(false)} data-testid="roadmap-filter-week"
          onClick={() => { void applyRange({ from: today, to: addDays(today, 6) }); }}>接下来一周</button>
      </div>
      <label>从 <input type="date" data-testid="roadmap-filter-from" value={range?.from ?? ''} onChange={event => { const value = event.target.value; if (value === '') { void applyRange(undefined); } else { void applyRange({ from: value, to: range?.to ?? value }); } }} /></label>
      <label>到 <input type="date" data-testid="roadmap-filter-to" value={range?.to ?? ''} onChange={event => { const value = event.target.value; if (value === '') { void applyRange(undefined); } else { void applyRange({ from: range?.from ?? value, to: value }); } }} /></label>
      {range !== undefined && <button type="button" className="sf-quiet" data-testid="roadmap-filter-clear" onClick={() => { void applyRange(undefined); }}>清除筛选</button>}
    </div></details>}
    {ordered.length === 0 && <p className="sf-note" data-testid="roadmap-empty">{range ? '这个日期范围内没有课程。' : '暂无学习安排'}</p>}
    <ol className="sf-roadmap sf-linear-tree" data-testid="roadmap-nodes">
      {linearTreeRows(ordered.map(row => row.node), node => node.id, node => node.parent, (node, children) => <li key={node.id} className={context.has(node.id) && !matched.has(node.id) ? 'sf-roadmap-row sf-roadmap-context' : 'sf-roadmap-row'}
        data-testid="roadmap-node" data-node-id={node.id} data-route-ref={`route:${node.id}`}>
        <div className="sf-roadmap-row-head">
          <span className="sf-roadmap-title" data-testid="roadmap-node-title">{node.title}</span>
          {node.opening !== undefined && node.session === undefined && <span className="sf-meta">正在开课…</span>}
          {node.session !== undefined && <span className="sf-meta" data-testid="roadmap-node-opened">已开课</span>}
        </div>
        <p className="sf-meta">
          {node.date !== undefined && <span data-testid="roadmap-node-date">{dayLabel(node.date)}</span>}
          {declLine(loaded, node) !== '' && <span data-testid="roadmap-node-decl"> · {declLine(loaded, node)}</span>}
        </p>
        {node.materials.materials.length > 0 && <p className="sf-meta" data-testid="roadmap-node-materials">
          {node.materials.materials.map((material, index) => `${node.materials.initialIndex === index ? '▸ ' : ''}${materialLabel(material, loaded.materials, loaded.cards)}`).join(' · ')}
        </p>}
        <div className="sf-roadmap-actions">
          {node.session !== undefined
            ? <button type="button" className="sf-action sf-action-quiet" data-testid="roadmap-node-open" onClick={() => { const bound = node.session; if (bound !== undefined) onOpenLesson(bound.sessionId); }}>接着上</button>
            : <button type="button" className="sf-action" data-testid="roadmap-node-start" disabled={busy} onClick={() => { void open(node); }}>开这节</button>}
          <button type="button" className="sf-quiet" data-testid="roadmap-node-edit" onClick={() => { setEditing({ node }); setNotice(''); }}>改这一节</button>
          <button type="button" className="sf-quiet" data-testid="roadmap-node-mount" onClick={() => { setMounting(mounting === node.id ? undefined : node.id); }}>换个位置</button>
        </div>
        {mounting === node.id && <div className="sf-roadmap-mount" data-testid="roadmap-mount">
          <label>接在
            <select defaultValue="" data-testid="roadmap-mount-select" onChange={event => {
              const value = event.target.value;
              if (value !== '') void mount(node, value === '__root__' ? '' : value);
            }}>
              <option value="">选一节…</option>
              <option value="__root__">（单独一支）</option>
              {loaded.route.nodes.filter(candidate => candidate.id !== node.id).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
            </select>
          </label>
        </div>}
        {children}
      </li>)}
    </ol>
    {editing !== undefined && <RouteEditor route={loaded.route} node={editing.node} materials={loaded.materials} cards={loaded.cards} choices={loaded.choices}
          pending={busy} notice={notice} onCreate={draft => { void createNode(draft); }}
          onEdit={patch => { const node = editing.node; if (node !== null) void editNode(node.id, patch); }}
          onCancel={() => { setEditing(undefined); setNotice(''); }} />}
    {notice !== '' && editing === undefined && <p className="sf-notice" role="status" data-testid="roadmap-notice">{notice}</p>}
  </section>;
}

/** The native lessons this workspace really has; a subagent is not a course. */
export function NativeLessonList({ lessons, loaded, onOpenLesson }: {
  readonly lessons: readonly NativeLessonRow[];
  readonly loaded: boolean;
  onOpenLesson(id: string): void;
}): React.JSX.Element {
  if (!loaded) return <p className="sf-note" role="status">正在看你的课…</p>;
  if (lessons.length === 0) return <p className="sf-note" data-testid="native-lessons-empty">暂无课堂记录</p>;
  return <ul className="sf-lessons sf-linear-tree" data-testid="studyforge-lessons">
    {lessons.map(lesson => <li key={lesson.id}>
      <button type="button" data-testid="native-lesson-open" onClick={() => { onOpenLesson(lesson.id); }}>
        <span>{lesson.title}</span>
        {lesson.running && <span className="sf-meta">进行中</span>}
      </button>
    </li>)}
  </ul>;
}

function declLine(loaded: Loaded, node: RouteNode): string {
  const decl = effectiveDecl(loaded.route.nodes, node);
  const parts: string[] = [];
  const choice = loaded.choices.find(candidate => candidate.id === decl.teachingRef);
  if (choice !== undefined) parts.push(choice.title);
  if (decl.name !== undefined) parts.push(decl.name);
  if (decl.stance !== undefined) parts.push(decl.stance);
  return parts.join(' · ');
}

function stripRoute(ref: string): string {
  return ref.startsWith('route:') ? ref.slice('route:'.length) : ref;
}

function chipClass(on: boolean): string {
  return on ? 'sf-chip sf-chip-on' : 'sf-chip';
}

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const at = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (date ?? 1) + days));
  return at.toISOString().slice(0, 10);
}

function refusalCopy(code: string, fallback: string): string {
  return REFUSAL_COPY[code] ?? fallback;
}
