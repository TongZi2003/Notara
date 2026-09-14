import type { CardContent, HostContext, SourceAnchor } from '@studyforge/contracts';
import type { Context } from '@deepseek-ai/cordis';
import { SourceContextSchema, encodeSourceFragment, type SourceContext, type SourceFragment, type FrozenSource } from '@studyforge/contracts/source-context';
import { readMaterial, resolveAnchor } from '@studyforge/domain/material-read';
import { entityLink, type LibraryEntityReference } from '@studyforge/contracts/entity-reference';
export interface ContextCardReader {
  read(ctx: HostContext, ref: string, version?: number): Promise<{ ref: string; version: number; content: CardContent }>;
}
declare module '@deepseek-ai/cordis' { interface Context { studyforgeCardContext: ContextCardReader; } }

/** Resolve UI references at freeze time. Acceptance and message identity remain native. */
export async function freezeSourceContext(host: Context, sessionId: string, input: SourceContext, cards?: ContextCardReader): Promise<FrozenSource> {
  const binding = await host.studyforgeAccess.forSession(sessionId);
  if (binding.purpose !== 'learning') throw new Error('source_learning_session_required');
  const ctx: HostContext = { workspaceId: binding.workspaceId, sessionId: binding.sessionId, purpose: binding.purpose, actor: 'student' };
  const materials = {
    resolve: async (context: HostContext, source: { materialId: string; versionId: string }) => {
      const resolved = await host.studyforgeMaterialService.resolve(context, source);
      host.studyforgeAccess.assert(binding, resolved.absolutePath);
      return resolved;
    },
  };
  const context = SourceContextSchema.parse(input);
  const fragment: SourceFragment = { version: 1, context, titles: [], objects: [] };
  const images: FrozenSource['images'] = [];
  const passages: string[] = [];
  const remember = (ref: string, title: string, version: string | number): void => {
    if (!fragment.titles.some(item => item.ref === ref)) fragment.titles.push({ ref, title });
    if (!fragment.objects.some(item => item.ref === ref && item.version === version)) fragment.objects.push({ ref, version });
  };
  const readAnchor = async (anchor: SourceAnchor): Promise<void> => {
    const reading = await resolveAnchor(materials, ctx, anchor);
    const { version } = await materials.resolve(ctx, { materialId: anchor.materialId, versionId: anchor.versionId });
    remember('material:' + anchor.materialId, version.title, version.digest);
    if (reading.text !== undefined) passages.push(reading.text);
    if (reading.image) images.push(reading.image);
  };
  if (context.selection) {
    for (const anchor of context.selection.sources) await readAnchor(anchor);
    // A DOM preview can transform whitespace/TeX. Send the source intervals
    // actually read, and never accept purported OCR text for a rectangle.
    context.selection.text = passages.join('\n');
  } else if (context.currentMaterial?.kind === 'source') {
    const source = context.currentMaterial.source;
    const { version } = await materials.resolve(ctx, { materialId: source.materialId, versionId: source.versionId });
    remember('material:' + source.materialId, version.title, version.digest);
    if (source.locator) {
      const reading = await readMaterial(materials, ctx, source);
      if (reading.image) images.push(reading.image);
    }
  } else if (context.currentMaterial?.kind === 'card') {
    if (!cards) throw new Error('card_context_unavailable');
    const card = await cards.read(ctx, context.currentMaterial.cardRef, context.currentMaterial.cardVersion);
    remember(card.ref, card.content.title, card.version);
    // A card's own sources remain readable by its normal source links; they are
    // not automatically all sent as if the student selected them this time.
  } else throw new Error('source_context_empty');
  const current = context.currentMaterial;
  const targets:LibraryEntityReference[] = context.selection ? context.selection.sources.map(source=>({kind:'source',source:{materialId:source.materialId,versionId:source.versionId,locator:source.locator}}))
    : current?.kind==='source' ? [{kind:'source',source:current.source}]
    : current?.kind==='card' ? [{kind:'card',ref:current.cardRef,version:fragment.objects.find(row=>row.ref===current.cardRef)!.version as number}] : [];
  fragment.entities = targets.map(reference => {
    const ref = reference.kind === 'source' ? 'material:' + reference.source.materialId : reference.kind === 'card' ? reference.ref : '';
    const title = fragment.titles.find(item => item.ref === ref)?.title ?? '资料';
    try { return { reference, title, link: entityLink(title, reference) }; }
    catch { return { reference, title }; } // A long link must not discard a valid selection.
  });
  return { fragment, images, modelText: encodeSourceFragment(fragment) };
}

/** Revalidate object identities against their actual fixed versions when evidence is queried. */
export async function sourceEvidenceObjects(host: Context, ctx: HostContext, fragments: readonly SourceFragment[]): Promise<{ ref: string; version: string | number }[]> {
  const objects: { ref: string; version: string | number }[] = [];
  for (const { context, objects: pins, entities } of fragments) {
    for (const entity of entities??[]) if(entity.reference.kind==='knowledge') {
      const note=host.studyforgeKnowledgeService.read(ctx,entity.reference.ref,entity.reference.version);
      if(!objects.some(item=>item.ref===note.ref&&item.version===note.version))objects.push({ref:note.ref,version:note.version});
    }
    const references = context.selection?.sources ?? (context.currentMaterial?.kind === 'source' ? [context.currentMaterial.source] : []);
    for (const source of references) {
      const resolved = await host.studyforgeMaterialService.resolve(ctx, { materialId: source.materialId, versionId: source.versionId });
      const ref = 'material:' + source.materialId;
      if (!objects.some(object => object.ref === ref && object.version === resolved.version.digest)) objects.push({ ref, version: resolved.version.digest });
    }
    if (!context.selection && context.currentMaterial?.kind === 'card') {
      const ref = context.currentMaterial.cardRef, pin = pins.find(item => item.ref === ref);
      const reader = host.get('studyforgeCardContext');
      if (!reader || typeof pin?.version !== 'number') throw new Error('card_evidence_version_unavailable');
      const saved = await reader.read(ctx, ref, pin.version);
      if (saved.version !== pin.version) throw new Error('card_evidence_version_mismatch');
      if (!objects.some(object => object.ref === ref && object.version === saved.version)) objects.push({ ref, version: saved.version });
    }
  }
  return objects;
}
