import { entityHref, type ResolvedEntityReference } from '@studyforge/contracts/entity-reference';
import type { LessonMindProjection } from './lesson-materials-mindmap.ts';
import type { MindNode } from './mindmap-model.ts';
import type { MaterialContext } from '@studyforge/contracts/materials';
import { parentTrail } from './lesson-deck.ts';

function sameSource(a: MaterialContext | null | undefined, b: MaterialContext | undefined): boolean {
  return !!a && !!b && a.materialId === b.materialId && a.versionId === b.versionId && JSON.stringify(a.locator) === JSON.stringify(b.locator);
}
/** Resolve identity before visibility. Missing/historical leaves are transient
 * navigation nodes with real ownership, never new library or learning facts. */
export function focusEntityNode(nodes: readonly MindNode[], projection: LessonMindProjection, versions: ReadonlyMap<string,number>, entity: ResolvedEntityReference): {nodes:MindNode[];key:string} {
  const ref = entity.reference;
  const candidates = nodes.filter(node => {
    const row = projection.rows.get(node.key), book = projection.books.get(node.key);
    if (ref.kind === 'source') return sameSource(row?.source,ref.source)
      || ref.source.locator !== undefined && book?.kind === 'section' && book.sources.length === 1 && sameSource(book.sources[0],ref.source);
    if (ref.kind === 'section') return !entity.historical && book?.kind === 'section' && book.path === ref.path
      && book.sources.length === entity.sources.length && book.sources.every((s,i)=>sameSource(s,entity.sources[i]));
    return row?.target === ref.ref && (row.cardVersion ?? versions.get(ref.ref)) === ref.version
      || book?.kind === ref.kind && 'target' in book && book.target === ref.ref && versions.get(ref.ref) === ref.version && !entity.historical;
  });
  if (candidates.length === 1) return {nodes:[...nodes],key:candidates[0]!.key};
  const source = entity.sources[0];
  const owner = nodes.find(node => node.kind === 'book' && sameSource(projection.rows.get(node.key)?.source, source && {materialId:source.materialId,versionId:source.versionId}));
  const section = owner && entity.chapter ? nodes.find(node => {
    const item=projection.books.get(node.key);
    return parentTrail(nodes,node.key).some(parent=>parent.key===owner.key) && item?.kind==='section' && item.path===entity.chapter && item.sources.some(s=>entity.sources.some(anchor=>sameSource(s,anchor)));
  }) : undefined;
  const parent = section?.key ?? owner?.key;
  const key = 'reference:' + entityHref(ref);
  const existing=nodes.find(node=>node.key===key);
  if(existing) return {nodes:[...nodes],key};
  const leaf:MindNode={key,title:entity.title,kind:ref.kind==='source'?'material':ref.kind,hint:entity.historical?'历史版本 · 本次查看':'本次查看',children:[],...(parent?{parent}:{})};
  return {key,nodes:[...nodes.map(node=>node.key===parent?{...node,children:[...node.children,key]}:node),leaf]};
}
