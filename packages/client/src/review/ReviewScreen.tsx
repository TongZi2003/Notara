/**
 * P5.6 studying one card, from the first look to a real learning record.
 *
 * Opening this screen writes nothing and showing the face is not studying: the
 * record is written only when the student marks their own recall after seeing
 * the back. An unstudied card can be studied right away — it simply has no
 * schedule until that first real mark — and a card that is skipped keeps its
 * old state exactly.
 *
 * The record itself is the Host's: `studyforgeLearning.review` binds the
 * occurrence, the ladder and the schedule, and what comes back is the stored
 * card, so the next due date shown here is the one that was really written.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CardView } from '@studyforge/contracts/cards';
import type { ReviewMark } from '@studyforge/contracts/reviews';
import { useEffect, useState } from 'react';
import { attemptKey, UNKNOWN_REVIEW_COPY, useStableOperationId } from '../cards/attempt.ts';
import { MarkdownBody } from '../cards/MarkdownBody.tsx';
import { answerLost, failureCode, PRESENTATION_LABELS } from '../cards/format.ts';
import { SourceExcerpt } from '../cards/SourceExcerpt.tsx';

export interface ReviewScreenProps {
  readonly ctx: Context;
  readonly sessionId?: string;
  /** Start with this card; the rest of the queue follows it. */
  readonly start?: string;
  readonly onBack: () => void;
  readonly onRecorded?: (card: CardView) => void;
}

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly queue: readonly CardView[] };

/** The three grades a student can honestly give themselves outside class. */
const MARKS: readonly { readonly mark: ReviewMark; readonly label: string; readonly meaning: string }[] = [
  { mark: '忘', label: '忘了', meaning: '想不起来，明天再看一次' },
  { mark: '糊', label: '有点糊', meaning: '想起来了，但很费劲' },
  { mark: '牢', label: '很牢', meaning: '能直接说出来' },
];

/** One card at a time: face, back, and the student's own mark. */
export function ReviewScreen({ ctx, sessionId, start, onBack, onRecorded }: ReviewScreenProps): React.JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [recorded, setRecorded] = useState<CardView | undefined>(undefined);
  // One attempt keeps one operation id: the Host keys the occurrence by it, so a
  // lost answer retried with a fresh id would be a second record.
  const operationFor = useStableOperationId();
  // While an answer is unknown the student is trying the *same* judgement again,
  // not making a new one: the submitted mark stays the only one on offer until
  // the Host either stored it or refused it.
  const [locked, setLocked] = useState<ReviewMark | undefined>(undefined);

  useEffect(() => {
    let live = true;
    ctx.remote.studyforgeLearning.cards().then(
      result => {
        if (!live) return;
        if (!result.ok) { setState({ status: 'unavailable' }); return; }
        setState({ status: 'ready', queue: queueOf(result.value, start) });
      },
      () => { if (live) setState({ status: 'unavailable' }); },
    );
    return () => { live = false; };
  }, [ctx, start]);

  if (state.status === 'loading') return <p className="sf-note" role="status" data-testid="review-loading">正在准备这一轮…</p>;
  if (state.status === 'unavailable') return <p className="sf-note" role="status" data-testid="review-unavailable">卡片暂时取不到，稍后再看一次。</p>;

  const card = recorded ?? state.queue[index];
  if (card === undefined) return <section className="sf-review" data-testid="review-screen" data-review-empty="true">
    <h2>这一轮看完了</h2>
    <p className="sf-note">今天没有更该看的卡了；想再练可以回卡片里挑一张。</p>
    <button type="button" className="sf-action" data-testid="review-back" onClick={onBack}>回卡片</button>
  </section>;
  // One binding for the whole render, so the mark closure names the same card.
  const current: CardView = card;

  async function mark(value: ReviewMark): Promise<void> {
    if (locked !== undefined && value !== locked) {
      setNotice('上一次的结果还没确认，先按同一个档位再试一次。');
      return;
    }
    setBusy(true);
    setNotice(undefined);
    const target = current.ref;
    try {
      const result = await ctx.remote.studyforgeLearning.review({
        operationId: operationFor(attemptKey('review', target, value)), target, mark: value,
      });
      if (!result.ok) {
        // A carrier failure is the same unknown outcome as a rejected fetch:
        // the record may already be stored, so the grade stays locked.
        if (answerLost(failureCode(result.error))) { setLocked(value); setNotice(UNKNOWN_REVIEW_COPY); return; }
        // A real refusal is a definite answer: nothing was stored, so the
        // student may choose differently.
        setLocked(undefined); setNotice('这一次没有记上，稍后再点一次。'); return;
      }
      setLocked(undefined);
      setRecorded(result.value.card);
      if (onRecorded !== undefined) onRecorded(result.value.card);
    } catch {
      setLocked(value);
      setNotice(UNKNOWN_REVIEW_COPY);
    } finally {
      setBusy(false);
    }
  }

  return <section className="sf-review" data-testid="review-screen">
    <header className="sf-review-head">
      <h2>学习</h2>
      <span className="sf-meta">{PRESENTATION_LABELS[current.content.presentation]}
        {current.review === undefined ? ' · 还没学过' : ` · 第 ${String(current.review.reviewCount)} 次`}</span>
      <button type="button" className="sf-quiet" data-testid="review-back" onClick={onBack}>回卡片</button>
    </header>

    <article className="sf-review-card" data-testid="review-card">
      <h3 data-testid="review-title">{current.content.title}</h3>
      <MarkdownBody text={current.content.front} testId="review-front" />
      {current.content.front === '' && current.content.sources.length > 0 && <SourceExcerpt ctx={ctx} sources={current.content.sources} />}
      {!revealed && <button type="button" className="sf-action" data-testid="review-reveal" onClick={() => { setRevealed(true); }}>看卡背</button>}
      {revealed && <div className="sf-review-back" data-testid="review-back-body">
        {current.content.sections.map((section, at) => <div key={`section-${String(at)}`}>
          <h4>{section.heading}</h4>
          <MarkdownBody text={section.body} />
        </div>)}
        {current.content.notes !== '' && <div><h4>笔记</h4><MarkdownBody text={current.content.notes} /></div>}
      </div>}
    </article>

    {recorded === undefined && revealed && <div className="sf-review-marks" data-testid="review-marks">
      <p className="sf-note">{locked === undefined
        ? '隔空回想一次，再照实选一个；先跳过不会记档。'
        : '上一次的结果还没回来，只能按同一个档位重试；点了别的档位会先被挡住。'}</p>
      {MARKS.map(entry => <button type="button" className="sf-action sf-action-quiet" key={entry.mark}
        data-testid={`review-mark-${entry.mark}`} data-mark={entry.mark} data-locked={locked === undefined ? undefined : String(locked === entry.mark)}
        disabled={busy || (locked !== undefined && locked !== entry.mark)}
        onClick={() => { void mark(entry.mark); }}>
        <span>{entry.label}</span><span className="sf-meta">{entry.meaning}</span>
      </button>)}
      <button type="button" className="sf-quiet" data-testid="review-skip" disabled={busy}
        onClick={() => { setRevealed(false); setRecorded(undefined); setIndex(at => at + 1); }}>这一个先跳过</button>
    </div>}

    {recorded !== undefined && <div className="sf-review-result" data-testid="review-result">
      <p className="sf-note">记下了{recorded.review === undefined ? '。' : `：下次 ${recorded.review.nextDue} 再看。`}</p>
      <button type="button" className="sf-action" data-testid="review-next"
        onClick={() => { setRevealed(false); setRecorded(undefined); setNotice(undefined); setIndex(at => at + 1); }}>下一个</button>
    </div>}
    {notice !== undefined && <p className="sf-notice" role="status" data-testid="review-notice">{notice}</p>}
  </section>;
}

/**
 * Review contains only due cards. An explicit learning action may additionally
 * put the selected card first; unrelated inventory never joins that queue.
 */
function queueOf(cards: readonly CardView[], start: string | undefined): readonly CardView[] {
  const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const due = cards.filter(card => card.review !== undefined && card.review.nextDue <= today);
  const queue = due;
  if (start === undefined) return queue;
  const chosen = cards.find(card => card.ref === start);
  return chosen === undefined ? queue : [chosen, ...queue.filter(card => card.ref !== start)];
}
