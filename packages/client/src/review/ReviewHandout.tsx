/**
 * P5.6 the review handout: the cards that are really due today, and nothing
 * else.
 *
 * A card enters this list only after it has been studied and only on its own
 * due day, so an unstudied card and a knowledge note stay out of it by
 * construction. The list is a filter over the fields the Host stored — no
 * schedule is recomputed here — and opening it writes nothing: the record is
 * still only written when the student marks their own recall.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CardView } from '@studyforge/contracts/cards';
import { useEffect, useState } from 'react';
import { MarkdownBody } from '../cards/MarkdownBody.tsx';
import { PRESENTATION_LABELS } from '../cards/format.ts';

export interface ReviewHandoutProps {
  readonly ctx: Context;
  /** Open one card's own surface; the caller owns what that means. */
  readonly onOpen?: (target: string) => void;
}

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly due: readonly CardView[] };

export function ReviewHandout({ ctx, onOpen }: ReviewHandoutProps): React.JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' });

  function load(): void {
    setState({ status: 'loading' });
    ctx.remote.studyforgeLearning.cards().then(
      result => { setState(result.ok ? { status: 'ready', due: dueToday(result.value) } : { status: 'unavailable' }); },
      () => { setState({ status: 'unavailable' }); },
    );
  }

  useEffect(load, [ctx]);

  if (state.status === 'loading') return <p className="sf-note" data-testid="handout-loading">正在整理今天的讲义…</p>;
  if (state.status === 'unavailable') return <div className="sf-notice" data-testid="handout-unavailable">
    <p>复习讲义现在读不出来。</p>
    <button type="button" className="sf-quiet" data-testid="handout-retry" onClick={load}>再读一次</button>
  </div>;
  if (state.due.length === 0) return <p className="sf-note" data-testid="handout-empty">
    今天没有到期的卡。这里只放学过、且今天该复习的卡。
  </p>;

  return <div className="sf-handout" data-testid="review-handout">
    <p className="sf-meta">今天到期 {String(state.due.length)} 张，按到期日排。</p>
    <ol>
      {state.due.map(card => <HandoutCard key={card.ref} card={card} {...(onOpen === undefined ? {} : { onOpen })} />)}
    </ol>
  </div>;
}

function HandoutCard({ card, onOpen }: { readonly card: CardView; readonly onOpen?: (target: string) => void }): React.JSX.Element {
  const [revealed, setRevealed] = useState(false);
  return <li className="sf-handout-card" data-testid="handout-card">
    <div className="sf-record-head">
      <span className="sf-record-title">{card.content.title}</span>
      <span className="sf-meta">{PRESENTATION_LABELS[card.content.presentation]} · 到期 {card.review?.nextDue}</span>
    </div>
    {card.content.front !== '' && <MarkdownBody text={card.content.front} testId="handout-front" />}
    <div className="sf-conflict-actions">
      <button type="button" className="sf-quiet" data-testid="handout-reveal" onClick={() => { setRevealed(!revealed); }}>
        {revealed ? '收起答案' : '对照答案'}
      </button>
      {onOpen !== undefined && <button type="button" className="sf-quiet" data-testid="handout-open"
        onClick={() => { onOpen(card.ref); }}>去复习</button>}
    </div>
    {revealed && <div data-testid="handout-back">
      {card.content.sections.map(section => <section key={section.heading}>
        <h4>{section.heading}</h4>
        <MarkdownBody text={section.body} />
      </section>)}
      {card.content.notes !== '' && <MarkdownBody text={card.content.notes} />}
    </div>}
  </li>;
}

/** Real stored fields only: studied (has a schedule) and due on or before today. */
function dueToday(cards: readonly CardView[]): readonly CardView[] {
  const today = localDay(new Date());
  return cards.filter(card => card.review !== undefined && card.review.nextDue <= today)
    .sort((left, right) => (left.review?.nextDue ?? '').localeCompare(right.review?.nextDue ?? ''));
}

function localDay(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${String(at.getFullYear())}-${month}-${day}`;
}
