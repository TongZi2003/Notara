import type { ComposedProps, EntryKeyOf } from '@deepseek-ai/dsh-client-ui-slots';
import { SOURCE_TRIGGER_NAME } from './source-trigger.ts';
import { useEffect, useRef } from 'react';
import type { SourceReferences } from './source-selection.ts';
type Props = ComposedProps<'conversation.composer.dock', EntryKeyOf<'conversation.composer.dock'>, never, undefined, { references: SourceReferences }>;
/** Read the native draft only. Crops were accepted before reference insertion. */
export function ContextPreview({ useInput, useSession, inputActions, sessionId, references }: Props): React.JSX.Element | null {
  const occurrences = useInput(state => state.occurrences);
  const ids = useInput(state => state.attachmentIds);
  const phase = useInput(state => state.phase);
  const pending = useSession(state => state.pendingSubmissions.length);
  const previous = useRef(new Set<string>());
  useEffect(() => { if (pending > 0) references.nextSubmission(String(sessionId)); }, [pending, sessionId, references]);
  useEffect(() => {
    if (phase === 'submitting' || phase === 'adjudicating') return;
    const live = new Set(occurrences.filter(item => item.source === SOURCE_TRIGGER_NAME).map(item => item.ref));
    for (const held of references.known(String(sessionId))) {
      if (live.has(held.ref)) {
        if (!previous.current.has(held.ref)) references.restored(held.ref);
      } else if (previous.current.has(held.ref)) {
        // Replacing the automatic reading reference is navigation, not the
        // student's choice to suppress that source when they come back to it.
        if (!references.isAutomatic(held.ref) || ![...live].some(ref => references.isAutomatic(ref))) references.dismissed(held.ref);
        for (const id of held.ids) if (ids.includes(id)) inputActions.removeAttachment(id);
      }
    }
    previous.current = live;
  }, [occurrences, ids, phase, inputActions, sessionId, references]);
  const sources = occurrences.filter(item => item.source === SOURCE_TRIGGER_NAME);
  if (sources.length === 0) return null;
  return <div className="sf-context-line" data-testid="composer-context">本次将引用：{sources.map(item => item.label).join('、')}</div>;
}
