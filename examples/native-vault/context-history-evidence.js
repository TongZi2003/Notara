// Pure helpers for locating original evidence in an encoded JSON string value.
export const HISTORY_LITERAL_MAX_QUERY_CHARS = 512;
export const HISTORY_LITERAL_MAX_ENCODED_QUERY_CHARS = 6 * HISTORY_LITERAL_MAX_QUERY_CHARS;
const escapedLiteral = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Preserve encoded UTF16 positions; do not decode the source string. */
export function maskHistoryStringEscapes(encoded) {
  if (typeof encoded !== 'string') throw new TypeError('history evidence requires an encoded string');
  const pieces = [];
  let start = 0;
  for (let index = 0; index < encoded.length; index++) {
    if (encoded[index] !== '\\') continue;
    pieces.push(encoded.slice(start, index));
    const next = encoded[index + 1];
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(encoded.slice(index + 2, index + 6))) {
      pieces.push('      '); index += 5;
    } else if (next && 'nrtbf'.includes(next)) {
      pieces.push('  '); index++;
    } else if (next === '\\' || next === '"' || next === '/') {
      pieces.push(' ', next); index++;
    } else {
      throw new TypeError('history evidence requires complete JSON string escapes');
    }
    start = index + 1;
  }
  pieces.push(encoded.slice(start));
  return pieces.join('');
}

const afterCodePoint = (text, index) => {
  const first = text.charCodeAt(index), second = text.charCodeAt(index + 1);
  return index + (first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff ? 2 : 1);
};

/** Find a literal in projected evidence, verifying the exact encoded raw span. */
export function createHistoryLiteralMatcher(query) {
  if (typeof query !== 'string' || !query.length || query.length > HISTORY_LITERAL_MAX_QUERY_CHARS) {
    throw new TypeError('history literal query must contain 1 to 512 UTF16 characters');
  }
  const encoded = JSON.stringify(query).slice(1, -1);
  if (encoded.length > HISTORY_LITERAL_MAX_ENCODED_QUERY_CHARS) throw new RangeError('history encoded literal query exceeds its budget');
  const projected = new RegExp(escapedLiteral(maskHistoryStringEscapes(encoded)), 'giu');
  const original = new RegExp(`^(?:${escapedLiteral(encoded)})$`, 'iu');
  return (projectedWindow, rawWindow) => {
    if (typeof projectedWindow !== 'string' || typeof rawWindow !== 'string') throw new TypeError('history literal windows must be strings');
    if (projectedWindow.length !== rawWindow.length) throw new RangeError('history literal windows must share UTF16 positions');
    projected.lastIndex = 0;
    for (;;) {
      const match = projected.exec(projectedWindow);
      if (!match) return null;
      const raw = rawWindow.slice(match.index, match.index + match[0].length);
      if (original.test(raw)) return { 0: raw, index: match.index };
      // A false masked candidate may overlap the true source. Advance one
      // complete code point rather than jumping past the candidate's end.
      projected.lastIndex = afterCodePoint(projectedWindow, match.index);
    }
  };
}
