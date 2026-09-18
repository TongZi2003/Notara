import type { Context } from '@deepseek-ai/cordis';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { MaterialNavigation } from '../materials/material-navigation.ts';
import { MemoryPage } from '../memory/MemoryPage.tsx';
import { SetPage } from '../sets/SetPage.tsx';
import { Calendar } from './Calendar.tsx';
import { MAP_PAGE_ID, MapPage } from './MapPage.tsx';
import { useEffect } from 'react';
import { LearningEntry } from '../classroom/LearningEntry.tsx';
import { registerLearningComposer } from '../classroom/LearningComposer.tsx';
import './original-pages.css';

export function registerOrganization(ctx: Context, navigation: MaterialNavigation): void {
  registerLearningComposer(ctx);
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.studyforgeStyle = 'organization'; style.textContent = css; document.head.append(style); return () => style.remove(); });
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'studyforge.sets', priority: -20 },
    () => <SetPage ctx={ctx} onMaterial={material => { navigation.show({ materialId: material.materialId, versionId: material.currentVersion.versionId }); ctx.layout.selectPanel('studyforge.materials' as MainPanelId); }}
      onSource={source => { navigation.show(source); ctx.layout.selectPanel('studyforge.materials' as MainPanelId); }} />)));
  async function open(target: string): Promise<void> {
    if (target.startsWith('session:')) { ctx.sessions.open(target.slice(8) as SessionId); ctx.layout.selectPanel(null); return; }
    if (target.startsWith('route:')) {
      const result = await ctx.remote.studyforgeOrganization.openPlannedLesson({ operationId: crypto.randomUUID(), nodeId: target.slice(6) });
      if (result.ok) { await ctx.sessions.refresh(); ctx.sessions.open(result.value.sessionId as SessionId); ctx.layout.selectPanel(null); }
      return;
    }
    if (target.startsWith('card:') || target.startsWith('knowledge:')) { ctx.layout.selectPanel('studyforge.cards' as MainPanelId); return; }
    if (target.startsWith('set:')) { ctx.layout.selectPanel('studyforge.sets' as MainPanelId); return; }
    ctx.layout.selectPanel('studyforge.courses' as MainPanelId);
  }
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'studyforge.calendar', priority: -20 },
    () => <Calendar ctx={ctx} onOpen={target => { void open(target); }} />)));
  // B's 记忆 screen is the student's own surface, not only a tab inside one lesson.
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'studyforge.memory', priority: -20 },
    () => <MemoryPage ctx={ctx} />)));
  // 知识地图：按书籍 / atlas 两个视图共用一张 Mindmap 画布。
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: MAP_PAGE_ID, priority: -20 },
    () => <MapPage ctx={ctx} navigation={navigation} />)));
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: MAP_PAGE_ID, order: 36, label: '知识地图' },
    function MapGlyph({ size }): React.JSX.Element {
      return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 5v5M7 10l5-5 5 5M7 10H4v9h5M17 10h3v9h-5M9 19h6" />
      </svg>;
    },
  )), 'studyforge: map row');
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'studyforge.home', priority: -20 },
    function HomePage(): null {
      useEffect(() => { startLesson(ctx); }, []);
      return null;
    })));
  ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({ name: 'conversation.composer.dock', id: 'studyforge.learning-entry', order: -20 },
    (props: PropsRuntime<'conversation.composer.dock'>) => <LearningEntry {...props} ctx={ctx} />)));
}

/**
 * B's 开始学习 opens a new lesson; the native Workspace flow owns what that means
 * (blank Session for the current workspace, then the classroom). The guard exists
 * because a composition that does not inject `uiWorkspace` must not throw — it
 * simply leaves the student where they are.
 */
function startLesson(ctx: Context): void {
  const workspace = ctx.uiWorkspace;
  if (workspace === undefined || typeof workspace.startSession !== 'function') return;
  workspace.startSession();
}
const css = `
.sf-organization-columns{display:grid;grid-template-columns:minmax(180px,26%) minmax(0,1fr);min-height:0;flex:1}
.sf-organization-list{border-right:1px solid #d9d2bd;padding:20px;overflow:auto}
.sf-organization-detail,.sf-calendar-body{padding:24px;min-width:0;overflow:auto}
.sf-org-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:13px 6px;border:0;border-bottom:1px solid #e7e0cd;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;width:100%;overflow-wrap:anywhere}
.sf-org-row span,.sf-org-row small{font-size:12px}.sf-org-row[aria-current=true]{border-left:3px solid #26437c;background:#f6f1e3}
.sf-org-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.sf-org-actions h2,.sf-org-actions h3{flex:1}
.sf-org-form{display:flex;flex-direction:column;gap:16px;max-width:68ch}.sf-org-form label{display:flex;flex-direction:column;gap:5px}
.sf-org-form input,.sf-org-form select,.sf-org-form textarea,.sf-calendar-body input{border:1px solid var(--nb-rule);border-radius:var(--sf-ui-radius);background:var(--nb-hi);color:var(--nb-ink);font:var(--nb-size)/1.6 var(--sf-ui-font);padding:7px;min-width:0;max-width:100%;box-sizing:border-box}
.sf-org-form .sf-org-check{display:flex;flex-direction:row;align-items:center;gap:8px;padding:4px 0}.sf-org-check input{flex:none}
.sf-org-form fieldset{border:1px solid #d9d2bd;max-height:220px;overflow:auto}.sf-daily-settings{margin-top:32px;border-top:1px solid #d9d2bd;padding:14px 0}.sf-daily-settings summary{cursor:pointer;margin-bottom:14px}
.sf-book-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,38%);gap:18px}
.sf-book-original{min-width:0}.sf-book-structure{border-left:1px solid #d9d2bd;padding-left:16px;min-width:0;overflow:auto}
.sf-book-nodes{margin-top:14px}.sf-book-node{border-left:1px solid #d9d2bd;padding-left:8px;margin-block:10px;max-width:100%}
.sf-book-node[data-selected=true]{border-left-color:#26437c}.sf-book-node .sf-quiet{font-size:11px;margin-top:5px}
.sf-book-detail{border-top:1px solid #d9d2bd;margin-top:22px;padding-top:16px}.sf-book-mobile-tabs{display:none}
@media(max-width:760px){.sf-organization-columns{display:flex;flex-direction:column}.sf-organization-list{border-right:0;border-bottom:1px solid #d9d2bd;max-height:180px}.sf-organization-detail,.sf-calendar-body{padding:16px}.sf-book-columns{display:flex;flex-direction:column}.sf-book-structure{border-left:0;padding:0}.sf-book-mobile-tabs{display:flex;gap:10px;margin-bottom:12px}.sf-book-columns[data-view=original] .sf-book-structure{display:none}.sf-book-columns[data-view=structure] .sf-book-original{display:none}}
.sf-map-page{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:#fdfaf1;color:#26437c;font-family:"Songti SC","Noto Serif SC",serif}
.sf-map-head{display:flex;align-items:center;gap:16px;border-bottom:1px solid #d9d2bd;padding:14px clamp(20px,4vw,48px);font-size:13px;letter-spacing:.08em}
.sf-map-views{display:flex;gap:6px}
.sf-map-page>.sf-note,.sf-map-page>.sf-notice{margin:14px clamp(20px,4vw,48px)}
.sf-map-page .sf-mindmap-shell{flex:1;min-height:0;max-height:none;border:0;border-radius:0}
`;
