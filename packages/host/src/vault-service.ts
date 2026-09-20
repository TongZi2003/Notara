import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { canonicalPath, under } from '@studyforge/domain/access';
import { buildBacklinks, parseMarkdownDocument, projectTree, queryDocuments, safeRelativePath, searchDocuments, summarizeDocument, revisionFor } from '@studyforge/domain/vault';
import { VaultListInputSchema, VaultQueryInputSchema, VaultReadInputSchema, VaultSaveInputSchema, VaultSearchInputSchema, type VaultDocument, type VaultLinks, type VaultListInput, type VaultQueryInput, type VaultReadInput, type VaultSaveInput, type VaultSearchInput, type VaultSearchResult, type VaultSummary, type VaultTreeNode } from '@studyforge/contracts/vault';

declare module '@deepseek-ai/cordis' { interface Context { studyforgeVault: StudyForgeVault } }

function fail(code: string): never { throw new Error(code); }

export class StudyForgeVault extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'studyforgeVault'); }

  private root(): string { return join(this.ctx.studyforgeAccess.root, 'vault'); }

  private relativePath(path: string): string {
    const value = safeRelativePath(path);
    if (!value.toLowerCase().endsWith('.md')) fail('VAULT_MARKDOWN_REQUIRED');
    return value;
  }

  private async target(path: string, create = false): Promise<string> {
    const root = this.root(), value = this.relativePath(path), absolute = resolve(root, value);
    if (!under(root, absolute)) fail('VAULT_PATH_INVALID');
    await mkdir(root, { recursive: true });
    const rootReal = canonicalPath(root, this.ctx.studyforgeAccess.root);
    const base = create ? dirname(absolute) : absolute;
    const baseReal = canonicalPath(base, root);
    if (!under(rootReal, baseReal)) fail('VAULT_PATH_INVALID');
    return absolute;
  }

  private async files(): Promise<string[]> {
    const root = this.root();
    await mkdir(root, { recursive: true });
    const rootReal = canonicalPath(root, this.ctx.studyforgeAccess.root), result: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && under(rootReal, canonicalPath(absolute, root))) result.push(relative(root, absolute).replaceAll('\\', '/'));
      }
    };
    await visit(root);
    return result.sort();
  }

  private async scan(): Promise<VaultDocument[]> {
    const documents: VaultDocument[] = [];
    for (const path of await this.files()) {
      try {
        const content = await readFile(await this.target(path), 'utf8');
        documents.push(parseMarkdownDocument(path, content, revisionFor(content)));
      } catch (error) {
        if (error instanceof Error && ('code' in error) && error.code === 'ENOENT') continue;
        if (error instanceof Error && error.message.startsWith('vault_')) throw error;
        fail('VAULT_FILE_INVALID');
      }
    }
    return documents;
  }

  @Remote('list')
  async list(input: VaultListInput): Promise<{ files: VaultSummary[]; tree: VaultTreeNode }> {
    const data = VaultListInputSchema.parse(input), prefix = data.prefix?.replaceAll('\\', '/');
    if (prefix) safeRelativePath(prefix);
    const files = (await this.scan()).filter(item => !prefix || item.path === prefix || item.path.startsWith(prefix + '/')).map(summarizeDocument);
    return { files, tree: projectTree(files) };
  }

  @Remote('read')
  async read(input: VaultReadInput): Promise<VaultDocument> {
    const data = VaultReadInputSchema.parse(input), path = this.relativePath(data.path);
    try {
      const content = await readFile(await this.target(path), 'utf8');
      return parseMarkdownDocument(path, content, revisionFor(content));
    } catch (error) {
      if (error instanceof Error && ('code' in error) && error.code === 'ENOENT') fail('VAULT_FILE_NOT_FOUND');
      if (error instanceof Error && error.message === 'vault_frontmatter_invalid') fail('VAULT_FRONTMATTER_INVALID');
      throw error;
    }
  }

  @Remote('save')
  async save(input: VaultSaveInput): Promise<VaultDocument> {
    const data = VaultSaveInputSchema.parse(input), path = this.relativePath(data.path), target = await this.target(path, true);
    let current = '';
    try { current = await readFile(target, 'utf8'); } catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
    if (revisionFor(current) !== data.expectedRevision && !(data.expectedRevision === 0 && current === '')) fail('VAULT_REVISION_CONFLICT');
    const parsed = parseMarkdownDocument(path, data.content, revisionFor(data.content));
    await mkdir(dirname(target), { recursive: true });
    const temporary = target + '.notara-tmp-' + process.pid + '-' + Date.now();
    await writeFile(temporary, data.content, 'utf8');
    await rename(temporary, target);
    return parsed;
  }

  @Remote('search')
  async search(input: VaultSearchInput): Promise<VaultSearchResult> {
    const data = VaultSearchInputSchema.parse(input);
    return searchDocuments(await this.scan(), data.query, data.limit);
  }

  @Remote('query')
  async query(input: VaultQueryInput): Promise<VaultSummary[]> {
    const data = VaultQueryInputSchema.parse(input);
    return queryDocuments(await this.scan(), data.where, data.limit);
  }

  @Remote('links')
  async links(input: VaultReadInput): Promise<VaultLinks> {
    const data = VaultReadInputSchema.parse(input), document = await this.read(data), backlinks = buildBacklinks(await this.scan());
    const key = document.path.replace(/\.md$/i, '');
    return { outgoing: document.links, incoming: backlinks.get(key) ?? [] };
  }
}
