/**
 * P6 course page registration.
 *
 * The page is an ordinary keyed occupant of the frame's `main` slot, registered
 * at a lower priority than the shell's placeholder so it shadows that
 * placeholder and nothing else. The sidebar row still belongs to the shell.
 *
 * Two halves, both reading the real Host: the native lesson list plus the
 * planned roadmap, and the precise-target plan editor. Nothing here starts a
 * second Session, keeps an open-tab ledger or mirrors a native capability list.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionId } from '@studyforge/contracts';
import { useCallback, useState } from 'react';
import { CourseMap, NativeLessonList, type NativeLessonRow } from './CourseMap.tsx';
import { CourseRoadmap } from './CourseRoadmap.tsx';
import { PlanEditor } from '../planning/PlanEditor.tsx';
// The ported page sheet; importing it here too keeps the course page styled in a
// composition that registers this page without the organization page beside it.
import '../planning/original-pages.css';

/** This client's `main` key; it is the shell's courses row, not a new sidebar entry. */
export const COURSES_PAGE_ID = 'studyforge.courses';

const css = `
.sf-courses-page{box-sizing:border-box;min-height:0;color:#26437c}
.sf-courses-page .sec-head{margin-top:0}
.sf-courses-page .plain-wrap{max-width:880px;padding-top:var(--s6)}
.sf-courses-tabs{display:flex;gap:8px;margin:var(--s5) 0 18px}
.sf-courses-block{display:flex;flex-direction:column;gap:12px;width:100%;min-width:0;margin-bottom:32px}
.sf-courses-block h2{font-size:18px;font-weight:600;margin:0;letter-spacing:.03em;font-family:var(--font-song,"Songti SC",serif)}
.sf-roadmap-filter{display:flex;flex-wrap:wrap;gap:12px;align-items:center;border:1px solid #e7e0cd;border-radius:4px;background:#fffdf6;padding:10px 12px}
.sf-roadmap-filter label{display:flex;gap:6px;align-items:center;font-size:12px;color:#777d88}
.sf-roadmap-filter input[type=date]{border:1px solid #d9d2bd;border-radius:3px;background:#fffdf6;color:#26437c;font:inherit;font-size:12px;padding:5px 7px}
.sf-roadmap{list-style:none;margin:0;padding:0;border-top:1px solid #d9d2bd}
.sf-roadmap-canvas{position:relative;border:1px dashed #d9d2bd;border-radius:6px;background:#fffdf6;overflow:auto;min-height:320px;touch-action:none}
.sf-roadmap-card{position:absolute;display:flex;flex-direction:column;gap:6px;min-width:150px;max-width:210px;border:1px solid #d9d2bd;border-radius:4px;background:#fdfaf1;color:#26437c;cursor:grab;padding:10px 12px;user-select:none}
.sf-roadmap-card:active{cursor:grabbing}
.sf-roadmap-card-placed{border-color:#26437c;background:#f6f1e3}
.sf-roadmap-card .sf-quiet{align-self:flex-start}
.sf-roadmap-row{display:flex;flex-direction:column;gap:6px;border-bottom:1px solid #eee7d6;padding:12px 4px}
.sf-roadmap-context{opacity:.62}
.sf-roadmap-row-head{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline}
.sf-roadmap-title{font-size:15px}
.sf-roadmap-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.sf-roadmap-mount label{display:flex;gap:8px;align-items:center;font-size:12px;color:#777d88}
.sf-roadmap-mount select,.sf-route-editor select,.sf-route-editor input,.sf-route-editor textarea,.sf-plan-editor select,.sf-plan-editor input,.sf-plan-editor textarea{border:1px solid #d9d2bd;border-radius:3px;background:#fffdf6;color:#26437c;font:13px/1.7 inherit;padding:7px 9px}
.sf-route-editor,.sf-plan-editor{display:flex;flex-direction:column;gap:12px;border:1px solid #d9d2bd;border-radius:4px;background:#fffdf6;padding:16px 18px;max-width:82ch}
.sf-route-editor h3,.sf-plan-editor h3{margin:0;font-size:15px;font-weight:600;letter-spacing:.04em}
.sf-route-editor label,.sf-plan-editor label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:#777d88}
.sf-route-editor fieldset,.sf-plan-editor fieldset{display:flex;flex-direction:column;gap:10px;border:1px solid #e7e0cd;border-radius:3px;margin:0;padding:12px}
.sf-route-editor legend,.sf-plan-editor legend{font-size:12px;letter-spacing:.08em;color:#5a688a;padding:0 6px}
.sf-route-materials{list-style:none;display:flex;flex-direction:column;gap:6px;margin:0;padding:0}
.sf-route-materials li{display:flex;flex-wrap:wrap;gap:10px;align-items:center;border-bottom:1px dotted #e7e0cd;padding-bottom:6px}
.sf-route-material-first,.sf-route-material-label{font-size:13px;color:#26437c}
.sf-route-material-first{display:flex;gap:5px;align-items:center}
.sf-route-material-label{flex:1;min-width:120px}
.sf-route-material-actions,.sf-route-add,.sf-route-editor-actions,.sf-plan-editor-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.sf-quiet{border:1px solid #cfc7ae;border-radius:3px;background:transparent;color:#26437c;cursor:pointer;font:inherit;font-size:12px;padding:4px 9px}
.sf-quiet:hover{background:#f6f1e3}
.sf-action{display:inline-flex;align-items:center;gap:10px;border:1px solid #26437c;border-radius:3px;background:#26437c;color:#fdfaf1;cursor:pointer;font:inherit;font-size:13px;padding:8px 14px}
.sf-action:disabled{opacity:.55;cursor:default}
.sf-action-quiet{background:transparent;color:#26437c;border-color:#cfc7ae}
.sf-action-quiet:hover{background:#f6f1e3}
.sf-chip-row{display:flex;flex-wrap:wrap;gap:6px}
.sf-chip{border:1px solid #cfc7ae;border-radius:999px;background:transparent;color:#5a688a;cursor:pointer;font:inherit;font-size:12px;padding:4px 12px}
.sf-chip-on{border-color:#26437c;background:#26437c;color:#fdfaf1}
.sf-note{margin:0;font-size:13px;color:#8a887c}
.sf-meta{font:11px system-ui,sans-serif;color:#8a887c;letter-spacing:.04em}
.sf-notice{margin:0;border:1px solid #cfc7ae;border-radius:3px;background:#f6f1e3;color:#5a688a;font-size:12px;line-height:1.7;padding:8px 10px}
.sf-lessons{list-style:none;margin:0;padding:0;border-top:1px solid #d9d2bd}
.sf-lessons li{border-bottom:1px solid #eee7d6}
.sf-lessons button{display:flex;justify-content:space-between;gap:16px;width:100%;border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:14px;text-align:left;padding:12px 4px}
.sf-lessons button:hover{background:#f6f1e3}
.sf-plan-list{list-style:none;display:flex;flex-direction:column;gap:8px;margin:0;padding:0}
.sf-plan-row{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;border-bottom:1px solid #eee7d6;padding:10px 2px}
.sf-plan-open{border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:14px;text-align:left;flex:1;min-width:160px;padding:0}
.sf-plan-open:hover span{text-decoration:underline}
@media(max-width:760px){.sf-courses-page .plain-wrap{padding:var(--s5) var(--s4) var(--s6)}}
`;

/**
 * Mount the course page and the plan editor. Registering at a lower priority
 * than the shell's placeholder shadows only that placeholder: the native frame,
 * the Conversation and the sidebar row survive, and a composition without the
 * organization Remote can still register nothing at all.
 */
export function registerCourses(ctx: Context): void {
  installStyles(ctx);
  const onOpenLesson = (id: string): void => {
    if (id === '') return;
    try { ctx.sessions.open(id as SessionId); } catch { return; }
    try { ctx.layout.selectPanel(null); } catch { /* the frame owns the panel */ }
  };
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: COURSES_PAGE_ID, priority: -20 },
    function CoursesPage({ useSessions }: PropsRuntime<'main'>): React.JSX.Element {
      const list = useSessions(snapshot => snapshot);
      const lessons: NativeLessonRow[] = list.ids.flatMap(id => {
        const session = list.byId[id];
        return session === undefined || session.blank || session.origin === 'subagent'
          ? []
          : [{ id: session.id, title: session.title ?? '未命名的一课', running: session.running }];
      });
      const [tab, setTab] = useState<'roadmap' | 'list' | 'plans'>('roadmap');
      const open = useCallback(onOpenLesson, []);
      return <main className={'sf-orig sf-page-scroll sf-courses-page' + (tab === 'roadmap' ? ' sf-courses-map-page' : '')} data-testid={`studyforge-page-${COURSES_PAGE_ID}`}>
          <nav className="sf-courses-tabs" aria-label="课程页" data-testid="courses-tabs">
            <button type="button" className={tab === 'roadmap' ? 'chip on' : 'chip'} data-testid="courses-tab-roadmap" onClick={() => { setTab('roadmap'); }}>路线图</button>
            <button type="button" className={tab === 'list' ? 'chip on' : 'chip'} data-testid="courses-tab-list" onClick={() => { setTab('list'); }}>课程列表</button>
            <button type="button" className={tab === 'plans' ? 'chip on' : 'chip'} data-testid="courses-tab-plans" onClick={() => { setTab('plans'); }}>计划</button>
          </nav>
          {tab === 'roadmap' ? <CourseRoadmap ctx={ctx} lessons={lessons} {...(list.current ? { currentSessionId: list.current } : {})} onOpenLesson={open} />
          : <div className="plain-wrap">{tab === 'list' ? <>
            <section className="sf-courses-block" data-testid="course-lessons">
              <h2>上过的课</h2>
              <NativeLessonList lessons={lessons} loaded={list.phase === 'ready'} onOpenLesson={open} />
            </section>
            <CourseMap ctx={ctx} lessons={lessons} lessonsLoaded={list.phase === 'ready'} onOpenLesson={open} />
          </> : <PlanEditor ctx={ctx} {...(list.current === undefined ? {} : { sessionId: list.current })} />}</div>}
      </main>;
    },
  )), 'studyforge: course page');
}

/** One sheet per mounted client; the native frame and Conversation keep their own look. */
function installStyles(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.studyforgeStyle = 'p6-courses';
    style.textContent = css;
    document.head.append(style);
    return () => { style.remove(); };
  }, 'studyforge: course styles');
}
