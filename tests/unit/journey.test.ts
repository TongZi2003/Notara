import { expect, test } from 'vitest';
import { journeyView, JOURNEY_LESSON_CAP, JOURNEY_LIST_CAP, type JourneyInput } from '../../packages/domain/src/courses/journey.ts';
import type { HandoffView } from '../../packages/contracts/src/handoffs.ts';
import type { RouteView } from '../../packages/contracts/src/routes.ts';
import type { CardRecord } from '../../packages/contracts/src/cards.ts';
import type { MemoryView } from '../../packages/contracts/src/memory.ts';
import type { KnowledgeRecord } from '../../packages/contracts/src/knowledge.ts';
import type { Saved } from '../../packages/domain/src/storage/record-store.ts';

const handoff = (over: Partial<HandoffView> = {}): HandoffView => ({
  ref: 'handoff:h_1', version: 1, sessionId: 's_1', title: '第一课小结', body: '学会了分数加法。',
  cutoff: { sessionId: 's_1', sequence: 3, at: '2026-09-01T10:00:00.000Z' },
  facts: [], createdAt: '2026-09-01T10:05:00.000Z', ...over,
});
const saved = <T>(ref: string, data: T, version = 1): Saved<T> => ({ ref, version, data, duplicate: false });
const card = (review?: { nextDue: string }): Saved<CardRecord> => saved(`card:c_${Math.random()}`, {
  content: { title: '卡', body: 'b', sources: [], links: [], tags: [], kind: 'normal' },
  history: [], ...(review ? { review: { lastAccessed: '2026-09-01', nextDue: review.nextDue, reviewCount: 1 } } : {}),
} as CardRecord);
const memory = (kind: string, title?: string): MemoryView => ({
  ref: `memory:m_${kind}_${title ?? 'x'}`, revision: 1,
  content: { kind, ...(title ? { title } : {}), body: 'observation' },
  history: [{ kind, body: 'o', basis: ['E1'] }], basis: { current: ['E1'], prior: [] },
} as MemoryView);
const knowledge = (title: string): Saved<KnowledgeRecord> => saved(`knowledge:k_${title}`, {
  content: { title, body: 'b', tags: [], links: [] }, publicSources: [],
});
const input = (over: Partial<JourneyInput> = {}): JourneyInput => ({
  handoffs: [], lessons: [], route: null, cards: [], today: '2026-09-17', memory: [], knowledge: [], ...over,
});

test('empty workspace yields an explicit empty view, not an error', () => {
  const view = journeyView(input());
  expect(view.lessons).toEqual([]);
  expect(view.earlierLessons).toBe(0);
  expect(view.route).toBeNull();
  expect(view.cards).toEqual({ total: 0, unlearned: 0, due: 0, upcoming: 0 });
  expect(view.memory).toEqual({ total: 0, items: [], omitted: 0 });
  expect(view.knowledge).toEqual({ total: 0, items: [], omitted: 0 });
});

test('closed lessons sort by handoff time; unclosed lessons follow with their native title', () => {
  const view = journeyView(input({
    handoffs: [
      handoff({ ref: 'handoff:h_2', sessionId: 's_2', title: '第二课', createdAt: '2026-09-03T09:00:00.000Z' }),
      handoff({ ref: 'handoff:h_1', sessionId: 's_1', title: '第一课', createdAt: '2026-09-01T09:00:00.000Z' }),
    ],
    lessons: [
      { sessionId: 's_1', title: '分数入门' }, { sessionId: 's_2', title: '分数加法' },
      { sessionId: 's_3', title: '进行中的新课' },
    ],
  }));
  expect(view.lessons.map(lesson => lesson.sessionId)).toEqual(['s_1', 's_2', 's_3']);
  expect(view.lessons[0]!.title).toBe('分数入门');
  expect(view.lessons[0]!.closed).toBe(true);
  expect(view.lessons[0]!.closedAt).toBe('2026-09-01T09:00:00.000Z');
  expect(view.lessons[2]!.closed).toBe(false);
  expect(view.lessons[2]!.handoff).toBeUndefined();
});

test('a lesson whose native row is gone still appears under its handoff title', () => {
  const view = journeyView(input({ handoffs: [handoff({ title: '孤儿小结' })], lessons: [] }));
  expect(view.lessons[0]!.title).toBe('孤儿小结');
});

test('handoff facts split into materials, saved and pending; continuation pin is carried', () => {
  const view = journeyView(input({ handoffs: [handoff({
    continuation: { ref: 'handoff:h_0', version: 2 },
    facts: [
      { kind: 'material', title: '数学课本' },
      { kind: 'saved', title: '分数加法卡', target: 'card:c_9' },
      { kind: 'pending', title: '一张待确认的卡' },
    ],
  })] }));
  const entry = view.lessons[0]!.handoff!;
  expect(entry.materials).toEqual(['数学课本']);
  expect(entry.saved).toEqual([{ title: '分数加法卡', target: 'card:c_9' }]);
  expect(entry.pending).toEqual(['一张待确认的卡']);
  expect(entry.continuedFrom).toEqual({ ref: 'handoff:h_0', version: 2 });
});

test('the index carries pointers, never the summary body — detail is read on demand', () => {
  const view = journeyView(input({ handoffs: [handoff({ body: 'x'.repeat(10_000) })] }));
  const entry = view.lessons[0]!.handoff!;
  expect(entry).toMatchObject({ ref: 'handoff:h_1', version: 1, title: '第一课小结' });
  expect('body' in entry).toBe(false);
});

test('card stance counts unlearned, due and upcoming against the host day', () => {
  const view = journeyView(input({ today: '2026-09-17', cards: [
    card(), card({ nextDue: '2026-09-10' }), card({ nextDue: '2026-09-17' }), card({ nextDue: '2026-09-30' }),
  ] }));
  expect(view.cards).toEqual({ total: 4, unlearned: 1, due: 2, upcoming: 1 });
});

test('route nodes project opened bindings; a never-written route stays null', () => {
  const route: RouteView = { ref: 'route:tree', version: 3, layout: [], nodes: [
    { id: 'n1', title: '已开的课', materials: { materials: [] }, session: { sessionId: 's_1', openingKey: 'k', openedAt: '2026-09-01T00:00:00.000Z' } },
    { id: 'n2', title: '还没开的课', materials: { materials: [] } },
  ] };
  const view = journeyView(input({ route }));
  expect(view.route).toEqual({ nodes: [
    { nodeId: 'n1', title: '已开的课', opened: true, sessionId: 's_1' },
    { nodeId: 'n2', title: '还没开的课', opened: false },
  ] });
  expect(journeyView(input({ route: null })).route).toBeNull();
});

test('lesson cap keeps the most recent and counts the dropped ones', () => {
  const handoffs = Array.from({ length: JOURNEY_LESSON_CAP + 5 }, (_, index) => handoff({
    ref: `handoff:h_${index}`, sessionId: `s_${index}`, createdAt: `2026-01-${String(index % 28 + 1).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
  }));
  const view = journeyView(input({ handoffs }));
  expect(view.lessons).toHaveLength(JOURNEY_LESSON_CAP);
  expect(view.earlierLessons).toBe(5);
});

test('memory and knowledge lists cap with an honest omitted count', () => {
  const memoryRows = Array.from({ length: JOURNEY_LIST_CAP + 3 }, (_, index) => memory('habit', `m${index}`));
  const view = journeyView(input({ memory: memoryRows, knowledge: [knowledge('笔记一')] }));
  expect(view.memory.total).toBe(JOURNEY_LIST_CAP + 3);
  expect(view.memory.items).toHaveLength(JOURNEY_LIST_CAP);
  expect(view.memory.omitted).toBe(3);
  expect(view.knowledge.items.map(item => item.title)).toEqual(['笔记一']);
});
