import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { FrozenSource, SourceContext } from '@studyforge/contracts/source-context';
import type { DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client';
export interface FreezeFace {
  freeze(input: { sessionId: string; context: SourceContext }): Promise<RemoteResult<FrozenSource>>;
}
export interface SourcePick { ref: string; sessionId: string; label: string; context: SourceContext }
/** Plugin-scoped references. New picks freeze anew; native retries retain their original ref. */
export class SourceReferences {
  private readonly picks = new Map<string, SourcePick>();
  private readonly frozen = new Map<string, Promise<FrozenSource>>();
  private readonly currentBySession = new Map<string, SourcePick>();
  private readonly listeners = new Set<() => void>();
  private readonly attachments = new Map<string, readonly DraftAttachmentId[]>();
  private readonly consumed = new Set<string>();
  private readonly suppressed = new Map<string, string>();
  private readonly tabs = new Map<string, Omit<SourcePick, 'ref'>>();
  private readonly automaticRefs = new Set<string>();
  private readonly face: FreezeFace;
  constructor(face: FreezeFace) { this.face = face; }
  stage(sessionId: string, label: string, context: SourceContext, notify = true): string {
    const pick = { ref: crypto.randomUUID(), sessionId, label, context };
    this.picks.set(pick.ref, pick);
    this.currentBySession.set(sessionId, pick);
    this.suppressed.delete(sessionId);
    if (notify) for (const listener of this.listeners) listener();
    return pick.ref;
  }
  current(sessionId: string): SourcePick | undefined { return this.currentBySession.get(sessionId); }
  clearSelection(sessionId: string, materialId: string, versionId: string): void {
    const selected = this.currentBySession.get(sessionId)?.context.selection;
    if (!selected?.sources.some(source => source.materialId === materialId && source.versionId === versionId)) return;
    this.currentBySession.delete(sessionId);
    for (const listener of this.listeners) listener();
  }
  browse(tabId: string, pick: Omit<SourcePick, 'ref'>): () => void {
    this.tabs.set(tabId, pick);
    for (const listener of this.listeners) listener();
    return () => { if (this.tabs.get(tabId) === pick) this.tabs.delete(tabId); };
  }
  active(sessionId: string, tabId?: string): Omit<SourcePick, 'ref'> | undefined {
    const picked = this.current(sessionId);
    // An explicit “bring into conversation” includes whole cards/originals as
    // well as selected passages. Generated browse references are not explicit.
    if (picked && (!this.automaticRefs.has(picked.ref) || picked.context.selection)) return picked;
    const tab = tabId ? this.tabs.get(tabId) : undefined;
    return tab?.sessionId === sessionId ? tab : undefined;
  }
  shouldAttach(pick: Omit<SourcePick, 'ref'>): boolean { return this.suppressed.get(pick.sessionId) !== JSON.stringify(pick.context); }
  nextSubmission(sessionId: string): void { this.suppressed.delete(sessionId); }
  automatic(ref: string): void { this.automaticRefs.add(ref); }
  isAutomatic(ref: string): boolean { return this.automaticRefs.has(ref); }
  matches(ref: string, context: SourceContext): boolean { return JSON.stringify(this.picks.get(ref)?.context) === JSON.stringify(context); }
  serialized(ref: string): void { this.consumed.add(ref); }
  restored(ref: string): void { this.consumed.delete(ref); }
  dismissed(ref: string): void {
    const pick = this.picks.get(ref);
    if (pick && !this.consumed.has(ref)) this.suppressed.set(pick.sessionId, JSON.stringify(pick.context));
  }
  labelOf(ref: string): string | undefined { return this.picks.get(ref)?.label; }
  attached(ref: string, ids: readonly DraftAttachmentId[]): void { this.attachments.set(ref, ids); }
  known(sessionId: string): { ref: string; ids: readonly DraftAttachmentId[] }[] {
    return [...this.attachments].filter(([ref]) => this.picks.get(ref)?.sessionId === sessionId).map(([ref, ids]) => ({ ref, ids }));
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  ensure(ref: string): Promise<FrozenSource> {
    const old = this.frozen.get(ref);
    if (old !== undefined) return old;
    const pick = this.picks.get(ref);
    if (pick === undefined) return Promise.reject(new Error('请重新选择要引用的资料。'));
    const work = this.face.freeze({ sessionId: pick.sessionId, context: pick.context }).then(result => {
      if (!result.ok) throw new Error('这处资料暂时读不出来，请重新选择。');
      return result.value;
    }).catch((error: unknown) => { this.frozen.delete(ref); throw error; });
    this.frozen.set(ref, work);
    return work;
  }
}
