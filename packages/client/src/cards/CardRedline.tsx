/**
 * P5.7 the red pen over two stored revisions of one card.
 *
 * A change projection is read-only: the struck line is the text as it was, the
 * marked line is the text stored now, and nothing here is ever written back
 * into the card. Fenced blocks and display math arrive as whole units from the
 * Host's own comparison, so an old formula still renders as a formula instead
 * of broken TeX, and an unchanged paragraph is only context.
 */
import type { ChangedTextField, TextChange } from '@studyforge/contracts/changes';
import { useState } from 'react';
import { MarkdownBody } from './MarkdownBody.tsx';
import { cardFieldLabel } from './format.ts';

export interface CardRedlineProps {
  readonly fields: readonly ChangedTextField[];
  /** Unchanged lines kept in view before the rest folds away. */
  readonly contextLines?: number;
}

const DEFAULT_CONTEXT_LINES = 4;

/** One card's authored fields, old line struck through and new line marked. */
export function CardRedline({ fields, contextLines = DEFAULT_CONTEXT_LINES }: CardRedlineProps): React.JSX.Element {
  return <div className="sf-redline" data-testid="card-redline">
    {fields.map(field => <section className="sf-redline-field" key={field.field} data-testid="card-redline-field" data-field={field.field}>
      <h4>{cardFieldLabel(field.field)}<span className="sf-meta">{changeWord(field)}</span></h4>
      <div className="sf-redline-runs">
        {field.lines.map((line, index) => <RedlineRun key={`${String(index)}:${line.kind}`} line={line} contextLines={contextLines} />)}
      </div>
    </section>)}
  </div>;
}

function changeWord(field: ChangedTextField): string {
  if (field.before === '') return '整段新增';
  if (field.after === '') return '整段删掉';
  return '有改动';
}

function RedlineRun({ line, contextLines }: { readonly line: TextChange; readonly contextLines: number }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  if (line.kind === 'remove') return <div className="sf-redline-run sf-redline-old" data-testid="card-redline-removed" data-line-kind="remove">
    <del><MarkdownBody text={line.text} /></del>
  </div>;
  if (line.kind === 'add') return <div className="sf-redline-run sf-redline-new" data-testid="card-redline-added" data-line-kind="add">
    <span className="sf-redline-mark">新增</span>
    <MarkdownBody text={line.text} />
  </div>;
  const units = unitsOf(line.text);
  const folded = !expanded && units.length > contextLines;
  const shown = folded ? units.slice(0, contextLines).join('') : line.text;
  return <div className="sf-redline-run sf-redline-same" data-testid="card-redline-same" data-line-kind="equal">
    <MarkdownBody text={shown} />
    {folded && <button type="button" className="sf-quiet" data-testid="card-redline-expand"
      onClick={() => { setExpanded(true); }}>展开没变的 {String(units.length - contextLines)} 行</button>}
  </div>;
}

/** The same unit rule the Host used, so folding never cuts a fenced block in half. */
function unitsOf(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}
