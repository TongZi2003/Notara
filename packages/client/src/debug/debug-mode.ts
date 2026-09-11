import { useSyncExternalStore } from 'react';

/**
 * The student client's debug switch. Off on every fresh browser: raw session
 * records and course metadata are a development surface, never the default
 * classroom. The value lives in this browser tab's memory, so a reload returns
 * to the student view.
 */
let enabled = false;
const listeners = new Set<() => void>();

function getSnapshot(): boolean {
  return enabled;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Read the switch value without React (registration-time decisions). */
export function debugEnabled(): boolean {
  return enabled;
}

/** Flip the switch and notify every surface that opted in. */
export function setDebugEnabled(next: boolean): void {
  if (next === enabled) return;
  enabled = next;
  for (const listener of [...listeners]) listener();
}

/** Subscribe outside React, e.g. to add or drop the Raw Conversation view. */
export function subscribeDebug(listener: () => void): () => void {
  return subscribe(listener);
}

/** React binding for the switch. */
export function useDebugEnabled(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
