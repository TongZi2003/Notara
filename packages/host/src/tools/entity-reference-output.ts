import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { entityHref, entityLink, type LibraryEntityReference } from '@studyforge/contracts/entity-reference';

/** Called only by typed learning-tool output renderers, after canonical validation.
 * The original JSON stays untouched so native version/evidence readers keep working. */
export function entityReferenceContent(value: unknown): ContentBlock[] {
  const links = new Map<string, string>();
  const add = (title: string, target: LibraryEntityReference): void => {
    try { links.set(entityHref(target), entityLink(title, target)); } catch { /* Not a complete saved identity. */ }
  };
  const visit = (input: unknown): void => {
    if (!input || typeof input !== 'object') return;
    if (Array.isArray(input)) { for (const item of input) visit(item); return; }
    const row = input as Record<string, any>;
    const title = row.content?.title ?? row.title;
    const version = row.version ?? row.revision;
    if (typeof row.ref === 'string' && typeof version === 'number') {
      if (row.ref.startsWith('card:')) add(title ?? '题卡', { kind: 'card', ref: row.ref, version });
      if (row.ref.startsWith('knowledge:')) add(title ?? '知识笔记', { kind: 'knowledge', ref: row.ref, version });
    }
    if (row.source?.materialId && row.source?.versionId) add(title ?? '原文', { kind: 'source', source: { materialId: row.source.materialId, versionId: row.source.versionId, ...(row.source.locator ? { locator: row.source.locator } : {}) } });
    if (row.materialId && row.versionId) add(title ?? '原文', { kind: 'source', source: { materialId: row.materialId, versionId: row.versionId, ...(row.locator ? { locator: row.locator } : {}) } });
    if (row.materialId && row.revision && Array.isArray(row.nodes)) for (const node of row.nodes) {
      if (node.path) add(node.path, { kind: 'section', materialId: row.materialId, skeletonRevision: row.revision, path: node.path });
    }
    for (const key of ['hits','cards','materials','items','reading']) if (row[key]) visit(row[key]);
    for (const source of row.content?.sources ?? row.sources ?? []) visit(source);
  };
  visit(value);
  return links.size ? [{ type: 'text', text: '可引用的资料（使用下列链接，显示标题；不要改写链接目标）：\n' + [...links.values()].join('\n') }] : [];
}
