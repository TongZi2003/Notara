import type { HostContext, MutationContext } from '@studyforge/contracts';
import { CardRecordSchema } from '@studyforge/contracts/cards';
import { PlanContentSchema, SkeletonChangeSchema, type SkeletonChange, type SkeletonPreview } from '@studyforge/contracts/plans';
import { SkeletonRecordSchema, type SkeletonNode, type SkeletonView } from '@studyforge/contracts/skeleton';
import type { SkeletonService } from '../materials/skeleton-service.ts';
import { RecordError, type RecordStore, type PreparedRecordChange } from '../storage/record-store.ts';

export interface AtomicPublisher { atomic(changes: readonly PreparedRecordChange[]): Promise<void>; }
const beneath = (path: string, root: string): boolean => path === root || path.startsWith(root + '/');
export class SkeletonAuthoring {
  constructor(skeletons: RecordStore<typeof SkeletonRecordSchema>, cards: RecordStore<typeof CardRecordSchema>, plans: RecordStore<typeof PlanContentSchema>, reader: SkeletonService, publisher: AtomicPublisher) {
    this.skeletons = skeletons; this.cards = cards; this.plans = plans; this.reader = reader; this.publisher = publisher;
  }
  private readonly skeletons: RecordStore<typeof SkeletonRecordSchema>;
  private readonly cards: RecordStore<typeof CardRecordSchema>;
  private readonly plans: RecordStore<typeof PlanContentSchema>;
  private readonly reader: SkeletonService;
  private readonly publisher: AtomicPublisher;

  async preview(ctx: HostContext, materialId: string, version: number, draft: unknown): Promise<SkeletonPreview> {
    const change = SkeletonChangeSchema.parse(draft);
    const before = version === 0 ? [] : this.skeletons.read(ctx, 'skeleton:' + materialId, version).data.nodes;
    const mappings = [...change.repath.map(row => row.from), ...change.removePaths];
    for (let i = 0; i < mappings.length; i++) {
      if (!before.some(node => beneath(node.path, mappings[i]!))) throw new RecordError('skeleton_path_missing');
      for (let j = 0; j < i; j++) if (beneath(mappings[i]!, mappings[j]!) || beneath(mappings[j]!, mappings[i]!)) throw new RecordError('skeleton_overlapping_changes');
    }
    const removed = before.filter(node => change.removePaths.some(path => beneath(node.path, path)));
    const retained = before.filter(node => !removed.includes(node)).map(node => ({ ...node, path: remap(node.path, change) }));
    if (!change.replaceExisting) {
      for (const node of change.nodes) {
        const old = retained.find(existing => existing.path === node.path);
        if (old && JSON.stringify(old) !== JSON.stringify(node)) throw new RecordError('skeleton_append_would_replace');
      }
    }
    const nodes = this.reader.merge(retained, change.nodes).nodes;
    await this.reader.validate(ctx, materialId, nodes);
    const affected = this.dependencies(ctx, materialId, change);
    return { nodes, impact: { cards: affected.cards.map(row => row.ref), plans: affected.plans.map(row => row.ref), removedPaths: removed.map(node => node.path) },
      requiresDetach: !change.detachDependents && affected.detached };
  }
  async save(ctx: MutationContext, materialId: string, draft: unknown): Promise<SkeletonView> {
    if (typeof ctx.expectedVersion !== 'number') throw new RecordError('skeleton_expected_version_required');
    const change = SkeletonChangeSchema.parse(draft), ref = 'skeleton:' + materialId;
    const preview = await this.preview(ctx, materialId, ctx.expectedVersion, change);
    if (preview.requiresDetach) throw new RecordError('skeleton_removal_has_dependents');
    const content = { materialId, nodes: preview.nodes };
    const skeleton = ctx.expectedVersion === 0 ? this.skeletons.prepareCreate(ctx, materialId, content)
      : this.skeletons.prepareUpdate(ctx, ref, change, () => content);
    if (skeleton.result.duplicate) {
      await this.publisher.atomic([skeleton]);
      return { materialId, revision: skeleton.result.version, nodes: skeleton.result.data.nodes };
    }
    const affected = this.dependencies(ctx, materialId, change);
    const plans: PreparedRecordChange[] = [skeleton];
    for (const row of affected.cards) {
      plans.push(this.cards.prepareUpdate({ ...ctx, operationId: `${ctx.operationId}:card:${row.ref}`, expectedVersion: row.version }, row.ref, change, old => {
        const { chapter: _chapter, ...rest } = old.content;
        const chapter = changedChapter(old.content.chapter!, change);
        return { ...old, content: { ...rest, ...(chapter ? { chapter } : {}) } };
      }));
    }
    for (const row of affected.plans) {
      plans.push(this.plans.prepareUpdate({ ...ctx, operationId: `${ctx.operationId}:plan:${row.ref}`, expectedVersion: row.version }, row.ref, change, old => {
        if (old.kind !== 'book') throw new RecordError('plan_target_kind_changed');
        return { ...old, entries: old.entries.map(entry => {
          if (!entry.chapter) return entry;
          const { chapter: _chapter, ...rest } = entry, chapter = changedChapter(entry.chapter, change);
          return { ...rest, ...(chapter ? { chapter } : {}) };
        }) };
      }));
    }
    await this.publisher.atomic(plans);
    return { materialId, revision: skeleton.result.version, nodes: skeleton.result.data.nodes };
  }
  private dependencies(ctx: HostContext, materialId: string, change: SkeletonChange) {
    const changes = (chapter: string): boolean => changedChapter(chapter, change) !== chapter;
    const cards = this.cards.list(ctx).filter(row => row.data.content.chapter && row.data.content.sources.some(source => source.materialId === materialId) && changes(row.data.content.chapter));
    const plans = this.plans.list(ctx).filter(row => row.data.kind === 'book' && row.data.materialId === materialId && row.data.entries.some(entry => entry.chapter && changes(entry.chapter)));
    const detached = cards.some(row => changedChapter(row.data.content.chapter!, change) === undefined)
      || plans.some(row => row.data.kind === 'book' && row.data.entries.some(entry => entry.chapter && changedChapter(entry.chapter, change) === undefined));
    return { cards, plans, detached };
  }
}
function remap(path: string, change: SkeletonChange): string {
  const match = change.repath.find(row => beneath(path, row.from));
  return match ? match.to + path.slice(match.from.length) : path;
}
function changedChapter(path: string, change: SkeletonChange): string | undefined {
  if (change.removePaths.some(root => beneath(path, root))) return undefined;
  return remap(path, change);
}
