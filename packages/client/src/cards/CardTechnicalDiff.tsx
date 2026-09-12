/**
 * P5.7 the exact bytes behind one change.
 *
 * The redline is the reading view; this is the same projection without any
 * interpretation — the stored text before and after, the fields that really
 * differ, and the mechanical parts (type, sources, chapter, tags, links) told
 * apart from the authored ones. Revisions and the author are shown; internal
 * ids are not, because knowing them never helps a student decide anything.
 */
import type { CardChangeView } from '@studyforge/contracts/changes';
import { useState } from 'react';
import { actorLabel, cardFieldLabel } from './format.ts';

export interface CardTechnicalDiffProps {
  readonly change: CardChangeView;
}

export function CardTechnicalDiff({ change }: CardTechnicalDiffProps): React.JSX.Element {
  if (change.state === 'unavailable') return <p className="sf-note" data-testid="diff-unavailable">
    这一版对不上了：修改前的样子已经读不到，改了什么无法确认。
  </p>;
  return <div className="sf-technical-diff" data-testid="technical-diff">
    <dl className="sf-diff-facts">
      <dt>时间</dt><dd>{change.operation.committedAt.replace('T', ' ').slice(0, 16)}</dd>
      <dt>谁改的</dt><dd>{actorLabel(change.operation.actor)}</dd>
      <dt>版本</dt><dd>{revisionRange(change)}</dd>
      {change.metadata.length > 0 && <><dt>另外改了</dt><dd>{change.metadata.map(cardFieldLabel).join('、')}</dd></>}
    </dl>
    {change.fields.length === 0 && <p className="sf-note">正文一个字都没改。</p>}
    {change.fields.map(field => <details className="sf-diff-field" key={field.field} data-testid="technical-diff-field">
      <summary>{cardFieldLabel(field.field)}</summary>
      <DiffText label="改前" text={field.before} />
      <DiffText label="改后" text={field.after} />
    </details>)}
  </div>;
}

function revisionRange(change: CardChangeView): string {
  const before = change.operation.beforeRevision;
  return before === null
    ? `第 ${String(change.operation.afterRevision)} 版`
    : `第 ${String(before)} 版 → 第 ${String(change.operation.afterRevision)} 版`;
}

/** One stored text as it is, with the same copy the rest of the product uses. */
function DiffText({ label, text }: { readonly label: string; readonly text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return <div className="sf-diff-text">
    <div className="sf-diff-text-head">
      <span className="sf-meta">{label}</span>
      <button type="button" className="sf-quiet" data-testid={`diff-copy-${label === '改前' ? 'before' : 'after'}`}
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => { setCopied(true); }, () => { setCopied(false); });
        }}>{copied ? '已复制' : '复制'}</button>
    </div>
    <pre data-testid={`diff-text-${label === '改前' ? 'before' : 'after'}`}>{text}</pre>
  </div>;
}
