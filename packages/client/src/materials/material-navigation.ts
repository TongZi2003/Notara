import type { MaterialContext } from '@studyforge/contracts/materials';
/** Navigation belongs to this plugin mount, never to a lesson or a saved fact. */
export class MaterialNavigation {
  private value: MaterialContext | undefined;
  private readonly listeners = new Set<() => void>();
  read = (): MaterialContext | undefined => this.value;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  show(source: MaterialContext): void { this.value = source; for (const listener of this.listeners) listener(); }
}
