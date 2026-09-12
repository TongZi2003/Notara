/**
 * P5.7 one card's own revisions, in the order they really happened.
 *
 * Each row is one committed operation the Host attributed to a target — a
 * proposal the student has not confirmed yet is a draft, never "已修改", and it
 * is the proposal card's job to say 拟修改. Nothing here reads a card's current
 * text as if it were history, and an answer-bearing change stays unnamed until
 * the student has opened the back.
 */
import type { CardChangeView } from '@studyforge/contracts/changes';
import { CardRedline } from './CardRedline.tsx';
import { CardTechnicalDiff } from './CardTechnicalDiff.tsx';
import { actorLabel, cardFieldLabel } from './format.ts';

export interface CardChangeListProps {
  readonly changes: readonly CardChangeView[];
  /** Whether the student already opened the back; a hidden answer never renders. */
  readonly showBack: boolean;
  readonly contextLines?: number;
}

export function CardChangeList({ changes, showBack, contextLines }: CardChangeListProps): React.JSX.Element | null {
  if (changes.length === 0) return null;
  return <section className="sf-card-changes">
    <h3>修改记录</h3>
    <ul data-testid="card-detail-changes">
      {changes.map(change => <li className="sf-change" key={change.operation.operationId}
        data-testid="card-change" data-change-state={change.state}>
        <div className="sf-change-head">
          <span className="sf-meta">{change.operation.committedAt.slice(0, 10)} · {actorLabel(change.operation.actor)}</span>
          <span>{changeSummary(change)}</span>
        </div>
        {!showBack && change.hiddenBackChanged && <span className="sf-meta" data-testid="change-hidden-back">卡背也改了，公开答案后可对照</span>}
        {change.state === 'available' && change.fields.length > 0
          && <CardRedline fields={change.fields} {...(contextLines === undefined ? {} : { contextLines })} />}
        <details className="sf-change-technical">
          <summary data-testid="change-technical-toggle">技术信息</summary>
          <CardTechnicalDiff change={change} />
        </details>
      </li>)}
    </ul>
  </section>;
}

/** What changed, named by field — never the changed text itself. */
function changeSummary(change: CardChangeView): string {
  if (change.state === 'unavailable') return '这次改动对不回原件';
  const parts = change.fields.map(field => cardFieldLabel(field.field));
  if (change.metadata.length > 0) parts.push(`另外：${change.metadata.map(cardFieldLabel).join('、')}`);
  return parts.length > 0 ? parts.join('、') : '（正文没有变）';
}
