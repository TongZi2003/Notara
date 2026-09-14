/**
 * P2.3 Host narrowing of native Session history into the evidence projection.
 *
 * Accepted student input lives in the native Session log. This module reads one
 * exact cut through the installed `ctx.sessionQuery.observeSession` service —
 * never a second session reader — and converts it into the JSON-safe rows the
 * domain `EvidenceQuery` consumes, keeping native message identity and event
 * time verbatim. System receipts (`source.kind === 'plugin'`) and assistant
 * messages keep their own role, so they can never be read back as the
 * student's own words.
 *
 * Leaning on the log is what makes a failed, cancelled or never-admitted send
 * harmless: it produced no event, so it has no identity to cite. Learning
 * objects arrive through an explicit resolver dependency; with none supplied
 * this module attaches no object rather than guessing an entity. P3/P5 wire the
 * real authorization behind that dependency.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-session-query';
import type { EvidenceCatalogueInput, EvidenceMessage, EvidenceObjectCandidate } from '@studyforge/domain/evidence';
import { decodeSourceFragments, type SourceFragment } from '@studyforge/contracts/source-context';

/** One Host-resolved object candidate; the version is the real object token. */
export type EvidenceObjectRow = EvidenceObjectCandidate;

/** One accepted native message, narrowed to JSON-safe data for the domain query. */
export type EvidenceMessageRow = EvidenceMessage;

/** The whole narrow projection of one session cut. */
export type EvidenceInputRow = EvidenceCatalogueInput;

/** What an object resolver may look at — narrow data only, never a native event. */
export interface EvidenceObjectQuery {
  readonly sessionId: string;
  readonly messageId: string;
  readonly occurredAt: string;
  readonly text: string;
  readonly fragments?: readonly SourceFragment[];
}

/**
 * Resolve the learning objects one real student message points at.
 * A dependency, not a lookup: the caller owns authorization and version truth.
 */
export type EvidenceObjectResolver = (
  query: EvidenceObjectQuery,
) => readonly EvidenceObjectRow[] | Promise<readonly EvidenceObjectRow[]>;

function roleOf(event: SessionEvent<'user/message'> | SessionEvent<'assistant/message'>): EvidenceMessageRow['role'] {
  if (event.type === 'assistant/message') return 'assistant';
  const kind: string = event.data.source.kind;
  if (kind === 'user') return 'student';
  if (kind === 'plugin') return 'system';
  return 'other';
}

function textOf(content: readonly ContentBlock[]): string {
  return content.map(block => (block.type === 'text' ? block.text : '')).join('');
}

/**
 * Convert one already-obtained native event cut into projection rows.
 * @param sessionId - native identity the rows belong to.
 * @param events - accepted events, exactly as the native log stores them.
 * @param resolveObjects - optional object dependency; absent means no objects.
 */
export async function narrowEvidence(
  sessionId: string,
  events: readonly SessionEvent[],
  resolveObjects?: EvidenceObjectResolver,
): Promise<EvidenceInputRow> {
  const messages: EvidenceMessageRow[] = [];
  for (const event of events) {
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue;
    const role = roleOf(event);
    const message = event.type === 'assistant/message' ? event.data.message : event.data;
    const messageId = String(message.id);
    const occurredAt = new Date(event.time).toISOString();
    const { text, fragments } = decodeSourceFragments(textOf(message.content));
    // Only a real student message can carry objects: those bind that student's own work.
    const query: EvidenceObjectQuery = { sessionId, messageId, occurredAt, text, fragments };
    const objects = role === 'student' && text.trim().length > 0 && resolveObjects
      ? [...await resolveObjects(query)]
      : [];
    messages.push({ messageId, occurredAt, role, text, objects });
  }
  return { sessionId, messages };
}

/**
 * Observe one session through the native query service and narrow its cut.
 * The observation lease is released before returning; nothing is retained.
 * @param ctx - Host context carrying the installed native `sessionQuery`.
 * @param sessionId - logical native session identity.
 * @param options - optional object dependency for this read.
 */
export async function observeEvidence(
  ctx: Context,
  sessionId: string,
  options: { readonly resolveObjects?: EvidenceObjectResolver } = {},
): Promise<EvidenceInputRow> {
  const observation = await ctx.sessionQuery.observeSession(SessionId(sessionId));
  try {
    // Restoring this same session also appends end-seed, without inherited.
    // Only a fork's inherited prefix belongs to another classroom.
    const inherited = observation.events.findLastIndex(event => event.type === 'session/end-seed' && event.data.inherited === true);
    return await narrowEvidence(sessionId, observation.events.slice(inherited + 1), options.resolveObjects);
  } finally {
    observation[Symbol.dispose]();
  }
}
