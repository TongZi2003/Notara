import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-session-title';
import { SessionId } from '@deepseek-ai/dsh-session';
import { createHash } from 'node:crypto';
import type { NativeOpen } from '@studyforge/domain/routes';
import { validateLessonMaterials } from '../materials/validate-lesson-materials.ts';
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types';

/** Native explicit-id adoption closes create-before-route-binding crashes. */
export function plannedSessionId(workspaceId: string, key: string): string {
  const hash = createHash('sha256').update(`${workspaceId}:${key}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${((parseInt(hash[16]!, 16) & 3) | 8).toString(16)}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export function nativeOpen(host: Context): NativeOpen {
  const opening = new Map<string, Promise<{ sessionId: string; openedAt: string }>>();
  return { async open(context, request) {
    const sessionId = SessionId(plannedSessionId(context.workspaceId, request.openingKey));
    const previous = opening.get(sessionId); if (previous) return previous;
    const job = (async () => {
      await validateLessonMaterials(host, context, request.materials);
      const created = await host.sessionController.create({ sessionId, workspaceId: context.workspaceId as WorkspaceId,
        agentPreset: 'studyforge-learning' });
      if (created.sessionId !== sessionId) throw new Error('native_planned_identity_mismatch');
      const observation = await host.sessionQuery.observeSession(sessionId);
      let hasTitle: boolean, openedAt: string;
      try { hasTitle = observation.events.some(event => event.type === 'session/title');
        openedAt = new Date(observation.header.createdAt).toISOString(); }
      finally { observation[Symbol.dispose](); }
      if (!hasTitle) await host.sessionController.rename({ sessionId, title: request.title });
      const ctx = { ...context, sessionId, operationId: 'planned:' + request.openingKey, expectedVersion: 0 };
      await host.studyforgeCourseMetadata.update(ctx, { lessonMaterials: request.materials,
        ...(request.decl.teachingRef ? { teachingRef: request.decl.teachingRef } : {}), ...(request.decl.stance ? { stance: request.decl.stance } : {}),
      });
      return { sessionId, openedAt };
    })();
    opening.set(sessionId, job);
    try { return await job; } finally { if (opening.get(sessionId) === job) opening.delete(sessionId); }
  } };
}
