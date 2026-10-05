/**
 * The large modules the client loads only when a feature first needs them,
 * served by the Host lazy route (`font-route.js / createLazyHandler`). This is
 * the one allowlist both sides read: the build copies exactly these files into
 * `lazy/`, the route serves exactly these, the client imports them by name.
 */
import {EXCALIDRAW_ASSETS} from './excalidraw-assets.js';
export const LAZY_PATH = '/notara/vault/lazy';
export const LAZY_FILES = Object.freeze({
  'pdf.min.mjs': 'text/javascript',
  'pdf.worker.min.mjs': 'text/javascript',
  // Board figures (`figure` components): JSXGraph, built to one ES module.
  'jsxgraph.mjs': 'text/javascript',
  'board-editors.mjs': 'text/javascript',
  'free-drawing-editor.mjs': 'text/javascript',
  ...EXCALIDRAW_ASSETS,
});
export function lazyUrl(name) {
  if (!Object.hasOwn(LAZY_FILES, name)) throw new Error('lazy_module_unknown');
  return `${LAZY_PATH}/${name}`;
}
const loading = new Map();
/** One import per module per page; a failed load may be retried later. */
export function loadLazyModule(name, prepare = module => module) {
  let pending = loading.get(name);
  if (!pending) {
    const url = lazyUrl(name);
    pending = import(/* webpackIgnore: true */ url).then(prepare);
    pending.catch(() => loading.delete(name));
    loading.set(name, pending);
  }
  return pending;
}
