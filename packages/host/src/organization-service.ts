/**
 * P6 organisation Remote: learning sets, the course route, plans, skeleton
 * authoring and the read-only book structure — the five surfaces a student's
 * own bookshelf, roadmap and book map are drawn from.
 *
 * Everything here is a thin, validating boundary over the domain services the
 * Host constructed; this file never re-implements a rule. A read resolves the
 * acting workspace from the native Session binding (`studentContext`), a write
 * always carries the caller's operation id so a retry is one effect, and a
 * planned lesson is opened through the domain's `NativeOpen` seam (native
 * explicit-id adoption), never through a second session factory. The route
 * keeps every reference honest: the Host's own validators confirm a material,
 * a card and a teaching configuration before the domain stores one.
 *
 * `expectedVersion` here is always the revision the caller *read*: the domain
 * turns it into a node-level baseline for the route and a set-level baseline for
 * a set, so a concurrent edit to a different object never blocks this write.
 */
import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';
import { EntityRefSchema, type HostContext, type MutationContext } from '@studyforge/contracts';
import { MaterialContextSchema, type MaterialContext } from '@studyforge/contracts/materials';
import { MaterialIdSchema } from '@studyforge/contracts/material-records';
import { SetCreateSchema, SetPatchSchema, type SetCreateDraft, type SetPatchDraft, type SetView } from '@studyforge/contracts/sets';
import { RouteNodeInputSchema, RouteNodePatchSchema, RoutePlacementSchema, type RouteNodeInputDraft, type RouteNodePatchDraft, type RouteOpenResult, type RoutePlacement, type RouteView } from '@studyforge/contracts/routes';
import { PlanContentSchema, PlanPatchSchema, SkeletonChangeSchema, type PlanContent, type PlanPatch, type PlanView, type SkeletonChangeDraft, type SkeletonPreview } from '@studyforge/contracts/plans';
import type { SkeletonView } from '@studyforge/contracts/skeleton';
import { BookBreakdownIntentSchema, type BookBreakdownIntent, type BookStructure } from '@studyforge/contracts/book-exploration';
import type { MaterialRefs, SetService } from '@studyforge/domain/sets';
import { RouteError, type RouteService, type RouteValidators } from '@studyforge/domain/routes';
import type { PlanService } from '@studyforge/domain/plans';
import type { SkeletonAuthoring } from '@studyforge/domain/skeleton-authoring';
import { validateBookBreakdown, type BookExploration } from '@studyforge/domain/book-exploration';
import { nativeOpen } from './runtime/native-open.ts';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller';
import { validateLessonMaterials } from './materials/validate-lesson-materials.ts';
import { studentContext } from './learning-service.ts';

/**
 * The Host's own first-release teaching configurations (CONTRACTS §8). Until
 * P7 lands the real config directory this is the list this Host really ships,
 * so a route can never store a teaching reference nothing implements; swap the
 * list (or the whole validator) when the directory arrives.
 */
export const HOST_TEACHING_CONFIGS: readonly string[] = ['organize', 'diagnose', 'socratic', 'brainstorm', 'search'];

/**
 * The set service's one existence port, over the real materials this workspace
 * holds. A set names the originals it groups; it never stores one that cannot
 * be opened, and an unknown id answers `set_material_unresolved` instead of a
 * parse error.
 */
export function materialRefs(host: Context): MaterialRefs {
  return {
    hasMaterial: async (ctx, materialId) => {
      if (!MaterialIdSchema.safeParse(materialId).success) return false;
      try { await host.studyforgeMaterialService.get(ctx, materialId); return true; }
      catch (error) { if ((error as { code?: string }).code === 'material_missing') return false; throw error; }
    },
  };
}

/** The Host's real reference validators for a route: P3/P4 material resolution. */
export function routeValidators(host: Context, teachingConfigs: readonly string[] = HOST_TEACHING_CONFIGS): RouteValidators {
  return {
    materials: (ctx, materials) => validateLessonMaterials(host, ctx, materials),
    teachingRef: (_ctx, ref) => teachingConfigs.includes(ref) ? Promise.resolve() : Promise.reject(new RouteError('route_teaching_ref_missing', [ref])),
  };
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    studyforgeOrganization: StudyForgeOrganization;
    studyforgeSetService: SetService;
    studyforgeRouteService: RouteService;
    studyforgePlanService: PlanService;
    studyforgeSkeletonAuthoring: SkeletonAuthoring;
    studyforgeBookExploration: BookExploration;
  }
}

const BoundSchema = z.object({ sessionId: z.string().min(1).optional() }).strict();
const ReadSchema = BoundSchema.extend({ ref: EntityRefSchema, version: z.number().int().positive().optional() }).strict();
const WriteSchema = BoundSchema.extend({ operationId: z.string().min(1) }).strict();
const VersionedWriteSchema = WriteSchema.extend({ ref: EntityRefSchema, expectedVersion: z.number().int().positive() }).strict();

export class StudyForgeOrganization extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'studyforgeOrganization'); }

  /**
   * The acting context. A write from a lesson carries that lesson's binding; a
   * workspace-level action (planning the roadmap, building the bookshelf) has no
   * Session and never borrows a recent one.
   */
  private context(sessionId?: string): Promise<HostContext> { return studentContext(this.ctx, sessionId); }

  private async mutation(sessionId: string | undefined, operationId: string, expectedVersion?: number): Promise<MutationContext> {
    return { ...await this.context(sessionId), operationId, ...(expectedVersion === undefined ? {} : { expectedVersion }) };
  }

  // ---- sets -----------------------------------------------------------------

  /** Every set of the workspace, by name; a card owned by no set is visible everywhere. */
  @Remote('sets')
  async sets(input: { sessionId?: string }): Promise<SetView[]> {
    const parsed = BoundSchema.parse(input ?? {});
    return this.ctx.studyforgeSetService.list(await this.context(parsed.sessionId));
  }

  @Remote('set')
  async set(input: { ref: string; version?: number; sessionId?: string }): Promise<SetView> {
    const parsed = ReadSchema.parse(input);
    return this.ctx.studyforgeSetService.read(await this.context(parsed.sessionId), parsed.ref, parsed.version);
  }

  @Remote('createSet')
  async createSet(input: { operationId: string; sessionId?: string; set: SetCreateDraft }): Promise<SetView> {
    const parsed = WriteSchema.extend({ set: SetCreateSchema }).strict().parse(input);
    return this.ctx.studyforgeSetService.create(await this.mutation(parsed.sessionId, parsed.operationId), parsed.set);
  }

  @Remote('updateSet')
  async updateSet(input: { operationId: string; sessionId?: string; ref: string; expectedVersion: number; patch: SetPatchDraft }): Promise<SetView> {
    const parsed = VersionedWriteSchema.extend({ patch: SetPatchSchema }).strict().parse(input);
    return this.ctx.studyforgeSetService.update(await this.mutation(parsed.sessionId, parsed.operationId, parsed.expectedVersion), parsed.ref, parsed.patch);
  }

  /** Every card this set owns: real members union the cards sourced from its own materials. */
  @Remote('setCards')
  async setCards(input: { ref: string; sessionId?: string }): Promise<string[]> {
    const parsed = BoundSchema.extend({ ref: EntityRefSchema }).strict().parse(input);
    return this.ctx.studyforgeSetService.cardsOf(await this.context(parsed.sessionId), parsed.ref);
  }

  /** The sets a card really belongs to; empty is a legal state, not a hidden set. */
  @Remote('cardSets')
  async cardSets(input: { target: string; sessionId?: string }): Promise<SetView[]> {
    const parsed = BoundSchema.extend({ target: EntityRefSchema }).strict().parse(input);
    return this.ctx.studyforgeSetService.ownership(await this.context(parsed.sessionId), parsed.target);
  }

  /** The ladder this card really reviews on (shortest owning policy, else the default). */
  @Remote('cardLadder')
  async cardLadder(input: { target: string; sessionId?: string }): Promise<number[]> {
    const parsed = BoundSchema.extend({ target: EntityRefSchema }).strict().parse(input);
    return this.ctx.studyforgeSetService.effectiveLadder(await this.context(parsed.sessionId), parsed.target);
  }

  // ---- route ----------------------------------------------------------------

  /** The whole course axis; an axis nobody wrote reads as an empty tree, not an error. */
  @Remote('route')
  async route(): Promise<RouteView> { return this.ctx.studyforgeRouteService.read(await this.context()); }

  @Remote('addRouteNode')
  async addRouteNode(input: { operationId: string; sessionId?: string; node: RouteNodeInputDraft }): Promise<RouteView> {
    const parsed = WriteSchema.extend({ node: RouteNodeInputSchema }).strict().parse(input);
    return this.ctx.studyforgeRouteService.add(await this.mutation(parsed.sessionId, parsed.operationId), parsed.node);
  }

  /**
   * One confirmed edit of one node. The parent edge is not part of a content
   * edit — `mountRouteNode` owns it — and a node whose opening is unresolved is
   * refused until the lesson binds.
   */
  @Remote('editRouteNode')
  async editRouteNode(input: { operationId: string; sessionId?: string; nodeId: string; expectedVersion: number; patch: RouteNodePatchDraft }): Promise<RouteView> {
    const parsed = VersionedWriteSchema.omit({ ref: true }).extend({ nodeId: z.string().min(1), patch: RouteNodePatchSchema }).strict().parse(input);
    return this.ctx.studyforgeRouteService.edit(await this.mutation(parsed.sessionId, parsed.operationId, parsed.expectedVersion), parsed.nodeId, parsed.patch);
  }

  @Remote('mountRouteNode')
  async mountRouteNode(input: { operationId: string; sessionId?: string; nodeId: string; expectedVersion: number; parent: string | null }): Promise<RouteView> {
    const parsed = VersionedWriteSchema.omit({ ref: true }).extend({ nodeId: z.string().min(1), parent: z.string().min(1).nullable() }).strict().parse(input);
    return this.ctx.studyforgeRouteService.mount(await this.mutation(parsed.sessionId, parsed.operationId, parsed.expectedVersion), parsed.nodeId, parsed.parent);
  }

  /**
   * Where the student really put their cards on the roadmap. A narrow merge:
   * only the named nodes move, `null` puts one node back in the automatic
   * order, and no node content, edge or declaration is touched. There is no
   * whole-tree revision here on purpose — a canvas drag must never be blocked
   * by, or block, an unrelated authoring edit.
   */
  @Remote('setRouteLayout')
  async setRouteLayout(input: { operationId: string; sessionId?: string; positions: RoutePlacement }): Promise<RouteView> {
    const parsed = WriteSchema.extend({ positions: RoutePlacementSchema }).strict().parse(input);
    return this.ctx.studyforgeRouteService.place(await this.mutation(parsed.sessionId, parsed.operationId), parsed.positions);
  }

  /**
   * Open the one native lesson a planned node owns. A double click, a second tab
   * and a restart all answer with the lesson that really exists; the Host's
   * `NativeOpen` adopts the same native id for the same stable opening key.
   */
  @Remote('openPlannedLesson')
  async openPlannedLesson(input: { operationId: string; sessionId?: string; nodeId: string }): Promise<RouteOpenResult> {
    const parsed = WriteSchema.extend({ nodeId: z.string().min(1) }).strict().parse(input);
    return this.ctx.studyforgeRouteService.openPlanned(await this.mutation(parsed.sessionId, parsed.operationId), parsed.nodeId);
  }

  // ---- plans ----------------------------------------------------------------

  @Remote('plans')
  async plans(input: { sessionId?: string }): Promise<PlanView[]> {
    const parsed = BoundSchema.parse(input ?? {});
    return this.ctx.studyforgePlanService.list(await this.context(parsed.sessionId));
  }

  @Remote('plan')
  async plan(input: { ref: string; version?: number; sessionId?: string }): Promise<PlanView> {
    const parsed = ReadSchema.parse(input);
    return this.ctx.studyforgePlanService.read(await this.context(parsed.sessionId), parsed.ref, parsed.version);
  }

  /** Preflight one whole plan draft against real books, chapters, cards and sets. */
  @Remote('checkPlan')
  async checkPlan(input: { sessionId?: string; plan: PlanContent }): Promise<PlanContent> {
    const parsed = BoundSchema.extend({ plan: PlanContentSchema }).strict().parse(input);
    return this.ctx.studyforgePlanService.check(await this.context(parsed.sessionId), parsed.plan);
  }

  @Remote('createPlan')
  async createPlan(input: { operationId: string; sessionId?: string; plan: PlanContent }): Promise<PlanView> {
    const parsed = WriteSchema.extend({ plan: PlanContentSchema }).strict().parse(input);
    return this.ctx.studyforgePlanService.create(await this.mutation(parsed.sessionId, parsed.operationId), parsed.plan);
  }

  /** The exact content one confirmed patch would write, without writing it. */
  @Remote('previewPlan')
  async previewPlan(input: { ref: string; expectedVersion: number; patch: PlanPatch; sessionId?: string }): Promise<PlanContent> {
    const parsed = BoundSchema.extend({ ref: EntityRefSchema, expectedVersion: z.number().int().positive(), patch: PlanPatchSchema }).strict().parse(input);
    return this.ctx.studyforgePlanService.preview(await this.context(parsed.sessionId), parsed.ref, parsed.expectedVersion, parsed.patch);
  }

  @Remote('editPlan')
  async editPlan(input: { operationId: string; sessionId?: string; ref: string; expectedVersion: number; patch: PlanPatch }): Promise<PlanView> {
    const parsed = VersionedWriteSchema.extend({ patch: PlanPatchSchema }).strict().parse(input);
    return this.ctx.studyforgePlanService.edit(await this.mutation(parsed.sessionId, parsed.operationId, parsed.expectedVersion), parsed.ref, parsed.patch);
  }

  // ---- skeleton authoring ----------------------------------------------------

  /**
   * What one skeleton change would do: the merged nodes, the real cards and
   * plans it moves, and whether removing a path still has dependents. Reads the
   * current revision; writes nothing.
   */
  @Remote('previewSkeleton')
  async previewSkeleton(input: { materialId: string; version: number; change: SkeletonChangeDraft; sessionId?: string }): Promise<SkeletonPreview> {
    const parsed = BoundSchema.extend({ materialId: z.string().min(1), version: z.number().int().nonnegative(), change: SkeletonChangeSchema }).strict().parse(input);
    return this.ctx.studyforgeSkeletonAuthoring.preview(await this.context(parsed.sessionId), parsed.materialId, parsed.version, parsed.change);
  }

  /** Save one confirmed change; the skeleton and every dependent card/plan move together. */
  @Remote('saveSkeleton')
  async saveSkeleton(input: { operationId: string; sessionId?: string; materialId: string; expectedVersion: number; change: SkeletonChangeDraft }): Promise<SkeletonView> {
    const parsed = WriteSchema.extend({ materialId: z.string().min(1), expectedVersion: z.number().int().nonnegative(), change: SkeletonChangeSchema }).strict().parse(input);
    return this.ctx.studyforgeSkeletonAuthoring.save(await this.mutation(parsed.sessionId, parsed.operationId, parsed.expectedVersion), parsed.materialId, parsed.change);
  }

  // ---- one book's read-only structure ---------------------------------------

  /** The whole book tree (root → skeleton sections → card/knowledge leaves), read-only. */
  @Remote('book')
  async book(input: { material: MaterialContext; sessionId?: string }): Promise<BookStructure> {
    const parsed = BoundSchema.extend({ material: MaterialContextSchema }).strict().parse(input);
    return this.ctx.studyforgeBookExploration.read(await this.context(parsed.sessionId), parsed.material);
  }

  /** An explicit student action, entering a native organisation lesson exactly once. */
  @Remote('breakdown')
  async breakdown(input: { operationId: string; intent: BookBreakdownIntent }): Promise<{ sessionId: string }> {
    const parsed = z.object({ operationId: z.string().min(1), intent: BookBreakdownIntentSchema }).strict().parse(input);
    const context = await this.context(), structure = await this.ctx.studyforgeBookExploration.read(context, parsed.intent.material);
    const intent = validateBookBreakdown(structure, parsed.intent);
    if (intent.skeletonRevision !== structure.skeletonRevision) throw new Error('book_skeleton_revision_mismatch');
    const material = intent.sources[0] ?? intent.material;
    const opened = await nativeOpen(this.ctx).open(context, { openingKey: 'book-breakdown:' + parsed.operationId,
      title: structure.title + ' · 整理', materials: { materials: [{ kind: 'source', source: material }] },
      decl: { teachingRef: 'organize', stance: intent.nodePath ? `继续整理 ${intent.nodePath}；保持其他章节。` : '从书根开始整理下一层结构。' },
    });
    await this.ctx.sessionController.prompt({ sessionId: SessionId(opened.sessionId), requestId: parsed.operationId as SessionRequestId, mode: 'queue',
      content: [{ type: 'text', text: `请先读取本课固定版本的《${structure.title}》原文和已有目录，${intent.nodePath ? `从“${intent.nodePath}”` : '从书根'}继续拆解下一层。需要保存的目录或卡片请交给我确认，保留其他章节和卡片。` }],
    }, AbortSignal.timeout(30_000));
    return { sessionId: opened.sessionId };
  }
}
