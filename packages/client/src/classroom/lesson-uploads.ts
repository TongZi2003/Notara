import type { Context } from '@deepseek-ai/cordis';
import type { CoursePatch } from '@studyforge/contracts/courses';
import type { MaterialView } from '@studyforge/contracts/material-records';
import { useSyncExternalStore } from 'react';
import { importFailureCopy, mediaTypeOfName, titleFromFileName } from '../materials/files.ts';
import { uploadMaterialFile } from '../materials/material-upload.ts';

export interface UploadRow {
  readonly id: string;
  readonly file: File;
  material?: MaterialView;
  attach?: { sessionId: string; operationId: string; expectedVersion: number; patch: CoursePatch };
  status: 'pending' | 'saved' | 'retry' | 'refused';
  message: string;
}

/** All lesson import entry points share the same queue and uncertain writes.
 * It survives component unmounts and always writes to the initiating lesson. */
class LessonUploads {
  rows: UploadRow[] = [];
  busy = false;
  private snapshot = { rows: this.rows, busy: false };
  private readonly listeners = new Set<() => void>();
  readonly read = () => this.snapshot;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  readonly publish = (): void => {
    this.snapshot = { rows: [...this.rows], busy: this.busy };
    for (const listener of this.listeners) listener();
  };
}
// The queue belongs to the lesson, not the mounted control: the composer seat
// and the materials desk mount under different plugin contexts, so keying the
// ledger by Context would split one lesson's attempts into silent halves.
const uploadsBySession = new Map<string, LessonUploads>();
function uploadsFor(sessionId: string): LessonUploads {
  let queue = uploadsBySession.get(sessionId);
  if (!queue) { queue = new LessonUploads(); uploadsBySession.set(sessionId, queue); }
  return queue;
}

export function useLessonUploads(ctx: Context, sessionId: string) {
  const uploads = uploadsFor(sessionId);
  const snapshot = useSyncExternalStore(uploads.subscribe, uploads.read);
  const changed = uploads.publish;
  async function upload(row: UploadRow): Promise<void> {
    row.status = 'pending'; row.message = '正在收下…'; changed();
    try {
      if (!row.material) {
        const mediaType = mediaTypeOfName(row.file.name);
        if (!mediaType) { row.status = 'refused'; row.message = '支持 PDF、Word、图片、Markdown、网页和纯文本。'; return; }
        try {
          row.material = await uploadMaterialFile(ctx, {
            kind: 'import', operationId: row.id, file: row.file,
            material: { title: titleFromFileName(row.file.name), fileName: row.file.name, mediaType },
            onProgress: (received, total) => { row.message = `正在收下… ${Math.round(received / total * 100)}%`; changed(); },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          row.status = /material_(name_exists|type_mismatch|content_invalid|too_large|encoding_invalid|name_invalid)/u.test(message) ? 'refused' : 'retry';
          row.message = row.status === 'refused' ? importFailureCopy(message) : '暂时没有收到结果，可以重试。';
          return;
        }
      }
      const material = row.material;
      if (!row.attach) {
        const course = await ctx.remote.studyforgeCourses.read({ sessionId });
        if (!course.ok) { row.status = 'retry'; row.message = '资料已收好，暂时没能加入本课。'; return; }
        const source = { materialId: material.materialId, versionId: material.currentVersion.versionId };
        const existing = course.value.data.lessonMaterials;
        if (existing.materials.some(item => item.kind === 'source' && item.source.materialId === source.materialId && item.source.versionId === source.versionId)) {
          row.status = 'saved'; row.message = '已加入本课'; return;
        }
        row.attach = { sessionId, operationId: crypto.randomUUID(), expectedVersion: course.value.version,
          patch: { lessonMaterials: { ...existing, materials: [...existing.materials, { kind: 'source', source }] } } };
      }
      const saved = await ctx.remote.studyforgeCourses.update(row.attach);
      if (!saved.ok) {
        // Only a definite stale refusal releases the attempt. An unknown result
        // retries the same operation instead of appending the material twice.
        if (/version_conflict/u.test(saved.error.message)) delete row.attach;
        row.status = 'retry'; row.message = '资料已收好，暂时没能加入本课。'; return;
      }
      row.status = 'saved'; row.message = '已加入本课';
    } catch {
      row.status = 'retry'; row.message = row.material ? '资料已收好，暂时没能加入本课。' : '暂时没有收到结果，可以重试。';
    } finally {
      if (row.status === 'saved') { delete row.attach; }
      changed();
      if (row.status === 'saved') window.dispatchEvent(new Event('studyforge:learning-changed'));
    }
  }
  async function run(batch: UploadRow[]): Promise<void> {
    if (uploads.busy) return;
    uploads.busy = true; changed();
    try { for (const row of batch) await upload(row); }
    finally { uploads.busy = false; changed(); }
  }
  function files(picked: readonly File[]): void {
    if (uploads.busy) return;
    const batch: UploadRow[] = picked.map(file => ({ id: crypto.randomUUID(), file, status: 'pending', message: '等待收下…' }));
    uploads.rows.push(...batch); changed();
    void run(batch);
  }
  return { ...snapshot, files, retry: (row: UploadRow) => { void run([row]); } };
}
