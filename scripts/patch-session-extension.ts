import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// rc.2 `Session.append` copies `sourceEventSeqs`/`surfaceOp` out of its options
// argument but silently drops the envelope's `ignorable` marker. An out-of-repo
// plugin event is unknown to this harness by construction, so the log it wrote
// refuses to load on the next cold read: `validateStoredEvents` rejects any
// unknown type without `ignorable: true` (host-review.md P0). Write and read
// disagree only because the writer had no way to mark the event.
//
// The narrowest native seam is one guard plus a one-line passthrough: the
// published envelope contract stays exactly as documented, `ignorable: true` is
// forwarded for an unknown, non-surface event type only, and any other use
// throws instead of writing a log that fails later. A known event therefore
// never becomes skippable and no surface (conversation) event changes shape.
// Append-time validation, the surface fold, JSONL encoding and the reader all
// stay upstream code, so this does not bypass `validateStoredEvents` — it is
// the only way to satisfy it.
const project = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(project, 'node_modules/@deepseek-ai/dsh-session/lib/index.js');
const original = "05e94f57d96e7979670a5b51024c8591572eb0051ce793613dbdec35cf2c47bf";
const patched = "5d2651ae5ca8f16db2fbf38055e63e45b414e952382c51c714dc3bde77356356";
const before = "\tappend(type, data, ...opts) {\n\t\tconst surfaceOpts = opts[0];\n\t\tconst surfaceMetadata = {\n\t\t\t...surfaceOpts?.sourceEventSeqs === void 0 ? {} : { sourceEventSeqs: surfaceOpts.sourceEventSeqs },\n\t\t\t...surfaceOpts?.surfaceOp === void 0 ? {} : { surfaceOp: surfaceOpts.surfaceOp }\n\t\t};\n";
const after = "\tappend(type, data, ...opts) {\n\t\tconst surfaceOpts = opts[0];\n\t\tconst surfaceMetadata = {\n\t\t\t...surfaceOpts?.sourceEventSeqs === void 0 ? {} : { sourceEventSeqs: surfaceOpts.sourceEventSeqs },\n\t\t\t...surfaceOpts?.surfaceOp === void 0 ? {} : { surfaceOp: surfaceOpts.surfaceOp },\n\t\t\t...sessionIgnorableMarker(type, surfaceOpts)\n\t\t};\n";
const insertBefore = "var Session = class Session {";
const insertAfter = "/**\n* Resolve the persisted `ignorable` envelope marker for one append.\n*\n* The envelope contract (`SessionEvent.ignorable`, `validateStoredEvents`)\n* lets a stored log carry event types this build does not know, but only when\n* the writer marked the event `ignorable: true`: a cold read refuses the whole\n* session for an unknown event without that marker. Out-of-repo plugin events\n* are unknown by construction, so this passthrough is the only supported way\n* to append one without making the log unreadable later.\n*\n* The seam stays narrow on purpose: only an unknown, non-surface event type\n* may carry the marker, so a known event can never become skippable and no\n* surface (conversation) event changes shape. Anything else throws here rather\n* than writing a log that only fails at the next cold read.\n* @param type - The event type being appended.\n* @param surfaceOpts - The caller's optional append options.\n* @returns the marker to spread into the surface metadata, or nothing.\n*/\nfunction sessionIgnorableMarker(type, surfaceOpts) {\n\tif (surfaceOpts?.ignorable !== true) return {};\n\tif (typeof type === \"string\" && !KNOWN_SESSION_EVENT_TYPES.has(type) && !isSurfaceEligibleType(type)) return { ignorable: true };\n\tthrow new Error(`session event \"${type}\" cannot carry ignorable: only unknown non-surface event types may be marked ignorable`);\n}\n\nvar Session = class Session {";
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const source = readFileSync(file, 'utf8');
const digest = sha(source);
if (digest !== patched) {
  if (digest !== original) throw new Error('Unknown DSH session artifact; review the version before patching');
  const result = source.replace(before, after).replace(insertBefore, insertAfter);
  if (sha(result) !== patched) throw new Error('DSH session ignorable-envelope patch digest mismatch');
  writeFileSync(file, result);
}
console.log('Verified rc.2 Session.append ignorable envelope passthrough');
