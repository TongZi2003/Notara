/**
 * The workspace knowledge map ("atlas") — the cross-book hierarchical
 * organization no single material owns, plus the writer and the mint port that
 * mirror the skeleton's own three pieces.
 *
 * Where a skeleton answers "where inside this one book", the atlas answers
 * "where inside the student's whole map". Three roles live here:
 *
 * - `AtlasService` is the read/check/merge side. An atlas node is a semantic
 *   bucket, not a reading claim: its `sources` may pin anchors of several
 *   books or none at all, so validation resolves every anchor that exists
 *   against the immutable bytes it pins without a single-book rule.
 * - `AtlasAuthoring` is the confirmed-change writer (preview + save). It owns
 *   the same change vocabulary as the skeleton — nodes/replaceExisting/
 *   removePaths/repath/detachDependents — and the same cascade, narrowed to
 *   what a map really depends on: card `topic` paths only (book plans belong
 *   to chapters, not topics). Repath and removal move or clear dependent
 *   topics atomically with the map row itself.
 * - `AtlasDeriver` is the {@link ChapterPlacement} port a card write uses.
 *   Because a topic is workspace-scoped there is no source-book ambiguity:
 *   any card — single-source, multi-source, or source-less — may claim a
 *   well-formed path it mints as an `outline` node in the same atomic unit,
 *   carrying the card's own verified sources as provenance. Anchored content
 *   mints structure; the map stays correctable through repath/remove.
 */
import type { HostContext, MutationContext, SourceAnchor } from '@studyforge/contracts';
import { CardRecordSchema } from '@studyforge/contracts/cards';
import {
  ATLAS_REF,
  ATLAS_SCOPE,
  AtlasChangeSchema,
  AtlasNodeSchema,
  AtlasNodesSchema,
  AtlasRecordSchema,
  AtlasViewSchema,
  type AtlasChange,
  type AtlasNode,
  type AtlasPreview,
  type AtlasView,
} from '@studyforge/contracts/atlas';
import { type MaterialResolver, resolveAnchor } from '../materials/read-material.ts';
import { RecordError, type PreparedRecordChange, type RecordStore, type Saved } from '../storage/record-store.ts';
import { beneath, changedChapter, type AtomicPublisher } from './skeleton-authoring.ts';
import type { ChapterClaim, ChapterPlacement } from '../cards/card-service.ts';

/** A refused atlas draft or save, with the exact rule that refused it. */
export class AtlasError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AtlasError';
  }
}

export class AtlasService {
  private readonly records: RecordStore<typeof AtlasRecordSchema>;
  private readonly materials: MaterialResolver;

  constructor(records: RecordStore<typeof AtlasRecordSchema>, materials: MaterialResolver) {
    this.records = records;
    this.materials = materials;
  }

  /** The whole workspace map; a map that was never written reads as empty. */
  async read(ctx: HostContext): Promise<AtlasView> {
    let saved: Saved<{ nodes: AtlasNode[] }> | undefined;
    try {
      saved = this.records.read(ctx, ATLAS_REF);
    } catch (error) {
      if (codeOf(error) !== 'record_missing') throw error;
    }
    if (saved === undefined) return AtlasViewSchema.parse({ nodes: [] });
    return AtlasViewSchema.parse({ revision: saved.version, nodes: saved.data.nodes });
  }

  /**
   * Check draft nodes against real bytes: every anchor a node actually carries
   * must resolve inside the immutable version it pins — in ANY book this
   * workspace holds, because map provenance is deliberately cross-book. Nodes
   * with no sources are legal: a topic level may exist by organization alone.
   * @throws AtlasError for a malformed draft and the material reader's own
   *   codes for an anchor that cannot really resolve.
   */
  async validate(ctx: HostContext, draft: unknown): Promise<AtlasNode[]> {
    const parsed = AtlasNodesSchema.safeParse(draft);
    if (!parsed.success) throw new AtlasError('atlas_draft_invalid', parsed.error.issues[0]?.message ?? '地图草稿不符合 schema');
    const nodes = [...parsed.data];
    const read = new Set<string>();
    for (const node of nodes) {
      for (const anchor of node.sources ?? []) {
        const key = anchorKey(anchor);
        if (read.has(key)) continue;
        await resolveAnchor(this.materials, ctx, anchor);
        read.add(key);
      }
    }
    return nodes;
  }

  /** Path-keyed merge, identical to the skeleton's: replace in place or append. */
  merge(existing: readonly AtlasNode[], incoming: readonly AtlasNode[]): { nodes: AtlasNode[] } {
    const nodes = parseMergeNodes(existing);
    const incomingParsed = parseMergeNodes(incoming);
    for (const node of incomingParsed) {
      const at = nodes.findIndex(item => item.path === node.path);
      if (at < 0) nodes.push(node);
      else nodes[at] = node;
    }
    return { nodes };
  }
}

/**
 * The confirmed-change writer for the workspace map. `preview` shows the
 * merged nodes plus the cards a repath/removal would move; `save` lands the
 * map row and every dependent card topic update in one atomic unit.
 */
export class AtlasAuthoring {
  private readonly atlas: RecordStore<typeof AtlasRecordSchema>;
  private readonly cards: RecordStore<typeof CardRecordSchema>;
  private readonly reader: AtlasService;
  private readonly publisher: AtomicPublisher;

  constructor(atlas: RecordStore<typeof AtlasRecordSchema>, cards: RecordStore<typeof CardRecordSchema>, reader: AtlasService, publisher: AtomicPublisher) {
    this.atlas = atlas;
    this.cards = cards;
    this.reader = reader;
    this.publisher = publisher;
  }

  async preview(ctx: HostContext, version: number, draft: unknown): Promise<AtlasPreview> {
    const change = AtlasChangeSchema.parse(draft);
    const before = version === 0 ? [] : this.atlas.read(ctx, ATLAS_REF, version).data.nodes;
    const mappings = [...change.repath.map(row => row.from), ...change.removePaths];
    for (let i = 0; i < mappings.length; i++) {
      if (!before.some(node => beneath(node.path, mappings[i]!))) throw new RecordError('atlas_path_missing');
      for (let j = 0; j < i; j++) if (beneath(mappings[i]!, mappings[j]!) || beneath(mappings[j]!, mappings[i]!)) throw new RecordError('atlas_overlapping_changes');
    }
    const removed = before.filter(node => change.removePaths.some(path => beneath(node.path, path)));
    const retained = before.filter(node => !removed.includes(node)).map(node => ({ ...node, path: remapPath(node.path, change) }));
    assertUniquePaths(retained);
    if (!change.replaceExisting) {
      for (const node of change.nodes) {
        const old = retained.find(existing => existing.path === node.path);
        if (old && JSON.stringify(old) !== JSON.stringify(node)) throw new RecordError('atlas_append_would_replace');
      }
    }
    const nodes = this.reader.merge(retained, change.nodes).nodes;
    await this.reader.validate(ctx, nodes);
    const affected = this.dependencies(ctx, change);
    return { nodes, impact: { cards: affected.cards.map(row => row.ref), removedPaths: removed.map(node => node.path) },
      requiresDetach: !change.detachDependents && affected.detached };
  }

  async save(ctx: MutationContext, draft: unknown): Promise<AtlasView> {
    if (typeof ctx.expectedVersion !== 'number') throw new RecordError('atlas_expected_version_required');
    const change = AtlasChangeSchema.parse(draft);
    const preview = await this.preview(ctx, ctx.expectedVersion, change);
    if (preview.requiresDetach) throw new RecordError('atlas_removal_has_dependents');
    const content = { nodes: preview.nodes };
    const atlas = ctx.expectedVersion === 0 ? this.atlas.prepareCreate(ctx, ATLAS_SCOPE, content)
      : this.atlas.prepareUpdate(ctx, ATLAS_REF, change, () => content);
    if (atlas.result.duplicate) {
      await this.publisher.atomic([atlas]);
      return { revision: atlas.result.version, nodes: atlas.result.data.nodes };
    }
    const affected = this.dependencies(ctx, change);
    const plans: PreparedRecordChange[] = [atlas];
    for (const row of affected.cards) {
      plans.push(this.cards.prepareUpdate({ ...ctx, operationId: `${ctx.operationId}:card:${row.ref}`, expectedVersion: row.version }, row.ref, change, old => {
        const { topic: _topic, ...rest } = old.content;
        const topic = changedChapter(old.content.topic!, change);
        return { ...old, content: { ...rest, ...(topic ? { topic } : {}) } };
      }));
    }
    await this.publisher.atomic(plans);
    return { revision: atlas.result.version, nodes: atlas.result.data.nodes };
  }

  /** The cards whose `topic` this change would move or clear; plans do not hold topics. */
  private dependencies(ctx: HostContext, change: AtlasChange) {
    const changes = (topic: string): boolean => changedChapter(topic, change) !== topic;
    const cards = this.cards.list(ctx).filter(row => row.data.content.topic && changes(row.data.content.topic));
    const detached = cards.some(row => changedChapter(row.data.content.topic!, change) === undefined);
    return { cards, detached };
  }
}

/**
 * The map side of card-claimed placement: when a card names a topic the map
 * does not have yet, the same atomic unit that lands the card also mints that
 * level as an `outline` node carrying the card's own verified sources as
 * provenance. Any card may claim a topic — a workspace path has no book
 * ambiguity — including multi-source and source-less cards.
 */
export class AtlasDeriver implements ChapterPlacement {
  private readonly records: RecordStore<typeof AtlasRecordSchema>;
  private readonly reader: AtlasService;
  private readonly publisher: AtomicPublisher;

  constructor(records: RecordStore<typeof AtlasRecordSchema>, reader: AtlasService, publisher: AtomicPublisher) {
    this.records = records;
    this.reader = reader;
    this.publisher = publisher;
  }

  /**
   * The atlas change the claims still need: one minted `outline` node per
   * missing level, folded into a single change so one atomic batch can never
   * carry two writes to the map row. A level that already exists contributes
   * nothing; nothing to mint contributes no change at all. The map key is
   * ignored — there is exactly one workspace map.
   */
  async plan(ctx: MutationContext, claims: ReadonlyMap<string, readonly ChapterClaim[]>): Promise<PreparedRecordChange[]> {
    const rows = [...claims.values()].flat();
    if (rows.length === 0) return [];
    const view = await this.reader.read(ctx);
    const mint = new Map<string, SourceAnchor[]>();
    for (const row of rows) {
      if (view.nodes.some(node => node.path === row.path)) continue;
      const list = mint.get(row.path) ?? [];
      for (const anchor of row.anchors) {
        if (!list.some(kept => anchorKey(kept) === anchorKey(anchor))) list.push(anchor);
      }
      mint.set(row.path, list);
    }
    if (mint.size === 0) return [];
    const added = [...mint].map(([path, sources]) => AtlasNodeSchema.parse({ path, ...(sources.length > 0 ? { sources } : {}), detail: 'outline' }));
    await this.reader.validate(ctx, added);
    const content = { nodes: this.reader.merge(view.nodes, added).nodes };
    const operationId = `${ctx.operationId}:atlas`;
    if (view.revision === undefined) {
      const { expectedVersion: _dropped, ...rest } = ctx;
      return [this.records.prepareCreate({ ...rest, operationId }, ATLAS_SCOPE, content)];
    }
    return [this.records.prepareUpdate({ ...ctx, operationId, expectedVersion: view.revision }, ATLAS_REF, content, () => content)];
  }

  /** One atomic unit covering the minted levels and the card changes themselves. */
  async atomic(changes: readonly PreparedRecordChange[]): Promise<void> {
    await this.publisher.atomic(changes);
  }
}

function remapPath(path: string, change: AtlasChange): string {
  return changedChapter(path, change) ?? path;
}

function anchorKey(anchor: SourceAnchor): string {
  return `${anchor.versionId}${anchor.quote ?? ''}${JSON.stringify(anchor.locator)}`;
}

function parseMergeNodes(input: unknown): AtlasNode[] {
  const parsed = AtlasNodesSchema.safeParse(input);
  if (!parsed.success) throw new AtlasError('atlas_nodes_invalid', parsed.error.issues[0]?.message ?? '地图节点不符合 schema');
  return [...parsed.data];
}

function assertUniquePaths(nodes: readonly AtlasNode[]): void {
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.path)) throw new RecordError('atlas_repath_conflict');
    seen.add(node.path);
  }
}

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const { code } = error as unknown as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}
