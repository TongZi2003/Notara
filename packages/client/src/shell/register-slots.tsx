import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-resources/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client';
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { StudyForgeShell } from './StudyForgeShell.tsx';

const css = `
/* rc.2 exposes no path-title slot. Keep its native filename tab and controls;
   hide only the redundant absolute-path row while our student surface owns main. */
body:has(.sf-shell) [data-textpreview-path]{display:none}
.sf-shell{height:100%;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 236px;color:#26437c;background:#fdfaf1;font-family:"Songti SC","Noto Serif SC",serif}
.sf-shell[data-preview=true]{grid-template-columns:minmax(0,1fr)}
.sf-space{min-width:0;display:flex;flex-direction:column;padding:32px clamp(22px,5vw,64px)}
.sf-heading{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #d9d2bd;padding-bottom:18px;font-size:13px;letter-spacing:.08em}
.sf-date{color:#777d88;font-family:system-ui,sans-serif;font-size:11px;letter-spacing:.03em}
.sf-empty{margin:auto 0;padding:48px 0}.sf-page-number{font-size:14px;color:#a9a28b;display:block;margin-bottom:24px;font-family:system-ui,sans-serif}
.sf-empty h1{font-size:clamp(24px,2.4vw,34px);font-weight:500;margin:0 0 18px;letter-spacing:.02em;line-height:1.4}
.sf-empty p{font-size:14px;line-height:1.9;color:#5a688a;margin:0 0 28px}
.sf-primary{display:inline-flex;align-items:center;gap:32px;padding:12px 18px;border:1px solid #26437c;background:#26437c;color:#fdfaf1;border-radius:3px;cursor:pointer;font:inherit;font-size:14px;transition:background 140ms ease}
.sf-primary:hover{background:#3d5488}.sf-primary:disabled{opacity:.5;cursor:wait}.sf-primary:focus-visible,.sf-nav button:focus-visible{outline:2px solid #c93a2e;outline-offset:3px}
.sf-empty .sf-message{font-size:12px;margin-top:16px;min-height:23px;color:#a52e24}
.sf-footer{padding-top:20px;border-top:1px solid #d9d2bd;color:#8a887c;font-size:12px}
.sf-context{background:#efe7d2;border-left:1px solid #d9d2bd;padding:30px 22px}.sf-context h2{font-size:14px;font-weight:500;margin:0 0 60px}.sf-context p{font-size:13px;line-height:1.8;margin-top:22px}.sf-context>span{font-size:11px;color:#747369}
.sf-page-outline{width:94px;height:124px;border:1px solid #b9b19c;margin:0 auto;padding:28px 15px;background:#f6f1e3}.sf-page-outline i{display:block;height:1px;background:#d9d2bd;margin-bottom:14px}.sf-page-outline i:last-child{width:60%}
.sf-nav{padding:18px 10px;display:flex;flex-direction:column;gap:6px;color:#26437c}.sf-nav-title{font:11px system-ui,sans-serif;letter-spacing:.12em;color:#777d88;padding:0 10px 12px}
.sf-nav button{border:0;background:transparent;color:inherit;text-align:left;padding:11px 12px;border-radius:3px;font-size:13px;cursor:pointer}.sf-nav button:hover,.sf-nav button[aria-current=page]{background:#eee9df}.sf-brand{font-size:15px;letter-spacing:.03em;color:#26437c;font-weight:600}
.sf-nav[data-wide=false]{padding:18px 0;align-items:center}.sf-nav[data-wide=false] button{display:grid;place-items:center;width:32px;height:32px;padding:6px}
@media(max-width:900px){.sf-shell{grid-template-columns:minmax(0,1fr)}.sf-context{display:none}.sf-space{padding:22px}.sf-empty{padding:24px 0}}
@media(prefers-reduced-motion:reduce){.sf-primary{transition:none}}
`;

/** Replace only owned contributions; the native frame, settings and rightbar survive. */
export function registerStudentShell(ctx: Context): void {
  const lifetime = new AbortController();
  const style = document.createElement('style');
  style.dataset.studyforgeStyle = 'p0';
  style.textContent = css;
  document.head.append(style);
  ctx.effect(() => () => { lifetime.abort(); style.remove(); });

  function Shell(): React.JSX.Element {
    const sessions = useSyncExternalStore(listener => ctx.sessions.list.subscribe(listener), () => ctx.sessions.list.getSnapshot());
    const [pending, setPending] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [message, setMessage] = useState('');
    async function preview(): Promise<void> {
      if (pending) return;
      const id = sessions.current ?? sessions.ids[0];
      const session = id === undefined ? undefined : sessions.byId[id];
      if (!session) return;
      setPending(true);
      setMessage('');
      try {
        if (!ctx.documentPreviews.candidates('学习示例.md').some(item => item.id === '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown')) throw new Error('Native Markdown preview unavailable');
        // The native navigation command requires the selected Session's committed seat.
        flushSync(() => { ctx.sessions.open(session.id); ctx.layout.selectPanel(null); });
        if (lifetime.signal.aborted) return;
        ctx.sidebarRight.openResource(fileAddressFor(session.id, session.cwd, '学习示例.md'));
        if (!lifetime.signal.aborted) setPreviewOpen(true);
      } catch (error) {
        console.warn('StudyForge preview', error);
        if (!lifetime.signal.aborted) setMessage('资料还没打开，请再试一次。');
      } finally {
        if (!lifetime.signal.aborted) setPending(false);
      }
    }
    return <StudyForgeShell canPreview={sessions.ids.length > 0} previewOpen={previewOpen} pending={pending} message={message} onPreview={() => { void preview(); }} />;
  }
  function Navigation({ wide }: PropsRuntime<'sidebar.workspaces'>): React.JSX.Element {
    return <nav className="sf-nav" data-wide={wide} aria-label="学习导航">
      {wide && <span className="sf-nav-title">我的学习</span>}
      <button aria-current="page" aria-label="学习空间" title={wide ? undefined : '学习空间'} onClick={() => ctx.layout.selectPanel(null)}>
        {wide ? '学习空间' : <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 4h6l2 2 2-2h6v16h-6l-2 2-2-2H4zM12 6v16" /></svg>}
      </button>
    </nav>;
  }
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'conversation', priority: -10 }, Shell)));
  ctx.effect(() => ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({ name: 'sidebar.workspaces', priority: -10 }, Navigation)));
  ctx.effect(() => ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name', priority: -10 }, () => <span className="sf-brand">StudyForge</span>)));
}
