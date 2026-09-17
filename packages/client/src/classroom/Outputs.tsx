import type { OutputEntry, OutputKind, OutputProjection } from '@studyforge/domain/outputs';

/**
 * P2.5 lesson outputs, presented only when a real projection has rows.
 *
 * The projection is built by the domain from committed changes plus a real read
 * of each object; this component never invents a row. An empty projection
 * renders nothing, so the lesson panel stays silent instead of showing a
 * placeholder such as "还没有产出".
 *
 * The pending arm is a read-only projection of whatever confirmation source the
 * Host hands in. The P5 confirmed writer is not connected yet, so nothing here
 * can confirm, save, or dismiss anything — it can only open a row by identity.
 */
export interface OutputsProps {
  readonly projection: OutputProjection;
  /** Open one row by its real identity: a committed target, or a draft proposal id. */
  readonly onOpen: (entry: OutputEntry) => void;
}

const KIND_LABELS: Record<OutputKind, string> = {
  card: '卡片',
  knowledge: '知识',
  memory: '学情',
  handoff: '课堂小结',
  diagram: '图示',
  set: '学习集', route: '课程安排', plan: '计划', skeleton: '目录',
  course: '本课设置',
  teaching: '教法',
};

const STATUS_LABELS: Record<OutputEntry['status'], string> = {
  saved: '已保存',
  pending: '待确认',
  unknown: '状态未知',
};

/** One lesson's outputs; null when there is nothing real to show. */
export function Outputs({ projection, onOpen }: OutputsProps): React.JSX.Element | null {
  if (projection.entries.length === 0) return null;
  const pending = projection.entries.filter(entry => entry.status === 'pending').length;
  return <section>
    <h3>本课产出</h3>
    <ul className="sf-linear-tree" data-testid="studyforge-lesson-outputs">
      {projection.entries.map((entry, index) => <li key={entryKey(entry, index)} data-output-status={entry.status}>
        <button type="button" className="sf-output-row" data-testid="studyforge-output-open" onClick={() => { onOpen(entry); }}>
          <span className="sf-output-title">{entry.title ?? '还没有标题'}</span>
          <span className="sf-meta">
            {KIND_LABELS[entry.kind]} · {STATUS_LABELS[entry.status]}
            {/* Only a saved ordinary problem card becomes a question entrance. */}
            {entry.deck ? ' · 题目入口' : ''}
          </span>
        </button>
      </li>)}
    </ul>
    {pending > 0 && <p className="sf-note" data-testid="studyforge-output-pending">有 {pending} 项等你确认。</p>}
  </section>;
}

/**
 * Row identity. A not-yet-confirmed draft keeps its own row even when it edits
 * an object that is already saved, so the proposal id wins; the type prefix
 * keeps the two identities from ever colliding in one list.
 */
function entryKey(entry: OutputEntry, index: number): string {
  if (entry.proposalId !== null) return `proposal:${entry.proposalId}`;
  if (entry.target !== null) return `target:${entry.target}`;
  return `row:${index}`;
}
