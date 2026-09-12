/**
 * The composer's own reference ledger, published to this client's other faces.
 *
 * `registerMaterials` owns the one `SourceReferences` the composer freezes its
 * references with. The classroom reads an original inside its own pane now, and
 * a selection made there has to stage into *that* ledger — a second ledger would
 * freeze a pick the composer never sees, and the ask would silently drop it. So
 * the owner hands the ledger over here instead of every face building its own.
 */
import type { SourceReferences } from './source-selection.ts';

let held: SourceReferences | undefined;

/** Called once by the materials face that owns the ledger. */
export function holdSourceReferences(references: SourceReferences): void { held = references; }

/** The composer's ledger, when this client has mounted its materials face. */
export function heldSourceReferences(): SourceReferences | undefined { return held; }
