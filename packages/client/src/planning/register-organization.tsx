import type { Context } from '@deepseek-ai/cordis';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { MaterialNavigation } from '../materials/material-navigation.ts';
import { SetPage } from '../sets/SetPage.tsx';
import { Calendar } from './Calendar.tsx';
import { Today } from './Today.tsx';

export function registerOrganization(ctx: Context, navigation: MaterialNavigation): void {
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.studyforgeStyle = 'organization'; style.textContent = css; document.head.append(style); return () => style.remove(); });
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'studyforge.sets', priority: -20 },
    () => <SetPage ctx={ctx} onMaterial={material => { navigation.show({ materialId: material.materialId, versionId: material.currentVersion.versionId }); ctx.layout.selectPanel('studyforge.materials' as MainPanelId); }}
      onSource={source => { navigation.show(source); ctx.layout.selectPanel('studyforge.materials' as MainPanelId); }} />)));
  async function open(target: string): Promise<void> {
    if (target.startsWith('session:')) { ctx.sessions.open(target.slice(8) as SessionId); ctx.layout.selectPanel(null); return; }
    if (target.startsWith('route:')) {
      const result = await ctx.remote.studyforgeOrganization.openPlannedLesson({ operationId: crypto.randomUUID(), nodeId: target.slice(6) });
      if (result.ok) { ctx.sessions.open(result.value.sessionId as SessionId); ctx.layout.selectPanel(null); }
      return;
    }
    if (target.startsWith('card:') || target.startsWith('knowledge:')) { ctx.layout.selectPanel('studyforge.cards' as MainPanelId); return; }
    if (target.startsWith('set:')) { ctx.layout.selectPanel('studyforge.sets' as MainPanelId); return; }
    ctx.layout.selectPanel('studyforge.courses' as MainPanelId);
  }
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'studyforge.calendar', priority: -20 },
    () => <Calendar ctx={ctx} onOpen={target => { void open(target); }} />)));
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'studyforge.home', priority: -20 },
    () => <Today ctx={ctx} onOpen={target => { if (target) void open(target); else ctx.layout.selectPanel(null); }} />)));
}
const css = `
.sf-organization-columns{display:grid;grid-template-columns:minmax(180px,26%) minmax(0,1fr);min-height:0;flex:1}
.sf-organization-list{border-right:1px solid #d9d2bd;padding:20px;overflow:auto}
.sf-organization-detail,.sf-calendar-body{padding:24px;min-width:0;overflow:auto}
.sf-org-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:13px 6px;border:0;border-bottom:1px solid #e7e0cd;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;width:100%;overflow-wrap:anywhere}
.sf-org-row span,.sf-org-row small{font-size:12px}.sf-org-row[aria-current=true]{border-left:3px solid #26437c;background:#f6f1e3}
.sf-org-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.sf-org-actions h2,.sf-org-actions h3{flex:1}
.sf-org-form{display:flex;flex-direction:column;gap:16px;max-width:68ch}.sf-org-form label{display:flex;flex-direction:column;gap:5px}
.sf-org-form input,.sf-org-form select,.sf-org-form textarea,.sf-calendar-body input{border:1px solid #d9d2bd;border-radius:3px;background:#fffdf6;color:#26437c;font:inherit;padding:7px;min-width:0;max-width:100%;box-sizing:border-box}
.sf-org-form .sf-org-check{display:flex;flex-direction:row;align-items:center;gap:8px;padding:4px 0}.sf-org-check input{flex:none}
.sf-org-form fieldset{border:1px solid #d9d2bd;max-height:220px;overflow:auto}.sf-daily-settings{margin-top:32px;border-top:1px solid #d9d2bd;padding:14px 0}.sf-daily-settings summary{cursor:pointer;margin-bottom:14px}
.sf-book-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,38%);gap:18px}
.sf-book-original{min-width:0}.sf-book-structure{border-left:1px solid #d9d2bd;padding-left:16px;min-width:0;overflow:auto}
.sf-book-nodes{margin-top:14px}.sf-book-node{border-left:1px solid #d9d2bd;padding-left:8px;margin-block:10px;max-width:100%}
.sf-book-node[data-selected=true]{border-left-color:#26437c}.sf-book-node .sf-quiet{font-size:11px;margin-top:5px}
.sf-book-detail{border-top:1px solid #d9d2bd;margin-top:22px;padding-top:16px}.sf-book-mobile-tabs{display:none}
@media(max-width:760px){.sf-organization-columns{display:flex;flex-direction:column}.sf-organization-list{border-right:0;border-bottom:1px solid #d9d2bd;max-height:180px}.sf-organization-detail,.sf-calendar-body{padding:16px}.sf-book-columns{display:flex;flex-direction:column}.sf-book-structure{border-left:0;padding:0}.sf-book-mobile-tabs{display:flex;gap:10px;margin-bottom:12px}.sf-book-columns[data-view=original] .sf-book-structure{display:none}.sf-book-columns[data-view=structure] .sf-book-original{display:none}}
`;
