import type { Context } from '@deepseek-ai/cordis';
import { LibraryEntityReferenceSchema, type ResolvedEntityReference } from '@studyforge/contracts/entity-reference';
import type { MaterialContext } from '@studyforge/contracts/materials';
import { readMaterial } from '@studyforge/domain/material-read';
import { studentContext } from './learning-service.ts';

const sourceContext = (source: MaterialContext): MaterialContext => ({ materialId: source.materialId, versionId: source.versionId, ...(source.locator ? { locator: source.locator } : {}) });

/** Navigation reads the same student's records. It records neither adoption nor study. */
export async function resolveEntityReference(host: Context, sessionId: string, input: unknown): Promise<ResolvedEntityReference> {
  const reference = LibraryEntityReferenceSchema.parse(input), context = await studentContext(host, sessionId);
  const binding = await host.studyforgeAccess.forSession(sessionId);
  const source = async (anchor: MaterialContext): Promise<string> => {
    const resolved = await host.studyforgeMaterialService.resolve(context, {materialId:anchor.materialId,versionId:anchor.versionId});
    host.studyforgeAccess.assert(binding, resolved.absolutePath);
    if (anchor.locator) await readMaterial(host.studyforgeMaterialService, context, anchor);
    return resolved.version.title;
  };
  if (reference.kind === 'source') {
    const title = await source(reference.source), book = await host.studyforgeMaterialService.get(context, reference.source.materialId);
    return { reference, title, sources: [reference.source], historical: book.currentVersion.versionId !== reference.source.versionId };
  }
  if (reference.kind === 'section') {
    const skeleton = await host.studyforgeSkeletonService.read(context, reference.materialId, reference.skeletonRevision);
    const node = skeleton.nodes.find(item => item.path === reference.path);
    if (!node) throw new Error('reference_section_missing');
    for (const anchor of node.sources) {
      const resolved = await host.studyforgeMaterialService.resolve(context, {materialId:anchor.materialId,versionId:anchor.versionId});
      host.studyforgeAccess.assert(binding, resolved.absolutePath);
    }
    const latest = await host.studyforgeSkeletonService.read(context, reference.materialId);
    return { reference, title: node.path.split('/').at(-1)!, sources: node.sources.map(sourceContext), chapter: node.path, historical: latest.revision !== reference.skeletonRevision };
  }
  if (reference.kind === 'card') {
    const card = host.studyforgeCardService.read(context, reference.ref, reference.version);
    return { reference, title: card.content.title, sources: card.content.sources.map(sourceContext),
      ...(card.content.chapter ? { chapter: card.content.chapter } : {}), historical: host.studyforgeCardService.read(context, reference.ref).version !== card.version };
  }
  const note = host.studyforgeKnowledgeService.read(context, reference.ref, reference.version);
  return { reference, title: note.content.title, sources: [], historical: host.studyforgeKnowledgeService.read(context, reference.ref).version !== note.version };
}
