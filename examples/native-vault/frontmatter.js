function fail() { throw new Error('vault_frontmatter_invalid'); }

function parseScalar(raw) {
  const value = raw.trim();
  if (value === '') return '';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) {
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
    if (!/^[A-Za-z0-9_-]+$/.test(key) || Object.hasOwn(frontmatter, key)) fail();
    Object.defineProperty(frontmatter, key, { value: parseScalar(line.slice(separator + 1)), enumerable: true });
  }
  return {
    frontmatter, body: content.slice(match[0].length),
    range: { from: 0, to: match[0].replace(/\r?\n$/, '').length },
  };
}
