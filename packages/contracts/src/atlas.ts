/**
 * Cross-book knowledge map ("atlas"): the workspace-level hierarchical
 * organization that no single material owns.
 *
 * A book skeleton answers "where inside this one book does this belong"; the
 * atlas answers "where inside the student's whole knowledge map does this
 * belong". A card's `topic` names one atlas path exactly the way its `chapter`
 * names one book path, and the two coexist: chapter is book-local, topic is
 * workspace-wide and may be claimed by a card sourced from any books — or from
 * none at all.
 *
 * Unlike a skeleton node, an atlas node is a semantic bucket, not a reading
 * claim: `sources` is optional provenance and may pin anchors of several
 * different books. `detail` keeps the same vocabulary as the skeleton —
 * `outline` marks a level minted as a placement hypothesis by a card write
 * (correctable through repath/remove like any node), `refined` marks a level a
 * human or AI confirmed by real reads.
 */
import { z } from 'zod';
import { SourceAnchorSchema } from './materials.ts';
import { SkeletonPathSchema, duplicateSkeletonPath, SKELETON_DUPLICATE_PATH_PREFIX } from './skeleton.ts';

/** The one workspace map; multiple named maps are deliberately out of scope. */
export const ATLAS_REF = 'atlas:main';
export const ATLAS_KIND = 'atlas';
export const ATLAS_SCOPE = 'main';

/** One topic level of the workspace map. */
export const AtlasNodeSchema = z
  .object({
    path: SkeletonPathSchema,
    note: z.string().max(600).optional().describe('这层主题的含义或划分依据；可空'),
    sources: z.array(SourceAnchorSchema).optional().describe('支持该层组织的真实出处；可跨多份资料，可空——脑图节点是语义归属，不是阅读凭证'),
    detail: z.enum(['outline', 'refined']).optional().describe('outline=顺带铸出的归属假设层；refined=经真实读取确认的组织。省略保守按轮廓'),
  })
  .strict();
export type AtlasNode = z.infer<typeof AtlasNodeSchema>;

/** A node list; two nodes may never claim the same path. */
export const AtlasNodesSchema = z.array(AtlasNodeSchema).superRefine((nodes, ctx) => {
  const duplicate = duplicateSkeletonPath(nodes);
  if (duplicate !== undefined) {
    ctx.addIssue({ code: 'custom', path: [], message: `${SKELETON_DUPLICATE_PATH_PREFIX}：${duplicate}` });
  }
});
export type AtlasNodes = z.infer<typeof AtlasNodesSchema>;

/** The atlas row of the whole workspace. Revised by the native record store. */
export const AtlasRecordSchema = z
  .object({ nodes: AtlasNodesSchema })
  .strict();
export type AtlasRecord = z.infer<typeof AtlasRecordSchema>;

/**
 * One read of the workspace map. `revision` is the record token a confirmed
 * save must match; it stays absent while no map exists at all, which is a real
 * state and not an error.
 */
export const AtlasViewSchema = z
  .object({
    revision: z.number().int().positive().optional(),
    nodes: AtlasNodesSchema,
  })
  .strict();
export type AtlasView = z.infer<typeof AtlasViewSchema>;

/** One authored map change; the same vocabulary a skeleton change uses. */
export const AtlasChangeSchema = z.object({
  nodes: AtlasNodesSchema.default([]),
  replaceExisting: z.boolean().default(false),
  removePaths: z.array(SkeletonPathSchema).default([]),
  repath: z.array(z.object({ from: SkeletonPathSchema, to: SkeletonPathSchema }).strict()).default([]),
  detachDependents: z.boolean().default(false),
}).strict();
export type AtlasChange = z.infer<typeof AtlasChangeSchema>;
/** The wire draft of one atlas change: every field above has a real default. */
export type AtlasChangeDraft = z.input<typeof AtlasChangeSchema>;
export interface AtlasImpact {
  cards: string[];
  removedPaths: string[];
}
export interface AtlasPreview {
  nodes: AtlasNode[];
  impact: AtlasImpact;
  requiresDetach: boolean;
}
