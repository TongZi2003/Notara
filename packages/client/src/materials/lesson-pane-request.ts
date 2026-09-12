/**
 * One classroom right column: the lesson's own material map, and the one place
 * inside it that a card or an original opens.
 *
 * The map pane is drawn from the lesson's own projection, so an open request has
 * to travel to *it* rather than to a native resource tab: a second tab beside
 * the map is the competing rail the layout retired. Whoever asks first brings
 * the lesson's tab forward; the pane picks the request up when it is drawn —
 * a request made before the tab mounts is held, not dropped.
 */
import type { MaterialContext } from '@studyforge/contracts/materials';

/** What the classroom asked the map's pane to show. */
export type LessonPaneRequest =
  | { readonly kind: 'source'; readonly title: string; readonly anchors: readonly MaterialContext[] }
  | { readonly kind: 'card' | 'knowledge'; readonly title: string; readonly target: string; readonly version?: number | undefined };

const pending = new Map<string, LessonPaneRequest>();
const listeners = new Map<string, (request: LessonPaneRequest) => void>();

/** Ask the lesson's own pane to open this; the caller brings its tab forward. */
export function requestLessonPane(sessionId: string, request: LessonPaneRequest): void {
  const listener = listeners.get(sessionId);
  if (listener !== undefined) { listener(request); pending.delete(sessionId); return; }
  pending.set(sessionId, request);
}

/** Take requests until unsubscribed; the mount picks up one already waiting. */
export function subscribeLessonPane(sessionId: string, handler: (request: LessonPaneRequest) => void): () => void {
  listeners.set(sessionId, handler);
  const first = pending.get(sessionId);
  if (first !== undefined) { pending.delete(sessionId); handler(first); }
  return () => { if (listeners.get(sessionId) === handler) listeners.delete(sessionId); };
}
