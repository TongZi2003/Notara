/**
 * The viewer's look for this browser: 极简 (default) or 手帐. It is a display
 * preference only — nothing about learning records, sessions or the Vault
 * depends on it — so it lives in localStorage and survives blocked storage as
 * an in-page choice.
 */
export const APPEARANCE_KEY = 'notara.vault.appearance';
export const STYLES = ['minimal', 'notebook'];

export function createAppearance(storage = globalThis.localStorage) {
  let stored = null;
  try { stored = storage?.getItem(APPEARANCE_KEY) ?? null; } catch { stored = null; }
  let value = { style: STYLES.includes(stored) ? stored : 'minimal' };
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setStyle(style) {
      if (!STYLES.includes(style) || style === value.style) return;
      value = { style };
      try { storage?.setItem(APPEARANCE_KEY, style); } catch { /* the choice still holds for this page */ }
      for (const fn of listeners) fn();
    },
  };
}
