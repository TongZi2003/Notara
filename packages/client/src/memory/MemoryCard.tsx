/**
 * P7.2 一条关于这个学生的判断，长成 B@3831987 记忆屏的那块纸（`mem-block`）。
 *
 * B 的规矩一条不改：块头是标题、右上角「改写 N 次」，展开后先摆改过的旧稿，
 * 再摆「现在的认识 · 可以纠正」，依据收在「这条认识的依据」里。没有「已证实」
 * 这类印章，也没有哪个数字代表「够强了」——一条真实观察和十条读起来一样。
 * 没有 Host 依据的行（B 的标签、对象标题）不在这里编。
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
  const older = memory.history.slice(0, -1);
  const rewrites = memory.history.length - 1;
  return <article className={`mem-block${content.kind === 'ability' ? ' ability' : ''}`} data-testid="memory-card" data-kind={content.kind}>
    <header className="mh">
      {content.kind === 'ability' && <span className="ability-pill" data-testid="memory-kind">能力</span>}
      {content.kind !== 'ability' && <span className="ability-pill" data-testid="memory-kind">{kindLabel(content.kind)}</span>}
      <span className="mt" data-testid="memory-title">{content.title ?? kindLabel(content.kind)}</span>
      <span className="mini-note">{scopeLabel(content)}</span>
      {rewrites > 0 && <span className="rw">改写 {rewrites} 次</span>}
    </header>
    {older.length > 0 && <><div className="mem-sec">改过的认识 · 最近几次旧稿</div>
      <div data-testid="memory-versions">{older.map((observation, index) => <div className="mem-hrow" key={`${String(index)}:${observation.body}`}>
        <span className="hd">{observation.basis[0]?.occurredAt.slice(0, 10) ?? ''}</span>
        <span className="ht">{observation.body}</span></div>)}</div></>}
    <div className="mem-sec">现在的认识 · 可以纠正</div>
    <div className="mem-assert" data-testid="memory-body-text"><MarkdownBody text={content.body} testId="memory-body" /></div>
    {/* B keeps this behind a <summary>; the accepted memory spec reads the
        student's own words in place, so the current basis stays visible and
        only the older records fold away. */}
    <div className="memory-evidence" data-testid="memory-basis">
      <div className="mem-sec">这条认识的依据</div>
      {basis.current.length === 0
        ? <p className="mini-note" data-testid="memory-no-basis">这条判断还没有挂上原话。</p>
        : <ul data-testid="memory-basis-current">
          {basis.current.map(quote => <li key={`${quote.messageId}:${quote.quote}`}><QuoteLine quote={quote} {...(onSource === undefined ? {} : { onSource })} /></li>)}
        </ul>}
      {basis.prior.length > 0 && <details data-testid="memory-prior">
        <div className="mem-sec">以前的依据（{String(basis.prior.length)} 条）</div>
        <ul>{basis.prior.map(quote => <li key={`prior:${quote.messageId}:${quote.quote}`}><QuoteLine quote={quote} /></li>)}</ul>
      </details>}
    </div>
    {onEdit !== undefined && <footer className="mem-sec" data-testid="memory-edit-row">
      <button type="button" className="btn primary" data-testid="memory-edit" onClick={() => { onEdit(memory); }}>直接编辑</button>
    </footer>}
  </article>;
}

/** One adopted utterance: what the student really said, and what it pointed at. */
function QuoteLine({ quote, onSource }: { readonly quote: EvidenceRef; readonly onSource?: (ref: string, version: string | number) => void }): React.JSX.Element {
  const object = quote.object;
  return <div className="mem-hrow">
    <span className="hd">{quote.occurredAt.slice(0, 10)}</span>
    <span className="ht" data-testid="memory-quote">{quote.source === 'student_statement' ? '你自己说的' : '课堂表现'} · 原文依据「{quote.quote}」
      {object !== undefined && onSource !== undefined && <button type="button" className="btn ghost" data-testid="memory-source"
        onClick={() => { onSource(object.ref, object.version); }}>看对应的内容</button>}</span>
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
