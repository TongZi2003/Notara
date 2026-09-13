import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-chat/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import { DebugRow } from './DebugRow.tsx';
import type { RawDebugInjected } from './RawSessionView.tsx';
import { RawSessionView } from './RawSessionView.tsx';
import { ContextNote, SystemPromptNote } from './ClassroomNotes.tsx';
import { debugEnabled, subscribeDebug } from './debug-mode.ts';
import { ReplyError } from './ReplyError.tsx';

/** This client's Raw Conversation view id. */
export const RAW_VIEW_ID = '@studyforge/dsh-client/raw';

const css = `
.sf-sysnote{width:100%;border-bottom:1px solid var(--dsw-alias-border-l2,#e7e0cd);padding:2px 0 6px}
.sf-sysnote-head{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#5a688a);font:inherit;font-size:13px;cursor:pointer;padding:4px 0;text-align:left}
.sf-sysnote .sf-note{margin:6px 0 0;line-height:1.8}
.sf-recall{width:100%;border-bottom:1px solid var(--dsw-alias-border-l2,#e7e0cd);padding:2px 0 6px;color:var(--dsw-alias-label-secondary,#5a688a);font-size:13px}
.sf-recall summary{cursor:pointer;padding:4px 0}
.sf-recall-body{margin:6px 0 0;line-height:1.8;color:var(--dsw-alias-label-primary,#26437c)}
.sf-debug-row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:10px 0}
.sf-debug-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.sf-debug-title{font-size:14px}
.sf-debug-note{font-size:12px;color:var(--dsw-alias-label-tertiary,#8a887c);line-height:1.6}
.sf-debug-switch{border:1px solid var(--dsw-alias-border-l2,#d9d2bd);border-radius:3px;background:transparent;color:inherit;font:inherit;font-size:13px;padding:5px 12px;cursor:pointer;flex:none}
.sf-debug-switch[aria-checked="true"]{border-color:#26437c;background:#26437c;color:#fdfaf1}
.sf-raw{box-sizing:border-box;height:100%;min-height:0;overflow:auto;padding:16px 14px 140px;background:#fdfaf1;color:#26437c;font-family:system-ui,sans-serif;font-size:13px}
.sf-raw h2{font-size:15px;margin:0 0 4px}
.sf-raw h3{font-size:12px;letter-spacing:.1em;color:#777d88;margin:0 0 8px}
.sf-raw .sf-note{color:#8a887c;margin:0 0 8px;line-height:1.7;font-size:12px}
.sf-raw-head{margin-bottom:10px}
.sf-raw-window{border:1px dashed #d9d2bd;border-radius:3px;padding:8px 10px;margin-bottom:10px;color:#5a688a;font-size:12px}
.sf-raw-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
.sf-raw-search{flex:1 1 160px;min-width:120px;border:1px solid #d9d2bd;border-radius:3px;background:#fffdf6;color:inherit;font:inherit;padding:6px 8px}
.sf-raw-button{border:1px solid #d9d2bd;border-radius:3px;background:#fffdf6;color:inherit;font:inherit;font-size:12px;padding:5px 10px;cursor:pointer}
.sf-raw-button:disabled{opacity:.5;cursor:default}
.sf-raw-list{list-style:none;margin:0;padding:0;border-top:1px solid #e7e0cd}
.sf-raw-entry{border-bottom:1px solid #f0e9d8}
.sf-raw-entry-head{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;color:inherit;font:inherit;text-align:left;padding:7px 2px;cursor:pointer}
.sf-raw-entry-head:hover{background:#f6f1e3}
.sf-raw-badge{font-size:10px;border:1px solid #d9d2bd;border-radius:2px;padding:1px 5px;color:#777d88;flex:none}
.sf-raw-kind{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sf-raw-body{padding:0 0 10px}
.sf-raw-json{margin:8px 0 0;padding:10px;background:#f6f1e3;border-radius:3px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:50vh;overflow:auto}
.sf-raw-domain{margin-top:22px;border-top:1px solid #d9d2bd;padding-top:12px}
`;

/** Register the debug preference row, the student system-note row, and the gated Raw view. */
export function registerDebugSurfaces(ctx: Context): void {
  // One stable read per plugin apply: the inspector's effect depends on this
  // identity, so re-binding the entry must not refetch on every render.
  const readCourse = (input: { sessionId: string }) => ctx.remote.studyforgeCourses.read(input);
  const style = document.createElement('style');
  style.dataset.studyforgeStyle = 'p27';
  style.textContent = css;
  document.head.append(style);
  ctx.effect(() => () => { style.remove(); });

  // Ordinary classroom reading must not print internal prompt text; the native
  // event and the debug views keep every byte.
  ctx.effect(() => ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'system-prompt', priority: -10 }, SystemPromptNote,
  )), 'studyforge: classroom system note');
  // Native Normal transcript mode would otherwise print the context producer's
  // plugin id; the durable row stays in Raw and Trajectory.
  ctx.effect(() => ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'context', priority: -10 }, ContextNote,
  )), 'studyforge: classroom context note');
  ctx.effect(() => ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'turn-error', priority: -10 }, ReplyError,
  )), 'studyforge: student reply error');

  ctx.effect(() => ctx.slots.inject('settings.general.item', () => ctx.slots.register(
    { name: 'settings.general.item', id: 'studyforge.debug', order: 40 }, DebugRow,
  )), 'studyforge: debug settings row');

  // Raw is registered here; the pinned native roster seam applies the same
  // preference to Trajectory. Neither debug view supplies learning facts.
  ctx.effect(() => {
    let dispose: (() => void) | undefined;
    const sync = (): void => {
      document.documentElement.dataset.studyforgeDebug = String(debugEnabled());
      window.dispatchEvent(new Event('studyforge:debug-views'));
      if (debugEnabled()) {
        dispose ??= ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view', id: RAW_VIEW_ID, order: 30, label: () => 'Raw',
          inject: (sessionId): RawDebugInjected => ({
            eventSource: ctx.sessions.binding(sessionId)?.eventSource,
            loadOlder: () => ctx.sessions.binding(sessionId)?.session.loadOlder() ?? Promise.resolve(),
            readCourse,
          }),
        }, RawSessionView));
      } else {
        dispose?.();
        dispose = undefined;
      }
    };
    const unsubscribe = subscribeDebug(sync);
    sync();
    return () => { unsubscribe(); dispose?.(); };
  }, 'studyforge: raw debug view');
}
