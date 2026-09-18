import type { Context } from '@deepseek-ai/cordis';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots';
import type { SetView } from '@studyforge/contracts/sets';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { setNavigation } from '../sets/set-navigation.ts';
import './original-shell.css';

type SidebarSeats = 'sidebar.brand.mark' | 'sidebar.brand.name' | 'sidebar.panellist' | 'sidebar.workspaces' | 'sidebar.settings' | 'sidebar.footer.action';
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Native sidebar keeps declaration authority and delegates only rendering. */
    'sidebar.content': { kind: 'single'; scope: 'root'; owner: {
      collapsed: boolean; width: number;
      renderSidebarSlot: PropsRenderSlots<SidebarSeats>['renderSlot'];
    } };
  }
}
type Props = PropsRuntime<'sidebar.content'>;
type Panel = { id: MainPanelId; title: string };
const PRIMARY = ['studyforge.home', 'studyforge.sets', 'studyforge.courses', 'studyforge.materials', 'studyforge.map', 'studyforge.calendar', 'studyforge.memory', 'studyforge.teaching', 'studyforge.plugins'];

/** Original navigation composition; every action delegates to native services. */
export function registerNotebookSidebar(ctx: Context): void {
  ctx.layout.setSidebarDefaultWidth(196);
  ctx.effect(() => () => { ctx.layout.setSidebarDefaultWidth(280); });
  let panels: Panel[] = [];
  const listeners = new Set<() => void>();
  const sync = (): void => {
    const next = ctx.slots.entriesOfSlot('sidebar.panellist').map(({ options }) => ({
      id: options.id as MainPanelId, title: resolveSlotLabel(options.label) ?? options.id!, order: options.order ?? 0,
    })).sort((a, b) => a.order - b.order).map(({ id, title }) => ({ id, title }));
    if (JSON.stringify(next) === JSON.stringify(panels)) return;
    panels = next; for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  ctx.effect(() => ctx.slots.subscribe('sidebar.panellist', sync)); sync();
  // The native sidebar owns this child seat. Delegate its live renderer into
  // settings rather than redeclaring the seat and invalidating both owners.
  let workspaceRenderer: Props['renderSidebarSlot'] | undefined;
  const workspaceListeners = new Set<() => void>();
  const subscribeWorkspace = (listener: () => void): (() => void) => { workspaceListeners.add(listener); return () => { workspaceListeners.delete(listener); }; };
  const readWorkspace = (): Props['renderSidebarSlot'] | undefined => workspaceRenderer;
  const notifyWorkspace = (): void => { for (const listener of workspaceListeners) listener(); };
  function Sidebar({ collapsed, usePanelInfo, useSessions, renderSidebarSlot: renderSlot }: Props): React.JSX.Element {
    useEffect(() => {
      workspaceRenderer = renderSlot; notifyWorkspace();
      return () => { if (workspaceRenderer === renderSlot) { workspaceRenderer = undefined; notifyWorkspace(); } };
    }, [renderSlot]);
    const active = usePanelInfo(value => value.activePanelId);
    const sessions = useSessions(value => value);
    const entries = useSyncExternalStore(subscribe, () => panels);
    const [sets, setSets] = useState<SetView[]>([]);
    const selectedSet = useSyncExternalStore(setNavigation.subscribe, setNavigation.read);
    useEffect(() => {
      let live = true;
      const read = (): void => { void ctx.remote.studyforgeOrganization.sets({}).then(result => { if (live && result.ok) setSets(result.value); }).catch(() => { /* The management page supplies the actionable failure. */ }); };
      read(); window.addEventListener('focus', read);
      return () => { live = false; window.removeEventListener('focus', read); };
    }, [sessions.current, active]);
    const rows = sessions.ids.flatMap(id => { const row = sessions.byId[id]; return row && !row.blank && row.origin !== 'subagent' ? [row] : []; });
    const running = rows.filter(row => row.running || row.id === sessions.current);
    const openPanel = (id: MainPanelId): void => { ctx.layout.selectPanel(id); };
    const isActive = (id: MainPanelId): boolean => active === id || id === 'studyforge.materials' && active === 'studyforge.cards';
    const link = (row: Panel): React.JSX.Element => <button type="button" key={row.id} title={row.title}
      className={isActive(row.id) ? 'on' : ''} aria-current={isActive(row.id) ? 'page' : undefined}
      onClick={() => openPanel(row.id)}>{renderSlot('sidebar.panellist', { size: 16, active: isActive(row.id) }, { only: row.id })}<span>{row.title}</span></button>;
    return <aside className="sf-original-sidebar" data-collapsed={collapsed} data-testid="notebook-sidebar">
      <div className="sf-side-brand"><div className="sf-side-wordmark">{renderSlot('sidebar.brand.mark', { size: 18 })}{!collapsed && renderSlot('sidebar.brand.name', {})}</div>
        <button className="sf-side-fold" title={collapsed ? '展开侧栏' : '收起侧栏'} aria-label={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => ctx.layout.toggleSidebar()}>{collapsed ? '›' : '‹'}</button></div>
      {!collapsed && <div className="sf-side-set-picker"><select aria-label="打开学习集" value={sets.some(set => set.ref === selectedSet) ? selectedSet : ''} onChange={event => {
        const ref = event.target.value || undefined; setNavigation.show(ref); openPanel((ref ? 'studyforge.sets' : 'studyforge.materials') as MainPanelId);
      }}><option value="">全部学习</option>{sets.map(set => <option key={set.ref} value={set.ref}>{set.name}</option>)}</select></div>}
      <nav className="sf-side-nav" aria-label="学习导航">
        {PRIMARY.flatMap(id => { const row = entries.find(entry => entry.id === id); return row ? [row.id === 'studyforge.courses' ? <div className="sf-side-course-row" key={row.id}>{link(row)}<button type="button" title="开始新课" aria-label="New session" onClick={() => ctx.uiWorkspace.startSession()}>＋</button></div> : link(row)] : []; })}
      </nav>
      {!collapsed && <div className="sf-side-recent">
        {running.length > 0 && <><div className="sf-side-label">进行中</div>{running.map(row => <button key={row.id} className="sf-side-active" onClick={() => ctx.uiWorkspace.openSession(row.id)}>
          <span><i data-running={row.running} /><b>{row.title || '自由学习'}</b></span><small>{row.running ? '正在回复…' : '回到这节课'}</small></button>)}</>}
        {rows.length > 0 && <><div className="sf-side-label">最 近</div>{rows.slice(0, 10).map(row => <button key={row.id} className={'sf-side-session' + (row.id === sessions.current && active === null ? ' on' : '')}
          onClick={() => ctx.uiWorkspace.openSession(row.id)} title={row.title || '未命名课程'}><span>{row.title || '未命名课程'}</span><time>{new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(row.updatedAt))}</time></button>)}</>}
      </div>}
      <footer className="sf-side-foot">{renderSlot('sidebar.footer.action', { wide: !collapsed })}{renderSlot('sidebar.settings', { wide: !collapsed })}
        {!collapsed && <div className="sf-side-connection"><i data-ready={sessions.phase === 'ready'} />{sessions.phase === 'ready' ? '已连接' : '正在连接…'}</div>}</footer>
    </aside>;
  }
  ctx.effect(() => ctx.slots.inject('sidebar.content', () => ctx.slots.register({ name: 'sidebar.content' }, Sidebar)));
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'studyforge.learning-spaces', order: 35, label: '学习空间',
  }, function LearningSpaces(): React.JSX.Element {
    const renderWorkspace = useSyncExternalStore(subscribeWorkspace, readWorkspace);
    return <section className="sf-space-settings" data-testid="learning-space-settings"><h2>学习空间</h2>
      {renderWorkspace?.('sidebar.workspaces', { wide: true, expandSidebar: () => {} })}</section>;
  })));
}
