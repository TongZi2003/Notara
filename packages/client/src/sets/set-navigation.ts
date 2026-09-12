/** A learning-set navigation target; this never changes an open lesson's scope. */
let selected: string | undefined;
const listeners = new Set<() => void>();
export const setNavigation = {
  read: (): string | undefined => selected,
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
  show(ref?: string): void { selected = ref; for (const listener of listeners) listener(); },
};
