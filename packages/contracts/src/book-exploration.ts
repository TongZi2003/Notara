import { z } from 'zod';
import { EntityRefSchema, RevisionSchema } from './core.ts';
import { MaterialContextSchema, SourceAnchorSchema } from './materials.ts';
import { SkeletonPathSchema } from './skeleton.ts';

/**
 * P6.6 书籍原文、逐层脑图与列表（plan §P6.6，CONTRACTS.md §10）。
 *
 * 一本书的层级是**读侧投影**，不是第二份持久事实：书根、任意级骨架节点、普通卡与知识
 * 的叶节点都从既有记录现读出来，叶节点用的就是那张卡/那条知识自己的 ref。展开状态属于
 * 界面，不进这一层——`read` 永远返回完整的树，谁展开谁收起由调用方拿着 key 决定。
 *
 * 入图只认真实关系，不认标题：
 *  - 骨架节点：真的读过那段原文（节点自带 anchors）；
 *  - 普通卡：`sources` 里真的有这本书，`chapter` 只决定在书内的放置位置；
 *  - 知识：`publicSources` 是公共教法的包条目、不是书锚，所以只有它真正关联的那张
 *    **在书卡**才能把知识带进来（`via` 记录这条关系），既不猜也不自动收录。
 */

/** 一个节点的共同部分：key 是投影身份，parentKey/children 是同一层级关系的两种读法。 */
export const BookNodeBaseSchema = z.object({
  /** 投影里的唯一身份：书根 `book`、某节 `section:<path>`、叶节点直接用那个对象的 ref。 */
  key: z.string().min(1),
  title: z.string().min(1),
  parentKey: z.string().min(1).optional(),
  /** 与 parentKey 同源，物化出来给渲染用；顺序就是这一层的显示顺序。 */
  children: z.array(z.string().min(1)).default([]),
  /** 这个节点自己真的读过的原文；知识叶没有材料锚，所以是空列表。 */
  sources: z.array(SourceAnchorSchema).default([]),
}).strict();

export const BookNodeSchema = z.discriminatedUnion('kind', [
  BookNodeBaseSchema.extend({ kind: z.literal('book') }).strict(),
  BookNodeBaseSchema.extend({ kind: z.literal('section'), path: SkeletonPathSchema }).strict(),
  BookNodeBaseSchema.extend({ kind: z.literal('card'), target: EntityRefSchema }).strict(),
  /** `via` 是这条知识真正关联的那张在书卡：关系和身份都留着，不复制成第二张卡。 */
  BookNodeBaseSchema.extend({ kind: z.literal('knowledge'), target: EntityRefSchema, via: EntityRefSchema }).strict(),
]);
export type BookNode = z.infer<typeof BookNodeSchema>;
export type BookNodeKind = BookNode['kind'];

/**
 * 一次读取的整本书层级。`material` 是这次读的版本（原文左侧打开的就是它），
 * `skeletonRevision` 缺省表示这本书还没有骨架——那是真实状态，不是错误。
 */
export const BookStructureSchema = z.object({
  material: MaterialContextSchema,
  title: z.string().min(1),
  skeletonRevision: RevisionSchema.optional(),
  nodes: z.array(BookNodeSchema).min(1),
}).strict().superRefine((structure, ctx) => {
  const roots = structure.nodes.filter(node => node.kind === 'book');
  if (roots.length !== 1) ctx.addIssue({ code: 'custom', path: ['nodes'], message: '一本书只有一个书根' });
  if (roots[0] !== undefined && roots[0].parentKey !== undefined) ctx.addIssue({ code: 'custom', path: ['nodes'], message: '书根没有父节点' });
  const keys = new Set(structure.nodes.map(node => node.key));
  if (keys.size !== structure.nodes.length) ctx.addIssue({ code: 'custom', path: ['nodes'], message: '节点 key 必须唯一' });
  for (const node of structure.nodes) {
    if (node.parentKey !== undefined && !keys.has(node.parentKey)) {
      ctx.addIssue({ code: 'custom', path: ['nodes'], message: `节点 ${node.key} 的父节点不存在` });
    }
    const born = structure.nodes.filter(child => child.parentKey === node.key).map(child => child.key);
    if (born.join('\u0000') !== node.children.join('\u0000')) {
      ctx.addIssue({ code: 'custom', path: ['nodes'], message: `节点 ${node.key} 的 children 必须正好是它的子节点` });
    }
  }
  const root = roots[0];
  if (root !== undefined) {
    const seen = new Set<string>(), pending = [root.key];
    while (pending.length > 0) {
      const key = pending.pop()!;
      if (seen.has(key)) continue;
      seen.add(key);
      pending.push(...structure.nodes.filter(node => node.parentKey === key).map(node => node.key));
    }
    if (seen.size !== structure.nodes.length) ctx.addIssue({ code: 'custom', path: ['nodes'], message: '每个节点都必须从书根可达' });
  }
});
export type BookStructure = z.infer<typeof BookStructureSchema>;

/**
 * 明确拆解意图（plan §P6.6）。它固定这次拆解围绕哪个原件版本、哪个已读节点、
 * 哪一版骨架，以及已知的原文范围；它**不是**写者授权，读原文后生成什么仍走 P5/P6
 * 的提案与确认。根节点用缺省的 `nodePath` 表示，尚未拆过的书允许没有 skeletonRevision。
 */
export const BookBreakdownIntentSchema = z.object({
  /** Older directory entries omitted this; current UI always names the intended output. */
  action: z.enum(['directory', 'cards']).optional(),
  material: MaterialContextSchema,
  /** 缺省＝书根；给了就必须是这本书骨架里真实存在的节点。 */
  nodePath: SkeletonPathSchema.optional(),
  /** 缺省＝这本书还没有骨架；给了就必须与读到的那一版一致。 */
  skeletonRevision: RevisionSchema.optional(),
  /** 已知的原文范围；尚未读过原文的书根可以为空。 */
  sources: z.array(SourceAnchorSchema).default([]),
}).strict();
export type BookBreakdownIntent = z.infer<typeof BookBreakdownIntentSchema>;

/**
 * 界面要显示的节点：书根永远在，某个节点展开才露出它的孩子。展开范围是调用方的状态，
 * 这里只做纯投影——不写任何东西，也不改变谁是谁的子节点。
 */
export function visibleNodes(structure: BookStructure, expanded: readonly string[]): BookNode[] {
  const open = new Set(expanded);
  const byKey = new Map(structure.nodes.map(node => [node.key, node]));
  const root = structure.nodes.find(node => node.kind === 'book');
  if (root === undefined) return [];
  const visible: BookNode[] = [];
  const walk = (key: string): void => {
    const node = byKey.get(key);
    if (node === undefined) return;
    visible.push(node);
    if (!open.has(key)) return;
    for (const child of node.children) walk(child);
  };
  walk(root.key);
  return visible;
}
