/**
 * P3.4 progressive skeleton contract (plan §P3.4, CONTRACTS.md §10).
 *
 * A skeleton is one book's own structure: nodes of `{ path, sources }` and
 * nothing else. The path says where a section sits in the book, the anchors say
 * which real bytes were read to place it. A node carries no teaching note, no
 * span shorthand and no "already broken down" flag — a position nobody read is
 * simply absent instead of guessed, and coverage is read back from the nodes
 * rather than tracked as a second ledger.
 *
 * One skeleton belongs to one material (`materialId`). Its anchors may pin
 * different versions of that same book: a chapter written from v1 keeps
 * resolving v1 after v2 is imported, because importing a version never rewrites
 * the anchors an existing chapter was written from.
 */
import { z } from 'zod';
import { MaterialIdSchema } from './material-records.ts';
import { SourceAnchorSchema } from './materials.ts';

/**
 * One level-separated semantic path. `/` separates levels, the trimmed text is
 * the node's identity, and a book never grows a second node for the same path.
 */
export const SkeletonPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine(path => !path.startsWith('/') && !path.endsWith('/') && !path.includes('//'), {
    message: '骨架路径用 / 分层，不能有空层',
  })
  .refine(path => !/[\u0000-\u001f\u007f]/.test(path), {
    message: '骨架路径不能含换行或控制字符',
  });

export type SkeletonPath = z.infer<typeof SkeletonPathSchema>;

/** Message prefix the schema and the service share, so one rule yields one code. */
export const SKELETON_DUPLICATE_PATH_PREFIX = '重复的骨架路径';

/** The first path that appears twice, or `undefined` when every path is unique. */
export function duplicateSkeletonPath(nodes: readonly { readonly path: string }[]): string | undefined {
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.path)) return node.path;
    seen.add(node.path);
  }
  return undefined;
}

/** One section of a book: a path plus the real anchors it was read from. */
export const SkeletonNodeSchema = z
  .object({
    path: SkeletonPathSchema,
    // Non-contiguous anchors are normal (a theme spreads across the book); an
    // empty list would be a position with no source, which is a guess.
    sources: z.array(SourceAnchorSchema).min(1),
  })
  .strict();

export type SkeletonNode = z.infer<typeof SkeletonNodeSchema>;

/** A node list; two nodes may never claim the same path. */
export const SkeletonNodesSchema = z.array(SkeletonNodeSchema).superRefine((nodes, ctx) => {
  const duplicate = duplicateSkeletonPath(nodes);
  if (duplicate !== undefined) {
    ctx.addIssue({ code: 'custom', path: [], message: `${SKELETON_DUPLICATE_PATH_PREFIX}：${duplicate}` });
  }
});

export type SkeletonNodes = z.infer<typeof SkeletonNodesSchema>;

/**
 * The skeleton row of one book. Revised and operated on by the native record
 * store, so the row carries no revision, timestamp or status of its own.
 */
export const SkeletonRecordSchema = z
  .object({
    materialId: MaterialIdSchema,
    nodes: SkeletonNodesSchema,
  })
  .strict();

export type SkeletonRecord = z.infer<typeof SkeletonRecordSchema>;

/**
 * One read of a book's skeleton. `revision` is the record token a confirmed
 * save must match; it stays absent while the book still has no skeleton at all,
 * which is a real state and not an error.
 */
export const SkeletonViewSchema = z
  .object({
    materialId: MaterialIdSchema,
    revision: z.number().int().positive().optional(),
    nodes: SkeletonNodesSchema,
  })
  .strict();

export type SkeletonView = z.infer<typeof SkeletonViewSchema>;
