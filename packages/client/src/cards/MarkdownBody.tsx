/**
 * Card text rendered by the primitives package's own public Markdown renderer
 * (GFM plus KaTeX), so a formula reads the same here as in the classroom and no
 * second parser exists in this client.
 */
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives';

const LABELS: MarkdownLabels = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '注释' };

export interface MarkdownBodyProps {
  readonly text: string;
  readonly testId?: string;
}

/** One authored passage: the card face, a section body, or a note. */
export function MarkdownBody({ text, testId }: MarkdownBodyProps): React.JSX.Element {
  return <div className="sf-card-markdown" {...(testId === undefined ? {} : { 'data-testid': testId })}>
    <MarkdownText text={text} labels={LABELS} />
  </div>;
}
