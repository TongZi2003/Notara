import type { Context } from '@deepseek-ai/cordis';
import { SOURCE_TRIGGER_NAME, sourceMention } from './source-trigger.ts';
import type { SourceReferences } from './source-selection.ts';
import { mintAttachments } from './source-attachments.ts';

/** Focus prepares a visible native reference. The native Send remains the only sender. */
export function registerAutomaticSource(ctx: Context, references: SourceReferences): void {
  const preparing = new Set<string>();
  let disposed = false;
  const prepare = (): void => {
    const sessionId = ctx.sessions.list.getSnapshot().current;
    if (!sessionId || preparing.has(sessionId)) return;
    const actx = ctx.sessions.scope(sessionId);
    if (!actx) return;
    const input = ctx.conversation.input.for(actx);
    const state = input.state.getSnapshot();
    if (state.phase !== 'plain') return;
    const picked = references.active(sessionId, ctx.sidebarRight.active()?.id);
    if (!picked || !references.shouldAttach(picked)) return;
    const held = state.occurrences.filter(item => item.source === SOURCE_TRIGGER_NAME);
    if (held.some(item => references.matches(item.ref, picked.context))) return;
    const replace = held.find(item => references.isAutomatic(item.ref));
    if (held.length > 0 && !replace) return;
    const blocks = ctx.conversation.blocks;
    if (blocks.storeFor(sessionId).getSnapshot() !== undefined) return;
    const block = { reason: '正在准备本次引用…' };
    preparing.add(sessionId);
    blocks.set(sessionId, block);
    const ref = references.stage(sessionId, picked.label, picked.context, false);
    references.automatic(ref);
    void references.ensure(ref).then(frozen => {
      if (disposed || ctx.sessions.list.getSnapshot().current !== sessionId) return;
      const now = input.state.getSnapshot();
      if (now.draft !== state.draft || now.phase !== 'plain') return;
      const ids = mintAttachments(ctx, sessionId, frozen.images);
      if (!input.addAttachments(ids)) return;
      // InputState occurrences use clipboard coordinates; TokenSpan uses one
      // atomic character per native chip. Fold preceding expansions only.
      const start = replace ? replace.offset - now.occurrences.filter(item => item.offset < replace.offset).reduce((sum, item) => sum + item.length - 1, 0) : 0;
      const inserted = input.insertReference({
        source: SOURCE_TRIGGER_NAME, ref, label: picked.label, appearance: 'file', clipboardText: sourceMention(picked.label, ref),
      }, { start, end: replace ? start + 1 : start, draftRev: input.state.getSnapshot().draftRev });
      if (inserted) {
        references.attached(ref, ids);
        if (replace) for (const old of references.known(sessionId).filter(item => item.ref === replace.ref)) for (const id of old.ids) input.removeAttachment(id);
      }
      else for (const id of ids) input.removeAttachment(id);
    }).catch(() => { references.dismissed(ref); input.notify('error', '资料暂时读不出来，可以先继续讨论，或稍后重新选择。'); })
      .finally(() => {
        preparing.delete(sessionId);
        if (blocks.storeFor(sessionId).getSnapshot()?.reason === block.reason) blocks.set(sessionId, undefined);
        const latest = references.active(sessionId, ctx.sidebarRight.active()?.id);
        if (!disposed && latest && JSON.stringify(latest.context) !== JSON.stringify(picked.context)) prepare();
      });
  };
  const onFocus = (event: Event): void => {
    if (event.target instanceof HTMLElement && event.target.closest('[data-composer-input]')) prepare();
  };
  const onInput = (event: Event): void => {
    if (event.target instanceof HTMLElement && event.target.closest('[data-composer-input]')) queueMicrotask(prepare);
  };
  ctx.effect(() => {
    document.addEventListener('focusin', onFocus);
    document.addEventListener('pointerdown', onFocus);
    document.addEventListener('input', onInput);
    const unsubscribe = references.subscribe(prepare);
    return () => { disposed = true; unsubscribe(); document.removeEventListener('focusin', onFocus); document.removeEventListener('pointerdown', onFocus); document.removeEventListener('input', onInput); };
  });
}
