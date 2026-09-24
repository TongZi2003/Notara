import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import type { VaultDocument, VaultFrontmatterValue, VaultSearchHit, VaultSearchResult, VaultSummary, VaultTreeNode } from '@studyforge/contracts/vault';

export function safeRelativePath(value: string): string {
  const path = value.trim();
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.split('/').some(part => part === '' || part === '.' || part === '..')) throw new Error('vault_path_invalid');
  return path;
}

function normalizeLinkTarget(value: string): string {
  const target = value.trim().split('#', 1)[0]!.replace(/^\.\//, '').replace(/\.md$/i, '');
  return target.replaceAll('\\', '/').replace(/^\/+/, '');
}

function scalar(value: unknown): VaultFrontmatterValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : JSON.stringify(item));
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function frontmatter(content: string): { values: Record<string, VaultFrontmatterValue>; body: string } {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return { values: {}, body: content };
  const match = /^(?:---\r?\n)([\s\S]*?)(?:\r?\n---\r?\n?)([\s\S]*)$/.exec(content);
  if (!match) throw new Error('vault_frontmatter_invalid');
  const parsed = parseYaml(match[1] ?? '');
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('vault_frontmatter_invalid');
  return { values: Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, scalar(value)])), body: match[2] ?? '' };
}

export function revisionFor(content: string): number {
  const hash = createHash('sha256').update(content).digest('hex');
  const value = Number(BigInt('0x' + hash.slice(0, 12)) % 9_000_000_000_000_000n);
  return value || 1;
}

export function parseMarkdownDocument(path: string, content: string, revision = revisionFor(content)): VaultDocument {
  const safePath = safeRelativePath(path), parsed = frontmatter(content), lines = parsed.body.split(/\r?\n/);
  const headings = lines.flatMap(line => /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1] ? [(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)![1] ?? '').trim()] : []);
  const tagMatches = [...content.matchAll(/(^|\s)#([\p{L}\p{N}_/-]+)/gu)].map(match => match[2]!).filter(Boolean);
  const frontTags = Array.isArray(parsed.values.tags) ? parsed.values.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  const tags = [...new Set([...frontTags, ...tagMatches])];
  const links = [...new Set([...content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map(match => normalizeLinkTarget(match[1]!)).filter(Boolean))];
  const tasks = lines.flatMap(line => { const match = /^\s*(?:[-*+]\s+)?\[([ xX])\]\s+(.+)$/.exec(line); return match ? [{ checked: match[1]!.toLowerCase() === 'x', text: match[2]!.trim() }] : []; });
  const title = headings[0] ?? safePath.split('/').at(-1)!.replace(/\.md$/i, '');
  return { path: safePath, revision, content, title, frontmatter: parsed.values, headings, tags, links, tasks };
}

export function summarizeDocument(document: VaultDocument): VaultSummary {
  const { content, ...summary } = document;
  return { ...summary, size: content.length };
}

export function buildBacklinks(documents: readonly VaultDocument[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const document of documents) for (const target of document.links) result.set(target, [...(result.get(target) ?? []), document.path]);
  for (const [key, paths] of result) result.set(key, [...new Set(paths)].sort());
  return result;
}

export function searchDocuments(documents: readonly VaultDocument[], query: string, limit = 30): VaultSearchResult {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return { query, hits: [] };
  const hits: VaultSearchHit[] = [];
  for (const document of documents) {
    const haystack = `${document.path}\n${document.title}\n${JSON.stringify(document.frontmatter)}\n${document.content}`.toLocaleLowerCase();
    const index = haystack.indexOf(needle); if (index < 0) continue;
    const score = (haystack.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
    hits.push({ path: document.path, title: document.title, revision: document.revision, score, excerpt: document.content.slice(Math.max(0, index - 40), index + needle.length + 120).replaceAll('\n', ' ') });
  }
  return { query, hits: hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit) };
}

export function queryDocuments(documents: readonly VaultDocument[], where: Record<string, unknown>, limit = 100): VaultSummary[] {
  return documents.filter(document => Object.entries(where).every(([key, expected]) => {
    const actual = document.frontmatter[key];
    return Array.isArray(actual) ? typeof expected === 'string' && actual.includes(expected) : actual === expected;
  })).slice(0, limit).map(summarizeDocument);
}

export function projectTree(summaries: readonly VaultSummary[]): VaultTreeNode {
  const root: VaultTreeNode = { name: '', children: [] };
  for (const summary of [...summaries].sort((a, b) => a.path.localeCompare(b.path))) {
    let node = root;
    const parts = summary.path.split('/');
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index]!;
      let child = node.children.find(item => item.name === name);
      if (!child) { child = { name, children: [] }; node.children.push(child); }
      node = child;
      if (index === parts.length - 1) node.path = summary.path;
    }
  }
  return root;
}
