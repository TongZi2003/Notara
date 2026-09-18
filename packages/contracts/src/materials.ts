import { z } from 'zod';

/**
 * Source locators (CONTRACTS.md §4).
 *
 * Pure data schemas only: P1.2 does not resolve a locator to bytes. PDF pages
 * and text lines are 1-based; text columns and DOCX offsets are 0-based
 * UTF-16, end-exclusive. `rect` is a normalized [0,1] source-coordinate box
 * with positive area. Cross-page/cross-block selections split into several
 * anchors rather than one spanning locator.
 */

/** Normalized [x0,y0,x1,y1] box; both extents must be positive. */
export const NormalizedRectSchema = z
  .tuple([z.number().gte(0).lte(1), z.number().gte(0).lte(1), z.number().gte(0).lte(1), z.number().gte(0).lte(1)])
  .refine(([x0, y0, x1, y1]) => x1 - x0 > 0 && y1 - y0 > 0, {
    message: 'rect must have positive area within the unit square',
  });

export type NormalizedRect = z.infer<typeof NormalizedRectSchema>;

const PositivePageSchema = z.number().int().positive();
const LineNumberSchema = z.number().int().positive();
const ColumnOffsetSchema = z.number().int().nonnegative();

const TextPointSchema = z.object({ line: LineNumberSchema, column: ColumnOffsetSchema }).strict();
const DocxPointSchema = z.number().int().nonnegative();

export const PdfLocatorSchema = z.object({
  kind: z.literal('pdf'),
  page: PositivePageSchema,
  rect: NormalizedRectSchema.optional(),
}).strict();

export const ImageLocatorSchema = z.object({
  kind: z.literal('image'),
  rect: NormalizedRectSchema.optional(),
}).strict();

export const TextLocatorSchema = z.object({
  kind: z.literal('text'),
  start: TextPointSchema,
  end: TextPointSchema,
}).strict().refine(
  ({ start, end }) => start.line < end.line || (start.line === end.line && start.column < end.column),
  { message: 'text end must be strictly after start (line first, then UTF-16 column)', path: ['end'] },
);

export const DocxLocatorSchema = z.object({
  kind: z.literal('docx'),
  part: z.string().min(1),
  blockId: z.string().min(1),
  start: DocxPointSchema,
  end: DocxPointSchema,
}).strict().refine(({ start, end }) => end > start, {
  message: 'docx end must be strictly after start (UTF-16 offsets, end-exclusive)',
  path: ['end'],
});

/**
 * A text anchor inside one PDF page's extracted text layer. `start`/`end` are
 * UTF-16 offsets into the page's joined text items (newline-joined, the same
 * string read_material returns); both or neither. With no span the anchor
 * resolves through its `quote`: the quote must occur exactly once in the page
 * text, otherwise the anchor is ambiguous and refused.
 */
export const PdftextLocatorSchema = z.object({
  kind: z.literal('pdftext'),
  page: PositivePageSchema,
  start: ColumnOffsetSchema.optional(),
  end: ColumnOffsetSchema.optional(),
}).strict().refine(
  ({ start, end }) => (start === undefined) === (end === undefined) && (start === undefined || end! > start),
  { message: 'pdftext needs start<end together, or neither (quote-resolved)', path: ['end'] },
);

export const SourceLocatorSchema = z.discriminatedUnion('kind', [
  PdfLocatorSchema,
  PdftextLocatorSchema,
  ImageLocatorSchema,
  TextLocatorSchema,
  DocxLocatorSchema,
]);

export type SourceLocator = z.infer<typeof SourceLocatorSchema>;

/** Fixed source version; the locator pins the position inside that version. */
export const MaterialContextSchema = z.object({
  materialId: z.string().min(1),
  versionId: z.string().min(1),
  locator: SourceLocatorSchema.optional(),
}).strict();

export type MaterialContext = z.infer<typeof MaterialContextSchema>;

/** A material context that necessarily points at concrete source extent. */
export const SourceAnchorSchema = z.object({
  materialId: z.string().min(1),
  versionId: z.string().min(1),
  locator: SourceLocatorSchema,
  quote: z.string().min(1).optional(),
}).strict();

export type SourceAnchor = z.infer<typeof SourceAnchorSchema>;

/** Frozen text selection captured when the student sends a message. */
export const SelectionSnapshotSchema = z.object({
  text: z.string(),
  sources: z.array(SourceAnchorSchema).min(1),
}).strict();

export type SelectionSnapshot = z.infer<typeof SelectionSnapshotSchema>;

/**
 * A student message bound to a native submission/request identity; the
 * selection is frozen at send time (CONTRACTS.md §4). Echo/ack/queue/steer
 * belong to the native ui-conversation owner, not to this schema.
 */
export const LessonMaterialSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('source'), source: MaterialContextSchema }).strict(),
  z.object({ kind: z.literal('card'), cardRef: z.string().min(1), cardVersion: z.number().int().positive().optional() }).strict(),
]);
export type LessonMaterial = z.infer<typeof LessonMaterialSchema>;

export const MessageEnvelopeSchema = z.object({
  messageId: z.string().min(1),
  text: z.string(),
  context: z.object({
    selection: SelectionSnapshotSchema.optional(),
    currentMaterial: LessonMaterialSchema.optional(),
  }).strict(),
}).strict();
export type MessageEnvelope = z.infer<typeof MessageEnvelopeSchema>;
