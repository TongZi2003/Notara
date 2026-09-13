/**
 * P6.6 一本书的只读层级（plan §P6.6，CONTRACTS.md §10）。
 *
 * 这一层只读：书根、任意级骨架节点、普通卡与知识的叶节点都从既有记录现读出来，
 * 叶节点用的就是那张卡/那条知识自己的 ref，不新建"脑图专属卡"，也不把私人知识
 * 收进书里。它不造课、不写事实、不调模型：展开/收起/定位/开详情都是阅读动作，
 * 只有明确的"继续拆解"才由 Host 走进原生课堂（`validateBookBreakdown` 只判目标
 * 与版本/骨架是否对得上，仍然是纯函数）。
 *
 * 入图只认真实关系，不认标题：
 *  - 骨架节点就是这本书自己被读过的位置（节点自带 anchors）；
 *  - 普通卡属于这本书，当且仅当它的 `sources` 里真的有这本书（锚可以钉在这本书的
 *    早期版本上——换原件版本不偷换锚）。`chapter` 只决定放在这本书的哪一节、不存在
 *    同一路径的节点就挂书根：路径在书之间是可以重名的，拿它当归属就是猜书。无来源卡
 *    因此不入任何书；
 *  - 知识只有通过一张**在书卡**才入图（`content.links` 指向这张卡），叶节点保留同一条
 *    知识的 ref、把这条关系记在 `via` 上。`publicSources` 是公共教法的包条目，不是书锚，
 *    绝不拿它当"这本书的知识"。
 *
 * 归属按 `materialId`、放置按 chapter：跨书来源的卡会出现在它真属的每一本书里，用的
 * 还是同一个 ref。
 */
import { MaterialContextSchema } from '@studyforge/contracts/materials';
import type { MaterialContext } from '@studyforge/contracts/materials';
import type { HostContext } from '@studyforge/contracts';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { SkeletonView } from '@studyforge/contracts/skeleton';
import type { CardRecord } from '@studyforge/contracts/cards';
import type { KnowledgeRecord } from '@studyforge/contracts/knowledge';
import { BookBreakdownIntentSchema, BookStructureSchema } from '@studyforge/contracts/book-exploration';
import type { BookBreakdownIntent, BookNode, BookStructure } from '@studyforge/contracts/book-exploration';
import type { Saved } from '../storage/record-store.ts';

/** 书根在投影里的 key；其余节点各自前缀，叶节点直接用对象的 ref。 */
export const BOOK_ROOT_KEY = 'book';

/** 这一层需要的四份读侧；真实的 MaterialService / SkeletonService / RecordStore 都满足它。 */
export interface BookMaterialReader {
  get(ctx: HostContext, materialId: string): Promise<MaterialView>;
}
export interface BookSkeletonReader {
  read(ctx: HostContext, materialId: string): Promise<SkeletonView>;
}
export interface BookCardReader {
  list(ctx: HostContext): Saved<CardRecord>[];
}
export interface BookKnowledgeReader {
  list(ctx: HostContext): Saved<KnowledgeRecord>[];
}

/** 被这一层的规则拒绝，带确切的原因。 */
export class BookExplorationError extends Error {
  readonly code: string;
  readonly problems: readonly string[];
  constructor(code: string, problems: readonly string[] = []) {
    super(problems[0] ?? code);
    this.code = code;
    this.problems = problems;
    this.name = 'BookExplorationError';
  }
}

export class BookExploration {
  private readonly materials: BookMaterialReader;
  private readonly skeletons: BookSkeletonReader;
  private readonly cards: BookCardReader;
  private readonly knowledge: BookKnowledgeReader;

  constructor(materials: BookMaterialReader, skeletons: BookSkeletonReader, cards: BookCardReader, knowledge: BookKnowledgeReader) {
    this.materials = materials; this.skeletons = skeletons; this.cards = cards; this.knowledge = knowledge;
  }

  /**
   * 读一本书的整棵层级（书根 → 任意级骨架 → 卡/知识叶）。展开范围不在这里：
   * 调用方拿 `visibleNodes(structure, expanded)` 决定眼下露出哪几层。
   * @throws BookExplorationError `book_version_missing`：要读的版本不在这本书真正拥有的版本里。
   * @throws 材料/骨架读侧自己的错误码（`material_missing`、`workspace_mismatch`…）。
   */
  async read(ctx: HostContext, material: MaterialContext): Promise<BookStructure> {
    const context = MaterialContextSchema.parse(material);
    const book = await this.materials.get(ctx, context.materialId);
    if (!book.versions.some(version => version.versionId === context.versionId)) {
      throw new BookExplorationError('book_version_missing', [context.versionId]);
    }
    const skeleton = await this.skeletons.read(ctx, context.materialId);

    const nodes: BookNode[] = [{ key: BOOK_ROOT_KEY, kind: 'book', title: book.title, children: [], sources: [] }];
    const paths = new Set(skeleton.nodes.map(node => node.path));
    for (const node of skeleton.nodes) {
      const parent = ancestorPath(node.path, paths);
      nodes.push({
        key: sectionKey(node.path), kind: 'section', title: lastSegment(node.path), path: node.path,
        parentKey: parent === undefined ? BOOK_ROOT_KEY : sectionKey(parent),
        children: [], sources: [...node.sources], ...(node.detail ? { detail: node.detail } : {}),
      });
    }

    // 卡片：归属只看它是否真的读了这本书；放置用真实 chapter（不在骨架里就挂书根）。
    const placed = new Set<string>();
    for (const saved of [...this.cards.list(ctx)].sort(byRef)) {
      const content = saved.data.content;
      const inBook = content.sources.some(source => source.materialId === context.materialId);
      if (!inBook) continue;
      const chapter = content.chapter;
      nodes.push({
        key: saved.ref, kind: 'card', title: content.title, target: saved.ref,
        parentKey: chapter !== undefined && paths.has(chapter) ? sectionKey(chapter) : BOOK_ROOT_KEY,
        children: [], sources: content.sources,
      });
      placed.add(saved.ref);
    }

    // 知识：只有指向一张真的在书卡的 links 才算这本书的知识；不猜、不自动收录。
    for (const saved of [...this.knowledge.list(ctx)].sort(byRef)) {
      const via = saved.data.content.links.find(link => placed.has(link));
      if (via === undefined) continue;
      nodes.push({
        key: saved.ref, kind: 'knowledge', title: saved.data.content.title, target: saved.ref, via,
        parentKey: via, children: [], sources: [],
      });
    }

    return BookStructureSchema.parse({
      material: context, title: book.title, nodes: withChildren(nodes),
      ...(skeleton.revision === undefined ? {} : { skeletonRevision: skeleton.revision }),
    });
  }
}

/**
 * 明确拆解动作的目标校验（纯函数，不写任何东西、不造课）。它回答三件事：目标节点真的
 * 在这本书的这一版里、骨架版本与读到的一致、给出的原文范围属于这本书。通过之后 Host 才
 * 把这份 DTO 绑到原生输入上，送进资料整理课。
 * @throws BookExplorationError `book_material_mismatch`、`book_version_mismatch`、
 *   `book_node_missing`、`book_skeleton_revision_mismatch`、`book_source_mismatch`。
 */
export function validateBookBreakdown(structure: BookStructure, intent: BookBreakdownIntent): BookBreakdownIntent {
  const target = BookBreakdownIntentSchema.parse(intent);
  if (target.material.materialId !== structure.material.materialId) {
    throw new BookExplorationError('book_material_mismatch', [target.material.materialId, structure.material.materialId]);
  }
  if (target.material.versionId !== structure.material.versionId) {
    throw new BookExplorationError('book_version_mismatch', [target.material.versionId, structure.material.versionId]);
  }
  if (target.nodePath !== undefined
    && !structure.nodes.some(node => node.kind === 'section' && node.path === target.nodePath)) {
    throw new BookExplorationError('book_node_missing', [target.nodePath]);
  }
  if (target.action !== 'cards' && target.skeletonRevision !== undefined && structure.skeletonRevision !== target.skeletonRevision) {
    throw new BookExplorationError('book_skeleton_revision_mismatch', [
      String(target.skeletonRevision), structure.skeletonRevision === undefined ? '无骨架' : String(structure.skeletonRevision),
    ]);
  }
  for (const source of target.sources) {
    if (source.materialId !== structure.material.materialId) {
      throw new BookExplorationError('book_source_mismatch', [source.materialId, structure.material.materialId]);
    }
  }
  if (target.action === 'cards' && target.nodePath !== undefined) {
    const node = structure.nodes.find(node => node.kind === 'section' && node.path === target.nodePath)!;
    if (JSON.stringify(node.sources) !== JSON.stringify(target.sources)) throw new BookExplorationError('book_node_changed');
  }
  return target;
}

/** 节点 key：节带前缀，叶节点直接用对象 ref，书根固定。 */
function sectionKey(path: string): string {
  return 'section:' + path;
}

/** 最近的、真的存在的那一级祖先；不合成中间层，不存在就挂到书根。 */
function ancestorPath(path: string, known: ReadonlySet<string>): string | undefined {
  let index = path.lastIndexOf('/');
  while (index > 0) {
    const candidate = path.slice(0, index);
    if (known.has(candidate)) return candidate;
    index = candidate.lastIndexOf('/');
  }
  return undefined;
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** children 与 parentKey 是同一关系：这里按节点顺序把它物化一遍。 */
function withChildren(nodes: readonly BookNode[]): BookNode[] {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentKey === undefined) continue;
    children.set(node.parentKey, [...(children.get(node.parentKey) ?? []), node.key]);
  }
  return nodes.map(node => ({ ...node, children: children.get(node.key) ?? [] }));
}

/** 同层顺序只由 ref 决定，不依赖存储的迭代顺序。 */
function byRef(left: { readonly ref: string }, right: { readonly ref: string }): number {
  return left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0;
}
