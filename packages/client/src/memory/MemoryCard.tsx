/**
 * P7.2 one judgement about this student, read as it is stored.
 *
 * The record is one identity with one current wording plus every observation it
 * really adopted. What is shown first is the wording and the sources it stands
 * on now; the older versions stay behind an explicit "看以前的说法", because a
 * history nobody asked for is noise. Nothing here certifies a conclusion — there
 * is no "已证实" badge, no count that means "strong enough", and a record with a
 * single real observation reads exactly like any other.
 */
import type { EvidenceRef } from '@studyforge/contracts/evidence';
import type { MemoryView } from '@studyforge/contracts/memory';
import { MarkdownBody } from '../cards/MarkdownBody.tsx';

export interface MemoryCardProps {
  readonly memory: MemoryView;
  readonly onEdit?: (memory: MemoryView) => void;
  /** Open one real object a quote points at; the caller owns that preview. */
  readonly onSource?: (ref: string, version: string | number) => void;
}

export function MemoryCard({ memory, onEdit, onSource }: MemoryCardProps): React.JSX.Element {
  const { content, basis } = memory;
  return <article className="sf-memory-card" data-testid="memory-card" data-kind={content.kind}>
    <header className="sf-memory-head">
      <span className="sf-memory-kind" data-testid="memory-kind">{kindLabel(content.kind)}</span>
      {content.title !== undefined && <h4 data-testid="memory-title">{content.title}</h4>}
      <span className="sf-meta">{scopeLabel(content)}</span>
    </header>
    <MarkdownBody text={content.body} testId="memory-body" />
    <section className="sf-memory-basis">
      <h5>现在的说法依据</h5>
      {basis.current.length === 0
        ? <p className="sf-note" data-testid="memory-no-basis">这条判断还没有挂上原话。</p>
        : <ul data-testid="memory-basis-current">
          {basis.current.map(quote => <li key={`${quote.messageId}:${quote.quote}`}><QuoteLine quote={quote} {...(onSource === undefined ? {} : { onSource })} /></li>)}
        </ul>}
    </section>
    {basis.prior.length > 0 && <details className="sf-memory-history" data-testid="memory-prior">
      <summary>以前的依据（{String(basis.prior.length)} 条）</summary>
      <ul>{basis.prior.map(quote => <li key={`prior:${quote.messageId}:${quote.quote}`}><QuoteLine quote={quote} /></li>)}</ul>
    </details>}
    {memory.history.length > 1 && <details className="sf-memory-history" data-testid="memory-versions">
      <summary>看以前的说法（{String(memory.history.length - 1)} 版）</summary>
      <ul>{memory.history.slice(0, -1).map((observation, index) => <li key={`${String(index)}:${observation.body}`}>
        <div className="sf-meta">{observation.basis[0]?.occurredAt.slice(0, 10) ?? ''} · {kindLabel(observation.kind)}</div>
        <div>{observation.body}</div>
      </li>)}</ul>
    </details>}
    {onEdit !== undefined && <footer className="sf-memory-actions">
      <button type="button" className="sf-quiet" data-testid="memory-edit" onClick={() => { onEdit(memory); }}>改这条</button>
    </footer>}
  </article>;
}

/** One adopted utterance: what the student really said, and what it pointed at. */
function QuoteLine({ quote, onSource }: { readonly quote: EvidenceRef; readonly onSource?: (ref: string, version: string | number) => void }): React.JSX.Element {
  const object = quote.object;
  return <div className="sf-memory-quote">
    <span className="sf-memory-quote-text">「{quote.quote}」</span>
    <span className="sf-meta">{quote.occurredAt.slice(0, 10)} · {quote.source === 'student_statement' ? '你自己说的' : '课堂表现'}</span>
    {object !== undefined && onSource !== undefined && <button type="button" className="sf-quiet" data-testid="memory-source"
      onClick={() => { onSource(object.ref, object.version); }}>看对应的内容</button>}
  </div>;
}

/** The configured classification, in the student's words; an unknown kind shows itself. */
export function kindLabel(kind: string): string {
  switch (kind) {
    case 'ability': return '能力';
    case 'habit': return '习惯';
    case 'preference': return '喜好';
    default: return kind;
  }
}

/** Applicability is a reading aid, never a permission: no scope means general. */
export function scopeLabel(content: MemoryView['content']): string {
  const subjects = content.scope?.subjects ?? [];
  return subjects.length === 0 ? '所有科目' : subjects.join('、');
}
