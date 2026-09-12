import { MaterialContextSchema, type MaterialContext } from '@studyforge/contracts/materials';
/** Navigation belongs to this plugin mount, never to a lesson or a saved fact. */
export class MaterialNavigation {
  private value: MaterialContext | undefined;
  private origin: string | undefined;
  originSession = (): string | undefined => this.origin;
  private readonly listeners = new Set<() => void>();
  read = (): MaterialContext | undefined => this.value;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  show(source: MaterialContext, originSessionId?: string): void {
    // SourceAnchor callers may also carry a quotation; history navigation owns
    // coordinates only, so a strict MaterialContext restore never rejects it.
    this.value = { materialId: source.materialId, versionId: source.versionId,
      ...(source.locator ? { locator: source.locator } : {}) }; this.origin = originSessionId;
    for (const listener of this.listeners) listener();
  }
  snapshot(): { source: MaterialContext; origin?: string } | undefined {
    return this.value ? { source: this.value, ...(this.origin ? { origin: this.origin } : {}) } : undefined;
  }
  /** A browser entry holds only a navigation reference; the Host resolves it again. */
  restore(raw: unknown): void {
    const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const parsed = MaterialContextSchema.safeParse(record.source);
    this.value = parsed.success ? parsed.data : undefined;
    this.origin = parsed.success && typeof record.origin === 'string' ? record.origin : undefined;
    for (const listener of this.listeners) listener();
  }
}
