import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { CoursePatch } from '@studyforge/contracts/courses';
import type { ImportUpload } from '@studyforge/contracts/material-api';
import type { MaterialView } from '@studyforge/contracts/material-records';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { ImportMaterial } from '../materials/ImportMaterial.tsx';
import { encodeBase64, importFailureCopy, mediaTypeOfName, titleFromFileName } from '../materials/files.ts';
import { requestLessonPane } from '../materials/lesson-pane-request.ts';
import { LESSON_TAB_KIND } from './LessonPanel.tsx';
import { LessonSettingsModal } from './LessonSettings.tsx';
import './lesson-start.css';

interface UploadRow {
  readonly id: string;
  readonly file: File;
  upload?: ImportUpload;
  material?: MaterialView;
  attach?: { sessionId: string; operationId: string; expectedVersion: number; patch: CoursePatch };
  status: 'pending' | 'saved' | 'retry' | 'refused';
  message: string;
}

/** A tab can unmount when hidden. Keep its unfinished writes with the lesson
 * for this client lifetime so returning to 开始 can still retry the same upload. */
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
const uploadsByContext = new WeakMap<Context, Map<string, LessonUploads>>();
function uploadsFor(ctx: Context, sessionId: string): LessonUploads {
  let sessions = uploadsByContext.get(ctx);
  if (!sessions) { sessions = new Map(); uploadsByContext.set(ctx, sessions); }
  let queue = sessions.get(sessionId);
  if (!queue) { queue = new LessonUploads(); sessions.set(sessionId, queue); }
  return queue;
}

/** Native 开始 tab: preparation belongs to this tab's session, never whichever
 * lesson happens to be selected when an asynchronous upload finishes. */
export function LessonStart({ ctx, sessionId, useSession, useSessions, useTabInfo }: PropsRuntime<'sidebar.right.tab.guide'> & { ctx: Context }): React.JSX.Element {
  const info = useTabInfo();
  const title = useSessions(state => state.byId[sessionId]?.title || '自由学习');
  const running = useSession(state => state.running);
  const [settings, setSettings] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const readCourse = useCallback((input: { sessionId: string }) => ctx.remote.studyforgeCourses.read(input), [ctx]);
  const uploads = uploadsFor(ctx, sessionId);
  const { rows, busy } = useSyncExternalStore(uploads.subscribe, uploads.read);
  const changed = uploads.publish;

  async function upload(row: UploadRow): Promise<void> {
    row.status = 'pending'; row.message = '正在收下…'; changed();
    try {
      if (!row.material) {
        const mediaType = mediaTypeOfName(row.file.name);
        if (!mediaType) { row.status = 'refused'; row.message = '支持 PDF、Word、图片、Markdown、网页和纯文本。'; return; }
        row.upload ??= { operationId: row.id, material: { title: titleFromFileName(row.file.name), fileName: row.file.name, mediaType },
          base64: encodeBase64(new Uint8Array(await row.file.arrayBuffer())) };
        const result = await ctx.remote.studyforgeMaterials.import(row.upload);
        if (!result.ok) {
          row.status = /material_(name_exists|type_mismatch|content_invalid|too_large|encoding_invalid|name_invalid)/u.test(result.error.message) ? 'refused' : 'retry';
          row.message = row.status === 'refused' ? importFailureCopy(result.error.message) : '暂时没有收到结果，可以重试。';
          return;
        }
        row.material = result.value;
      }
      const material = row.material;
      if (!row.attach) {
        const course = await readCourse({ sessionId });
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
        // Only a definite stale-version refusal releases the attempt. An
        // unknown result retries its exact operation and cannot append twice.
        if (/version_conflict/u.test(saved.error.message)) delete row.attach;
        row.status = 'retry'; row.message = '资料已收好，暂时没能加入本课。'; return;
      }
      row.status = 'saved'; row.message = '已加入本课';
    } catch {
      row.status = 'retry'; row.message = row.material ? '资料已收好，暂时没能加入本课。' : '暂时没有收到结果，可以重试。';
    } finally {
      if (row.status === 'saved') { delete row.upload; delete row.attach; }
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
  return <div className="sf-lesson-start" data-testid="lesson-deck-reopen">
    <div className="sf-start-actions">
      <button type="button" className="sf-start-entry" onClick={() => { info.tab.actions.openTab(LESSON_TAB_KIND); }}>打开工作台 <span aria-hidden="true">→</span></button>
      <button type="button" className="sf-start-settings" data-testid="open-lesson-settings" ref={trigger} onClick={() => { setSettings(true); }}>本课设置</button>
    </div>
    <div className="sf-start-upload">
      <header><h3>外部资料</h3><span>PDF / Word / 图片 / 文本</span></header>
      <ImportMaterial pending={busy} active={info.tab.visible} pasteScope="control" appearance="sheet" onFiles={files} />
      {rows.length > 0 && <ul aria-label="上传结果">{rows.map(row => <li key={row.id}>
        {row.status === 'saved' && row.material ? <button type="button" onClick={() => {
          const material = row.material!;
          requestLessonPane(sessionId, { kind: 'source', title: material.title, anchors: [{ materialId: material.materialId, versionId: material.currentVersion.versionId }] });
          info.tab.actions.openTab(LESSON_TAB_KIND);
        }}>{row.material.title}</button> : <span>{titleFromFileName(row.file.name)}</span>}
        <small role="status">{row.message}</small>
        {row.status === 'retry' && <button type="button" disabled={busy} onClick={() => { void run([row]); }}>重试</button>}
      </li>)}</ul>}
    </div>
    {settings && <LessonSettingsModal ctx={ctx} sessionId={sessionId} title={title} readCourse={readCourse} refreshToken={running}
      onClose={() => { setSettings(false); trigger.current?.focus(); }} />}
  </div>;
}
