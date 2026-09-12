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

/** The automatic spot for one node when the student has not placed it themselves. */
function autoSpot(index: number, depth: number): { readonly x: number; readonly y: number } {
  // B's mapAutoLayout: one column per generation (280px), one row per node (150px).
  // The floating filter bar sits above this board rather than over it, so row one starts at 20.
  return { x: 40 + depth * 280, y: 20 + index * 150 };
}

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
  const [arranging, setArranging] = useState(false);
  const [holding, setHolding] = useState<{ readonly id: string; readonly x: number; readonly y: number } | undefined>(undefined);
  const drag = useRef<{ id: string; pointerX: number; pointerY: number; originX: number; originY: number; x: number; y: number; moved: boolean } | undefined>(undefined);
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
      onOpenLesson(reply.value.sessionId);
    } catch { setNotice('这节课现在开不了。'); }
    finally { setBusy(false); }
  }

  /**
   * Save where the student really put one card. Only this node's coordinate is
   * sent, so a drag can never rewrite another node's placement or its content;
   * `null` puts the node back into the automatic order.
   */
  async function place(nodeId: string, position: { readonly x: number; readonly y: number } | null): Promise<void> {
    setBusy(true); setNotice('');
    try {
      const reply = await ctx.remote.studyforgeOrganization.setRouteLayout({
        operationId: operationId('place:' + nodeId + ':' + (position === null ? 'auto' : `${String(position.x)},${String(position.y)}`)),
        positions: [{ nodeId, position }],
      });
      if (reply.ok) { setLoaded(current => current === undefined ? current : { ...current, route: reply.value }); return; }
      setNotice(refusalCopy(refusalCode(reply.error), '这次没挪成，请再试一次。'));
    } catch { setNotice('这次没挪成，请再试一次。'); }
    finally { setBusy(false); }
  }

  /** One pointer drag on the canvas: the card follows the pointer, the save happens on release. */
  function beginDrag(event: React.PointerEvent<HTMLDivElement>, nodeId: string, at: { readonly x: number; readonly y: number }): void {
    if ((event.target as HTMLElement).closest('button') !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: nodeId, pointerX: event.clientX, pointerY: event.clientY, originX: at.x, originY: at.y, x: at.x, y: at.y, moved: false };
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>): void {
    const at = drag.current;
    if (at === undefined) return;
    const dx = event.clientX - at.pointerX, dy = event.clientY - at.pointerY;
    if (!at.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    at.moved = true;
    at.x = Math.max(0, Math.round(at.originX + dx));
    at.y = Math.max(0, Math.round(at.originY + dy));
    setHolding({ id: at.id, x: at.x, y: at.y });
  }

  function endDrag(): void {
    const at = drag.current;
    drag.current = undefined;
    setHolding(undefined);
    // A tap is not a placement: only a real move writes a coordinate.
    if (at === undefined || !at.moved) return;
    void place(at.id, { x: at.x, y: at.y });
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
  const placedByNode = new Map(loaded.route.layout.map(entry => [entry.nodeId, entry] as const));
  const spots = ordered.map(({ node, depth }, index) => ({
    node, saved: placedByNode.get(node.id), auto: autoSpot(index, depth),
  }));
  const canvasHeight = Math.max(320, ...spots.map(spot => (spot.saved ?? spot.auto).y + 124));
  const canvasWidth = Math.max(320, ...spots.map(spot => (spot.saved ?? spot.auto).x + 290));
  /** Where one card is right now: the pointer's own spot while it is being dragged. */
  type Spot = { readonly node: RouteNode; readonly saved: RouteView['layout'][number] | undefined; readonly auto: { readonly x: number; readonly y: number } };
  const liveOf = (spot: Spot): { readonly x: number; readonly y: number } =>
    (holding?.id === spot.node.id ? holding : spot.saved ?? spot.auto);
  const byNode = new Map(spots.map(spot => [spot.node.id, spot] as const));

  return <section className="sf-courses-block" data-testid="course-map">
    <div className="sec-head"><h2>排课</h2><span className="cnt">{String(loaded.route.nodes.length)} 节</span><div className="line" /></div>
    <div className="sf-roadmap-filter" data-testid="roadmap-filter">
      <div className="sf-chip-row">
        <button type="button" className={chipClass(range === undefined)} data-testid="roadmap-filter-all" onClick={() => { void applyRange(undefined); }}>全部</button>
        <button type="button" className={chipClass(range !== undefined && range.from === today && range.to === today)} data-testid="roadmap-filter-today"
          onClick={() => { void applyRange({ from: today, to: today }); }}>今天</button>
        <button type="button" className={chipClass(false)} data-testid="roadmap-filter-week"
          onClick={() => { void applyRange({ from: today, to: addDays(today, 6) }); }}>接下来一周</button>
      </div>
      <label>从 <input type="date" data-testid="roadmap-filter-from" value={range?.from ?? ''} onChange={event => { const value = event.target.value; if (value === '') { void applyRange(undefined); } else { void applyRange({ from: value, to: range?.to ?? value }); } }} /></label>
      <label>到 <input type="date" data-testid="roadmap-filter-to" value={range?.to ?? ''} onChange={event => { const value = event.target.value; if (value === '') { void applyRange(undefined); } else { void applyRange({ from: range?.from ?? value, to: value }); } }} /></label>
      <span className="sf-meta" data-testid="roadmap-filter-count">{match === undefined ? `${String(loaded.route.nodes.length)} 节` : `命中 ${String(matched.size)} 节`}</span>
      {range !== undefined && <button type="button" className="sf-quiet" data-testid="roadmap-filter-clear" onClick={() => { void applyRange(undefined); }}>清除筛选</button>}
      <button type="button" className="sf-quiet" data-testid="roadmap-arrange" onClick={() => { setArranging(current => !current); }}>
        {arranging ? '看顺序' : '自己摆'}
      </button>
    </div>
    {ordered.length === 0 && <p className="sf-note" data-testid="roadmap-empty">还没有排课。写下想去哪，再点「排一节」。</p>}
    {arranging && <div className="sf-roadmap-canvas" data-testid="roadmap-canvas" style={{ height: `${String(canvasHeight)}px` }}>
      {/* B's map draws the mount edges; a child's line starts at its parent's right edge. */}
      <svg className="sf-roadmap-edges" width={canvasWidth} height={canvasHeight} aria-hidden="true">
        {spots.flatMap(spot => {
          const parent = spot.node.parent === undefined ? undefined : byNode.get(spot.node.parent);
          if (parent === undefined) return [];
          const from = liveOf(parent), to = liveOf(spot);
          return [<path key={spot.node.id} className={spot.node.session === undefined ? 'planned' : 'opened'}
            d={`M ${String(from.x + 230)} ${String(from.y + 42)} C ${String(from.x + 300)} ${String(from.y + 42)}, ${String(to.x - 70)} ${String(to.y + 42)}, ${String(to.x)} ${String(to.y + 42)}`} />];
        })}
      </svg>
      {spots.map(({ node, saved, auto }) => {
        const live = holding?.id === node.id ? holding : saved ?? auto;
        return <div key={node.id} className={saved === undefined ? 'sf-roadmap-card' : 'sf-roadmap-card sf-roadmap-card-placed'}
          data-testid="roadmap-canvas-node" data-node-id={node.id} data-x={String(live.x)} data-y={String(live.y)}
          data-held={holding?.id === node.id}
          style={{ left: `${String(live.x)}px`, top: `${String(live.y)}px` }}
          onPointerDown={event => { beginDrag(event, node.id, live); }} onPointerMove={moveDrag} onPointerUp={endDrag}>
          <span className="sf-roadmap-title">{node.title}</span>
          {node.session !== undefined && <span className="sf-meta">已开课</span>}
          {saved !== undefined && <button type="button" className="sf-quiet" data-testid="roadmap-node-auto" disabled={busy}
            onClick={() => { void place(node.id, null); }}>排回原位</button>}
        </div>;
      })}
    </div>}
    {!arranging && <ol className="sf-roadmap" data-testid="roadmap-nodes">
      {ordered.map(({ node, depth }) => <li key={node.id} className={context.has(node.id) && !matched.has(node.id) ? 'sf-roadmap-row sf-roadmap-context' : 'sf-roadmap-row'}
        data-testid="roadmap-node" data-node-id={node.id} data-route-ref={`route:${node.id}`}>
        {placedByNode.get(node.id) !== undefined && <span className="sf-meta" data-testid="roadmap-position">已自己摆位</span>}
        <div className="sf-roadmap-row-head" style={{ marginLeft: `${String(depth * 16)}px` }}>
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
      </li>)}
    </ol>}
    {editing === undefined
      ? <button type="button" className="sf-action" data-testid="roadmap-create" disabled={busy} onClick={() => { setEditing({ node: null }); setNotice(''); }}>排一节</button>
      : <RouteEditor route={loaded.route} node={editing.node} materials={loaded.materials} cards={loaded.cards} choices={loaded.choices}
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
  if (lessons.length === 0) return <p className="sf-note" data-testid="native-lessons-empty">还没有课。回到课堂写下想学的主题，就会开出第一节。</p>;
  return <ul className="sf-lessons" data-testid="studyforge-lessons">
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
