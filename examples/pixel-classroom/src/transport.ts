import type { ClientMessage, ServerMessage } from '../upstream/core/src/messages';
import type { MessageTransport } from '../upstream/core/src/transport';

const listeners = new Set<(message: ServerMessage) => void>();
/** Local presentation adapter; no terminal discovery, transcript reads, hooks,
 * or inference requests. Layout and seat state belong to this browser origin. */
export const transport: MessageTransport = {
  state: 'connected', ready: Promise.resolve(),
  send(message: ClientMessage) {
    if (message.type === 'saveLayout') {
      try { localStorage.setItem('notara.pixel-classroom.layout.v1', JSON.stringify(message.layout)); }
      catch { window.dispatchEvent(new CustomEvent('pixel-classroom:storage-error')); }
    } else if (message.type === 'saveAgentSeats') {
      try { localStorage.setItem('notara.pixel-classroom.seats.v1', JSON.stringify(message.seats)); }
      catch { window.dispatchEvent(new CustomEvent('pixel-classroom:storage-error')); }
    } else if (message.type === 'focusAgent') {
      window.dispatchEvent(new CustomEvent('pixel-classroom:focus', { detail: { id: message.id } }));
    }
  },
  onMessage(handler) { listeners.add(handler); return () => listeners.delete(handler); },
  onStateChange(handler) { handler('connected'); return () => {}; },
  dispose() { listeners.clear(); },
};
