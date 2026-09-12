import type { CardView } from '@studyforge/contracts/cards';
import type { ReviewHistory, ReviewSchedule } from '@studyforge/contracts/reviews';
import { occurrenceDay } from './occurrence-effect.ts';

export interface LearningRecord {
  target: string; title: string; presentation: CardView['content']['presentation']; day: string;
  fact: ReviewHistory; schedule: ReviewSchedule;
}
/** Every ordinary card presentation can have real learning history; inventory
 * and knowledge collection never synthesize records or a due queue. */
export function learningRecords(cards: readonly CardView[]): LearningRecord[] {
  return cards.flatMap(card => card.review ? card.history.map(fact => ({ target: card.ref, title: card.content.title,
    presentation: card.content.presentation, day: occurrenceDay(fact.occurrence), fact, schedule: card.review! })) : [])
    .sort((a, b) => b.fact.occurrence.occurredAt.localeCompare(a.fact.occurrence.occurredAt));
}
export function dueCards(cards: readonly CardView[], day: string): CardView[] {
  return cards.filter(card => card.review && card.review.nextDue <= day).sort((a, b) => a.review!.nextDue.localeCompare(b.review!.nextDue));
}
