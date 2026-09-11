/**
 * P2.3 on-demand evidence projection over accepted native messages.
 *
 * The native Session log is the only accepted-input source; this module owns no
 * store, no second reader and no identity. The Host narrows an exact native cut
 * into {@link EvidenceMessage} rows (`packages/host/src/evidence-query.ts`), and
 * adoption persists only what was really adopted: the resolved `EvidenceRef`
 * keeps the native session/message identity, the real occurrence time, the
 * quoted student words and the actual object version.
 *
 * Short `E` aliases are a pure function of the accepted message order, so the
 * same log yields the same aliases and repeated queries append no record. Only
 * student-authored messages are adoptable; system receipts, assistant content
 * and other accepted traffic are counted in {@link EvidenceCatalogue.skipped}
 * instead of being silently aliased or dressed up as the student's own words.
 */
import { EvidenceRefSchema, type EvidenceRef, type VersionToken } from '@studyforge/contracts';

/** Who authored one accepted native message. */
export type EvidenceRole = 'student' | 'system' | 'assistant' | 'other';

/** Role of the words once adopted: the student's own account, or real classroom work. */
export type EvidenceSource = 'student_statement' | 'classroom_evidence';

/** One Host-resolved learning object a message really points at. Never fabricated here. */
export interface EvidenceObjectCandidate { readonly ref: string; readonly version: VersionToken; }

/** One accepted native message, already narrowed by the Host from the native log. */
export interface EvidenceMessage {
  readonly messageId: string;
  readonly occurredAt: string;
  readonly role: EvidenceRole;
  readonly text: string;
  readonly objects?: readonly EvidenceObjectCandidate[];
}

/** Everything one catalogue read needs: the native session id and its accepted messages. */
export interface EvidenceCatalogueInput {
  readonly sessionId: string;
  readonly messages: readonly EvidenceMessage[];
}

/** One adoptable entry the model may cite by alias. */
export interface EvidenceEntry {
  readonly alias: string;
  readonly messageId: string;
  readonly occurredAt: string;
  readonly quote: string;
  readonly source: EvidenceSource;
  readonly objects: readonly EvidenceObjectCandidate[];
}

/** Accepted messages that are real history but cannot become the student's words. */
export interface EvidenceSkipped {
  readonly system: number;
  readonly assistant: number;
  readonly other: number;
  /** Student messages with nothing quotable (attachment-only sends, blank text). */
  readonly empty: number;
}

/** On-demand projection result. Aliases are stable for a given accepted log. */
export interface EvidenceCatalogue {
  readonly sessionId: string;
  readonly entries: readonly EvidenceEntry[];
  readonly skipped: EvidenceSkipped;
}

/** Rejection reason for a citation the domain refuses to turn into adopted basis. */
export class EvidenceQueryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = 'EvidenceQueryError'; }
}

/** Turns one accepted native cut into alias rows and resolves the aliases actually adopted. */
export class EvidenceQuery {
  /**
   * Derive the current alias catalogue from accepted messages, in log order.
   * @param input - native session id plus the Host-narrowed accepted messages.
   * @returns dense `E1…En` aliases for student messages and a count of the rest.
   */
  catalogue(input: EvidenceCatalogueInput): EvidenceCatalogue {
    const entries: EvidenceEntry[] = [];
    const skipped = { system: 0, assistant: 0, other: 0, empty: 0 };
    for (const message of input.messages) {
      const quote = message.text.trim();
      if (message.role !== 'student' || quote.length === 0) {
        if (message.role === 'student') skipped.empty += 1;
        else skipped[message.role] += 1;
        continue;
      }
      const objects = message.objects ?? [];
      entries.push({
        alias: `E${entries.length + 1}`,
        messageId: message.messageId,
        occurredAt: message.occurredAt,
        quote,
        source: objects.length > 0 ? 'classroom_evidence' : 'student_statement',
        objects: [...objects],
      });
    }
    return { sessionId: input.sessionId, entries, skipped };
  }

  /**
   * Resolve the aliases the model selected into the basis to persist.
   * @param catalogue - the exact catalogue shown for this turn.
   * @param selections - alias strings only; the Host supplies identities and versions.
   * @returns contract-valid refs, one per adopted object (or one per message when it binds none).
   */
  resolve(catalogue: EvidenceCatalogue, selections: readonly string[]): EvidenceRef[] {
    const byAlias = new Map(catalogue.entries.map(entry => [entry.alias, entry]));
    const refs: EvidenceRef[] = [];
    const seen = new Set<string>();
    for (const selection of selections) {
      const alias = selection.trim();
      const entry = byAlias.get(alias);
      if (!entry) {
        throw new EvidenceQueryError('evidence_alias_unknown',
          `依据目录里没有 ${alias}；只能用本轮列出的 E 别名，系统回执和助手的说法不能当学生原话。`);
      }
      const objects: (EvidenceObjectCandidate | undefined)[] = entry.objects.length > 0 ? [...entry.objects] : [undefined];
      for (const object of objects) {
        const draft = {
          sessionId: catalogue.sessionId, messageId: entry.messageId, occurredAt: entry.occurredAt,
          source: entry.source, quote: entry.quote,
          ...(object ? { object: { ref: object.ref, version: object.version } } : {}),
        };
        const parsed = EvidenceRefSchema.safeParse(draft);
        if (!parsed.success) throw new EvidenceQueryError('evidence_ref_invalid', '这条依据缺少可核验的原文、时间或对象版本。');
        const identity = `${parsed.data.messageId}\u0000${parsed.data.object?.ref ?? ''}\u0000${String(parsed.data.object?.version ?? '')}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        refs.push(parsed.data);
      }
    }
    return refs;
  }
}
