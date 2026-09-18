/**
 * The skeleton side of card-claimed placement (the write half of "anchored
 * content mints structure"). When a card names a chapter its one source book
 * does not have yet, the same atomic unit that lands the card also mints the
 * level it claims: an `outline` node anchored to the card's own verified
 * sources, because a real anchored card is itself proof that level exists.
 *
 * This only ever grows `outline` nodes for paths a write already declared; the
 * explicit skeleton proposal still owns every richer shape — repath, removal,
 * `refined` detail, and the cascade that re-binds dependents. A minted level
 * is a placement hypothesis a later split or repath can correct; it is never a
 * claim that the whole section was read.
 */
import type { MutationContext, SourceAnchor } from '@studyforge/contracts';
import { SkeletonNodeSchema, SkeletonRecordSchema } from '@studyforge/contracts/skeleton';
import type { SkeletonService } from '../materials/skeleton-service.ts';
import type { PreparedRecordChange, RecordStore } from '../storage/record-store.ts';
import type { AtomicPublisher } from './skeleton-authoring.ts';
import type { ChapterClaim, ChapterPlacement } from '../cards/card-service.ts';

/** Grows the levels cards claim, in the same atomic unit as the cards themselves. */
export class ChapterDeriver implements ChapterPlacement {
  private readonly records: RecordStore<typeof SkeletonRecordSchema>;
  private readonly reader: SkeletonService;
  private readonly publisher: AtomicPublisher;

  constructor(records: RecordStore<typeof SkeletonRecordSchema>, reader: SkeletonService, publisher: AtomicPublisher) {
    this.records = records;
    this.reader = reader;
    this.publisher = publisher;
  }

  /**
   * The skeleton changes the claims still need: one minted `outline` node per
   * missing level, folded into a single change per book so one atomic batch can
   * never carry two writes to the same skeleton row. A level that already
   * exists contributes nothing; a book with nothing to mint contributes no
   * change at all.
   */
  async plan(ctx: MutationContext, claims: ReadonlyMap<string, readonly ChapterClaim[]>): Promise<PreparedRecordChange[]> {
    const plans: PreparedRecordChange[] = [];
    for (const [materialId, rows] of claims) {
      const view = await this.reader.read(ctx, materialId);
      const mint = new Map<string, SourceAnchor[]>();
      for (const row of rows) {
        if (view.nodes.some(node => node.path === row.chapter)) continue;
        const list = mint.get(row.chapter) ?? [];
        for (const anchor of row.anchors) {
          if (anchor.materialId === materialId && !list.some(kept => anchorKey(kept) === anchorKey(anchor))) list.push(anchor);
        }
        mint.set(row.chapter, list);
      }
      if (mint.size === 0) continue;
      const added = [...mint].map(([path, sources]) => SkeletonNodeSchema.parse({ path, sources, detail: 'outline' }));
      // The minted node is a skeleton node like any other: its anchors must
      // really belong to this book and resolve inside the bytes they pin.
      await this.reader.validate(ctx, materialId, added);
      const content = { materialId, nodes: this.reader.merge(view.nodes, added).nodes };
      const operationId = `${ctx.operationId}:skeleton:${materialId}`;
      if (view.revision === undefined) {
        const { expectedVersion: _dropped, ...rest } = ctx;
        plans.push(this.records.prepareCreate({ ...rest, operationId }, materialId, content));
      } else {
        plans.push(this.records.prepareUpdate({ ...ctx, operationId, expectedVersion: view.revision }, `skeleton:${materialId}`, content, () => content));
      }
    }
    return plans;
  }

  /** One atomic unit covering the minted nodes and the card changes themselves. */
  async atomic(changes: readonly PreparedRecordChange[]): Promise<void> {
    await this.publisher.atomic(changes);
  }
}

function anchorKey(anchor: SourceAnchor): string {
  return `${anchor.versionId}${anchor.quote ?? ''}${JSON.stringify(anchor.locator)}`;
}
