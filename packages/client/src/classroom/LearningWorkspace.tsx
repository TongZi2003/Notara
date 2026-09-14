import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type DragEvent } from 'react';
import { ClassroomTrace } from './ClassroomTrace.tsx';
import { LessonResources, type LessonResourcesFace } from '../materials/LessonResources.tsx';
import { LearningObject } from './LearningObject.tsx';
import { LessonSettingsModal } from './LessonSettings.tsx';
import { PluginWorkbench, useWorkbenchChoices } from '../plugins/PluginWorkbench.tsx';
import { PluginIcon } from '../plugins/PluginManager.tsx';
import { VIEWS, availableTree, adaptTree, dockView, geometry, leaves, removeView, resizeTree, revealWorkspaceView, subscribeWorkspace, updateWorkspace, workspaceLayout, type Edge, type Rect, type SplitTree, type WorkspaceView } from './workspace-layout.ts';
import './learning-workspace.css';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** The original owner still declares and renders every native child. */
    'conversation.workspace': { kind: 'single'; scope: 'session-maybe'; owner: { nativeConversation: ReactNode } };
  }
}
const BASE_LABELS: Record<string, string> = { chat: '对话', thoughts: '思维图', materials: '资料工作台' };
const EDGE_LABELS: Record<Edge, string> = { left: '放到左侧', right: '放到右侧', top: '放到上方', bottom: '放到下方' };
const EDGES = ['left', 'right', 'top', 'bottom'] as const;
function ViewIcon({ view }: { view: WorkspaceView }): React.JSX.Element {
  if (view.startsWith('plugin-')) return <PluginIcon />;
  return <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">{view === 'chat' ? <path d="M4 3.5h12v10H9l-4 3v-3H4zM7 7h6M7 10h4" /> : view === 'thoughts' ? <><rect x="7" y="2" width="6" height="4" rx="1" /><path d="M10 6v4M4 13v-3h12v3" /><rect x="1" y="13" width="6" height="4" rx="1" /><rect x="13" y="13" width="6" height="4" rx="1" /></> : <><rect x="2" y="3" width="10" height="14" rx="1" /><path d="M5 3v14M14 5h4v11h-4" /></>}</svg>;
}

function MaterialsView({ ctx, sessionId, running, visible, host }: { ctx: Context; sessionId: string; running: boolean; visible: boolean; host: LessonResourcesFace }): React.JSX.Element {
  const [refresh, setRefresh] = useState(0);
  return <aside className="sf-lesson" data-testid="studyforge-lesson-panel">
    <button className="sf-workspace-refresh" aria-label="刷新资料" data-testid="lesson-materials-refresh" onClick={() => setRefresh(n => n + 1)}>↻</button>
    <section className="sf-lesson-materials-section"><LessonResources ctx={ctx} sessionId={sessionId} host={host} browseId={visible ? `workspace:${sessionId}:materials` : undefined} refreshToken={`${running}:${refresh}`}
      renderObject={(target, controls) => <LearningObject ctx={ctx} sessionId={sessionId} target={target} onBack={controls.back} onSource={anchor => controls.source([anchor], '原文')} />} /></section>
  </aside>;
}

/** Stable siblings with calculated rectangles: layout changes never reparent or
 * remount chat, canvases or readers. The single composer stays inside chat. */
function Workspace({ ctx, sessionId, blank, running, title, nativeConversation, host }: {
  ctx: Context; sessionId: string; blank: boolean; running: boolean; title: string; nativeConversation: ReactNode; host: LessonResourcesFace;
}): React.JSX.Element {
  const extensions = useWorkbenchChoices(ctx, sessionId);
  const views: WorkspaceView[] = [...VIEWS, ...extensions.map(row => row.id as WorkspaceView)];
  const LABELS: Record<string, string> = { ...BASE_LABELS, ...Object.fromEntries(extensions.map(row => [row.id, row.title])) };
  const state = useSyncExternalStore(subscribeWorkspace, () => workspaceLayout(sessionId, blank));
  const surface = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: 1000, height: 700 });
  const [dragging, setDragging] = useState<WorkspaceView>(), [over, setOver] = useState(''), [settings, setSettings] = useState(false);
  const [menu, setMenu] = useState<WorkspaceView>(), lastRects = useRef<Partial<Record<WorkspaceView, Rect>>>({});
  const readCourse = useCallback((input: { sessionId: string }) => ctx.remote.studyforgeCourses.read(input), [ctx]);
  useLayoutEffect(() => {
    const node = surface.current; if (!node) return;
    const measure = (): void => { setSize({ width: node.clientWidth, height: node.clientHeight }); }; measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    // The materials pane replaces the learning rightbar; creator sessions keep
    // their native files. Restore its expansion preference when leaving class.
    document.body.dataset.sfWorkspace = 'true';
    const expanded = ctx.sidebarRight.isExpanded(); if (expanded) ctx.sidebarRight.toggleExpanded();
    ctx.layout.closeRightbar();
    return () => { delete document.body.dataset.sfWorkspace; if (expanded && !ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded(); };
  }, [ctx]);
  useEffect(() => { setMenu(undefined); setSettings(false); lastRects.current = {}; }, [sessionId]);
  const currentTree = availableTree(state.tree, views);
  const open = leaves(currentTree), narrow = size.width < 650;
  const active = open.includes(state.active) ? state.active : open[0];
  const drawn = narrow ? active ?? null : adaptTree(currentTree, size.width);
  const { panes, dividers } = geometry(drawn, { x: 0, y: 0, ...size });
  Object.assign(lastRects.current, panes);
  const arrange = (tree: SplitTree | null, activeView = state.active): void => {
    updateWorkspace(sessionId, old => ({ tree, active: activeView, visited: [...new Set([...old.visited, ...leaves(tree)])] })); setMenu(undefined);
  };
  const close = (view: WorkspaceView): void => { const tree = removeView(state.tree, view); arrange(tree, state.active === view ? leaves(tree)[0] ?? 'chat' : state.active); };
  const move = (view: WorkspaceView, target: WorkspaceView, edge: Edge): void => { arrange(dockView(state.tree, view, target, edge), view); setDragging(undefined); setOver(''); };
  function startDrag(event: DragEvent, view: WorkspaceView): void { event.dataTransfer.setData('application/x-studyforge-view', view); event.dataTransfer.effectAllowed = 'move'; setDragging(view); setMenu(undefined); }
  const endDrag = (): void => { setDragging(undefined); setOver(''); };
  function preset(event: React.MouseEvent<HTMLButtonElement>, tree: SplitTree, selected: WorkspaceView = 'chat'): void { arrange(tree, selected); event.currentTarget.closest('details')?.removeAttribute('open'); }
  return <main className="sf-learning-workspace" data-testid="learning-workspace" data-narrow={narrow}>
    <header className="sf-workspace-bar"><nav aria-label="课堂视图">{views.filter(view=>extensions.length<=4||!view.startsWith('plugin-')||open.includes(view)).map(view => <button key={view} type="button" draggable={!narrow} onDragStart={event => startDrag(event, view)} onDragEnd={endDrag}
      data-testid={`workspace-open-${view}`} aria-pressed={open.includes(view)} data-current={active === view} onClick={() => revealWorkspaceView(sessionId, view)}><ViewIcon view={view} /><span>{LABELS[view]}</span></button>)}</nav>
      {extensions.length>4&&<details className="sf-workspace-layout-menu sf-workspace-catalog"><summary aria-label="选择插件工作台">＋ 工作台</summary><div>{extensions.map(item=><button key={item.id} onClick={event=>{revealWorkspaceView(sessionId,item.id as WorkspaceView);event.currentTarget.closest('details')?.removeAttribute('open');}}>{item.title}{open.includes(item.id as WorkspaceView)?' ✓':''}</button>)}</div></details>}
      <details className="sf-workspace-layout-menu"><summary aria-label="调整布局" title="调整布局">▥</summary><div>
        <button onClick={e => preset(e, 'chat')}>只看对话</button>
        <button onClick={e => preset(e, { axis: 'x', ratio: .54, a: 'chat', b: 'thoughts' })}>对话与思维图</button>
        <button onClick={e => preset(e, { axis: 'x', ratio: .54, a: 'chat', b: 'materials' })}>对话与资料</button>
        <button onClick={e => preset(e, { axis: 'x', ratio: .5, a: 'thoughts', b: 'materials' }, 'thoughts')}>思维图与资料</button>
        <button onClick={e => preset(e, { axis: 'x', ratio: .4, a: 'chat', b: { axis: 'x', ratio: .5, a: 'thoughts', b: 'materials' } })}>三栏并排</button>
        <button onClick={e => preset(e, { axis: 'x', ratio: .54, a: 'chat', b: { axis: 'y', ratio: .5, a: 'thoughts', b: 'materials' } })}>对话在左 · 两图上下</button>
        <hr /><button data-testid="open-lesson-settings" onClick={event => { setSettings(true); event.currentTarget.closest('details')?.removeAttribute('open'); }}>本课设置</button>
      </div></details>
    </header>
    <div className="sf-workspace-surface" ref={surface} data-testid="workspace-surface" onDragEnd={endDrag}>
      {views.map(view => {
        const rect = panes[view] ?? lastRects.current[view] ?? { x: 0, y: 0, ...size }, visible = !!panes[view];
        return <section key={view} className="sf-workspace-pane" data-testid={`workspace-pane-${view}`} data-view={view} data-current={active === view} data-visible={visible} aria-label={LABELS[view]} aria-hidden={!visible} {...(!visible ? { inert: '' } : {})}
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, visibility: visible ? 'visible' : 'hidden' }}
          onFocusCapture={() => { if (state.active !== view && visible) updateWorkspace(sessionId, old => ({ ...old, active: view })); }}>
          <header className="sf-workspace-pane-head"><button className="sf-workspace-grip" draggable={!narrow} onDragStart={event => startDrag(event, view)} onDragEnd={endDrag} aria-label={`拖动${LABELS[view]}`}><span aria-hidden="true">⠿</span><ViewIcon view={view} />{LABELS[view]}</button>
            <button aria-label={`${LABELS[view]}布局`} onClick={() => setMenu(menu === view ? undefined : view)}>⋯</button><button aria-label={`关闭${LABELS[view]}`} onClick={() => close(view)}>×</button>
            {menu === view && <div className="sf-workspace-pane-menu"><button onClick={() => arrange(view, view)}>只看{LABELS[view]}</button>{open.filter(target => target !== view).map(target => <div key={target}><small>{LABELS[target]}</small>{EDGES.map(edge => <button key={edge} onClick={() => move(view, target, edge)}>{EDGE_LABELS[edge]}</button>)}</div>)}<button onClick={() => setMenu(undefined)}>收起菜单</button></div>}
          </header>
          <div className="sf-workspace-pane-content" data-sf-conversation-paper={view === 'chat' ? true : undefined}>
            {view === 'chat' ? nativeConversation : state.visited.includes(view) && (view.startsWith('plugin-') ? <PluginWorkbench key={sessionId + view} ctx={ctx} sessionId={sessionId} id={view} /> : view === 'thoughts' ? <ClassroomTrace key={sessionId} ctx={ctx} sessionId={sessionId} running={running} /> : <MaterialsView key={sessionId} ctx={ctx} sessionId={sessionId} host={host} running={running} visible={visible} />)}
          </div>
          {dragging && dragging !== view && visible && <div className="sf-workspace-drops">{EDGES.map(edge => <div key={edge} data-edge={edge} data-testid={`drop-${view}-${edge}`} data-over={over === view + edge}
            onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(view + edge); }} onDrop={event => { event.preventDefault(); move(dragging, view, edge); }}>{EDGE_LABELS[edge]}</div>)}</div>}
        </section>;
      })}
      {dividers.map(divider => <div key={divider.path} className="sf-workspace-divider" role="separator" tabIndex={0} aria-label="调整分栏大小" aria-orientation={divider.axis === 'x' ? 'vertical' : 'horizontal'} aria-valuenow={Math.round(divider.ratio * 100)} aria-valuemin={20} aria-valuemax={80} data-axis={divider.axis}
        style={{ left: divider.rect.x, top: divider.rect.y, width: divider.rect.width, height: divider.rect.height }}
        onKeyDown={event => { if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key) && state.tree) { event.preventDefault(); arrange(resizeTree(state.tree, divider.path, divider.ratio + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -.03 : .03))); } }}
        onPointerDown={event => {
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
          const start = divider.axis === 'x' ? event.clientX : event.clientY, extent = (divider.axis === 'x' ? divider.parent.width : divider.parent.height) - 4, tree = state.tree;
          const node = event.currentTarget;
          const movePointer = (e: PointerEvent): void => { if (tree) arrange(resizeTree(tree, divider.path, divider.ratio + ((divider.axis === 'x' ? e.clientX : e.clientY) - start) / extent)); };
          const end = (): void => { node.removeEventListener('pointermove', movePointer); node.removeEventListener('lostpointercapture', end); };
          node.addEventListener('pointermove', movePointer); node.addEventListener('lostpointercapture', end);
        }} />)}
      {!currentTree && <div className="sf-workspace-empty" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (dragging) { revealWorkspaceView(sessionId, dragging); endDrag(); } }}><span>打开一个视图</span><div>{views.map(view => <button key={view} onClick={() => revealWorkspaceView(sessionId, view)}>{LABELS[view]}</button>)}</div></div>}
    </div>
    {settings && <LessonSettingsModal ctx={ctx} sessionId={sessionId} title={title} readCourse={readCourse} refreshToken={running} onClose={() => setSettings(false)} />}
  </main>;
}

export function registerLearningWorkspace(ctx: Context): void {
  const host: LessonResourcesFace = {
    lessonResources: input => ctx.remote.studyforgeMaterials.lessonResources(input), materials: () => ctx.remote.studyforgeMaterials.list(), book: input => ctx.remote.studyforgeOrganization.book(input),
    card: input => ctx.remote.studyforgeLearning.card(input), cards: () => ctx.remote.studyforgeLearning.cards(), resolveForSession: input => ctx.remote.studyforgeMaterials.resolveForSession(input), bytes: ref => ctx.remote.studyforgeMaterials.bytes(ref), docxIndex: ref => ctx.remote.studyforgeMaterials.docxIndex(ref),
  };
  function Surface({ nativeConversation, sessionId, useSessions }: PropsRuntime<'conversation.workspace'>): React.JSX.Element {
    const row = useSessions(state => sessionId ? state.byId[sessionId] : undefined);
    if (!sessionId || row?.projectionValues?.agentPreset !== 'studyforge-learning') return <>{nativeConversation}</>;
    return <Workspace ctx={ctx} sessionId={sessionId} blank={row.blank} running={row.running} title={row.title || '自由学习'} nativeConversation={nativeConversation} host={host} />;
  }
  ctx.effect(() => ctx.slots.inject('conversation.workspace', () => ctx.slots.register({ name: 'conversation.workspace' }, Surface)));
}
