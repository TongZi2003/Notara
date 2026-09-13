import type { MaterialView } from '@studyforge/contracts/material-records';
import type { LessonResource } from '@studyforge/domain/lesson-resources';

/** Read-only whiteboard inventory. An inventory row has no classroom origin.
 * Keep actual lesson positions and pinned old versions intact when adding the
 * library's current originals; browsing never adds lesson membership or study.
 */
export function workbenchMaterials(materials: readonly MaterialView[], lesson: readonly LessonResource[]): readonly LessonResource[] {
  const present = new Set(lesson.flatMap(row => row.source ? [`${row.source.materialId}@${row.source.versionId}`] : []));
  return [...lesson, ...materials.filter(view => !present.has(`${view.materialId}@${view.currentVersion.versionId}`)).map((view): LessonResource => ({
    kind: 'material', tabKey: `material:${view.materialId}@${view.currentVersion.versionId}`,
    source: { materialId: view.materialId, versionId: view.currentVersion.versionId },
    target: null, title: view.title, quote: null, origins: [],
  }))];
}
