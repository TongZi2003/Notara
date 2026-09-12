/**
 * P3.2 the same Markdown reading the classroom uses.
 *
 * `MarkdownText` is the primitives package's own public React renderer (GFM plus
 * KaTeX), so a Chinese formula note renders as formulas here and in a session,
 * with one renderer and no second parser. Only the labels are ours.
 */
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives';

/** Chrome text for the fence copy control and the footnote section. */
const LABELS: MarkdownLabels = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '注释' };

export interface MarkdownViewProps {
  readonly text: string;
}

/** Render one Markdown original as real elements, formulas included. */
export function MarkdownView({ text }: MarkdownViewProps): React.JSX.Element {
  return <div className="sf-markdown" data-testid="material-markdown">
    <MarkdownText text={text} labels={LABELS} />
  </div>;
}
