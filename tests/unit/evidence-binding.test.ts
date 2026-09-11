/**
 * P2.3 EvidenceQuery: aliases over accepted native messages.
 *
 * Pure domain check. The Host supplies the narrowed rows; here they stand in
 * for one real native cut so the alias/role rules can be exercised without a
 * live session. The same shapes are produced from a real log by
 * `tests/integration/native-input-evidence.test.ts`.
 */
import { describe, expect, test } from 'vitest';
import { EvidenceRefSchema } from '../../packages/contracts/src/index.ts';
import {
  EvidenceQuery,
  EvidenceQueryError,
  type EvidenceCatalogueInput,
} from '../../packages/domain/src/evidence/evidence-query.ts';

const at = (second: number) => `2026-09-12T01:00:${String(second).padStart(2, '0')}.000Z`;

function cut(messages: EvidenceCatalogueInput['messages']): EvidenceCatalogueInput {
  return { sessionId: 'session-1', messages };
}

describe('EvidenceQuery.catalogue', () => {
  test('aliases only the student words and counts the rest of the accepted log', () => {
    const input = cut([
      { messageId: 'm1', occurredAt: at(1), role: 'student', text: '我一般先把定义域写出来再化简' },
      { messageId: 'm2', occurredAt: at(2), role: 'system', text: '【单据·结果】已经把这张卡记下了' },
      { messageId: 'm3', occurredAt: at(3), role: 'assistant', text: '那我们从定义域这一步开始。' },
      { messageId: 'm4', occurredAt: at(4), role: 'other', text: '{"tool":"read"}' },
      { messageId: 'm5', occurredAt: at(5), role: 'student', text: '这样算对吗' },
      { messageId: 'm6', occurredAt: at(6), role: 'student', text: '   ' },
    ]);

    const catalogue = new EvidenceQuery().catalogue(input);
    expect(catalogue.entries.map(entry => entry.alias)).toEqual(['E1', 'E2']);
    expect(catalogue.entries.map(entry => entry.messageId)).toEqual(['m1', 'm5']);
    expect(catalogue.entries[0]).toMatchObject({ quote: '我一般先把定义域写出来再化简', source: 'student_statement' });
    expect(catalogue.skipped).toEqual({ system: 1, assistant: 1, other: 1, empty: 1 });
  });

  test('a repeated query is identical and appending a message keeps earlier aliases', () => {
    const query = new EvidenceQuery();
    const first = query.catalogue(cut([
      { messageId: 'm1', occurredAt: at(1), role: 'student', text: '第一句' },
      { messageId: 'm2', occurredAt: at(2), role: 'student', text: '第二句' },
    ]));
    expect(query.catalogue(cut([
      { messageId: 'm1', occurredAt: at(1), role: 'student', text: '第一句' },
      { messageId: 'm2', occurredAt: at(2), role: 'student', text: '第二句' },
    ]))).toEqual(first);

    const grown = query.catalogue(cut([
      { messageId: 'm1', occurredAt: at(1), role: 'student', text: '第一句' },
      { messageId: 'm2', occurredAt: at(2), role: 'student', text: '第二句' },
      { messageId: 'm3', occurredAt: at(3), role: 'student', text: '第三句' },
    ]));
    expect(grown.entries.slice(0, 2)).toEqual(first.entries);
    expect(grown.entries[2]).toMatchObject({ alias: 'E3', messageId: 'm3' });
  });
});

describe('EvidenceQuery.resolve', () => {
  test('adoption carries the real session, message, time and quote', () => {
    const query = new EvidenceQuery();
    const catalogue = query.catalogue(cut([
      { messageId: 'm1', occurredAt: at(1), role: 'student', text: '这道题我卡在为什么要先配方' },
      { messageId: 'm2', occurredAt: at(2), role: 'assistant', text: '我们拆开看。' },
    ]));

    const basis = query.resolve(catalogue, ['E1']);
    expect(basis).toEqual([{
      sessionId: 'session-1', messageId: 'm1', occurredAt: at(1),
      source: 'student_statement', quote: '这道题我卡在为什么要先配方',
    }]);
    expect(EvidenceRefSchema.parse(basis[0])).toEqual(basis[0]);
  });

  test('a receipt or an assistant alias can never become the student words', () => {
    const query = new EvidenceQuery();
    const catalogue = query.catalogue(cut([
      { messageId: 'm1', occurredAt: at(1), role: 'student', text: '学生原话' },
      { messageId: 'm2', occurredAt: at(2), role: 'system', text: '【单据·结果】已记下' },
      { messageId: 'm3', occurredAt: at(3), role: 'assistant', text: '助手说法' },
    ]));

    for (const alias of ['E2', 'E3', 'm2', '', 'E0']) {
      expect(() => query.resolve(catalogue, [alias])).toThrow(EvidenceQueryError);
    }
    try { query.resolve(catalogue, ['E2']); } catch (error) {
      expect((error as EvidenceQueryError).code).toBe('evidence_alias_unknown');
    }
    expect(query.resolve(catalogue, ['E1'])).toHaveLength(1);
    expect(query.resolve(catalogue, [])).toEqual([]);
  });

  test('one message with several objects is legal and binds each real version', () => {
    const query = new EvidenceQuery();
    const catalogue = query.catalogue(cut([
      {
        messageId: 'm1', occurredAt: at(1), role: 'student', text: '两问都做完了',
        objects: [{ ref: 'card:c1', version: 3 }, { ref: 'card:c2', version: 'sha256:aa' }],
      },
    ]));

    const basis = query.resolve(catalogue, ['E1']);
    expect(basis.map(ref => [ref.object?.ref, ref.object?.version])).toEqual([
      ['card:c1', 3], ['card:c2', 'sha256:aa'],
    ]);
    expect(basis.every(ref => ref.source === 'classroom_evidence')).toBe(true);
    expect(basis.every(ref => ref.messageId === 'm1' && ref.quote === '两问都做完了')).toBe(true);
  });

  test('one object cited from two messages yields two refs, and repeats dedupe', () => {
    const query = new EvidenceQuery();
    const catalogue = query.catalogue(cut([
      { messageId: 'm1', occurredAt: at(1), role: 'student', text: '第一次作答', objects: [{ ref: 'card:c1', version: 2 }] },
      { messageId: 'm2', occurredAt: at(2), role: 'student', text: '第二次作答', objects: [{ ref: 'card:c1', version: 2 }] },
    ]));

    expect(query.resolve(catalogue, ['E1', 'E2'])).toHaveLength(2);
    expect(query.resolve(catalogue, ['E2', 'E2'])).toHaveLength(1);
  });

  test('a message that binds no object stays a bare student statement', () => {
    const query = new EvidenceQuery();
    const catalogue = query.catalogue(cut([
      { messageId: 'm1', occurredAt: at(1), role: 'student', text: '我平时喜欢先看图像' },
    ]));

    const basis = query.resolve(catalogue, ['E1']);
    expect(basis).toHaveLength(1);
    expect(basis[0]).not.toHaveProperty('object');
    expect(basis[0]?.source).toBe('student_statement');
    expect(EvidenceRefSchema.safeParse(basis[0]).success).toBe(true);
  });
});
