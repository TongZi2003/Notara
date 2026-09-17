import { entityReferenceContent } from './entity-reference-output.ts';
import type { Context } from '@deepseek-ai/cordis';
import { ModelLearningSearchInputSchema, LearningSearchResultSchema, type LearningSearchInput, type LearningSearchResult } from '@studyforge/contracts/learning-search';
import { LearningSearch, type LearningSearchSources } from '@studyforge/domain/learning-search';
import type { HostContext } from '@studyforge/contracts';
import { toolSchema } from './tool-schema.ts';
import { rejected } from './learning-context.ts';

declare module '@deepseek-ai/cordis' { interface Context { studyforgeSearchSources: LearningSearchSources; } }

/** Native web tools remain separate. Local reads use the actual caller's grants. */
export async function searchLearning(host: Context, context: HostContext, input: LearningSearchInput): Promise<LearningSearchResult> {
  if (context.purpose !== 'learning') throw rejected('本工具只在学习课堂中可用');
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
    name: 'search_learning', description: '查内容：本人资料全文、普通卡正反面和私人知识，省略query或传空字符串可枚举。查今天到期的卡/标签/章节用list_cards；学情（学生的能力、习惯、偏好）用search_memory。命中后按类型read_material/read_card/read_method精读；搜索不绑定编辑版本、不表示学生已学过。扫描件无文字层不会虚构OCR；外网用原生web_search/web_fetch。',
    parameters: toolSchema(ModelLearningSearchInputSchema),
    output: { schema: toolSchema(LearningSearchResultSchema), render: (_args, value) => [{ type: 'text', text: JSON.stringify(LearningSearchResultSchema.parse(value)) }, ...entityReferenceContent(value)] },
    async execute(args, execution) {
      if (!execution.agent) throw rejected('本工具只能在课堂会话中使用');
      const binding = await host.studyforgeAccess.forSession(execution.agent.session.id);
      return searchLearning(host, { workspaceId: binding.workspaceId, sessionId: binding.sessionId, actor: 'teacher', purpose: binding.purpose }, ModelLearningSearchInputSchema.parse(args));
    },
  }));
}
