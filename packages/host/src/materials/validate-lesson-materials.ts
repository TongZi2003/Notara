import type { Context } from '@deepseek-ai/cordis';
import { LessonMaterialsSchema, type HostContext, type LessonMaterials } from '@studyforge/contracts';
import { readMaterial } from '@studyforge/domain/material-read';

export async function validateLessonMaterials(host: Context, ctx: HostContext, draft: LessonMaterials): Promise<void> {
  const input = LessonMaterialsSchema.parse(draft);
  for (const item of input.materials) {
    if (item.kind === 'card') host.studyforgeCardService.read(ctx, item.cardRef);
    else {
      await host.studyforgeMaterialService.resolve(ctx, { materialId: item.source.materialId, versionId: item.source.versionId });
      if (item.source.locator) await readMaterial(host.studyforgeMaterialService, ctx, item.source);
    }
  }
}
