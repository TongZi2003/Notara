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
import { SessionId } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-session-query';
import type {} from '@deepseek-ai/dsh-workspace';
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title';
import { realpathSync } from 'node:fs';
import { z } from 'zod';
import { EntityRefSchema, LessonMaterialsSchema, type HostContext, type LessonMaterials, type MutationContext } from '@studyforge/contracts';
import { MaterialContextSchema, type MaterialContext } from '@studyforge/contracts/materials';
import { MaterialIdSchema } from '@studyforge/contracts/material-records';
import { SetCreateSchema, SetPatchSchema, type SetCreateDraft, type SetPatchDraft, type SetView } from '@studyforge/contracts/sets';
import { RouteNodeInputSchema, RouteNodePatchSchema, RoutePlacementSchema, type RouteNativeLesson, type RouteNodeInputDraft, type RouteNodePatchDraft, type RouteOpenResult, type RoutePlacement, type RouteView } from '@studyforge/contracts/routes';
import { PlanContentSchema, PlanPatchSchema, SkeletonChangeSchema, type PlanContent, type PlanContentDraft, type PlanPatch, type PlanView, type SkeletonChangeDraft, type SkeletonPreview } from '@studyforge/contracts/plans';
import type { SkeletonView } from '@studyforge/contracts/skeleton';
import { BookBreakdownIntentSchema, type BookBreakdownIntent, type BookStructure } from '@studyforge/contracts/book-exploration';
import type { MaterialRefs, SetService } from '@studyforge/domain/sets';
import { RouteError, lessonNodeId, type NativeLessonSource, type RouteService, type RouteValidators } from '@studyforge/domain/routes';
import type { PlanService } from '@studyforge/domain/plans';
import type { SkeletonAuthoring } from '@studyforge/domain/skeleton-authoring';
import { validateBookBreakdown, type BookExploration } from '@studyforge/domain/book-exploration';
import { nativeOpen } from './runtime/native-open.ts';
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller';
import { encodeSourceFragment } from '@studyforge/contracts/source-context';
import { validateLessonMaterials } from './materials/validate-lesson-materials.ts';
import { studentContext } from './learning-service.ts';
import { validateStudy } from './teaching/guided-learning.ts';

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
    study: async (ctx, study) => { validateStudy(host, ctx, study); },
    teachingRef: (_ctx, ref) => teachingConfigs.includes(ref) ? Promise.resolve() : Promise.reject(new RouteError('route_teaching_ref_missing', [ref])),
  };
}

/** Fallback title for a native session whose log carries no title event yet. */
const UNNAMED_LESSON = '未命名的一课';

/** A narrow code read, so a domain refusal can be classified without swallowing it. */
function codeOf(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * The route membership rule, exactly the workspace registry's own: a session is
 * a lesson of this workspace only when its header's canonical cwd *is* the
 * workspace path. A nested registered workspace inside this one is a different
 * workspace, so its lessons are foreign — a string-prefix check would wrongly
 * adopt them.
 */
function isWorkspacePath(root: string, headerCwd: string): boolean {
  try { return realpathSync(headerCwd) === root; }
  catch { return false; }
}

/** The native blank predicate: a session no turn ever started is the reusable empty one. */
function isBlankSession(events: readonly { readonly type: string }[]): boolean {
  return !events.some(event => event.type === 'turn/start');
}

/**
 * Whether one native session is the reusable empty/startup shell rather than a
 * lesson to draw. The course page's own list keeps a lesson once it is named or
 * an opening title landed, so "blank" only hides a session that is *also*
 * untitled: the planned-opened flow names its lesson, and a real lesson the
 * student opens gets a title too. Every other non-blank session is a lesson.
 */
function isBlankUntitled(
  blank: boolean,
  title: string | undefined,
): boolean {
  return blank && (title ?? '').trim().length === 0;
}

/**
 * A lesson this workspace really holds no teaching row for. Only these codes
 * mean "there is no row" — `record_corrupt`, persistence faults and every other
 * failure are real and must reach the caller instead of dissolving into an
 * apparently complete empty row.
 */
const COURSE_ROW_ABSENT = new Set(['record_missing', 'workspace_mismatch']);

interface NativeCourseFacts {
  readonly materials: LessonMaterials;
  readonly archived: boolean;
  readonly continuation?: { readonly ref: string; readonly version: number };
  readonly teachingRef?: string;
  readonly stance?: string;
}

/**
 * The lesson's own CourseMetadata — its real material list, archived flag,
 * teaching reference, stance and continuation pin. A workspace that genuinely
 * holds no row for this lesson answers the untouched shape; a row that exists but
 * cannot be read throws, so a corrupt or unreadable lesson never masquerades as
 * an empty, complete one.
 */
function nativeLessonCourse(host: Context, ctx: HostContext, sessionId: string): NativeCourseFacts {
  const own: HostContext = { workspaceId: ctx.workspaceId, sessionId, purpose: 'learning', actor: 'student' };
  try {
    const data = host.studyforgeCourseMetadata.read(own).data;
    return {
      materials: data.lessonMaterials, archived: data.archived,
      ...(data.continuation === undefined ? {} : { continuation: data.continuation }),
      ...(data.teachingRef === undefined ? {} : { teachingRef: data.teachingRef }),
      ...(data.stance === undefined ? {} : { stance: data.stance }),
    };
  } catch (error) {
    if (COURSE_ROW_ABSENT.has(codeOf(error) ?? '')) {
      return { materials: LessonMaterialsSchema.parse({ materials: [] }), archived: false };
    }
    throw error;
  }
}

/**
 * Read the workspace's own native lessons without writing anything, and derive
 * the one route node id a binding of each lesson would use.
 *
 * Membership is the workspace's own canonical directory plus the native header,
 * exactly the rule the workspace registry uses; a session of any other directory
 * — another workspace, or a nested registered workspace inside this one — is
 * `foreign`, and so is a subagent child. A lesson no turn ever started is the
 * reusable empty session, refused like the course page's own lesson list. The
 * title and creation time come from the native observation — the header's own
 * `createdAt`, never the route row's clock — and the material facts from that
 * lesson's CourseMetadata. A lesson whose facts cannot be read fails the read
 * instead of being dropped or defaulted.
 */
export function nativeLessons(host: Context): NativeLessonSource {
  const lesson = async (ctx: HostContext, sessionId: string): Promise<RouteNativeLesson | undefined> => {
    const observation = await host.sessionQuery.observeSession(SessionId(sessionId));
    try {
      const header = observation.header;
      if (header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0) return undefined;
      if (header.cwd === undefined) return undefined;
      const workspace = host.workspaceRegistry.get(ctx.workspaceId as never);
      if (workspace === undefined || !isWorkspacePath(workspace.path, header.cwd)) return undefined;
      const title = foldSessionTitle(observation.events)?.title;
      if (isBlankUntitled(isBlankSession(observation.events), title)) return undefined;
      const parent = header.parentSession;
      const parentSession = parent === undefined || parent === header.id ? undefined : parent;
      const course = nativeLessonCourse(host, ctx, header.id);
      return {
        sessionId: header.id, title: title ?? UNNAMED_LESSON,
        createdAt: new Date(header.createdAt).toISOString(),
        ...(parentSession === undefined ? {} : { parentSession }),
        materials: course.materials, archived: course.archived,
        ...(course.continuation === undefined ? {} : { continuation: course.continuation }),
        ...(course.teachingRef === undefined ? {} : { teachingRef: course.teachingRef }),
        ...(course.stance === undefined ? {} : { stance: course.stance }),
        nodeId: lessonNodeId(ctx.workspaceId, header.id),
      };
    } finally { observation[Symbol.dispose](); }
  };
  return {
    read: async (ctx, sessionId) => {
      let found: RouteNativeLesson | undefined;
      try { found = await lesson(ctx, sessionId); }
      catch (error) {
        // A session this runtime does not know is "not a lesson of this
        // workspace"; anything else (corruption, unreadable facts, persistence
        // faults) is a real failure and travels to the caller.
        if (codeOf(error) === 'SESSION_QUERY_SESSION_NOT_FOUND') return { foreign: true };
        throw error;
      }
      return found === undefined ? { foreign: true } : { foreign: false, lesson: found };
    },
    list: async ctx => {
      const workspace = host.workspaceRegistry.get(ctx.workspaceId as never);
      if (workspace === undefined) return [];
      const root = workspace.path;
      // The native Session list is the course page's own source: it carries the
      // blank predicate and the folded title the sidebar already shows, so a
      // startup/empty session never becomes a ghost lesson on the graph.
      const list = await host.sessionController.list({}, AbortSignal.timeout(30_000));
      const own = list.items.filter(item => {
        if (item.origin === 'subagent' || item.cwd === undefined || !isWorkspacePath(root, item.cwd)) return false;
        // The controller's cached projection is the native blank/title predicate
        // the course page's own list uses; a session with neither is the reusable
        // empty shell, not a lesson.
        return !isBlankUntitled(item.blank === true, item.projections?.values.title ?? undefined);
      });
      const decided = await Promise.all(own.map(item => lesson(ctx, item.sessionId).then(
        found => found === undefined ? [] : [found],
        // A lesson that is really listed but cannot be read must fail the graph,
        // never quietly vanish into an apparently complete one.
        error => { throw error; },
      )));
      return decided.flat();
    },
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

  /**
   * Every native lesson this workspace really has, read-only: the full-graph
   * source the course page draws. A browse writes nothing, and each row already
   * carries the route node id its explicit binding would use.
   */
  @Remote('routeLessons')
  async routeLessons(): Promise<RouteNativeLesson[]> {
    return [...await this.ctx.studyforgeRouteService.lessons(await this.context())];
  }

  /**
   * The explicit student action that puts one existing native lesson onto the
   * axis, in the same route row. A retry, a second tab and a restart answer the
   * one node; a lesson a planned node already opened adopts that binding. This
   * never creates or duplicates a session.
   */
  @Remote('bindNativeLesson')
  async bindNativeLesson(input: { operationId: string; nativeSessionId: string }): Promise<RouteView> {
    const parsed = z.object({ operationId: z.string().min(1), nativeSessionId: z.string().min(1) }).strict().parse(input);
    return this.ctx.studyforgeRouteService.bindNativeLesson(await this.mutation(undefined, parsed.operationId), parsed.nativeSessionId);
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
  async checkPlan(input: { sessionId?: string; plan: PlanContentDraft }): Promise<PlanContent> {
    const parsed = BoundSchema.extend({ plan: PlanContentSchema }).strict().parse(input);
    return this.ctx.studyforgePlanService.check(await this.context(parsed.sessionId), parsed.plan);
  }

  @Remote('createPlan')
  async createPlan(input: { operationId: string; sessionId?: string; plan: PlanContentDraft }): Promise<PlanView> {
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
  async breakdown(input: { operationId: string; intent: BookBreakdownIntent; sessionId?: string }): Promise<{ sessionId: string }> {
    const parsed = z.object({ operationId: z.string().min(1), intent: BookBreakdownIntentSchema, sessionId: z.string().min(1).optional() }).strict().parse(input);
    const context = await this.context(parsed.sessionId), structure = await this.ctx.studyforgeBookExploration.read(context, parsed.intent.material);
    const intent = validateBookBreakdown(structure, parsed.intent);
    // Lesson references carry coordinates; authored quotes stay in the frozen
    // task/selection below, rather than crossing the strict MaterialContext boundary.
    const materials = { materials: (intent.sources.length ? intent.sources : [intent.material]).map(({ materialId, versionId, locator }) => ({
      kind: 'source' as const, source: { materialId, versionId, ...(locator ? { locator } : {}) },
    })) };
    await validateLessonMaterials(this.ctx, context, materials);
    const opened = parsed.sessionId ? { sessionId: parsed.sessionId } : await nativeOpen(this.ctx).open(context, { openingKey: 'book-breakdown:' + parsed.operationId,
      title: structure.title + ' · 整理', materials,
      decl: { teachingRef: 'organize', stance: intent.nodePath ? `继续整理 ${intent.nodePath}；保持其他章节。` : '从书根开始整理下一层结构。' },
    });
    const verb = intent.action === 'cards' ? '拆成题卡，先核对已有卡片，保留原题的条件与设问，交给我确认' : '细分下一层目录，保留其他章节和卡片，交给我确认';
    const text = `请把《${structure.title}》${intent.nodePath ? `中的“${intent.nodePath}”` : '从书根开始'}${verb}。`;
    const fragment = encodeSourceFragment({ version: 1, bookTask: intent, objects: [],
      titles: [{ ref: intent.material.materialId, title: structure.title }],
      context: intent.sources.length ? { selection: { text: '', sources: intent.sources } } : { currentMaterial: { kind: 'source', source: intent.material } },
    });
    await this.ctx.sessionController.prompt({ sessionId: SessionId(opened.sessionId), requestId: parsed.operationId as SessionRequestId, mode: 'queue',
      content: [{ type: 'text', text: text + fragment }],
    }, AbortSignal.timeout(30_000));
    return { sessionId: opened.sessionId };
  }
}
