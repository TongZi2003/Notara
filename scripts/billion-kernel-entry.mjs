// Native Notara owns network requests, auth, durable history and scheduling.
// Export the pure reviewed core only; never load Billion's proxy/plugin launcher.
export { createCore } from '../vendor/billion-context/kernel/src/compress.ts';
export { createInitialState } from '../vendor/billion-context/kernel/src/state.ts';
export { defaultConfig } from '../vendor/billion-context/kernel/src/config.ts';
export { assignRefs } from '../vendor/billion-context/kernel/src/refs.ts';
export { resolveBoundaries } from '../vendor/billion-context/kernel/src/boundaries.ts';
export { searchBlocks, docFeatures, setDocCacheCap, clearDocFeatures, docCacheInfo } from '../vendor/billion-context/kernel/src/search.ts';
