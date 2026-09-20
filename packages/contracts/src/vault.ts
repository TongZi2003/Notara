import { z } from 'zod';

/** Vault paths are workspace-relative and are always Markdown files at the Host boundary. */
export const VaultPathSchema = z.string().trim().min(1).max(500)
  .refine(value => !value.startsWith('/') && !value.includes('\\') && !value.includes('\0'), 'vault path must be relative')
  .refine(value => !value.split('/').some(part => part === '..' || part === '.'), 'vault path traversal is not allowed');
export const VaultListInputSchema = z.object({ prefix: z.string().trim().max(300).optional() }).strict();
export const VaultReadInputSchema = z.object({ path: VaultPathSchema }).strict();
export const VaultSaveInputSchema = z.object({ path: VaultPathSchema, content: z.string().max(1_000_000), expectedRevision: z.number().int().nonnegative() }).strict();
export const VaultSearchInputSchema = z.object({ query: z.string().trim().max(200), limit: z.number().int().positive().max(100).default(30) }).strict();
export const VaultQueryValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const VaultQueryInputSchema = z.object({ where: z.record(z.string(), VaultQueryValueSchema).default({}), limit: z.number().int().positive().max(100).default(100) }).strict();

export type VaultListInput = z.infer<typeof VaultListInputSchema>;
export type VaultReadInput = z.infer<typeof VaultReadInputSchema>;
export type VaultSaveInput = z.infer<typeof VaultSaveInputSchema>;
export type VaultSearchInput = z.infer<typeof VaultSearchInputSchema>;
export type VaultQueryInput = z.infer<typeof VaultQueryInputSchema>;

export interface VaultTask { checked: boolean; text: string }
export type VaultFrontmatterValue = string | number | boolean | null | string[];
export interface VaultDocument {
  path: string;
  revision: number;
  content: string;
  title: string;
  frontmatter: Record<string, VaultFrontmatterValue>;
  headings: string[];
  tags: string[];
  links: string[];
  tasks: VaultTask[];
}
export type VaultSummary = Omit<VaultDocument, 'content'> & { size: number };
export interface VaultSearchHit { path: string; title: string; revision: number; score: number; excerpt: string }
export interface VaultSearchResult { query: string; hits: VaultSearchHit[] }
export interface VaultTreeNode { name: string; path?: string; children: VaultTreeNode[] }
export interface VaultLinks { outgoing: string[]; incoming: string[] }
