import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { StudyForgeShell, type StudentLesson } from './StudyForgeShell.tsx';
import { STUDENT_PAGES, type StudentPageId, type StudentPageSpec } from './navigation.ts';

const css = `
/* StudyForge paper-and-ink surface. Scoped to the pages this client owns: the
   native frame, Conversation, sidebar browser and rightbar keep their own look. */
/* The native classroom reads the same paper-and-ink palette through the
   Conversation's public data hooks and the documented --dsw-* alias tokens.
   No hashed class name is referenced, and only the classroom surface is scoped. */
[data-conversation-scroll],[data-composer-seat]{
  --dsw-alias-bg-base:#fdfaf1;--dsw-alias-bg-layer-1:#fffdf6;--dsw-alias-bg-layer-2:#f6f1e3;
  --dsw-alias-bg-layer-3:#f9f5ea;--dsw-alias-bg-layer-4:#efe7d2;
  --dsw-alias-label-primary:#26437c;--dsw-alias-label-secondary:#5a688a;--dsw-alias-label-tertiary:#8a887c;
  --dsw-alias-border-l1:#e7e0cd;--dsw-alias-border-l2:#d9d2bd;--dsw-alias-border-l3:#cfc7ae;
  font-family:"Songti SC","Noto Serif SC",serif;
}
[data-conversation-scroll]{background:#fdfaf1}
[data-composer-seat]{background:#fdfaf1}
.sf-page{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;overflow:auto;background:#fdfaf1;color:#26437c;font-family:"Songti SC","Noto Serif SC",serif}
.sf-page-head{display:flex;justify-content:space-between;align-items:baseline;gap:16px;border-bottom:1px solid #d9d2bd;padding:28px clamp(22px,5vw,64px) 18px;font-size:13px;letter-spacing:.08em}
.sf-page-date{color:var(--nb-pencil);font-family:var(--sf-ui-font);font-size:var(--sf-text-meta);letter-spacing:.03em}
.sf-page-body{padding:clamp(28px,7vh,72px) clamp(22px,5vw,64px);max-width:62ch}
.sf-page-index{font-size:var(--sf-text-meta);color:var(--nb-pencil);display:block;margin-bottom:24px;font-family:var(--sf-ui-font)}
.sf-page-body h1{font-size:var(--sf-text-page);font-weight:500;margin:0 0 18px;letter-spacing:.02em;line-height:1.4}
.sf-page-body p{font-size:14px;line-height:1.9;color:#5a688a;margin:0 0 26px}
.sf-note{font-size:13px;color:#8a887c;margin:0}
.sf-action{display:inline-flex;align-items:center;gap:32px;padding:12px 18px;border:1px solid #26437c;background:#26437c;color:#fdfaf1;border-radius:3px;cursor:pointer;font:inherit;font-size:14px;transition:background 140ms ease}
.sf-action:hover{background:#3d5488}.sf-action:focus-visible,.sf-lessons button:focus-visible{outline:2px solid #c93a2e;outline-offset:3px}
.sf-lessons{list-style:none;margin:0;padding:0;border-top:1px solid #d9d2bd}
.sf-lessons li{border-bottom:1px solid #eee7d6}
.sf-lessons button{display:flex;justify-content:space-between;align-items:baseline;gap:16px;width:100%;border:0;background:transparent;color:inherit;font:inherit;font-size:14px;text-align:left;padding:14px 4px;cursor:pointer}
.sf-lessons button:hover{background:#f6f1e3}
.sf-meta{font:11px system-ui,sans-serif;color:#8a887c;letter-spacing:.04em}
.sf-brand{font-size:15px;letter-spacing:.03em;color:#26437c;font-weight:600}
.sf-lesson{box-sizing:border-box;height:100%;min-height:0;overflow:auto;padding:22px 20px;background:#fdfaf1;color:#26437c;font-family:"Songti SC","Noto Serif SC",serif}
.sf-lesson h2{font-size:15px;font-weight:600;margin:0 0 4px;letter-spacing:.04em}
.sf-lesson .sf-note{margin:10px 0 0;line-height:1.8}
.sf-lesson section{margin-top:26px;border-top:1px solid #d9d2bd;padding-top:14px}
.sf-lesson h3{font-size:12px;font-weight:600;margin:0 0 10px;letter-spacing:.1em;color:#777d88}
.sf-lesson h4{font-size:11px;font-weight:600;margin:14px 0 6px;letter-spacing:.08em;color:#8a887c}
.sf-lesson ul{list-style:none;margin:0;padding:0}
.sf-lesson li{display:flex;justify-content:space-between;gap:12px;font-size:13px;line-height:1.9;border-bottom:1px solid #f0e9d8;padding:8px 0}
.sf-lesson li .sf-meta{white-space:nowrap}
@media(max-width:900px){.sf-page-body{padding:22px}}
@media(prefers-reduced-motion:reduce){.sf-action{transition:none}}
`;

/** Replace only owned contributions; the native frame, Conversation, rightbar and settings survive. */
export function registerStudentShell(ctx: Context): void {
  const lifetime = new AbortController();
  const style = document.createElement('style');
  style.dataset.studyforgeStyle = 'p2';
  style.textContent = css;
  document.head.append(style);
  ctx.effect(() => () => { lifetime.abort(); style.remove(); });

  for (const page of STUDENT_PAGES) {
    ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: page.id, priority: -10 }, pageView(ctx, page))));
    ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
      { name: 'sidebar.panellist', id: page.id, order: page.order, label: page.title }, pageIcon(page.id),
    )));
  }
  ctx.effect(() => ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register(
    { name: 'sidebar.brand.name', priority: -10 }, () => <span className="sf-brand">StudyForge</span>,
  )));
}

/** One centre-column occupant per page key; the layout renders exactly the active key. */
function pageView(ctx: Context, page: StudentPageSpec): (props: PropsRuntime<'main'>) => React.JSX.Element {
  return function StudentPage({ useSessions }): React.JSX.Element {
    const list = useSessions(snapshot => snapshot);
    const lessons: StudentLesson[] = list.ids.flatMap(id => {
      const session = list.byId[id];
      return session === undefined || session.blank || session.origin === 'subagent'
        ? []
        : [{ id: session.id, title: session.title ?? '未命名的一课', running: session.running }];
    });
    return <StudyForgeShell
      page={page.id}
      today={todayLabel()}
      lessons={lessons}
      lessonsLoaded={list.phase === 'ready'}
      onOpenClassroom={() => { ctx.layout.selectPanel(null); }}
      onOpenLesson={(id) => {
        const entry = ctx.sessions.list.getSnapshot().ids.find(candidate => candidate === id);
        if (entry === undefined) return;
        ctx.sessions.open(entry);
        ctx.layout.selectPanel(null);
      }}
    />;
  };
}

function todayLabel(): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
}

/** Sidebar glyph for one row; the sidebar owns the row button and its label. */
function pageIcon(page: StudentPageId): (props: PropsRuntime<'sidebar.panellist'>) => React.JSX.Element {
  const paths: Record<StudentPageId, React.JSX.Element> = {
    'studyforge.home': <path d="M4 11 12 4l8 7v9h-6v-5h-4v5H4z" />,
    'studyforge.courses': <path d="M4 5h16v13H4zM4 9h16M9 9v9" />,
    'studyforge.materials': <path d="M5 4h7a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3zM15 4h4v19h-4" />,
    'studyforge.sets': <path d="M6 4h12v16l-6-4-6 4z" />,
    'studyforge.memory': <path d="M12 4a7 7 0 0 1 7 7c0 2-1 3.5-2 5H7c-1-1.5-2-3-2-5a7 7 0 0 1 7-7zM9 20h6" />,
    'studyforge.calendar': <path d="M4 6h16v14H4zM4 10h16M9 4v4M15 4v4" />,
  };
  return function PageGlyph({ size }): React.JSX.Element {
    return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">{paths[page]}</svg>;
  };
}
