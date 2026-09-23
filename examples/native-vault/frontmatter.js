function fail() { throw new Error('vault_frontmatter_invalid'); }

const KEY = /^[A-Za-z0-9_-]+$/;
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const KEYWORD = /^(?:true|false|null|~)$/;
// A plain scalar must survive the reader byte for byte: no surrounding space,
// no quoting, no flow delimiter that would re-parse as a list or an object.
const PLAIN_SAFE = /^[^\s"'[\]{}#&*!|>%@`,][^\s"'[\]{}#&*!|>%@`,\n\r]*$/;

/** Single-line JSON, the only structured form besides the legacy `[a, b]`
 * string list. A value that opens and closes like JSON but does not parse is a
 * real error: it is never silently kept as text. */
function parseJson(raw, open, close) {
  if (!raw.startsWith(open) || !raw.endsWith(close) || raw.length < 2) return undefined;
  try {
    const value = JSON.parse(raw);
    return value === undefined ? undefined : value;
  } catch { return undefined; }
}

function parseDoubleQuoted(raw) {
  try {
    const value = JSON.parse(raw);
    if (typeof value === 'string') return value;
  } catch { /* legacy unquote below keeps historical behaviour */ }
  return raw.slice(1, -1);
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === '') return '';
  if (value.startsWith('"') && value.endsWith('"')) return parseDoubleQuoted(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (NUMBER.test(value)) return Number(value);
  if (value.startsWith('{') && value.endsWith('}')) {
    const object = parseJson(value, '{', '}');
    if (object === null || typeof object !== 'object' || Array.isArray(object)) fail();
    return object;
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const list = parseJson(value, '[', ']');
    if (list !== undefined) {
      if (!Array.isArray(list)) fail();
      return list;
    }
    return value.slice(1, -1).split(',').map(item => item.trim()).filter(Boolean).map(parseScalar).map(item => {
      if (typeof item !== 'string') fail();
      return item;
    });
  }
  return value;
}

/** The Vault's flat YAML subset, shared by file indexing and Live Preview. */
export function parseFrontmatter(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return { frontmatter: {}, body: content, range: null };
  const match = content.match(/^---\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m);
  if (!match) fail();
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator <= 0) fail();
    const key = line.slice(0, separator).trim();
    if (!KEY.test(key) || Object.hasOwn(frontmatter, key)) fail();
    Object.defineProperty(frontmatter, key, { value: parseScalar(line.slice(separator + 1)), enumerable: true });
  }
  return {
    frontmatter, body: content.slice(match[0].length),
    range: { from: 0, to: match[0].replace(/\r?\n$/, '').length },
  };
}

function plainSafe(value) {
  return value.length > 0 && PLAIN_SAFE.test(value) && !KEYWORD.test(value) && !NUMBER.test(value);
}

function scalarText(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    // Anything the reader would not read back as the same number must fail
    // here instead of silently turning into text.
    if (!Number.isFinite(value) || !NUMBER.test(String(value))) fail();
    return String(value);
  }
  if (typeof value === 'string') return plainSafe(value) ? value : JSON.stringify(value);
  return fail();
}

function valueText(value) {
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    // The historical `[a, b]` string list stays readable; anything else (objects,
    // numbers, strings with commas or quotes) is written as single-line JSON.
    if (value.every(item => typeof item === 'string' && plainSafe(item) && !item.includes(','))) return `[${value.join(', ')}]`;
    const json = JSON.stringify(value);
    if (json === undefined) fail();
    return json;
  }
  if (typeof value === 'object' && value !== null) {
    const json = JSON.stringify(value);
    if (json === undefined) fail();
    return json;
  }
  return scalarText(value);
}

/** Write the same flat subset `parseFrontmatter` reads, so a written page is
 * never a shape the reader cannot open: plain scalars stay plain, structured
 * values become single-line JSON, and nothing is folded across lines. */
export function serializeFrontmatter(frontmatter) {
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) fail();
  const lines = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!KEY.test(key) || value === undefined) fail();
    const text = valueText(value);
    if (/[\r\n]/.test(text)) fail();
    lines.push(`${key}: ${text}`);
  }
  return `---\n${lines.join('\n')}${lines.length ? '\n' : ''}---\n`;
}
