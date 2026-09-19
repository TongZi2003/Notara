/**
 * P6.2 the route writer (plan §P6.2, CONTRACTS.md §5).
 *
 * A route is one native row: planned nodes with their parent edge, the ordered
 * teaching references a lesson would start from, an optional date and the
 * declaration the student confirmed. It is deliberately *not* a second session
 * lifecycle — a node only gains a `session` binding when the lesson really
 * opened, and that binding names the one native lesson its stable opening key
 * produced.
 *
 * Materials are `LessonMaterials`, so a node may hold a book section, a card,
 * an image, several of them in order, or none: "no material" is a planned
 * direction. `initialIndex` stays what the native preview opens first; nothing
 * here is a read allow-list or a mirror of open tabs. A route row never invents
 * a reference: the Host's own validators confirm every material and teaching
 * configuration before anything is stored.
 *
 * A declaration inherits down the subtree with the nearest ancestor winning per
 * field, so a fork can restate the stance without losing the teaching
 * reference it inherited.
 *
 * Concurrency is **node level**, never a whole-tree compare-and-swap. One
 * route is one persisted snapshot (a classroom axis is small and read whole),
 * but an edit or a move takes its baseline from the node's own authored fields
 * at the revision the caller read, compares only *that* node inside the store's
 * queued mechanical update, and rewrites one node while leaving the rest
 * untouched. Two different nodes edited from the same old read both land; the
 * same node edited twice from the same old baseline is refused; two
 * simultaneous moves that would close a cycle are checked against the current
 * parent chain, so the second one is refused instead of persisted.
 *
 * Opening a planned node freezes the exact input the lesson starts with
 * (`opening`: stable key, title, materials, effective declaration, real time)
 * *before* the Host is asked for a native session, and locks that node's
 * content edits while the opening is unresolved. A repeat open — a double
 * click, a second tab, a restart after the session was created but before the
 * binding landed — reuses that frozen snapshot, and the binding is written
 * mechanically against the current row, so an unrelated edit never drops the
 * session this node really opened. The freeze and the binding are two
 * mechanical records of the one Host opening, written under `<operation>:opening`
 * and `<operation>:bind`. What the domain cannot remove is the window between
 * the Host creating a native session and this row being written: the Host's
 * `NativeOpen` must adopt the same stable id for the same `openingKey`.
 *
 * A lesson that already exists gets onto the axis the other way round: browsing
 * reads the Host's read-only {@link NativeLessonSource} and writes nothing, and
 * the explicit student action binds it through {@link RouteService.bindNativeLesson}
 * under a session-derived node id in this same row. That path never asks the
 * Host for a session, so it cannot invent one.
 */
import { createHash } from 'node:crypto';
import { MutationContextSchema } from '@studyforge/contracts';
import { RouteNativeLessonSchema, RouteNodeInputSchema, RouteNodePatchSchema, RouteNodeSchema, RouteOpeningSchema, RoutePlacementSchema, RouteSessionBindingSchema, RouteViewSchema } from '@studyforge/contracts/routes';
import type { HostContext, LessonMaterials, MutationContext } from '@studyforge/contracts';
import type { RouteNativeLesson, RouteDecl, RouteLayout, RouteNode, RouteNodePatch, RouteOpening, RoutePlacementEntry, RoutePosition, RouteRecord, RouteSessionBinding, RouteView } from '@studyforge/contracts/routes';
import type { Clock } from '../clock.ts';
import type { LearningContext } from '@studyforge/contracts/courses';
import { RecordError, type Saved } from '../storage/record-store.ts';

/** The record kind the course axis lives under, and the single row inside it. */
export const ROUTE_KIND = 'route';
export const ROUTE_ID = 'tree';
export const ROUTE_REF = `${ROUTE_KIND}:${ROUTE_ID}`;

/** The record surface this service needs; one native `RecordStore` satisfies it. */
export interface RouteRecordStore {
  readonly workspaceId: string;
  read(ctx: HostContext, ref: string, revision?: number): Saved<RouteRecord>;
  create(ctx: MutationContext, id: string, input: unknown): Promise<Saved<RouteRecord>>;
  updateCurrent(ctx: Omit<MutationContext, 'expectedVersion'>, ref: string, input: unknown, transform: (current: RouteRecord) => unknown): Promise<Saved<RouteRecord>>;
}

/**
 * The Host's own reference validators. A route may only freeze a teaching
 * reference and a material list the workspace really holds; the domain never
 * proves a card/version exists by itself.
 */
export interface RouteValidators {
  materials(ctx: HostContext, materials: LessonMaterials): Promise<void>;
  teachingRef(ctx: HostContext, ref: string): Promise<void>;
  study?(ctx: HostContext, context: LearningContext): Promise<void>;
}

/**
 * The Host's native-session side. It is handed the frozen payload the lesson
 * starts with and the stable key of this planned node; the same key must always
 * answer the same native lesson (native explicit-id adoption), or a retry after
 * a crash opens a second one. `openedAt` is the lesson's own real time — the
 * native header's creation time — never this row's clock on the retry.
 */
export interface NativeOpen {
  open(ctx: HostContext, request: {
    readonly openingKey: string;
    readonly title: string;
    readonly materials: LessonMaterials;
    readonly decl: RouteDecl;
    readonly study?: LearningContext;
  }): Promise<{ readonly sessionId: string; readonly openedAt: string }>;
}

/**
 * The Host's native lesson side, read only. A lesson that already exists is
 * bound onto the axis by reading it, never by starting a session: this port has
 * no creation method at all, so `bindNativeLesson` cannot open a second lesson.
 *
 * `foreign` is `true` for a live or persisted native session that is *not*
 * attached to the acting workspace (or is a subagent child); the domain refuses
 * that instead of persisting a node this workspace cannot support, and the list
 * simply leaves it out.
 */
export interface NativeLessonSource {
  read(ctx: HostContext, sessionId: string): Promise<NativeLessonRead>;
  /** The workspace's own ordinary lessons: attached, non-subagent, not archived, newest-first. */
  list(ctx: HostContext): Promise<readonly RouteNativeLesson[]>;
}

export type NativeLessonRead =
  | { readonly foreign: true }
  | { readonly foreign: false; readonly lesson: RouteNativeLesson };

/**
 * The route node id one native lesson binds under. It is a pure function of the
 * workspace and the native session, so a retry, a second tab or a restart binds
 * the same one node; the `l_` namespace can never collide with a planned node's
 * `p_` id, because no operation hash starts with the literal `l_`.
 */
export function lessonNodeId(workspaceId: string, sessionId: string): string {
  return 'l_' + createHash('sha256').update(JSON.stringify([workspaceId, sessionId])).digest('hex').slice(0, 16);
}

/** A refused route write, with the exact rule that refused it. */
export class RouteError extends Error {
  readonly code: string;
  readonly problems: readonly string[];
  /**
   * The Remote carrier folds a thrown domain error into one generic failure, so
   * the code has to travel *inside* the message for the client to branch on it;
   * the problems stay readable right after it.
   */
  constructor(code: string, problems: readonly string[] = []) {
    super(problems.length === 0 ? code : `${code}: ${problems.join('; ')}`);
    this.code = code;
    this.problems = problems;
    this.name = 'RouteError';
  }
}

export class RouteService {
  private readonly records: RouteRecordStore;
  private readonly native: NativeOpen;
  private readonly nativeLessons: NativeLessonSource;
  private readonly clock: Clock;
  private readonly validators: RouteValidators;

  constructor(records: RouteRecordStore, native: NativeOpen, clock: Clock, validators: RouteValidators, nativeLessons: NativeLessonSource) {
    this.records = records;
    this.native = native;
    this.nativeLessons = nativeLessons;
    this.clock = clock;
    this.validators = validators;
  }

  /** A route nobody wrote yet reads as an empty axis, not as an error and not as a created row. */
  read(ctx: HostContext): RouteView {
    try {
      return this.viewOf(this.records.read(ctx, ROUTE_REF));
    } catch (error) {
      if (codeOf(error) !== 'record_missing') throw error;
      return RouteViewSchema.parse({ ref: ROUTE_REF, version: 0, nodes: [], layout: [] });
    }
  }

  /** One node by id; `route_node_missing` instead of an empty shell. */
  node(view: RouteView, nodeId: string): RouteNode {
    return findNode(view.nodes, nodeId);
  }

  /** The declaration a lesson would really start with: root → node, nearest ancestor wins per field. */
  effectiveDecl(view: RouteView, nodeId: string): RouteDecl {
    return declOf(view.nodes, nodeId);
  }

  /** The stable key one planned node opens under; renaming the node never changes it. */
  openingKeyOf(nodeId: string): string {
    return 'open_' + createHash('sha256').update(`${ROUTE_KIND}:${nodeId}`).digest('hex').slice(0, 24);
  }

  /**
   * Plan one new node. Its id is derived from the accepted operation, so a
   * retry plans one lesson; a parent that does not exist and a material or
   * teaching reference the workspace does not really hold are refused. Adding
   * is an append, so it is never blocked by an unrelated concurrent edit.
   */
  createdNodeId(ctx: MutationContext): string {
    return 'p_' + createHash('sha256').update(`${ctx.workspaceId}:${ctx.operationId}`).digest('hex').slice(0, 16);
  }
  async add(ctx: MutationContext, input: unknown): Promise<RouteView> {
    MutationContextSchema.parse(ctx);
    const parsed = RouteNodeInputSchema.parse(input);
    await this.validate(ctx, parsed.materials, parsed.decl);
    if (parsed.study) await this.validators.study?.(ctx, parsed.study);
    const id = this.createdNodeId(ctx);
    const node: RouteNode = {
      id, title: parsed.title, materials: parsed.materials,
      ...(parsed.parent === null ? {} : { parent: parsed.parent }),
      ...(parsed.date === null ? {} : { date: parsed.date }),
      ...(Object.keys(parsed.decl).length === 0 ? {} : { decl: parsed.decl }),
      ...(parsed.study ? { study: parsed.study } : {}),
    };
    // The node id is a pure function of the accepted operation, so a retry must
    // be answered by the store's own operation replay — never by a shortcut that
    // skips the fingerprint. The same input therefore travels as the operation's
    // payload on both the creating and the replaying call.
    const payload: RouteRecord = { nodes: [node], layout: [] };
    const append = (row: RouteRecord): RouteRecord => {
      // Reaching here means this operation is new: an id already in the tree
      // belongs to another operation, and silently adopting it would fabricate
      // an effect this caller never asked for.
      if (row.nodes.some(item => item.id === id)) throw new RouteError('route_node_conflict', [id]);
      assertParent(row.nodes, id, node.parent);
      // The layout rides along unchanged: a node edit is never a reason to lose
      // where the student really put the others.
      return { ...row, nodes: [...row.nodes, node] };
    };
    if (this.optional(ctx) === undefined) {
      // The very first node of an empty axis has no parent to hang under.
      assertParent([], id, node.parent);
      try { return this.viewOf(await this.records.create(subContext(ctx, 'write'), ROUTE_ID, payload)); }
      catch (error) {
        // Another tab may have created the empty axis after our read. Continue
        // against that row, just as a normal append would, instead of exposing
        // the storage-level record_exists race to the caller.
        if (codeOf(error) !== 'record_exists') throw error;
      }
    }
    return this.mechanical(ctx, payload, append);
  }

  /**
   * Apply one confirmed edit to a planned node. Omitted fields keep what the
   * student saw; `date: null` and `decl: null` are the explicit "clear" forms.
   * The parent edge is not part of a content edit — {@link mount} owns it — and
   * a node whose opening is unresolved is locked until the lesson binds.
   *
   * `expectedVersion` is the route revision this edit was read from; the
   * *control* is this node's authored fields at that revision, so another
   * node's edit never blocks it and the same node's authored change does.
   * @throws RouteError `route_node_conflict` for a stale node baseline and
   *   `route_opening_pending` while this node is opening.
   */
  async edit(ctx: MutationContext, nodeId: string, patch: unknown): Promise<RouteView> {
    MutationContextSchema.parse(ctx);
    const base = this.baseline(ctx, nodeId);
    const change = RouteNodePatchSchema.parse(patch);
    if (change.materials !== undefined) await this.validators.materials(ctx, change.materials);
    if (change.decl !== undefined && change.decl !== null && change.decl.teachingRef !== undefined) {
      await this.validators.teachingRef(ctx, change.decl.teachingRef);
    }
    return this.mechanical(ctx, { nodeId, patch: change, baseline: base }, row => {
      const at = findNode(row.nodes, nodeId);
      // While the opening is unresolved the frozen input is what the lesson is
      // starting from: this node may not be edited out from under it.
      if (at.opening !== undefined && at.session === undefined) throw new RouteError('route_opening_pending', [nodeId]);
      if (authored(at) !== base) throw new RouteError('route_node_conflict', [nodeId]);
      return { ...row, nodes: row.nodes.map(node => node.id === nodeId ? replaceNode(node, change) : node) };
    });
  }

  /**
   * Move one node under another, or detach it with `parent: null`. The move is
   * checked against the *current* parent chain, so two moves that would close a
   * cycle cannot both persist.
   * @throws RouteError `route_parent_missing` for an unknown parent,
   *   `route_cycle` when the move would put a node under itself, and
   *   `route_node_conflict` for a stale node baseline.
   */
  async mount(ctx: MutationContext, nodeId: string, parent: string | null): Promise<RouteView> {
    MutationContextSchema.parse(ctx);
    const base = this.baseline(ctx, nodeId);
    return this.mechanical(ctx, { nodeId, parent, baseline: base }, row => {
      const at = findNode(row.nodes, nodeId);
      if (authored(at) !== base) throw new RouteError('route_node_conflict', [nodeId]);
      assertParent(row.nodes, nodeId, parent ?? undefined);
      return { ...row, nodes: row.nodes.map(node => node.id === nodeId ? mountNode(node, parent ?? undefined) : node) };
    });
  }

  /**
   * Place the nodes the student really dragged, or clear one node's own
   * placement with `null`. This is the narrow layout writer: it merges only the
   * named coordinates into the stored layout, refuses a node this route does not
   * have, and touches no node's authored content. Two drags of two different
   * nodes from the same read both land; dragging one card never rewrites
   * another's coordinate or the parent edge.
   *
   * It deliberately takes no `expectedVersion`: a placement is a merge against
   * the current row, validated against the current node set, so an unrelated
   * edit never blocks moving a card on the canvas.
   * @throws RouteError `route_node_missing` for an id this route does not hold.
   */
  async place(ctx: MutationContext, positions: unknown): Promise<RouteView> {
    MutationContextSchema.parse(ctx);
    const parsed = RoutePlacementSchema.parse(positions);
    const known = this.optional(ctx)?.data.nodes ?? [];
    for (const entry of parsed) if (!known.some(node => node.id === entry.nodeId)) throw new RouteError('route_node_missing', [entry.nodeId]);
    return this.mechanical(ctx, { placements: parsed }, row => ({ ...row, layout: mergedLayout(row, parsed) }));
  }

  /**
   * Open the native lesson one planned node owns, once. The opening input is
   * frozen before the Host is asked, so a retry reuses the same real material
   * list and declaration, and the binding is written mechanically against the
   * current row.
   * @returns the bound session and whether this call was the one that created it.
   * @throws RouteError `route_node_missing`; the Host's own codes when creating
   *   a lesson fails.
   */
  async openPlanned(ctx: MutationContext, nodeId: string): Promise<{ readonly sessionId: string; readonly node: RouteNode; readonly created: boolean }> {
    MutationContextSchema.parse(ctx);
    const current = this.records.read(ctx, ROUTE_REF);
    let node = findNode(current.data.nodes, nodeId);
    // Already bound: the student may double-click, the second tab may race, the
    // app may restart — the lesson that exists is the answer, no new session.
    if (node.session !== undefined) return { sessionId: node.session.sessionId, node, created: false };

    // Freeze the exact input this lesson starts with before asking the Host, so
    // a retry after a crash adopts the same session instead of re-deriving from
    // a row other edits may have moved on.
    if (node.opening === undefined) {
      const frozen = await this.records.updateCurrent(subContext(ctx, 'opening'), ROUTE_REF, { opening: nodeId }, row => {
        const at = findNode(row.nodes, nodeId);
        if (at.session !== undefined || at.opening !== undefined) return row;
        const study = studyOf(row.nodes, nodeId);
        const snapshot = RouteOpeningSchema.parse({
          key: this.openingKeyOf(nodeId), title: at.title, materials: at.materials,
          decl: declOf(row.nodes, nodeId), at: this.clock.now(),
          ...(study ? { study } : {}),
        });
        return { ...row, nodes: row.nodes.map(item => item.id === nodeId ? withOpening(item, snapshot) : item) };
      });
      node = findNode(frozen.data.nodes, nodeId);
      if (node.session !== undefined) return { sessionId: node.session.sessionId, node, created: false };
    }

    const opening = node.opening;
    if (opening === undefined) throw new RouteError('route_opening_missing', [nodeId]);
    const opened = await this.native.open(ctx, {
      openingKey: opening.key, title: opening.title, materials: opening.materials, decl: opening.decl,
      ...(opening.study ? { study: { ...opening.study, nodeId } } : {}),
    });
    // The binding keeps the lesson's own real time, so a retry after a crash
    // records when the lesson really started, not when the retry ran.
    const binding = RouteSessionBindingSchema.parse({ sessionId: opened.sessionId, openingKey: opening.key, openedAt: opened.openedAt });
    // The write itself is the once-only gate and only checks *this* node: if
    // another open landed first its binding stays, and an edit to a different
    // node in between never invalidates this binding.
    const saved = await this.records.updateCurrent(subContext(ctx, 'bind'), ROUTE_REF, { open: nodeId, sessionId: opened.sessionId }, row => {
      const at = findNode(row.nodes, nodeId);
      if (at.session !== undefined) return row;
      return { ...row, nodes: row.nodes.map(item => item.id === nodeId ? bindNode(item, binding) : item) };
    });
    const bound = findNode(saved.data.nodes, nodeId);
    if (bound.session === undefined) throw new RouteError('route_binding_missing', [nodeId]);
    return { sessionId: bound.session.sessionId, node: bound, created: bound.session.sessionId === opened.sessionId };
  }

  /**
   * Bind one native lesson that already exists onto this axis, in this one row.
   *
   * This is the explicit student action ("把这一节挪上课程路线"); browsing calls
   * `lessons` and writes nothing. The lesson's title, creation time and
   * material list are read from the native session and its own CourseMetadata —
   * the caller supplies only the operation and the native id, and this never
   * starts a session, so it cannot manufacture a lesson that is not there.
   *
   * The node id is a pure function of the workspace and the session, so a retry,
   * an accepted-operation replay, a second tab and a restart all answer the one
   * node. A lesson that was planned first (`openPlanned`) already holds a session
   * binding without a lesson-node id: binding the same session then adopts that
   * node instead of adding a duplicate leaf.
   *
   * A *new* node inherits its native lineage: when the lesson's `parentSession`
   * already has a route node, the child lands under it in the same write. An
   * already bound node is answered untouched, so an explicit later mount (the
   * student dragging the child to the root, say) is never overwritten.
   *
   * @throws RouteError `route_native_session_foreign` for a session that is not
   *   attached to the acting workspace, `route_native_session_unavailable` for a
   *   subagent child or a lesson this workspace cannot read.
   */
  async bindNativeLesson(ctx: MutationContext, sessionId: string): Promise<RouteView> {
    MutationContextSchema.parse(ctx);
    try { return await this.bindNativeLessonOnce(ctx, sessionId); }
    catch (error) {
      // Another tab created the axis between this read and this write, under its
      // own operation. The row now exists: re-read and let that one answer the
      // node it wrote, or append against it when it wrote something else.
      if (codeOf(error) !== 'record_exists') throw error;
      return this.bindNativeLessonOnce(ctx, sessionId);
    }
  }

  private async bindNativeLessonOnce(ctx: MutationContext, sessionId: string): Promise<RouteView> {
    const nodeId = lessonNodeId(ctx.workspaceId, sessionId);
    const current = this.optional(ctx);
    // Already on the axis: a retry from another tab, and the lesson a planned
    // node already opened, both answer the node that really carries the binding.
    const existing = current?.data.nodes.find(node => node.session?.sessionId === sessionId);
    if (existing !== undefined && current !== undefined) return this.viewOf(current);

    const read = await this.nativeLessons.read(ctx, sessionId);
    if (read.foreign) throw new RouteError('route_native_session_foreign', [sessionId]);
    const lesson = read.lesson;
    if (lesson.sessionId !== sessionId) throw new RouteError('route_native_session_unavailable', [sessionId]);

    const session = RouteSessionBindingSchema.parse({ sessionId, openingKey: this.openingKeyOf(nodeId), openedAt: lesson.createdAt });
    /**
     * The one edge this write may introduce is the lesson's own native lineage,
     * and only when that parent *already* has a route node: dragging a child in
     * after its parent preserves the relation instead of dropping it at the root,
     * and the recursive UI bind (parent first) is what makes that true. A parent
     * nobody bound yet leaves the child at the root. This runs inside the same
     * create transform, so it is never a second mount, and it never touches a
     * node that already carries a binding (the replay path returns before here),
     * so a student's explicit root mount is never overwritten.
     */
    const nodeFor = (row: RouteRecord): RouteNode => {
      const parentSession = lesson.parentSession;
      const inherited = parentSession === undefined ? undefined
        : row.nodes.find(item => item.session?.sessionId === parentSession)?.id;
      return RouteNodeSchema.parse({
        id: nodeId, title: lesson.title, materials: lesson.materials, session,
        ...(inherited === undefined ? {} : { parent: inherited }),
      });
    };
    // A workspace that never wrote a route row is not an error and not a row to
    // adopt: this lesson is the axis' first node, created under the operation's
    // own mechanical record so a retry replays it instead of colliding.
    if (current === undefined) {
      const node = nodeFor({ nodes: [], layout: [] });
      return this.viewOf(await this.records.create(subContext(ctx, 'write'), ROUTE_ID, { nodes: [node], layout: [] }));
    }
    // Reaching the transform means this operation is new: the node id is
    // session-derived, so a *different* operation arriving for the same lesson
    // adopts the binding another operation already wrote instead of colliding.
    return this.viewOf(await this.records.updateCurrent(subContext(ctx, 'write'), ROUTE_REF, { bindNative: sessionId }, row => {
      if (row.nodes.some(item => item.session?.sessionId === sessionId)) return row;
      if (row.nodes.some(item => item.id === nodeId)) throw new RouteError('route_node_conflict', [nodeId]);
      return { ...row, nodes: [...row.nodes, nodeFor(row)] };
    }));
  }

  /**
   * Every native lesson this workspace really has, read-only, in the route's own
   * node order when a binding exists and newest-first otherwise. A browse never
   * writes: this call only reads the row and asks the Host for the workspace's
   * own lessons.
   */
  async lessons(ctx: HostContext): Promise<readonly RouteNativeLesson[]> {
    // The Host owns the native side; this boundary only re-asserts the shape the
    // course page can rely on, so a malformed row fails here rather than in UI.
    return (await this.nativeLessons.list(ctx)).map(lesson => RouteNativeLessonSchema.parse(lesson));
  }

  /** The Host's validators, run before anything is stored. */
  private async validate(ctx: HostContext, materials: LessonMaterials, decl: RouteDecl): Promise<void> {
    await this.validators.materials(ctx, materials);
    if (decl.teachingRef !== undefined) await this.validators.teachingRef(ctx, decl.teachingRef);
  }

  /**
   * This node's own baseline, taken from the revision the caller read. A node
   * that no longer exists there is refused before any write.
   */
  private baseline(ctx: MutationContext, nodeId: string): string {
    if (ctx.expectedVersion === undefined) throw new RouteError('route_expected_version_required');
    if (typeof ctx.expectedVersion !== 'number') throw new RecordError('version_conflict');
    const at = this.records.read(ctx, ROUTE_REF, ctx.expectedVersion);
    return authored(findNode(at.data.nodes, nodeId));
  }

  /**
   * One mechanical node write per accepted operation, queued against the current
   * row. The store runs the operation replay first, so a retry answers the
   * revision that operation really wrote and a changed input is refused instead
   * of quietly succeeding.
   */
  private async mechanical(ctx: MutationContext, input: unknown, transform: (row: RouteRecord) => RouteRecord): Promise<RouteView> {
    if (this.optional(ctx) === undefined) throw new RecordError('record_missing');
    return this.viewOf(await this.records.updateCurrent(subContext(ctx, 'write'), ROUTE_REF, input, row => transform(row)));
  }

  private viewOf(saved: Saved<RouteRecord>): RouteView {
    return RouteViewSchema.parse({ ref: saved.ref, version: saved.version, nodes: saved.data.nodes, layout: orderedLayout(saved.data.nodes, saved.data.layout) });
  }

  private optional(ctx: HostContext): Saved<RouteRecord> | undefined {
    try { return this.records.read(ctx, ROUTE_REF); }
    catch (error) { if (codeOf(error) === 'record_missing') return undefined; throw error; }
  }
}

function findNode(nodes: readonly RouteNode[], nodeId: string): RouteNode {
  const node = nodes.find(item => item.id === nodeId);
  if (node === undefined) throw new RouteError('route_node_missing', [nodeId]);
  return node;
}

/**
 * The fields a student really authored. Everything mechanical (`opening`, the
 * native `session` binding) is left out so a concurrent open never blocks an
 * edit of unrelated content.
 */
function authored(node: RouteNode): string {
  return JSON.stringify({
    title: node.title, materials: node.materials,
    date: node.date ?? null, decl: node.decl ?? null, parent: node.parent ?? null,
  });
}

/**
 * The student's own placements, merged with one narrow layout write. `null`
 * removes that node's entry, so "put this one back in order" is a real edit
 * instead of a coordinate that merely looks automatic.
 */
function mergedLayout(row: RouteRecord, placements: readonly RoutePlacementEntry[]): RouteLayout {
  const next = new Map(row.layout.map(entry => [entry.nodeId, entry] as const));
  for (const entry of placements) {
    if (entry.position === null) next.delete(entry.nodeId);
    else next.set(entry.nodeId, { nodeId: entry.nodeId, x: entry.position.x, y: entry.position.y });
  }
  return orderedLayout(row.nodes, [...next.values()]);
}

/**
 * The layout in the route's own node order, with entries for nodes this route
 * no longer holds dropped: a placement is only meaningful while its node is.
 */
function orderedLayout(nodes: readonly RouteNode[], layout: readonly RoutePosition[]): RouteLayout {
  const byId = new Map(layout.map(entry => [entry.nodeId, entry] as const));
  return nodes.flatMap(node => { const at = byId.get(node.id); return at === undefined ? [] : [at]; });
}

/** The declaration root → node, nearest ancestor winning per field. */
function declOf(nodes: readonly RouteNode[], nodeId: string): RouteDecl {
  const chain: RouteNode[] = [];
  let at: string | undefined = findNode(nodes, nodeId).id;
  const seen = new Set<string>();
  while (at !== undefined) {
    if (seen.has(at)) throw new RouteError('route_cycle', [at]);
    seen.add(at);
    const node = findNode(nodes, at);
    chain.unshift(node);
    at = node.parent;
  }
  const decl: RouteDecl = {};
  for (const node of chain) if (node.decl !== undefined) Object.assign(decl, node.decl);
  return decl;
}

/** A parent must exist in this same tree, and the edge may not close a cycle. */
function assertParent(nodes: readonly RouteNode[], nodeId: string, parent: string | undefined): void {
  if (parent === undefined) return;
  if (!nodes.some(node => node.id === parent)) throw new RouteError('route_parent_missing', [parent]);
  const seen = new Set<string>([nodeId]);
  let at: string | undefined = parent;
  while (at !== undefined) {
    if (seen.has(at)) throw new RouteError('route_cycle', [at]);
    seen.add(at);
    at = nodes.find(node => node.id === at)?.parent;
  }
}

/** One confirmed content edit: omitted fields keep their stored value, `null` removes the key entirely. */
function replaceNode(node: RouteNode, change: RouteNodePatch): RouteNode {
  return buildNode(node, {
    title: change.title ?? node.title,
    materials: change.materials ?? node.materials,
    date: change.date === undefined ? node.date : change.date ?? undefined,
    decl: change.decl === undefined ? node.decl : change.decl ?? undefined,
  });
}

/** One edge move; a detached node simply has no parent key. */
function mountNode(node: RouteNode, parent: string | undefined): RouteNode {
  return buildNode(node, { parent });
}

/** The frozen opening snapshot, kept exactly as the lesson was started with. */
function withOpening(node: RouteNode, opening: RouteOpening): RouteNode {
  return buildNode(node, { opening });
}

/** The bound lesson: `opening` is cleared because the native session now *is* the record. */
function bindNode(node: RouteNode, session: RouteSessionBinding): RouteNode {
  return buildNode(node, { session, clearOpening: true });
}

/**
 * Rebuild one node from a base plus the keys it carries. A key set to
 * `undefined` removes it, so `date: null` / `decl: null` really drop the field
 * instead of leaving an `undefined` that a later JSON round-trip would hide.
 */
function buildNode(node: RouteNode, patch: {
  readonly title?: string;
  readonly parent?: string | undefined;
  readonly materials?: LessonMaterials;
  readonly date?: string | undefined;
  readonly decl?: RouteDecl | undefined;
  readonly opening?: RouteOpening;
  readonly session?: RouteSessionBinding;
  readonly clearOpening?: boolean;
}): RouteNode {
  const next: Record<string, unknown> = {
    id: node.id,
    title: patch.title ?? node.title,
    materials: patch.materials ?? node.materials,
  };
  const parent = 'parent' in patch ? patch.parent : node.parent;
  const date = 'date' in patch ? patch.date : node.date;
  const decl = 'decl' in patch ? patch.decl : node.decl;
  const opening = patch.clearOpening === true ? undefined : patch.opening ?? node.opening;
  const session = 'session' in patch ? patch.session : node.session;
  if (parent !== undefined) next['parent'] = parent;
  if (date !== undefined) next['date'] = date;
  if (decl !== undefined) next['decl'] = decl;
  if (opening !== undefined) next['opening'] = opening;
  if (session !== undefined) next['session'] = session;
  if (node.study !== undefined) next['study'] = node.study;
  return RouteNodeSchema.parse(next);
}

/**
 * The mechanical sub-context of one Host operation. A single opening legitimately
 * writes two rows (the frozen input, then the binding); each is its own record
 * operation so a retry replays both instead of colliding on one fingerprint.
 */
function subContext(ctx: MutationContext, suffix: string): Omit<MutationContext, 'expectedVersion'> {
  const { expectedVersion: _ignored, ...rest } = ctx;
  const parsed = MutationContextSchema.parse({ ...rest, operationId: `${ctx.operationId}:${suffix}` });
  const { expectedVersion: _none, ...without } = parsed;
  return without;
}

export function studyOf(nodes: readonly RouteNode[], nodeId: string): LearningContext | undefined {
  const seen = new Set<string>();
  let node = nodes.find(item => item.id === nodeId);
  while (node && !seen.has(node.id)) {
    if (node.study) return node.study;
    seen.add(node.id);
    node = nodes.find(item => item.id === node!.parent);
  }
  return undefined;
}

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const { code } = error as unknown as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}
