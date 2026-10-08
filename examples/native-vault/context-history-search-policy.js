// Retrieval policy is separate from the lossless canonical archive encoding.
// v3 keeps the v2 escape mask and adds numeric candidate anchors. The binding
// revision forces older derived postings to rebuild without changing SQLite.
export const NATIVE_HISTORY_SEARCH_POLICY = 'native-evidence-v3';
export const HISTORY_RETRIEVAL_TOOL_NAMES = Object.freeze(['history_search', 'history_read']);
export const HISTORY_SEARCH_IDENTITY_LIMITS = Object.freeze({ callId: 4096, name: 1024 });
export const isNativeHistorySearchPosition = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);

// Transport sentinels preserve the complete, same-length evidence projection.
// Callers validate the body and expanded projection at their trust boundary.
export const expandHistorySearchProjection = (body, search) => search === null ? body : search === '' ? ' '.repeat(body.length) : search;
export const compactHistorySearchChunk = ({ body, search }) => ({ body,
  search: search === body ? null : /^ *$/.test(search) ? '' : search });
