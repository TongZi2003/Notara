import { createHash } from 'node:crypto';
import { PlanContentSchema, PlanPatchSchema, PlanViewSchema, type PlanContent, type PlanView } from '@studyforge/contracts/plans';
import type { HostContext, MutationContext } from '@studyforge/contracts';
import type { MaterialService } from '../materials/material-service.ts';
import type { SkeletonService } from '../materials/skeleton-service.ts';
import { resolveAnchor } from '../materials/read-material.ts';
import { RecordError, type RecordStore } from '../storage/record-store.ts';

export interface PlanTargets { hasCard(ctx: HostContext, ref: string): boolean; hasSet(ctx: HostContext, ref: string): boolean; }
export class PlanService {
  constructor(records: RecordStore<typeof PlanContentSchema>, materials: MaterialService, skeletons: SkeletonService, targets: PlanTargets) {
    this.records = records; this.materials = materials; this.skeletons = skeletons; this.targets = targets;
  }
  private readonly records: RecordStore<typeof PlanContentSchema>;
  private readonly materials: MaterialService;
  private readonly skeletons: SkeletonService;
  private readonly targets: PlanTargets;
  read(ctx: HostContext, ref: string, version?: number): PlanView {
    const saved = this.records.read(ctx, ref, version);
    return PlanViewSchema.parse({ ref: saved.ref, version: saved.version, content: saved.data });
  }
  list(ctx: HostContext): PlanView[] { return this.records.list(ctx).map(row => PlanViewSchema.parse({ ref: row.ref, version: row.version, content: row.data })); }
  async check(ctx: HostContext, input: unknown): Promise<PlanContent> {
    const content = PlanContentSchema.parse(input);
    if (content.kind === 'book') {
      await this.materials.get(ctx, content.materialId);
      const outline = await this.skeletons.read(ctx, content.materialId), paths = new Set(outline.nodes.map(node => node.path));
      for (const entry of content.entries) {
        if (entry.chapter && !paths.has(entry.chapter)) throw new RecordError('plan_chapter_missing');
        for (const anchor of entry.sources) {
          if (anchor.materialId !== content.materialId) throw new RecordError('plan_wrong_book');
          await resolveAnchor(this.materials, ctx, anchor);
        }
      }
    } else {
      if (content.learningSetRef && !this.targets.hasSet(ctx, content.learningSetRef)) throw new RecordError('plan_set_missing');
      for (const ref of [...content.cards, ...content.schedule.flatMap(day => day.cards)]) if (!this.targets.hasCard(ctx, ref)) throw new RecordError('plan_card_missing');
      const dates = new Set<string>();
      for (const day of content.schedule) {
        if (day.date < content.start || day.date > content.end) throw new RecordError('plan_date_outside_campaign');
        if (dates.has(day.date)) throw new RecordError('plan_duplicate_date'); dates.add(day.date);
        if (new Set(day.cards).size !== day.cards.length) throw new RecordError('plan_duplicate_card');
      }
    }
    return content;
  }
  async create(ctx: MutationContext, input: unknown): Promise<PlanView> {
    const content = await this.check(ctx, input);
    const id = 'plan_' + createHash('sha256').update(`${ctx.workspaceId}:${ctx.operationId}`).digest('hex').slice(0, 24);
    const saved = await this.records.create(ctx, id, content);
    return PlanViewSchema.parse({ ref: saved.ref, version: saved.version, content: saved.data });
  }
  async preview(ctx: HostContext, ref: string, version: number, patch: unknown): Promise<PlanContent> {
    const before = this.read(ctx, ref, version).content, change = PlanPatchSchema.parse(patch);
    // Kind and book identity are fixed by the target; strict branch parsing
    // rejects campaign fields on a book plan and vice versa.
    return this.check(ctx, { ...before, ...change });
  }
  async edit(ctx: MutationContext, ref: string, patch: unknown): Promise<PlanView> {
    if (typeof ctx.expectedVersion !== 'number') throw new RecordError('plan_expected_version_required');
    const change = PlanPatchSchema.parse(patch), content = await this.preview(ctx, ref, ctx.expectedVersion, change);
    const saved = await this.records.update(ctx, ref, change, () => content);
    return PlanViewSchema.parse({ ref: saved.ref, version: saved.version, content: saved.data });
  }
}
