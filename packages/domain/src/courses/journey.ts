/**
 * 学习历程投影（read_journey 的域内一半）。
 *
 * 历程不存记录：它把各服务已经持有的不可变记录——每节课的收课小结、路线节点与真实
 * 开课绑定、卡片复习账本、学情与方法笔记——聚合成一份**索引视图**，让老师在续接、
 * 规划下一段或回顾成果时先看到「之前所有经历是什么、结果落在哪里」，而不是逐课翻
 * 或让学生重述。视图只带指针与计数：小结正文、卡片正文、学情正文都按需渐进披露，
 * 由专门读工具按这里的真实 ref/sessionId 精读。
 *
 * 排序约定：已收课的课按小结创建时间升序；从没收过课的课（进行中或被放弃）排在其后，
 * 因为它们没有可断言的收课时间。条目数超过上限时保留最近的一批，earlierLessons 如实
 * 记下被略去的节数——cap 掉的是视图的一部分，不是经历本身。
 */
import type { JourneyLesson, JourneyView } from '@studyforge/contracts/journey';
import type { HandoffView } from '@studyforge/contracts/handoffs';
import type { RouteView } from '@studyforge/contracts/routes';
import type { CardRecord } from '@studyforge/contracts/cards';
import type { MemoryView } from '@studyforge/contracts/memory';
import type { KnowledgeRecord } from '@studyforge/contracts/knowledge';
import type { Saved } from '../storage/record-store.ts';

/** 视图上限：课条数、学情/方法清单条数。 */
export const JOURNEY_LESSON_CAP = 60;
export const JOURNEY_LIST_CAP = 80;

/** 投影需要的最小输入；由 Host 从各服务 list 出来，本函数不读存储。 */
export interface JourneyInput {
  /** 本工作区全部小结（任意序，函数内按 createdAt 排）。 */
  readonly handoffs: readonly HandoffView[];
  /** 本工作区原生学习课清单（title 已取回，含进行中与被放弃的）。 */
  readonly lessons: readonly { readonly sessionId: string; readonly title: string }[];
  /** 路线当前视图；version===0（从未写过）时传 null。 */
  readonly route: RouteView | null;
  readonly cards: readonly Saved<CardRecord>[];
  /** 本地民用日（YYYY-MM-DD），与复习账本的 day 字段同一时区口径。 */
  readonly today: string;
  readonly memory: readonly MemoryView[];
  readonly knowledge: readonly Saved<KnowledgeRecord>[];
}

export function journeyView(input: JourneyInput): JourneyView {
  const titleOf = new Map(input.lessons.map(lesson => [lesson.sessionId, lesson.title]));
  const closed = [...input.handoffs].sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)
    .map((handoff): JourneyLesson => ({
      sessionId: handoff.sessionId,
      title: titleOf.get(handoff.sessionId) ?? handoff.title,
      closedAt: handoff.createdAt,
      closed: true,
      handoff: {
        ref: handoff.ref, version: handoff.version, title: handoff.title,
        ...(handoff.continuation === undefined ? {} : { continuedFrom: handoff.continuation }),
        materials: handoff.facts.filter(fact => fact.kind === 'material').map(fact => fact.title),
        saved: handoff.facts.filter(fact => fact.kind === 'saved')
          .map(fact => fact.target === undefined ? { title: fact.title } : { title: fact.title, target: fact.target }),
        pending: handoff.facts.filter(fact => fact.kind === 'pending').map(fact => fact.title),
      },
    }));
  const closedIds = new Set(closed.map(lesson => lesson.sessionId));
  const open: JourneyLesson[] = input.lessons.filter(lesson => !closedIds.has(lesson.sessionId))
    .map(lesson => ({ sessionId: lesson.sessionId, title: lesson.title, closed: false }));
  const all = [...closed, ...open], keep = Math.max(0, all.length - JOURNEY_LESSON_CAP);
  const lessons = all.slice(keep);

  const cards = { total: input.cards.length, unlearned: 0, due: 0, upcoming: 0 };
  for (const row of input.cards) {
    const review = row.data.review;
    if (!review) cards.unlearned++;
    else if (review.nextDue <= input.today) cards.due++;
    else cards.upcoming++;
  }

  const memory = input.memory.map(view => ({ ref: view.ref, kind: view.content.kind, title: view.content.title ?? null }));
  const knowledge = input.knowledge.map(row => ({ ref: row.ref, title: row.data.content.title }));

  return {
    lessons,
    earlierLessons: keep,
    route: input.route === null ? null : {
      nodes: input.route.nodes.map(node => ({
        nodeId: node.id, title: node.title, opened: node.session !== undefined,
        ...(node.session === undefined ? {} : { sessionId: node.session.sessionId }),
      })),
    },
    cards,
    memory: { total: memory.length, items: memory.slice(-JOURNEY_LIST_CAP), omitted: Math.max(0, memory.length - JOURNEY_LIST_CAP) },
    knowledge: { total: knowledge.length, items: knowledge.slice(-JOURNEY_LIST_CAP), omitted: Math.max(0, knowledge.length - JOURNEY_LIST_CAP) },
  };
}
