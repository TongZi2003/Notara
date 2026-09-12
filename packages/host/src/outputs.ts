import type { Context } from '@deepseek-ai/cordis';
import type { HostContext } from '@studyforge/contracts';
import { projectOutputs, type OutputProjection, type OutputProposal, type OutputKind } from '@studyforge/domain/outputs';
import type { ChangeReader } from './calendar-service.ts';
declare module '@deepseek-ai/cordis' { interface Context { studyforgeOutputSources: readonly ChangeReader[]; } }

export async function lessonOutputs(host: Context, context: HostContext, proposals: readonly OutputProposal[] = []): Promise<OutputProjection> {
  if (!context.sessionId) throw new Error('course_session_required');
  const cards = host.studyforgeCardRecords.list(context), knowledge = host.studyforgeKnowledgeRecords.list(context);
  const objects = host.studyforgeOutputSources.flatMap(source => source.list(context).map(row => ({ ...row, kind: source.kind })));
  const pending: OutputProposal[] = host.studyforgeProposalService.list(context).flatMap(proposal => {
    if (proposal.origin.kind !== 'native' || proposal.origin.sessionId !== context.sessionId) return [];
    return proposal.items.filter(item => item.status !== 'applied' && item.status !== 'rejected').map(item => ({
      sessionId: context.sessionId!, proposalId: `${proposal.ref}#${item.id}`, kind: effectKind(item.draft.effect.kind),
      title: proposal.title, status: item.failure?.commit === 'unknown' ? 'unknown' as const : 'pending' as const,
      ...(item.target ? { target: item.target } : {}),
    }));
  });
  const changes = [
    ...host.studyforgeOutputSources.flatMap(source => source.list(context).flatMap(row => source.changes(context, row.ref))),
  ].sort((a, b) => a.committedAt.localeCompare(b.committedAt));
  return projectOutputs({ sessionId: context.sessionId, changes, proposals: [...pending, ...proposals], read: ref => {
    const card = cards.find(row => row.ref === ref);
    if (card) return { state: 'present', title: card.data.content.title, presentation: card.data.content.presentation, revision: card.version, sources: card.data.content.sources };
    const method = knowledge.find(row => row.ref === ref);
    if (method) return { state: 'present', title: method.data.content.title, revision: method.version };
    const object = objects.find(row => row.ref === ref);
    if (object) {
      const data = object.data as { title?: string; name?: string; content?: { title?: string } };
      const labels: Record<string, string> = { memory: '学情记录', handoff: '课堂小结', route: '课程安排', skeleton: '目录', course: '本课设置' };
      return { state: 'present', title: data.content?.title ?? data.title ?? data.name ?? labels[object.kind] ?? '学习记录', revision: object.version };
    }
    return { state: 'gone' };
  } });
}
function effectKind(kind: string): OutputKind {
  if (kind === 'lesson-edit') return 'course';
  if (kind === 'review') return 'card';
  const prefix = kind.split('-')[0];
  if (['card', 'knowledge', 'memory', 'handoff', 'set', 'route', 'plan', 'skeleton'].includes(prefix ?? '')) return prefix as OutputKind;
  throw new Error('unhandled_proposal_output_kind');
}
