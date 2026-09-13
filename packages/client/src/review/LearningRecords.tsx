/**
 * P5.6 what really happened, newest first.
 *
 * One record is one adopted review occurrence: a card that was never studied
 * has none, and a knowledge note never gains one. The projection is the Host's
 * own `records()`, so the view only groups by day and puts the stored fact next
 * to the schedule it is really on — an occurrence recorded late keeps the day
 * it happened on and is marked as a backfilled entry.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { LearningRecord } from '@studyforge/domain/learning-records';
import { useEffect, useState } from 'react';
import { PRESENTATION_LABELS } from '../cards/format.ts';

export interface LearningRecordsProps {
  readonly ctx: Context;
  /** Open the card this record belongs to; the caller owns that surface. */
  readonly onOpen?: (target: string) => void;
}

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly records: readonly LearningRecord[] };

export function LearningRecords({ ctx, onOpen }: LearningRecordsProps): React.JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' });

  function load(): void {
    setState({ status: 'loading' });
    ctx.remote.studyforgeLearning.records().then(
      result => { setState(result.ok ? { status: 'ready', records: result.value } : { status: 'unavailable' }); },
      () => { setState({ status: 'unavailable' }); },
    );
  }

  useEffect(load, [ctx]);

  if (state.status === 'loading') return <p className="sf-note" data-testid="records-loading">正在读学习记录…</p>;
  if (state.status === 'unavailable') return <div className="sf-notice" data-testid="records-unavailable">
    <p>学习记录现在读不出来。</p>
    <button type="button" className="sf-quiet" data-testid="records-retry" onClick={load}>再读一次</button>
  </div>;
  if (state.records.length === 0) return <p className="sf-note" data-testid="records-empty">
    还没有学习记录。一张卡真正记过一次之后，这里才有。
  </p>;

  const today = localDay(new Date());
  return <div className="sf-records" data-testid="learning-records">
    {groupByDay(state.records).map(group => <section className="sf-records-day" key={group.day} data-testid="records-day">
      <h3>{group.day === today ? `今天 · ${group.day}` : group.day}</h3>
      <ul className="sf-linear-tree">
        {group.records.map(record => <li className="sf-record" key={`${record.target}:${record.fact.occurrence.id}`} data-testid="learning-record">
          <div className="sf-record-head">
            <span className="sf-record-mark" data-mark={record.fact.mark}>{record.fact.mark}</span>
            <span className="sf-record-title">{record.title}</span>
            <span className="sf-meta">{PRESENTATION_LABELS[record.presentation]} · {record.fact.channel}</span>
          </div>
          <div className="sf-meta">
            记于 {record.fact.occurrence.occurredAt.replace('T', ' ').slice(0, 16)}
            {record.day < today ? ' · 补记' : ''}
            {' · '}下次 {record.schedule.nextDue}
            {' · '}共 {String(record.schedule.reviewCount)} 次
          </div>
          {record.fact.note !== '' && <p className="sf-record-note">{record.fact.note}</p>}
          {onOpen !== undefined && <button type="button" className="sf-quiet" data-testid="record-open"
            onClick={() => { onOpen(record.target); }}>看这张卡</button>}
        </li>)}
      </ul>
    </section>)}
  </div>;
}

/** The projection is already newest-first; grouping keeps that order inside a day. */
function groupByDay(records: readonly LearningRecord[]): readonly { readonly day: string; readonly records: readonly LearningRecord[] }[] {
  const groups: { day: string; records: LearningRecord[] }[] = [];
  for (const record of records) {
    const last = groups.at(-1);
    if (last?.day === record.day) last.records.push(record);
    else groups.push({ day: record.day, records: [record] });
  }
  return groups;
}

function localDay(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${String(at.getFullYear())}-${month}-${day}`;
}
