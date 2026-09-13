import type { Context } from '@deepseek-ai/cordis';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
let selected: string | undefined;
const listeners = new Set<() => void>();
export const creationNavigation = {
  read: (): string | undefined => selected,
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
  select(ref?: string): void { selected = ref; for (const listener of listeners) listener(); },
};
export function openCreation(ctx: Context, ref?: string): void {
  creationNavigation.select(ref); ctx.layout.selectPanel('studyforge.creator' as MainPanelId);
}
