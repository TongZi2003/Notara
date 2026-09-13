import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { HostContext } from '@studyforge/contracts';
import { decodeSourceFragments } from '@studyforge/contracts/source-context';
import { SourceUseSchema } from '@studyforge/contracts/content-history';
import { projectCourse } from '@studyforge/domain/course-projection';
import type { OutputProjection } from '@studyforge/domain/outputs';
import { readLessonResources, type AcceptedMessageSources, type LessonResourcesProjection } from '@studyforge/domain/lesson-resources';

declare module '@deepseek-ai/cordis' {
  interface Context { studyforgeOutputReader: (context: HostContext) => Promise<OutputProjection>; }
}

/** Read native accepted references; tab activity never writes a teaching record. */
export async function sessionResources(host: Context, sessionId: string): Promise<LessonResourcesProjection> {
  const binding = await host.studyforgeAccess.forSession(sessionId);
  if (binding.purpose !== 'learning') throw new Error('source_learning_session_required');
  const context: HostContext = { workspaceId: binding.workspaceId, sessionId, purpose: binding.purpose, actor: 'student' };
  const course = projectCourse(host.studyforgeCourseMetadata.read(context));
  const observation = await host.sessionQuery.observeSession(SessionId(sessionId));
  const messages: AcceptedMessageSources[] = [];
  try {
    for (const event of observation.events) {
      if (event.type === 'tool/result' && !event.data.message.content.some(block => block.isError)) {
        const item = SourceUseSchema.safeParse(event.data.meta);
        if (item.success && item.data.use === 'cited') messages.push({ messageId: String(event.data.message.id), sources: item.data.sources,
          ...(item.data.target?.startsWith('card:') && item.data.version ? { currentMaterial: { kind: 'card', cardRef: item.data.target, cardVersion: item.data.version } } : {}) });
      }
      if (event.type !== 'user/message' || event.data.source.kind !== 'user') continue;
      const text = event.data.content.map(block => block.type === 'text' ? block.text : '').join('');
      for (const fragment of decodeSourceFragments(text).fragments) {
        const { selection, currentMaterial } = fragment.context;
        messages.push({ messageId: String(event.data.id), ...(selection ? { sources: selection.sources } : currentMaterial ? { currentMaterial } : {}) });
      }
    }
  } finally { observation[Symbol.dispose](); }
  const readOutputs = host.get('studyforgeOutputReader');
  return readLessonResources({ sessionId, course, messages, ...(readOutputs ? { outputs: await readOutputs(context) } : {}) });
}
