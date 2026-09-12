import type { Context } from '@deepseek-ai/cordis';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots';
import { useState, useSyncExternalStore } from 'react';
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
const PRIMARY = ['studyforge.home', 'studyforge.courses', 'studyforge.materials', 'studyforge.sets'];

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
  function Sidebar({ collapsed, usePanelInfo, useSessions, renderSidebarSlot: renderSlot }: Props): React.JSX.Element {
    const active = usePanelInfo(value => value.activePanelId);
    const sessions = useSessions(value => value);
    const entries = useSyncExternalStore(subscribe, () => panels);
    const [more, setMore] = useState(() => { try { return localStorage.getItem('studyforge.notebook.more') === 'true'; } catch { return false; } });
    const rows = sessions.ids.flatMap(id => { const row = sessions.byId[id]; return row && !row.blank && row.origin !== 'subagent' ? [row] : []; });
    const running = rows.filter(row => row.running || row.id === sessions.current);
    const openPanel = (id: MainPanelId): void => { ctx.layout.selectPanel(id); };
    const link = (row: Panel): React.JSX.Element => <button type="button" key={row.id} title={row.title}
      className={active === row.id ? 'on' : ''} aria-current={active === row.id ? 'page' : undefined}
      onClick={() => openPanel(row.id)}>{renderSlot('sidebar.panellist', { size: 16, active: active === row.id }, { only: row.id })}<span>{row.title}</span></button>;
    return <aside className="sf-original-sidebar" data-collapsed={collapsed} data-testid="notebook-sidebar">
      <div className="sf-side-brand"><div className="sf-side-wordmark">{renderSlot('sidebar.brand.mark', { size: 18 })}{!collapsed && renderSlot('sidebar.brand.name', {})}</div>
        <button className="sf-side-fold" title={collapsed ? '展开侧栏' : '收起侧栏'} aria-label={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => ctx.layout.toggleSidebar()}>{collapsed ? '›' : '‹'}</button></div>
      {!collapsed && <button className="sf-side-set" onClick={() => openPanel('studyforge.sets' as MainPanelId)}>全部学习<span>▾</span></button>}
      <nav className="sf-side-nav" aria-label="学习导航">
        {entries.filter(row => PRIMARY.includes(row.id)).map(row => row.id === 'studyforge.courses' ? <div className="sf-side-course-row" key={row.id}>{link(row)}<button type="button" title="新建会话" aria-label="New session" onClick={() => ctx.uiWorkspace.startSession()}>＋</button></div> : link(row))}
        <details className="sf-side-more" open={more || collapsed} onToggle={event => { const open = event.currentTarget.open; setMore(open); try { localStorage.setItem('studyforge.notebook.more', String(open)); } catch { /* Local appearance only. */ } }}>
          <summary>更多 <span>▾</span></summary><div>{entries.filter(row => !PRIMARY.includes(row.id)).map(link)}</div>
        </details>
      </nav>
      {!collapsed && <div className="sf-side-recent">
        {running.length > 0 && <><div className="sf-side-label">进行中</div>{running.map(row => <button key={row.id} className="sf-side-active" onClick={() => ctx.uiWorkspace.openSession(row.id)}>
          <span><i data-running={row.running} /><b>{row.title || '自由学习'}</b></span><small>{row.running ? '正在回复…' : '回到这节课'}</small></button>)}</>}
        {rows.length > 0 && <><div className="sf-side-label">最 近</div>{rows.slice(0, 10).map(row => <button key={row.id} className={'sf-side-session' + (row.id === sessions.current && active === null ? ' on' : '')}
          onClick={() => ctx.uiWorkspace.openSession(row.id)} title={row.title || '未命名课程'}><span>{row.title || '未命名课程'}</span><time>{new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(row.updatedAt))}</time></button>)}</>}
      </div>}
      <details className="sf-side-archive" open={collapsed || undefined}><summary>全部会话与工作区</summary>{renderSlot('sidebar.workspaces', { wide: !collapsed, expandSidebar: () => ctx.layout.toggleSidebar() })}</details>
      <footer className="sf-side-foot">{renderSlot('sidebar.footer.action', { wide: !collapsed })}{renderSlot('sidebar.settings', { wide: !collapsed })}
        {!collapsed && <div className="sf-side-connection"><i data-ready={sessions.phase === 'ready'} />{sessions.phase === 'ready' ? '已连接' : '正在连接…'}</div>}</footer>
    </aside>;
  }
  ctx.effect(() => ctx.slots.inject('sidebar.content', () => ctx.slots.register({ name: 'sidebar.content' }, Sidebar)));
}
