import { describe, expect, test } from 'vitest';
import {
  CardContentSchema,
  KnowledgeContentSchema,
  LessonMaterialsSchema,
  MemoryContentSchema,
  MemoryDraftSchema,
  MemoryObservationSchema,
  MessageEnvelopeSchema,
  SourceLocatorSchema,
} from '../../packages/contracts/src/index.ts';
import { createTestClock, isValidIanaTimeZone } from '../../packages/domain/src/clock.ts';
import { newId, objectRef, isObjectRef } from '../../packages/domain/src/ids.ts';

const pdfWithRect = { kind: 'pdf', page: 7, rect: [0.1, 0.2, 0.4, 0.5] };

describe('SourceLocator', () => {
  test('accepts the four contract branches inside their ranges', () => {
    expect(SourceLocatorSchema.parse(pdfWithRect)).toEqual(pdfWithRect);
    expect(SourceLocatorSchema.parse({ kind: 'image', rect: [0, 0, 1, 1] })).toEqual({ kind: 'image', rect: [0, 0, 1, 1] });
    expect(SourceLocatorSchema.parse({ kind: 'text', start: { line: 2, column: 0 }, end: { line: 2, column: 12 } })).toEqual({
      kind: 'text',
      start: { line: 2, column: 0 },
      end: { line: 2, column: 12 },
    });
    expect(SourceLocatorSchema.parse({ kind: 'docx', part: 'word/document.xml', blockId: 'p3', start: 0, end: 8 })).toEqual({
      kind: 'docx',
      part: 'word/document.xml',
      blockId: 'p3',
      start: 0,
      end: 8,
    });
  });

  test('rejects out-of-range pages, degenerate rects and inverted ranges', () => {
    expect(SourceLocatorSchema.safeParse({ kind: 'pdf', page: 0 }).success).toBe(false);
    expect(SourceLocatorSchema.safeParse({ kind: 'pdf', page: 1.5 }).success).toBe(false);
    expect(SourceLocatorSchema.safeParse({ kind: 'pdf', page: 3, rect: [0.4, 0.2, 0.4, 0.5] }).success).toBe(false);
    expect(SourceLocatorSchema.safeParse({ kind: 'pdf', page: 3, rect: [0.4, 0.5, 0.3, 0.6] }).success).toBe(false);
    expect(SourceLocatorSchema.safeParse({ kind: 'pdf', page: 3, rect: [-0.01, 0, 0.5, 0.5] }).success).toBe(false);
    expect(SourceLocatorSchema.safeParse({ kind: 'image', rect: [0, 0, 1.2, 1] }).success).toBe(false);
    expect(SourceLocatorSchema.safeParse({ kind: 'text', start: { line: 3, column: 4 }, end: { line: 3, column: 4 } }).success).toBe(false);
    expect(SourceLocatorSchema.safeParse({ kind: 'text', start: { line: 0, column: 0 }, end: { line: 3, column: 1 } }).success).toBe(false);
    expect(SourceLocatorSchema.safeParse({ kind: 'docx', part: 'word/document.xml', blockId: 'p3', start: 5, end: 5 }).success).toBe(false);
    expect(SourceLocatorSchema.safeParse({ kind: 'docx', part: 'word/document.xml', blockId: 'p3', start: -1, end: 4 }).success).toBe(false);
  });

  test('rejects unknown locator kinds and stray fields', () => {
    expect(SourceLocatorSchema.safeParse({ kind: 'epub', page: 1 }).success).toBe(false);
    expect(SourceLocatorSchema.safeParse({ ...pdfWithRect, workspaceId: 'w1' }).success).toBe(false);
  });
});

describe('LessonMaterials', () => {
  test('an empty plan and a mixed source/card plan are both legal', () => {
    expect(LessonMaterialsSchema.parse({ materials: [] })).toEqual({ materials: [] });
    const mixed = {
      materials: [
        { kind: 'source', source: { materialId: 'book-1', versionId: 'v3', locator: pdfWithRect } },
        { kind: 'card', cardRef: 'card_2026-09-12_kinematics' },
      ],
      initialIndex: 1,
    };
    expect(LessonMaterialsSchema.parse(mixed)).toEqual(mixed);
  });

  test('initialIndex must address a real item', () => {
    expect(LessonMaterialsSchema.safeParse({ materials: [], initialIndex: 0 }).success).toBe(false);
    expect(LessonMaterialsSchema.safeParse({ materials: [{ kind: 'card', cardRef: 'c1' }], initialIndex: 1 }).success).toBe(false);
    expect(LessonMaterialsSchema.safeParse({ materials: [{ kind: 'card', cardRef: 'c1' }], initialIndex: -1 }).success).toBe(false);
  });

  test('a card entry cannot smuggle a material locator', () => {
    expect(LessonMaterialsSchema.safeParse({ materials: [{ kind: 'card', cardRef: 'c1', source: { materialId: 'm', versionId: 'v' } }] }).success).toBe(false);
  });
});

describe('model-boundary content schemas', () => {
  test('author headings are ordinary content and source-only cards are valid', () => {
    const headings = CardContentSchema.parse({ title: '记录示例', front: '', sections: [{ heading: '复习', body: '这是作者正文' }, { heading: '重写', body: '不是系统历史' }] });
    expect(headings.sections).toHaveLength(2);
    const sourceOnly = CardContentSchema.parse({ title: '原图题', front: '', sources: [{ materialId: 'm1', versionId: 'v1', locator: { kind: 'pdf', page: 1 } }] });
    expect(sourceOnly).not.toHaveProperty('review');
  });
  test('card content keeps front/sections/notes and rejects host mechanical fields', () => {
    const content = { title: '解方程', front: '求 $x^2-4=0$ 的解', sections: [{ heading: '解答', body: 'x = ±2' }], notes: '课上验算了一遍' };
    expect(CardContentSchema.parse(content)).toMatchObject(content);
    for (const hostField of ['workspaceId', 'sessionId', 'actor', 'id', 'created', 'updatedAt', 'version', 'operationId', 'expectedVersion']) {
      expect(CardContentSchema.safeParse({ ...content, [hostField]: 'x' }).success).toBe(false);
    }
  });

  test('knowledge is one body and carries no review ladder', () => {
    expect(KnowledgeContentSchema.parse({ title: '判别式', body: '判别式 Δ=b²-4ac' })).toMatchObject({ body: '判别式 Δ=b²-4ac' });
    expect(KnowledgeContentSchema.safeParse({ title: 'x', body: 'x', nextDue: '2026-09-20' }).success).toBe(false);
    expect(KnowledgeContentSchema.safeParse({ title: 'x', body: 'x', reviewCount: 3 }).success).toBe(false);
    expect(KnowledgeContentSchema.safeParse({ title: 'x', body: 'x', ladder: [1, 3] }).success).toBe(false);
  });

  test('a single real observation can be saved without any verifiedAbility claim', () => {
    const memory = MemoryObservationSchema.parse({
      kind: 'habit',
      scope: { subjects: ['数学'] },
      body: '本题先写定义域再动手化简，比上次直接算少错一步。',
      basis: [{ sessionId: 'session-1', messageId: 'msg-3', occurredAt: '2026-09-12T01:00:00Z', source: 'classroom_evidence', quote: '先检查定义域', object: { ref: 'card:c1', version: 1 } }],
    });
    expect(memory.body).toContain('本题');
    expect(memory).not.toHaveProperty('verifiedAbility');
    expect(memory.basis).toHaveLength(1);
    expect(MemoryObservationSchema.safeParse({ ...memory, basis: [{}] }).success).toBe(false);
    expect(MemoryDraftSchema.parse({ kind: 'habit', body: '本题观察', evidenceRefs: ['E1'] }).evidenceRefs).toEqual(['E1']);
    expect(MemoryDraftSchema.safeParse({ kind: 'habit', body: 'x', evidenceRefs: ['E1'], basis: memory.basis }).success).toBe(false);
  });

  test('memory kind is configurable and scope defaults to general', () => {
    const custom = MemoryContentSchema.parse({ kind: '关注点', body: '最近更愿意先猜再验证。' });
    expect(custom.kind).toBe('关注点');
    expect(custom).not.toHaveProperty('scope');
    expect(MemoryContentSchema.safeParse({ kind: 'x', body: 'y', verifiedAbility: 'strong' }).success).toBe(false);
    expect(MemoryContentSchema.safeParse({ kind: 'x', body: 'y', subject: '数学' }).success).toBe(false);
  });

  test('message envelope requires a bound native messageId and freezes selection', () => {
    const envelope = {
      messageId: 'msg-9',
      text: '这段怎么来的',
      context: { selection: { text: '被选中的句子', sources: [{ materialId: 'm1', versionId: 'v1', locator: { kind: 'text', start: { line: 1, column: 0 }, end: { line: 1, column: 6 } } }] } },
    };
    expect(MessageEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(MessageEnvelopeSchema.safeParse({ text: 'x', context: {} }).success).toBe(false);
    expect(MessageEnvelopeSchema.safeParse({ messageId: 'm', text: 'x', context: { selection: { text: 't', sources: [] } } }).success).toBe(false);
  });
});

describe('injected clock', () => {
  test('Host mints distinct opaque identifiers and valid object references', () => {
    const a = newId();
    expect(newId()).not.toBe(a);
    expect(isObjectRef(objectRef('card', a))).toBe(true);
    expect(() => objectRef('../other', a)).toThrow();
  });
  test('now and time zone are provided by the caller, not the contract module', () => {
    const clock = createTestClock('2026-09-12T09:30:00.000Z', 'Asia/Shanghai');
    expect(clock.now()).toBe('2026-09-12T09:30:00.000Z');
    expect(clock.timeZone).toBe('Asia/Shanghai');
    expect(isValidIanaTimeZone('Asia/Shanghai')).toBe(true);
    expect(isValidIanaTimeZone('Not/AZone')).toBe(false);
    expect(() => createTestClock('2026-09-12T09:30:00.000Z', 'Not/AZone')).toThrow(/IANA/);
    expect(() => createTestClock('yesterday', 'Asia/Shanghai')).toThrow();
  });
});
