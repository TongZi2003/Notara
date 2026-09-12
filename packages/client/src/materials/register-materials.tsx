/**
 * P3.2/P3.3 wiring for the materials surface.
 *
 * Two public seams only. The materials page shadows this client's own
 * placeholder occupant of the `main` key, and the DOCX renderer joins the
 * native document-preview registry the way any other renderer does: a
 * definition plus a body under the same id in the keyed
 * `sidebar.right.tab.document` seat. No private registry, no second Sidebar and
 * no mirrored capability list.
 */
import type { Context } from '@deepseek-ai/cordis';
// Brings the `useResource` global standard hook the native document bodies type against.
import type {} from '@deepseek-ai/dsh-client-resources/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import { useEffect, useState } from 'react';
import './original-pages.css';
import { ContextPreview } from './ContextPreview.tsx';
import { DocxPreview } from './docx/DocxPreview.tsx';
import { SourceReferences } from './source-selection.ts';
import { holdSourceReferences } from './source-references-holder.ts';
import { registerSourceTrigger } from './source-trigger.ts';
import { registerSourceDisplay } from './source-display.tsx';
import { requestLessonPane } from './lesson-pane-request.ts';
import { LESSON_TAB_KIND } from '../classroom/LessonPanel.tsx';
import { SourceDocument } from './SourceDocument.tsx';
import { registerAutomaticSource } from './automatic-source.ts';
import { registerCardResource } from './CardResource.tsx';
import { MATERIALS_PAGE_ID, MaterialsPage, type MaterialsInjected, type MaterialsFace } from './MaterialsPage.tsx';

/** This client's DOCX implementation identity; its body registers under it. */
export const DOCX_PREVIEW_ID = '@studyforge/dsh-client/docx';

const css = `
[data-testid="message-sources"]{display:flex;justify-content:flex-end;gap:6px;padding:4px 0 12px}
[data-testid="message-sources"] button{border:1px solid #d9d2bd;border-radius:4px;background:#fffdf6;color:#26437c;font:inherit;font-size:12px;padding:5px 10px;cursor:pointer}
[data-testid="source-capture"]{padding:16px;min-width:0}
[data-testid="source-capture"] pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.75}
[data-testid="source-capture"]>button{border:1px solid #d9d2bd;border-radius:4px;background:#fffdf6;color:#26437c;padding:5px 10px;margin-bottom:10px}
[data-testid="source-capture"]>p{color:#6a7190;font-size:12px;line-height:1.7}
.sf-materials-body{display:flex;flex:1;min-height:0;border-top:1px solid #d9d2bd}
.sf-materials-column{display:flex;flex-direction:column;gap:14px;width:min(40%,380px);min-width:270px;overflow:auto;padding:20px 18px 48px;border-right:1px solid #e7e0cd}
.sf-material-reader{display:flex;flex-direction:column;gap:12px;flex:1;min-width:0;overflow:auto;padding:20px 22px 64px}
.sf-import{display:flex;flex-direction:column;gap:10px;position:relative}
.sf-import-input{position:absolute;width:1px;height:1px;clip-path:inset(50%);overflow:hidden}
.sf-import-drop{display:flex;flex-direction:column;gap:10px;align-items:flex-start;border:1px dashed #cfc7ae;border-radius:4px;background:#fffdf6;padding:16px}
.sf-import-drop-over{border-color:#26437c;background:#f6f1e3}
.sf-import-drop .sf-note{margin:0;font-size:12px;line-height:1.75}
.sf-notice{margin:0;border:1px solid #cfc7ae;border-radius:3px;background:#f6f1e3;color:#5a688a;font-size:12px;line-height:1.7;padding:8px 10px}
.sf-notice-error{border-color:#e0b3ab;background:#fdf3f1;color:#8f2c22}
.sf-materials-list h2{font-size:15px;font-weight:600;margin:0 0 6px;letter-spacing:.04em}
.sf-materials-list ul{list-style:none;margin:0;padding:0;border-top:1px solid #d9d2bd}
.sf-material-row{display:flex;align-items:center;gap:8px;border-bottom:1px solid #eee7d6}
.sf-material-open{display:flex;flex:1;flex-direction:column;gap:3px;min-width:0;border:0;border-radius:3px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;padding:9px 6px}
.sf-material-open:hover{background:#f6f1e3}
.sf-material-row-on .sf-material-open{background:#f1ead7}
.sf-material-title{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-material-version{border:1px solid #d9d2bd;border-radius:3px;color:#5a688a;cursor:pointer;flex:none;font-size:12px;padding:4px 9px;white-space:nowrap}
.sf-material-version:hover{border-color:#26437c;color:#26437c}
.sf-material-version input{display:none}
.sf-material-head{display:flex;flex-direction:column;gap:8px}
.sf-material-head h2{font-size:clamp(18px,1.6vw,22px);font-weight:500;margin:0;line-height:1.4}
.sf-material-head .sf-meta{margin:0}
.sf-material-head .sf-note{margin:0;font-size:12px}
.sf-material-head-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.sf-material-versions{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#5a688a}
.sf-material-versions select{border:1px solid #d9d2bd;border-radius:3px;background:#fffdf6;color:#26437c;font:inherit;font-size:12px;padding:5px 6px}
.sf-action-quiet{background:transparent;color:#26437c;border-color:#cfc7ae}
.sf-action-quiet:hover{background:#f6f1e3}
.sf-action:disabled{opacity:.55;cursor:default}
.sf-material-view{margin-top:6px;border-top:1px solid #e7e0cd;padding-top:12px}
.sf-material-outline{display:flex;flex-direction:column;gap:6px;align-items:flex-start;margin-top:4px}
.sf-context-line{display:flex;gap:10px;align-items:center;border:1px solid #d9d2bd;border-radius:3px;background:#fffdf6;color:#5a688a;font-size:12px;padding:6px 10px}
.sf-context-label{color:#26437c}
.sf-material-outline h3{font-size:13px;font-weight:600;letter-spacing:.08em;margin:0;color:#5a688a}
.sf-material-outline ol{list-style:none;margin:0;padding:0;border-top:1px solid #eee7d6}
.sf-material-outline li{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;border-bottom:1px solid #eee7d6;padding:7px 2px}
.sf-material-outline .sf-outline-path{font-size:14px;color:#26437c}
.sf-material-outline .sf-meta{margin:0}
.sf-material-image{max-width:100%;height:auto;border:1px solid #e7e0cd;border-radius:3px;background:#fff}
.sf-material-html,.sf-material-pdf object{width:100%;height:min(70vh,680px);border:1px solid #e7e0cd;border-radius:3px;background:#fff}
.sf-material-pdf{display:flex;flex-direction:column;gap:8px}
.sf-material-pdf .sf-note{margin:0;font-size:12px}
.sf-material-text{margin:0;max-height:70vh;overflow:auto;border:1px solid #e7e0cd;border-radius:3px;background:#fffdf6;color:#26437c;font:13px/1.85 ui-monospace,SFMono-Regular,Menlo,monospace;padding:14px;white-space:pre-wrap;word-break:break-word}
.sf-markdown{max-height:72vh;overflow:auto;border:1px solid #e7e0cd;border-radius:3px;background:#fffdf6;color:#26437c;font-size:14px;line-height:1.9;padding:16px 18px}
.sf-markdown h1{font-size:20px;margin:0 0 10px}
.sf-markdown h2{font-size:17px;margin:16px 0 8px}
.sf-markdown p{margin:0 0 10px}
.sf-markdown table{border-collapse:collapse;margin:8px 0}
.sf-markdown td,.sf-markdown th{border:1px solid #d9d2bd;padding:4px 8px}
.sf-markdown code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.sf-markdown pre{background:#f6f1e3;border-radius:3px;padding:10px;overflow:auto}
.sf-pdf{display:flex;flex-direction:column;gap:8px}
.sf-pdf-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.sf-pdf-button{border:1px solid #d9d2bd;border-radius:3px;background:#fffdf6;color:inherit;font:inherit;font-size:12px;padding:5px 10px;cursor:pointer}
.sf-pdf-button:hover:not(:disabled){border-color:#26437c}
.sf-pdf-button:disabled{opacity:.5;cursor:default}
.sf-pdf-page{display:flex;justify-content:center;justify-content:safe center;max-height:72vh;overflow:auto;border:1px solid #e7e0cd;border-radius:3px;background:#f6f1e3;padding:10px}
.sf-pdf-page canvas{flex:none;background:#fff;box-shadow:0 1px 2px rgba(38,67,124,.12)}
.sf-docx-shell{display:flex;flex-direction:column;gap:8px}
.sf-docx-shell .sf-note{margin:0;font-size:12px}
.sf-docx-body{max-height:70vh;overflow:auto;border:1px solid #e7e0cd;border-radius:3px;background:#fffdf6;padding:12px}
.sf-docx-body section.sf-docx{background:transparent;box-shadow:none;margin:0 0 10px;padding:0;width:auto}
.sf-docx-body section.sf-docx > header,.sf-docx-body section.sf-docx > footer{border-bottom:1px dotted #e7e0cd;color:#8a887c;font-size:12px;margin-bottom:6px}
.sf-docx-body p{color:#26437c}
.sf-docx-body table{border-collapse:collapse;margin:6px 0}
.sf-docx-body td,.sf-docx-body th{border:1px solid #d9d2bd;padding:3px 6px;vertical-align:top}
@media(max-width:900px){
  .sf-materials-body{flex-direction:column}
  .sf-materials-column{width:auto;min-width:0;border-right:0;border-bottom:1px solid #e7e0cd;padding:16px 16px 28px}
  .sf-material-reader{padding:14px 16px 48px}
  .sf-material-html,.sf-material-pdf object,.sf-docx-body{max-height:none}
}
`;

/** The native document body that renders a DOCX tab's own bytes. */
function DocxPreviewBody({ content }: DocumentPreviewProps): React.JSX.Element {
  const data = content.kind === 'bytes' ? content.data : undefined;
  const [bytes, setBytes] = useState<Uint8Array | undefined>(undefined);
  useEffect(() => { setBytes(data === undefined ? undefined : data.slice()); }, [data]);
  if (bytes === undefined) return <p className="sf-note" role="status" style={{ padding: 16 }}>正在打开这份文档…</p>;
  // The tab carries a file address, not a material id, so this entry previews
  // the real bytes without the Host's block index; the materials page shows the
  // same document with its stable ids.
  return <DocxPreview data={bytes} index={undefined} />;
}

/** The page and composer styles are one sheet, installed once per client. */
function installStyles(ctx: Context): void {
  const style = document.createElement('style');
  style.dataset.studyforgeStyle = 'p4';
  style.textContent = css;
  ctx.effect(() => { document.head.append(style); return () => { style.remove(); }; });
}

/** Add the materials page and the DOCX document renderer. */
export function registerMaterials(ctx: Context, navigation: import('./material-navigation.ts').MaterialNavigation): void {
  installStyles(ctx);
  const references = new SourceReferences({ freeze: input => ctx.remote.studyforgeSources.freeze(input) });
  // The classroom reads an original inside its own pane now; it stages through
  // this same ledger, so a pick made there is the one the composer sends.
  holdSourceReferences(references);
  registerCardResource(ctx, references);
  registerSourceContext(ctx, references);

  // One business face per plugin apply: the page's effects depend on its identity.
  const face: MaterialsFace = {
    list: () => ctx.remote.studyforgeMaterials.list(),
    importMaterial: upload => ctx.remote.studyforgeMaterials.import(upload),
    createVersion: upload => ctx.remote.studyforgeMaterials.createVersion(upload),
    bytes: ref => ctx.remote.studyforgeMaterials.bytes(ref),
    docxIndex: ref => ctx.remote.studyforgeMaterials.docxIndex(ref),
    resolveForSession: input => ctx.remote.studyforgeMaterials.resolveForSession(input),
    skeleton: input => ctx.remote.studyforgeMaterials.skeleton(input),
    openInClassroom: async (address, params) => {
      const session = ctx.sessions.list.getSnapshot();
      const sessionId = session.current;
      if (sessionId && params?.studyforge && session.byId[sessionId]?.projectionValues?.agentPreset === 'studyforge-learning') {
        requestLessonPane(sessionId, { kind: 'source', title: params.studyforge.version.title, anchors: [params.studyforge.source] });
        ctx.layout.selectPanel(null);
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await new Promise(resolve => { setTimeout(resolve, 50); });
          if (ctx.sessions.list.getSnapshot().current !== sessionId) return;
          try { ctx.sidebarRight.openTab(LESSON_TAB_KIND); return; } catch { /* Native seat has not mounted yet. */ }
        }
        throw new Error('sidebar_right_unavailable');
      }
      // The right column's seat is drawn by the classroom, which owns the
      // mounted Session surface; coming back to it is what makes the address
      // land in a real tab. The seat mounts on the next frame, so a bounded
      // retry is the honest way to wait for it — no private state is read.
      ctx.layout.selectPanel(null);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise(resolve => { setTimeout(resolve, 50); });
        try { ctx.sidebarRight.openResource(address, { params }); return; } catch { /* seat not drawn yet */ }
      }
      throw new Error('sidebar_right_unavailable');
    },
  };
  // The lowest cell in this key wins, so the real page shadows this client's own
  // placeholder without deleting it: a client without the Host still shows the
  // placeholder instead of a page that cannot read anything.
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: MATERIALS_PAGE_ID, priority: -20, inject: () => ({ host: face, references, ctx, navigation }) }, MaterialsPage,
  )), 'studyforge: materials page');

  ctx.effect(() => ctx.documentPreviews.register({
    id: DOCX_PREVIEW_ID, extensions: ['docx', 'pdf', 'md', 'txt', 'png', 'jpg', 'jpeg', 'webp'], loading: 'bytes-complete', title: () => '资料阅读',
  }), 'studyforge: docx preview definition');
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
    { name: 'sidebar.right.tab.document', key: DOCX_PREVIEW_ID, inject: () => ({ ctx, references }) }, SourceDocument,
  )), 'studyforge: docx preview body');
}

/**
 * P4.3: the `@` source the composer freezes with, and the dock row that owns its
 * crops and shows what will be sent. Registered apart from the page so a
 * composition without a conversation surface still gets the materials page.
 */
export function registerSourceContext(ctx: Context, references: SourceReferences): void {
  registerSourceTrigger(ctx, references);
  registerSourceDisplay(ctx);
  registerAutomaticSource(ctx, references);
  ctx.effect(() => ctx.slots.register({
    name: 'conversation.composer.dock', id: '@studyforge/dsh-client/context', inject: () => ({ references }),
  }, ContextPreview), 'studyforge: composer context row');
}
