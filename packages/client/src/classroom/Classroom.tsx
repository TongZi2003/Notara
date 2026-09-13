import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { LessonImport } from './LessonImport.tsx';
import { requestLessonPane } from '../materials/lesson-pane-request.ts';
import { registerConversationProposals } from '../proposals/ConversationProposals.tsx';

/** The one native composition that owns learning surfaces; creation is not a lesson. */
const LEARNING_PRESET = 'studyforge-learning';

/**
 * Native input and proposal contributions. LearningWorkspace owns the three
 * view seats; native files remain available to non-learning sessions.
 * The composer, transcript, queue, drafts and Session binding stay native.
 */
export function registerClassroom(ctx: Context): void {
  function ImportEntry({ sessionId, useSessions }: PropsRuntime<'conversation.input.left'>): React.JSX.Element | null {
    const learning = useSessions(state => state.byId[sessionId]?.projectionValues?.agentPreset === LEARNING_PRESET);
    const selected = useSessions(state => state.current === sessionId);
    if (!learning) return null;
    return <LessonImport key={sessionId} ctx={ctx} sessionId={sessionId} active={selected} appearance="compact" onOpen={material => {
      requestLessonPane(sessionId, { kind: 'source', title: material.title, anchors: [{ materialId: material.materialId, versionId: material.currentVersion.versionId }] });
    }} />;
  }
  ctx.effect(() => ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    { name: 'conversation.input.left', id: 'studyforge.import', order: 5 }, ImportEntry,
  )), 'studyforge: classroom material import');
  registerConversationProposals(ctx);
}
