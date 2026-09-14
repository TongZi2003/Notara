/**
 * P3.4 skeleton reading, checking and merging (plan §P3.4, CONTRACTS.md §10).
 *
 * This module is the read/check side of progressive book structure and nothing
 * else. It reads the skeleton row a book may already have, checks a draft
 * against the real bytes of that same book, and merges one checked chapter into
 * the full node list a confirmed save would write. It never creates, revises or
 * deletes a row: P6 owns proposal → student confirmation → save, and a merge
 * result is the draft that writer saves rather than a save.
 *
 * Ownership is by `materialId`. One book owns one skeleton, and the anchors of
 * its nodes may pin different versions of that same book, so importing v2
 * neither invalidates the v1 anchors a chapter was written from nor rewrites
 * them. A book whose structure was never split reads as an empty node list --
 * reading is not a reason to grow a skeleton, and no coverage or progress field
 * is kept here to turn into a second ledger.
 */
import type { ZodError } from 'zod';
import type { HostContext } from '@studyforge/contracts';
import { MaterialIdSchema, type MaterialView } from '@studyforge/contracts/material-records';
import {
  SKELETON_DUPLICATE_PATH_PREFIX,
  SkeletonNodesSchema,
  SkeletonViewSchema,
  type SkeletonNode,
  type SkeletonRecord,
  type SkeletonView,
} from '@studyforge/contracts/skeleton';
import type { Saved } from '../storage/record-store.ts';
import { resolveAnchor } from './read-material.ts';
import type { ResolvedMaterial } from './material-service.ts';

/** The record kind one book's skeleton lives under; the P6 writer saves the same kind. */
export const SKELETON_KIND = 'skeleton';

/** The record surface this service needs; one native store satisfies it. */
export interface SkeletonRecordStore {
  readonly workspaceId: string;
  read(ctx: HostContext, ref: string, revision?: number): Saved<SkeletonRecord>;
}

/** The material side this service needs; one real MaterialService satisfies it. */
export interface SkeletonMaterials {
  /** The book must really exist in this workspace before its structure is discussed. */
  get(ctx: HostContext, materialId: string): Promise<MaterialView>;
  /** Resolves one exact version to its immutable bytes for the real locator check. */
  resolve(ctx: HostContext, query: { materialId: string; versionId: string }): Promise<ResolvedMaterial>;
}

/** A draft the skeleton side refuses before any confirmation happens. */
export class SkeletonError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'SkeletonError';
  }
}

/** A checked draft: what P6 may put in front of the student, and which versions it really read. */
export interface SkeletonValidation {
  readonly materialId: string;
  /** The parsed nodes, path-normalized, in the order the draft gave them. */
  readonly nodes: SkeletonNode[];
  /** Versions the checked anchors really resolved, first-seen order; one book may use several. */
  readonly versionIds: string[];
}

/** The full node list a confirmed save would write, plus what the merge touched. */
export interface SkeletonMerge {
  /** Existing order first, with replaced nodes in place and new nodes appended. */
  readonly nodes: SkeletonNode[];
  /** Paths appended from the draft, in draft order. */
  readonly added: string[];
  /** Paths whose node the draft replaced, in draft order. */
  readonly replaced: string[];
}

export class SkeletonService {
  private readonly records: SkeletonRecordStore;
  private readonly materials: SkeletonMaterials;

  constructor(records: SkeletonRecordStore, materials: SkeletonMaterials) {
    this.records = records;
    this.materials = materials;
  }

  /**
   * Read one book's skeleton. A book that was never split returns an empty node
   * list, and nothing is created to remember that it was read.
   * @throws `material_missing`/`workspace_mismatch` for a book this workspace does not own.
   */
  async read(ctx: HostContext, materialIdInput: string, revision?: number): Promise<SkeletonView> {
    const materialId = MaterialIdSchema.parse(materialIdInput);
    await this.materials.get(ctx, materialId);
    const saved = revision === undefined ? this.existing(ctx, materialId) : this.records.read(ctx, refOf(materialId), revision);
    if (saved === undefined) return SkeletonViewSchema.parse({ materialId, nodes: [] });
    if (saved.data.materialId !== materialId) {
      throw new SkeletonError('skeleton_record_mismatch', `这份骨架记的是另一本书（${saved.data.materialId}），不能当作 ${materialId} 的结构。`);
    }
    return SkeletonViewSchema.parse({ materialId, revision: saved.version, nodes: saved.data.nodes });
  }

  /**
   * Check a draft against the real book before anyone confirms it: every anchor
   * must belong to this material, every locator must resolve inside the
   * immutable bytes of the version it pins, and a text or DOCX anchor that
   * carries a quote must quote the text really at that range. Anchors of the
   * same version, position and quote are read once per call.
   * @param draft - untrusted nodes (a model draft); the schema is the only shape trusted.
   * @throws SkeletonError for a malformed draft or a foreign book, and the material
   *   reader's own codes (`material_version_missing`, `source_offset_out_of_range`,
   *   `source_quote_mismatch`, …) for a stale, out-of-range or misquoted anchor.
   */
  async validate(ctx: HostContext, materialIdInput: string, draft: unknown): Promise<SkeletonValidation> {
    const materialId = MaterialIdSchema.parse(materialIdInput);
    await this.materials.get(ctx, materialId);
    const nodes = this.parseNodes(draft);
    const read = new Set<string>();
    const versionIds: string[] = [];
    for (const node of nodes) {
      for (const anchor of node.sources) {
        if (anchor.materialId !== materialId) {
          throw new SkeletonError('skeleton_wrong_book',
            `节点「${node.path}」的来源属于另一本书（${anchor.materialId}）；一本书的骨架只能引用 ${materialId}。`);
        }
        const key = anchorKey(anchor);
        if (!read.has(key)) {
          // The exact bytes, not a shape check: an anchor pointing outside the
          // version it pins, or quoting text that is not really there, is
          // refused here, before a confirmation exists. Pixels stay pixels --
          // the reader never answers a quote with OCR.
          await resolveAnchor(this.materials, ctx, anchor);
          read.add(key);
        }
        if (!versionIds.includes(anchor.versionId)) versionIds.push(anchor.versionId);
      }
    }
    return { materialId, nodes: [...nodes], versionIds };
  }

  /**
   * Merge one checked chapter into the existing structure, the way the P6 writer
   * must: a draft path the book already has replaces that node in place, a new
   * path is appended in draft order, and every other chapter keeps exactly the
   * node it had. A chapter's node is replaced as a whole -- callers pass the
   * anchors the chapter really cites, and nothing is unioned behind their back.
   */
  merge(existing: readonly SkeletonNode[], incoming: readonly SkeletonNode[]): SkeletonMerge {
    const nodes = [...this.parseNodes(existing)];
    const added: string[] = [];
    const replaced: string[] = [];
    for (const node of this.parseNodes(incoming)) {
      const at = nodes.findIndex(item => item.path === node.path);
      if (at < 0) {
        nodes.push(node);
        added.push(node.path);
        continue;
      }
      nodes[at] = node;
      replaced.push(node.path);
    }
    return { nodes, added, replaced };
  }

  private existing(ctx: HostContext, materialId: string): Saved<SkeletonRecord> | undefined {
    try {
      return this.records.read(ctx, refOf(materialId));
    } catch (error) {
      if (codeOf(error) === 'record_missing') return undefined;
      throw error;
    }
  }

  /** Parse untrusted nodes; the schema owns the path and duplicate rules. */
  private parseNodes(input: unknown): SkeletonNode[] {
    const parsed = SkeletonNodesSchema.safeParse(input);
    if (!parsed.success) throw draftError(parsed.error);
    return [...parsed.data];
  }
}

function refOf(materialId: string): string {
  return `${SKELETON_KIND}:${materialId}`;
}

/** One rule, one code: a duplicate path is named as such, everything else is a draft problem. */
function draftError(error: ZodError): SkeletonError {
  const issue = error.issues[0];
  const message = issue === undefined ? '这份骨架草稿不符合骨架 schema。' : issue.message;
  const code = message.startsWith(SKELETON_DUPLICATE_PATH_PREFIX) ? 'skeleton_duplicate_path' : 'skeleton_draft_invalid';
  const where = issue === undefined || issue.path.length === 0
    ? '骨架草稿'
    : `第 ${issue.path.map(String).join('.')} 项`;
  return new SkeletonError(code, `${where}：${message}`);
}

/**
 * Canonical key for one anchor inside a single validate call; never persisted.
 * The quote belongs to the key: two anchors may share one position and carry
 * different quotes, and every quote still has to be checked on its own.
 */
function anchorKey(anchor: { readonly versionId: string; readonly locator: SourceAnchorLocator; readonly quote?: string | undefined }): string {
  return `${anchor.versionId}\u0000${anchor.quote ?? ''}\u0000${locatorKey(anchor.locator)}`;
}

function locatorKey(locator: SourceAnchorLocator): string {
  switch (locator.kind) {
    case 'pdf':
      return `pdf\u0000${String(locator.page)}\u0000${(locator.rect ?? []).join(',')}`;
    case 'image':
      return `image\u0000${(locator.rect ?? []).join(',')}`;
    case 'text':
      return `text\u0000${String(locator.start.line)}:${String(locator.start.column)}-${String(locator.end.line)}:${String(locator.end.column)}`;
    case 'docx':
      return `docx\u0000${locator.part}\u0000${locator.blockId}\u0000${String(locator.start)}-${String(locator.end)}`;
  }
}

/** Structural alias of the contract's locator, so this module needs no runtime import of it. */
type SourceAnchorLocator = SkeletonNode['sources'][number]['locator'];

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const { code } = error as unknown as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}
