import assert from 'node:assert/strict';
import test from 'node:test';
import { maskHistoryStringEscapes, createHistoryLiteralMatcher,
  HISTORY_LITERAL_MAX_QUERY_CHARS, HISTORY_LITERAL_MAX_ENCODED_QUERY_CHARS } from './context-history-evidence.js';

const encoded = text => JSON.stringify(text).slice(1, -1);
const evidence = text => maskHistoryStringEscapes(encoded(text));
const assertMask = raw => {
  const masked = maskHistoryStringEscapes(raw);
  assert.equal(masked.length, raw.length);
  for (let index = 0; index < raw.length; index++) assert.ok(masked[index] === raw[index] || masked[index] === ' ');
  assert.ok(masked.isWellFormed());
  return masked;
};

test('JSON control escapes are spaces while escaped punctuation retains its second character', () => {
  const raw = String.raw`before\n\r\t\b\f\u0000\u2028\uD800after\\\"\/`;
  assert.equal(assertMask(raw), 'before' + ' '.repeat(28) + 'after' + ' \\' + ' "' + ' /');
  const source = '中😀\n"quote" C:\\原文\\notes\t\u0000\ud800';
  assertMask(encoded(source));
  assert.equal(maskHistoryStringEscapes(''), '');
  for (const malformed of ['\\', String.raw`\x`, String.raw`\u00`]) assert.throws(() => maskHistoryStringEscapes(malformed), TypeError);
});

test('newline preserves the next word without indexing the escape n as evidence', () => {
  const raw = encoded('before\nmarker');
  const projected = assertMask(raw);
  assert.ok(projected.endsWith('  marker'));
  assert.equal(createHistoryLiteralMatcher('nmarker')(projected, raw), null);
  assert.deepEqual(createHistoryLiteralMatcher('marker')(projected, raw), { 0: 'marker', index: raw.indexOf('marker') });
  assert.deepEqual(createHistoryLiteralMatcher('\nmarker')(projected, raw), { 0: String.raw`\nmarker`, index: raw.indexOf('\\n') });
});

test('LaTex, quoted strings and Windows paths return the complete raw encoded range', () => {
  for (const query of [String.raw`\frac{中😀}{x}`, '"quoted"', String.raw`C:\Users\Student\notes.md`, 'slash/segment']) {
    const raw = encoded('prefix ' + query + ' suffix');
    const match = createHistoryLiteralMatcher(query)(assertMask(raw), raw);
    assert.deepEqual(match, { 0: encoded(query), index: encoded('prefix ').length });
  }
  // JSON accepts an optional escaped slash even though stringify does not emit it.
  assert.equal(maskHistoryStringEscapes(String.raw`a\/b`), 'a /b');
});

test('Unicode literal matching ignores case and does not decode or relocate evidence', () => {
  const raw = encoded('noise 🙂 ÜBER原文😀 quote: "K"');
  assert.deepEqual(createHistoryLiteralMatcher('über原文😀')(evidence('noise 🙂 ÜBER原文😀 quote: "K"'), raw),
    { 0: 'ÜBER原文😀', index: raw.indexOf('ÜBER') });
  assert.equal(createHistoryLiteralMatcher('absent')(assertMask(raw), raw), null);
});

test('masked metadata and plain spaces cannot stand in for a newline literal', () => {
  const raw = 'head __metadata_hidden__ tail';
  const projected = 'head ' + ' '.repeat('__metadata_hidden__'.length) + ' tail';
  assert.equal(createHistoryLiteralMatcher('\n')(projected, raw), null);
  assert.equal(createHistoryLiteralMatcher('  ')(projected, raw), null);
  assert.equal(createHistoryLiteralMatcher('head \n tail')(projected, raw), null);
});

test('a false first masked candidate does not hide a later or overlapping original newline', () => {
  const raw = encoded('  marker and then\nmarker');
  const projected = assertMask(raw);
  assert.deepEqual(createHistoryLiteralMatcher('\nmarker')(projected, raw),
    { 0: String.raw`\nmarker`, index: raw.indexOf('\\n') });
  const overlapRaw = encoded(' \n\n');
  assert.equal(assertMask(overlapRaw), '     ');
  assert.deepEqual(createHistoryLiteralMatcher('\n\n')(assertMask(overlapRaw), overlapRaw), { 0: String.raw`\n\n`, index: 1 });
  const unicodeRaw = encoded('😀  marker 😀\nmarker');
  assert.deepEqual(createHistoryLiteralMatcher('😀\nmarker')(assertMask(unicodeRaw), unicodeRaw),
    { 0: encoded('😀\nmarker'), index: unicodeRaw.lastIndexOf('😀') });
});

test('the maximum 512-control query matches across a part cut with 3072-character overlap', () => {
  assert.equal(HISTORY_LITERAL_MAX_QUERY_CHARS, 512);
  assert.equal(HISTORY_LITERAL_MAX_ENCODED_QUERY_CHARS, 3072);
  const query = '\u0001'.repeat(512), encodedQuery = encoded(query);
  assert.equal(encodedQuery.length, HISTORY_LITERAL_MAX_ENCODED_QUERY_CHARS);
  const start = 8192 - 1536;
  const raw = encoded('x'.repeat(start) + query + 'tail');
  const projected = assertMask(raw);
  const matcher = createHistoryLiteralMatcher(query);
  for (const [from, to] of [[0, 8192 + 3072], [8192 - 3072, raw.length]]) {
    const hit = matcher(projected.slice(from, to), raw.slice(from, to));
    assert.deepEqual(hit, { 0: encodedQuery, index: start - from });
  }
  assert.equal(matcher(projected.slice(0, 8192), raw.slice(0, 8192)), null);
  assert.throws(() => createHistoryLiteralMatcher(query + '\u0001'), TypeError);
});

test('10k backslashes retain parity and bounded query matches the full encoded source span', () => {
  const raw = encoded('\\'.repeat(10000) + ' marker');
  const projected = assertMask(raw);
  assert.equal(projected.slice(0, 20000), ' \\'.repeat(10000));
  const query = '\\'.repeat(512);
  assert.deepEqual(createHistoryLiteralMatcher(query)(projected, raw), { 0: encoded(query), index: 0 });
  const quoteQuery = '\\'.repeat(511) + '"';
  const quoteRaw = encoded('\\'.repeat(10000) + '"');
  assert.deepEqual(createHistoryLiteralMatcher(quoteQuery)(assertMask(quoteRaw), quoteRaw),
    { 0: encoded(quoteQuery), index: (10000 - 511) * 2 });
});

test('window positions are checked before matching and matcher instances are reusable', () => {
  const matcher = createHistoryLiteralMatcher('marker');
  assert.throws(() => matcher('marker', 'short'), RangeError);
  assert.throws(() => matcher(null, 'marker'), TypeError);
  assert.throws(() => createHistoryLiteralMatcher(''), TypeError);
  assert.throws(() => createHistoryLiteralMatcher(null), TypeError);
  assert.deepEqual(matcher('MARKER', 'MARKER'), { 0: 'MARKER', index: 0 });
  assert.equal(matcher('absent', 'absent'), null);
  assert.deepEqual(matcher('marker', 'marker'), { 0: 'marker', index: 0 });
});
