import { z } from 'zod';
import { LessonMaterialSchema } from './materials.ts';
export { LessonMaterialSchema } from './materials.ts';
export type { LessonMaterial } from './materials.ts';

/** Teaching references, never a read allow-list or a native tab mirror. */
export const LessonMaterialsSchema = z.object({
  materials: z.array(LessonMaterialSchema), initialIndex: z.number().int().nonnegative().optional(),
}).strict().refine(({ materials, initialIndex }) => initialIndex === undefined || initialIndex < materials.length,
  { message: 'initialIndex必须指向材料列表中的实际项；空材料不可指定', path: ['initialIndex'] });
export type LessonMaterials = z.infer<typeof LessonMaterialsSchema>;
