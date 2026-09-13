import type { BookBreakdownIntent, BookNode, BookStructure } from '@studyforge/contracts/book-exploration';

export type BreakdownAction = 'directory' | 'cards';
export const breakdownLabel = (action: BreakdownAction): string => action === 'cards' ? '拆成题卡' : '细分目录';
export function bookNodeIntent(structure: BookStructure, node: BookNode, action: BreakdownAction): BookBreakdownIntent {
  return { action, material: structure.material, sources: node.sources,
    ...(node.kind === 'section' ? { nodePath: node.path } : {}),
    ...(structure.skeletonRevision === undefined ? {} : { skeletonRevision: structure.skeletonRevision }) };
}
