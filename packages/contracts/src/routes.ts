/**
 * P6.2 route contract (plan §P6.2, CONTRACTS.md §5).
 *
 * A route is the student's own course axis: planned nodes, the edge each one
 * hangs under, and what a lesson would start with. It is not the native session
 * lifecycle — a node gains a `session` binding only when the lesson really
 * opened, and the binding names the one native lesson this node opened.
 *
 * `materials` are teaching references (`LessonMaterials`), so a node may carry
 * a book section, a card, an image, several of them in order, or none at all;
 * "no material" is a planned direction, not an empty error. Nothing here is a
 * read allow-list or a mirror of open native tabs.
 *
 * `decl` freezes the teaching declaration a node was confirmed with (the
 * teaching-config reference and the short stance the student can read); it
 * inherits down the subtree and the nearest ancestor wins.
 */
import { z } from 'zod';
import { EntityRefSchema, SessionIdSchema, TimestampSchema } from './core.ts';
import { DaySchema } from './reviews.ts';
import { LessonMaterialsSchema } from './lesson-materials.ts';

/** A node's own declaration; every field is optional and inherits when absent. */
export const RouteDeclSchema = z.object({
  name: z.string().trim().min(1).optional(),
  /** A stable key of one teaching configuration; it selects the brief, never a native composition. */
  teachingRef: z.string().min(1).optional(),
  /** Short, student-readable goal / entry point / what to watch for. Never an answer or a full lesson plan. */
  stance: z.string().trim().min(1).optional(),
}).strict();
export type RouteDecl = z.infer<typeof RouteDeclSchema>;

/**
 * The frozen input one planned node opened with, written *before* the Host is
 * asked to create a native lesson. It exists so a retry after a crash — or a
 * Host that adopts the same id — reuses the exact title, materials and
 * declaration the lesson was really started from, instead of re-deriving them
 * from a row other edits may have moved on. `at` is the real opening time.
 */
export const RouteOpeningSchema = z.object({
  key: z.string().min(1),
  title: z.string().trim().min(1),
  materials: LessonMaterialsSchema,
  decl: RouteDeclSchema,
  at: TimestampSchema,
}).strict();
export type RouteOpening = z.infer<typeof RouteOpeningSchema>;

/** The native lesson one planned node opened; `openingKey` is the stable key that made it that one lesson. */
export const RouteSessionBindingSchema = z.object({
  sessionId: z.string().min(1),
  openingKey: z.string().min(1),
  openedAt: TimestampSchema,
}).strict();
export type RouteSessionBinding = z.infer<typeof RouteSessionBindingSchema>;

/** One planned node. `parent` names another node of this same route, never a foreign tree. */
export const RouteNodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  parent: z.string().min(1).optional(),
  materials: LessonMaterialsSchema.default({ materials: [] }),
  date: DaySchema.optional(),
  decl: RouteDeclSchema.optional(),
  opening: RouteOpeningSchema.optional(),
  session: RouteSessionBindingSchema.optional(),
}).strict();
export type RouteNode = z.infer<typeof RouteNodeSchema>;

/** A whole route as one native row: one atomic edit moves the axis, not a tree of files. */
/**
 * One student-placed coordinate on the roadmap. It is a view preference the
 * student really set, so it is stored: a node without an entry keeps the
 * automatic tree order, and placing a node never moves another one.
 *
 * The layout travels as an ordered **list**, never as a map keyed by node id:
 * the native tool schema subset has no `propertyNames`, so a dynamic-key object
 * would make the whole route unreadable to a model tool. The list is ordered by
 * the node order, which is what makes reading it back deterministic.
 */
export const RoutePositionSchema = z.object({
  nodeId: z.string().min(1),
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
}).strict();
export type RoutePosition = z.infer<typeof RoutePositionSchema>;

/** Every node the student really placed, in the route's own node order. */
export const RouteLayoutSchema = z.array(RoutePositionSchema);
export type RouteLayout = z.infer<typeof RouteLayoutSchema>;

/**
 * One entry of the narrow layout write: a real coordinate, or `null` to remove
 * that node's own placement so it falls back to the automatic order. Only the
 * nodes this caller names are touched — dragging one card can never rewrite
 * another's coordinate or its content.
 */
export const RoutePlacementEntrySchema = z.object({
  nodeId: z.string().min(1),
  position: z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() }).strict().nullable(),
}).strict();
export type RoutePlacementEntry = z.infer<typeof RoutePlacementEntrySchema>;
export const RoutePlacementSchema = z.array(RoutePlacementEntrySchema).min(1);
export type RoutePlacement = z.infer<typeof RoutePlacementSchema>;

export const RouteRecordSchema = z.object({
  nodes: z.array(RouteNodeSchema).default([]),
  /** Where the student really put each node; absent means the stored tree order. */
  layout: RouteLayoutSchema.default([]),
}).strict();
export type RouteRecord = z.infer<typeof RouteRecordSchema>;

/**
 * `version: 0` means this axis has never been written — an empty route, not an
 * empty record (CONTRACTS §5, the same convention as the optional course row).
 */
export const RouteViewSchema = z.object({
  ref: EntityRefSchema,
  version: z.number().int().nonnegative(),
  nodes: z.array(RouteNodeSchema),
  /** Always present: `[]` is "nobody placed anything yet", not a missing read. */
  layout: RouteLayoutSchema.default([]),
}).strict();
export type RouteView = z.infer<typeof RouteViewSchema>;

/** What adding one planned node needs; `parent` may be null for a new root. */
export const RouteNodeInputSchema = z.object({
  title: RouteNodeSchema.shape.title,
  parent: z.string().min(1).nullable().default(null),
  materials: LessonMaterialsSchema.default({ materials: [] }),
  date: DaySchema.nullable().default(null),
  decl: RouteDeclSchema.default({}),
}).strict();
export type RouteNodeInput = z.infer<typeof RouteNodeInputSchema>;
/**
 * What a caller really sends when planning a node: the output type fills "no
 * parent / no materials / no declaration", so the wire draft is the schema
 * *input*. A Remote boundary imports this instead of declaring its own DTO.
 */
export type RouteNodeInputDraft = z.input<typeof RouteNodeInputSchema>;

/**
 * One confirmed edit of a node. `parent` is deliberately absent: the edge has
 * its own entry point, so a material/declaration edit can never move a subtree
 * by accident. `null` clears an explicitly optional field.
 */
export const RouteNodePatchSchema = z.object({
  title: RouteNodeSchema.shape.title.optional(),
  materials: LessonMaterialsSchema.optional(),
  date: DaySchema.nullable().optional(),
  decl: RouteDeclSchema.nullable().optional(),
  reason: z.string().min(1).optional(),
}).strict();
export type RouteNodePatch = z.infer<typeof RouteNodePatchSchema>;
/** The wire draft of one node edit; `null` is the explicit clear form. */
export type RouteNodePatchDraft = z.input<typeof RouteNodePatchSchema>;

/**
 * What one confirmed opening answered: the native lesson, the node that now
 * carries its binding, and whether this call was the one that opened it.
 */
export interface RouteOpenResult {
  readonly sessionId: string;
  readonly node: RouteNode;
  readonly created: boolean;
}

/**
 * One native lesson of the acting workspace, as the course page draws it.
 *
 * A lesson summary is a *read*: it names a native session that really exists,
 * its own title and header creation time, the existing CourseMetadata material
 * list, and the route node id its explicit binding would use. It is not the
 * binding itself — nothing is written to the axis until the student binds it —
 * and it is never a member of the layout, so browsing the graph cannot move a
 * card or create a node.
 */
export const RouteNativeLessonSchema = z.object({
  sessionId: SessionIdSchema,
  title: z.string().trim().min(1),
  /** The native header's own creation time, never the route row's clock. */
  createdAt: TimestampSchema,
  /** The native lesson this one was forked from, when that parent is a real lesson of the same workspace. */
  parentSession: SessionIdSchema.optional(),
  /** What this lesson already carries as teaching material; `{ materials: [] }` means none. */
  materials: LessonMaterialsSchema,
  /** This lesson's own CourseMetadata archived flag; false when the row does not exist. */
  archived: z.boolean(),
  /** The route node id its binding uses/creates; stable for one workspace + native session. */
  nodeId: z.string().min(1),
  /** The handoff revision this lesson really continued from, when the confirmed close pinned one. */
  continuation: z.object({ ref: EntityRefSchema, version: z.number().int().positive() }).strict().optional(),
  /** The teaching configuration this lesson carried, when it has one. */
  teachingRef: z.string().min(1).optional(),
  /** The short student-facing stance this lesson carried, when it has one. */
  stance: z.string().min(1).optional(),
}).strict();
export type RouteNativeLesson = z.infer<typeof RouteNativeLessonSchema>;
