import type { Context } from '@deepseek-ai/cordis';
import type { ClassroomModelRoute } from '@studyforge/contracts/classroom';

/**
 * Every provider × model route this deployment can currently serve. One
 * adapter failure only drops that provider's models — the route list itself
 * stays honest. Shared by the student-facing classroom picker and the
 * teacher-facing delegate route reader.
 */
export async function listModelRoutes(ctx: Context): Promise<ClassroomModelRoute[]> {
  const routes: ClassroomModelRoute[] = [];
  for (const provider of ctx.llm.listProviders()) {
    let models;
    try { models = await ctx.llm.listModels(provider.id); } catch { continue; }
    for (const model of models) {
      let reasoningEfforts: { id: string; name: string }[] = [];
      try {
        const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id);
        reasoningEfforts = resolved.reasoning?.efforts.map(effort => ({ id: String(effort.id), name: effort.name })) ?? [];
      } catch { /* The model remains selectable; exact validation belongs to DSH at spawn. */ }
      routes.push({ provider: provider.id, providerName: provider.name, model: model.id, modelName: model.name, reasoningEfforts });
    }
  }
  return routes;
}
