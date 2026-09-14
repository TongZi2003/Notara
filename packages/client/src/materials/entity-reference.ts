import type { Context } from '@deepseek-ai/cordis';
import { parseEntityHref, LibraryEntityReferenceSchema, type LibraryEntityReference } from '@studyforge/contracts/entity-reference';
import { requestLessonPane } from './lesson-pane-request.ts';
import './entity-reference.css';

const attempts = new Map<string, number>();
function notice(message: string): void { window.dispatchEvent(new CustomEvent('studyforge:reference-notice', { detail: message })); }
export async function openEntityReference(ctx: Context, sessionId: string, reference: LibraryEntityReference): Promise<void> {
  const attempt = (attempts.get(sessionId) ?? 0) + 1; attempts.set(sessionId, attempt); notice('');
  try {
    const reply = await ctx.remote.studyforgeLibrary.resolveReference({ sessionId, reference: LibraryEntityReferenceSchema.parse(reference) });
    if (attempts.get(sessionId) !== attempt || String(ctx.sessions.list.getSnapshot().current ?? '') !== sessionId) return;
    if (!reply.ok) { notice('这处引用暂时无法打开，资料可能已移除。'); return; }
    const entity = reply.value, target = entity.reference;
    requestLessonPane(sessionId, target.kind === 'source' || target.kind === 'section'
      ? { kind: 'source', title: entity.title, anchors: entity.sources, entity }
      : { kind: target.kind, target: target.ref, version: target.version, title: entity.title, entity });
  } catch { if (attempts.get(sessionId) === attempt && String(ctx.sessions.list.getSnapshot().current ?? '') === sessionId) notice('这处引用暂时无法打开，请稍后重试。'); }
}

/** Native anchors retain their authored labels and copy behavior; a single
 * application-level handler resolves them against the currently viewed lesson. */
export function registerEntityReferences(ctx: Context): void {
  const click = (event: MouseEvent): void => {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-studyforge-reference]') : null;
    if (!anchor) return;
    event.preventDefault();
    const reference = parseEntityHref(anchor.getAttribute('href') ?? ''), sessionId = ctx.sessions.list.getSnapshot().current;
    if (!reference) { notice('这处引用不完整，暂时无法定位。'); return; }
    if (!sessionId) { notice('请先打开一节课堂，再查看这处引用。'); return; }
    void openEntityReference(ctx, String(sessionId), reference);
  };
  document.addEventListener('click', click);
  ctx.effect(() => () => document.removeEventListener('click', click));
}
