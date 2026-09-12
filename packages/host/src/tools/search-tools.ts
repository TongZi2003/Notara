import type { Context } from '@deepseek-ai/cordis';
import { LearningSearchInputSchema, LearningSearchResultSchema, type LearningSearchInput, type LearningSearchResult } from '@studyforge/contracts/learning-search';
import { LearningSearch, type LearningSearchSources } from '@studyforge/domain/learning-search';
import type { HostContext } from '@studyforge/contracts';
import { toolSchema } from './tool-schema.ts';

declare module '@deepseek-ai/cordis' { interface Context { studyforgeSearchSources: LearningSearchSources; } }

/** Native web tools remain separate. Local reads use the actual caller's grants. */
export async function searchLearning(host: Context, context: HostContext, input: LearningSearchInput): Promise<LearningSearchResult> {
  if (context.purpose !== 'learning') throw new Error('learning_search_purpose_required');
  const binding = context.sessionId ? await host.studyforgeAccess.forSession(context.sessionId) : undefined;
  const sources = host.studyforgeSearchSources;
  return new LearningSearch({ ...sources, resolve: {
    async resolve(ctx, ref) {
      const resolved = await host.studyforgeMaterialService.resolve(ctx, ref);
      if (binding) host.studyforgeAccess.assert(binding, resolved.absolutePath);
      return resolved;
    },
  } }).search(context, input);
}

export function registerSearchTools(host: Context): void {
  host.effect(() => host.tools.register({
    name: 'search_learning', description: '检索本人资料全文、普通卡正反面和私人知识。返回实际对象、版本与位置；没有文字层的扫描件不会虚构OCR。相关性和进一步读取由你判断，搜索不表示学生已学过。外网请使用原生web_search/web_fetch。',
    parameters: toolSchema(LearningSearchInputSchema),
    output: { schema: toolSchema(LearningSearchResultSchema), render: (_args, value) => [{ type: 'text', text: JSON.stringify(LearningSearchResultSchema.parse(value)) }] },
    async execute(args, execution) {
      if (!execution.agent) throw new Error('learning_session_required');
      const binding = await host.studyforgeAccess.forSession(execution.agent.session.id);
      return searchLearning(host, { workspaceId: binding.workspaceId, sessionId: binding.sessionId, actor: 'teacher', purpose: binding.purpose }, LearningSearchInputSchema.parse(args));
    },
  }));
}
