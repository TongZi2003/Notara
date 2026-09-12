/**
 * P3.1/P3.2 the materials page: one workspace's imported originals, read on the
 * spot.
 *
 * Every row and every version here comes from the Host's own reply; the page
 * keeps no fixture array and invents no material, no name and no version.
 * Reading a file never creates a lesson and never sends a message: opening the
 * classroom preview is an action the student takes, and it resolves through the
 * real Session that was on stage when they took it.
 *
 * A Remote call may fail *and* may throw (a dropped transport is not the same as
 * a refusal), so the page distinguishes three outcomes: accepted, refused with a
 * named reason, and unknown. An unknown outcome keeps that file's own upload —
 * same operation id, same bytes — so a retry is the same import instead of a
 * second one under a name the first attempt may already have taken.
 */
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots';
import type { Context } from '@deepseek-ai/cordis';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { MaterialContext, SourceAnchor } from '@studyforge/contracts/materials';
import type { ImportUpload, MaterialBytes, MaterialResource, VersionUpload } from '@studyforge/contracts/material-api';
import type { MaterialRef, MaterialVersion, MaterialView } from '@studyforge/contracts/material-records';
import type { SkeletonView } from '@studyforge/contracts/skeleton';
import type { DocxIndex } from '@studyforge/domain/docx';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BookWorkspace } from './BookWorkspace.tsx';
import type { MaterialNavigation } from './material-navigation.ts';
import { captureAnchors } from './anchors/index.ts';
import { ImportMaterial } from './ImportMaterial.tsx';
import { isBookFormat } from './MaterialOutline.tsx';
import type { SourceReferences } from './source-selection.ts';
import { rememberSourceText, sourceTextOf } from './source-text.ts';
import { SourceCapture } from './SourceCapture.tsx';
import type { NativeResourceParams } from './native-preview-adapter.ts';
import {
  DOCX_MEDIA_TYPE, byteLabel, decodeBase64, decodeText, encodeBase64, importFailureCopy,
  kindLabel, mediaTypeOfName, titleFromFileName, versionFailureCopy,
} from './files.ts';

/** This page's key in the layout's `main` slot and its sidebar row. */
export const MATERIALS_PAGE_ID = 'studyforge.materials';

/**
 * The Host business face the page calls. It travels as one nested object so its
 * identity is the plugin apply's, not a fresh object per render: the page's
 * effects and callbacks depend on it directly.
 */
export interface MaterialsFace {
  list(): Promise<RemoteResult<MaterialView[]>>;
  importMaterial(upload: ImportUpload): Promise<RemoteResult<MaterialView>>;
  createVersion(upload: VersionUpload): Promise<RemoteResult<MaterialView>>;
  bytes(ref: MaterialRef): Promise<RemoteResult<MaterialBytes>>;
  docxIndex(ref: MaterialRef): Promise<RemoteResult<DocxIndex>>;
  resolveForSession(input: { sessionId: string; source: MaterialContext }): Promise<RemoteResult<MaterialResource>>;
  /** The book's own saved sections, or none at all; reading never writes one. */
  skeleton(input: { materialId: string }): Promise<RemoteResult<SkeletonView>>;
  /**
   * Show one resolved address in the lesson's own right column. The column's
   * seat belongs to the classroom, so this returns to it first and only then
   * hands the address to the native registry.
   */
  openInClassroom(address: string, params?: NativeResourceParams): Promise<void>;
}

export interface MaterialsInjected {
  readonly ctx: Context;
  readonly navigation: MaterialNavigation;
  readonly host: MaterialsFace;
  /** The references the composer holds; a fresh selection is staged here. */
  readonly references: SourceReferences;
}

export type MaterialsPageProps = ComposedProps<'main', typeof MATERIALS_PAGE_ID, never, undefined, MaterialsInjected>;

type ListState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly materials: readonly MaterialView[] };

type Notice = { readonly kind: 'ok' | 'info' | 'error'; readonly text: string };

/** One selected original version; identity only, exactly as the Host spells it. */
interface Selected {
  readonly materialId: string;
  readonly versionId: string;
  readonly locator?: MaterialContext['locator'];
}

/** One upload whose outcome never came back, kept whole so a retry is the same import. */
interface Unsettled {
  readonly what: 'import' | 'version';
  readonly title: string;
  readonly upload: ImportUpload | VersionUpload;
}

/** The refusal codes that say "this will be refused again", so retrying is pointless. */
const SETTLED_REFUSALS = /material_name_exists|material_type_mismatch|material_content_invalid|material_too_large|material_encoding_invalid|material_name_invalid|version_conflict|material_missing/u;

/** The materials page: import, list, and read one original at a time. */
export function MaterialsPage({ useSessions, host, references, ctx, navigation }: MaterialsPageProps): React.JSX.Element {
  const currentSession = useSessions(state => state.current);
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const navigated = useSyncExternalStore(navigation.subscribe, navigation.read);
  const [selected, setSelected] = useState<Selected | undefined>(navigated);
  useEffect(() => { if (navigated) setSelected(navigated); }, [navigated]);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [unsettled, setUnsettled] = useState<Unsettled | undefined>(undefined);
  // The lesson a resolve may open into is the one on stage *now*, read at the
  // moment of the call: a stale prop would open one lesson's file in another.
  const currentRef = useRef<string | undefined>(undefined);
  currentRef.current = currentSession;
  const readCurrentSession = useCallback(() => currentRef.current, []);

  const reload = useCallback(async () => {
    try {
      const result = await host.list();
      setList(result.ok ? { status: 'ready', materials: result.value } : { status: 'failed' });
    } catch {
      setList({ status: 'failed' });
    }
  }, [host]);

  useEffect(() => { void reload(); }, [reload]);

  /** Send one upload and keep it whole whenever the outcome is not knowable. */
  const send = useCallback(async (what: Unsettled['what'], title: string, upload: ImportUpload | VersionUpload) => {
    setPending(true);
    setUnsettled(undefined);
    let result: RemoteResult<MaterialView> | undefined;
    try {
      result = what === 'import' ? await host.importMaterial(upload as ImportUpload) : await host.createVersion(upload as VersionUpload);
    } catch {
      result = undefined;
    }
    setPending(false);
    if (result === undefined || (!result.ok && !SETTLED_REFUSALS.test(result.error.message))) {
      setUnsettled({ what, title, upload });
      setNotice({ kind: 'info', text: `《${title}》这次没有结果回来。点「重试」会按同一次上传再试，不会变成第二份。` });
      return;
    }
    if (result.ok) {
      setNotice(what === 'import'
        ? { kind: 'ok', text: `《${result.value.title}》收好了，可以直接读。` }
        : { kind: 'ok', text: `《${result.value.title}》多了第 ${String(result.value.versions.length)} 版；旧版还在，随时能翻回去。` });
      setSelected({ materialId: result.value.materialId, versionId: result.value.currentVersion.versionId });
    } else {
      setNotice({ kind: 'error', text: what === 'import' ? importFailureCopy(result.error.message) : versionFailureCopy(result.error.message) });
    }
    await reload();
  }, [host, reload]);

  const importFiles = useCallback(async (files: readonly File[]) => {
    for (const file of files) {
      const mediaType = mediaTypeOfName(file.name);
      if (mediaType === undefined) {
        setNotice({ kind: 'error', text: `「${file.name}」这一种还不能导入：现在支持 PDF、Word、图片、Markdown、网页和纯文本。` });
        continue;
      }
      const title = titleFromFileName(file.name);
      await send('import', title, {
        operationId: crypto.randomUUID(),
        material: { title, fileName: file.name, mediaType },
        base64: encodeBase64(new Uint8Array(await file.arrayBuffer())),
      });
    }
  }, [send]);

  const addVersion = useCallback(async (view: MaterialView, file: File) => {
    const mediaType = mediaTypeOfName(file.name);
    if (mediaType === undefined) {
      setNotice({ kind: 'error', text: `「${file.name}」这一种还不能当作新版本：现在支持 PDF、Word、图片、Markdown、网页和纯文本。` });
      return;
    }
    // The revision read with the view is what this append confirms; a stale one
    // is refused by the Host rather than overwriting whatever happened since.
    await send('version', view.title, {
      operationId: crypto.randomUUID(),
      expectedVersion: view.revision,
      material: { materialId: view.materialId, title: view.title, fileName: file.name, mediaType },
      base64: encodeBase64(new Uint8Array(await file.arrayBuffer())),
    });
  }, [send]);

  const materials = list.status === 'ready' ? list.materials : [];
  const active = selected === undefined ? undefined : materials.find(view => view.materialId === selected.materialId);
  const activeVersion = active === undefined ? undefined
    : active.versions.find(version => version.versionId === selected?.versionId) ?? active.currentVersion;

  return <main className="sf-page sf-materials" data-studyforge-page={MATERIALS_PAGE_ID} data-testid={`studyforge-page-${MATERIALS_PAGE_ID}`}>
    <header className="sf-page-head"><span className="sf-kicker">资料</span><span className="sf-page-date">{todayLabel()}</span></header>
    <div className="sf-materials-body">
      <div className="sf-materials-column">
        <ImportMaterial pending={pending} onFiles={files => { void importFiles(files); }} />
        {notice !== undefined && <p className={notice.kind === 'error' ? 'sf-notice sf-notice-error' : 'sf-notice'} role="status"
          data-testid="materials-notice" data-notice-kind={notice.kind}>{notice.text}</p>}
        {unsettled !== undefined && <button type="button" className="sf-action sf-action-quiet" data-testid="materials-retry" disabled={pending}
          onClick={() => { void send(unsettled.what, unsettled.title, unsettled.upload); }}>
          重试《{unsettled.title}》
        </button>}
        <section className="sf-materials-list" aria-label="你的资料">
          <h2>你的资料</h2>
          {list.status === 'loading' && <p className="sf-note" role="status">正在看你的资料…</p>}
          {list.status === 'failed' && <p className="sf-note" role="status">资料列表暂时取不到，稍后再看一次。</p>}
          {list.status === 'ready' && (materials.length === 0
            ? <p className="sf-note" data-testid="materials-empty">还没有资料。上面放一份文件进来，就能直接读。</p>
            : <ul data-testid="materials-list">
              {materials.map(view => <MaterialRow
                key={view.materialId}
                view={view}
                selected={view.materialId === selected?.materialId}
                pending={pending}
                onOpen={() => { setSelected({ materialId: view.materialId, versionId: view.currentVersion.versionId }); }}
                onAddVersion={file => { void addVersion(view, file); }}
              />)}
            </ul>)}
        </section>
      </div>
      <div className="sf-material-reader" data-testid="material-reader">
        {active === undefined || activeVersion === undefined
          ? <p className="sf-note" role="status">左边选一份资料，就在这里直接读。</p>
          : <MaterialReader
            ctx={ctx}
            locator={selected?.locator}
            onSource={source => setSelected(source)}
            view={active}
            version={activeVersion}
            host={host}
            references={references}
            sessionId={currentSession}
            readCurrentSession={readCurrentSession}
            onSelectVersion={versionId => { setSelected({ materialId: active.materialId, versionId }); }}
            onNotice={setNotice}
          />}
      </div>
    </div>
  </main>;
}

/** One original in the list: its Host title, and the explicit way to add a version. */
function MaterialRow({ view, selected, pending, onOpen, onAddVersion }: {
  readonly view: MaterialView;
  readonly selected: boolean;
  readonly pending: boolean;
  onOpen(): void;
  onAddVersion(file: File): void;
}): React.JSX.Element {
  const versionInput = `${MATERIALS_PAGE_ID}-version-${view.materialId}`;
  return <li className={selected ? 'sf-material-row sf-material-row-on' : 'sf-material-row'} data-testid="material-row" data-material-title={view.title}>
    <button type="button" className="sf-material-open" onClick={onOpen} aria-current={selected}>
      <span className="sf-material-title">{view.title}</span>
      <span className="sf-meta">{kindLabel(view.mediaType)} · {byteLabel(view.currentVersion.byteLength)} · {view.versions.length > 1 ? `${String(view.versions.length)} 个版本` : '1 个文件'}</span>
    </button>
    <label className="sf-material-version" htmlFor={versionInput} data-testid="material-new-version">
      新版本
      <input id={versionInput} type="file" data-testid="material-new-version-input" disabled={pending} onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file !== undefined) onAddVersion(file);
      }} />
    </label>
  </li>;
}

type ReaderState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly text: string }
  | { readonly status: 'ready'; readonly data: Uint8Array; readonly index: DocxIndex | undefined };

/** One version's real content, plus the way into the lesson's own right column. */
function MaterialReader({ view, version, host, references, sessionId, readCurrentSession, onSelectVersion, onNotice, ctx, locator, onSource }: {
  readonly ctx: Context;
  readonly locator: MaterialContext['locator'];
  onSource(source: SourceAnchor): void;
  readonly view: MaterialView;
  readonly version: MaterialVersion;
  readonly host: MaterialsFace;
  readonly references: SourceReferences;
  readonly sessionId: string | undefined;
  readCurrentSession(): string | undefined;
  onSelectVersion(versionId: string): void;
  onNotice(notice: Notice): void;
}): React.JSX.Element {
  const [state, setState] = useState<ReaderState>({ status: 'loading' });
  const [opening, setOpening] = useState(false);
  const [mobileView, setMobileView] = useState<'original' | 'structure'>('original');

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    void (async () => {
      const ref: MaterialRef = { materialId: version.materialId, versionId: version.versionId };
      try {
        const bytes = await host.bytes(ref);
        if (!live) return;
        if (!bytes.ok) {
          setState({ status: 'failed', text: '这个版本暂时读不出来，稍后再试一次。' });
          return;
        }
        // A DOCX keeps its structure index beside its bytes; a failure here costs
        // the block ids, never the preview.
        let index: DocxIndex | undefined;
        if (version.mediaType === DOCX_MEDIA_TYPE) {
          const docx = await host.docxIndex(ref);
          if (!live) return;
          index = docx.ok ? docx.value : undefined;
        }
        if (!live) return;
        setState({ status: 'ready', data: decodeBase64(bytes.value.base64), index });
      } catch {
        if (live) setState({ status: 'failed', text: '这个版本暂时读不出来，稍后再试一次。' });
      }
    })();
    return () => { live = false; };
  }, [host, version]);

  async function openInClassroom(): Promise<void> {
    // The lesson is fixed when the student asks, not when the answer arrives.
    const started = readCurrentSession();
    if (started === undefined) return;
    setOpening(true);
    let result: RemoteResult<MaterialResource> | undefined;
    try {
      result = await host.resolveForSession({ sessionId: started, source: { materialId: version.materialId, versionId: version.versionId } });
    } catch {
      result = undefined;
    }
    setOpening(false);
    if (result === undefined || !result.ok) {
      onNotice({ kind: 'info', text: '这节课暂时打不开这份资料：它可能已经不在，或这节课没有读它的授权。' });
      return;
    }
    // The column belongs to whoever is on stage now; opening another lesson's
    // address there would read one lesson's file in the wrong surface.
    if (readCurrentSession() !== started) {
      onNotice({ kind: 'info', text: '课已经换到另一节了，再点一次就在现在这节课里打开。' });
      return;
    }
    try {
      await host.openInClassroom(result.value.address, { studyforge: { source: { materialId: version.materialId, versionId: version.versionId }, version: result.value.version } });
    } catch {
      onNotice({ kind: 'info', text: '这个格式还没有课堂预览，先在左边读着。' });
    }
  }

  return <>
    <header className="sf-material-head">
      <h2>{view.title}</h2>
      <p className="sf-meta">{kindLabel(version.mediaType)} · {byteLabel(version.byteLength)} · {formatDay(version.importedAt)}</p>
      <div className="sf-material-head-actions">
        {view.versions.length > 1 && <label className="sf-material-versions">
          <span>版本</span>
          <select data-testid="material-version-select" value={version.versionId} onChange={event => { onSelectVersion(event.target.value); }}>
            {view.versions.map((item, index) => <option key={item.versionId} value={item.versionId}>
              第 {String(index + 1)} 版 · {formatDay(item.importedAt)} · {byteLabel(item.byteLength)}{item.versionId === view.currentVersion.versionId ? ' · 当前' : ''}
            </option>)}
          </select>
        </label>}
        <button type="button" className="sf-action sf-action-quiet" data-testid="material-open-classroom"
          disabled={sessionId === undefined || opening}
          title={sessionId === undefined ? '先开一节课，才能在课堂右栏里读' : '在这节课的右栏打开'}
          onClick={() => { void openInClassroom(); }}>
          在课堂右栏打开
        </button>
      </div>
      {sessionId === undefined && <p className="sf-note">还没有正在上的课：这里先直接读；右栏预览需要一节课。</p>}
    </header>
    {isBookFormat(version.mediaType) && <nav className="sf-book-mobile-tabs"><button className="sf-quiet" onClick={() => setMobileView('original')}>原文</button><button className="sf-quiet" onClick={() => setMobileView('structure')}>结构</button></nav>}
    <div className={isBookFormat(version.mediaType) ? 'sf-book-columns' : undefined} data-view={mobileView}>
    <div className="sf-book-original">
    <div className="sf-material-view"

      ref={element => {
        // The rendered DOM is HTML; the source text is remembered beside the
        // element the selection will come from, never by a global lookup.
        if (element !== null && state.status === 'ready') rememberSourceText(element, sourceTextOfVersion(version, state.data));
      }}>
      {state.status === 'loading' && <p className="sf-note" role="status">正在取原件…</p>}
      {state.status === 'failed' && <p className="sf-note" role="status">{state.text}</p>}
      {state.status === 'ready' && <SourceCapture version={version} data={state.data} index={state.index} references={references} sessionId={sessionId} locator={locator} />}
    </div>
    </div>
    {isBookFormat(version.mediaType) && <BookWorkspace key={version.materialId} ctx={ctx} source={{ materialId: version.materialId, versionId: version.versionId }} onSource={source => { onSource(source); setMobileView('original'); }} />}
    </div>
  </>;
}

/** What one reader element says about the material it renders. */
interface CaptureMeta {
  readonly materialId: string;
  readonly versionId: string;
  readonly mediaType: string;
  readonly title: string;
}

/** Stamped on the reader so a selection can name the material it came from. */
function captureMeta(view: MaterialView, version: MaterialVersion): string {
  return JSON.stringify({ materialId: version.materialId, versionId: version.versionId, mediaType: version.mediaType, title: view.title } satisfies CaptureMeta);
}

/** The stamp, parsed; an unreadable stamp is no stamp. */
function readCaptureMeta(wrapper: HTMLElement): CaptureMeta | undefined {
  const raw = wrapper.dataset.sfCapture;
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as CaptureMeta;
    return typeof parsed.materialId === 'string' && typeof parsed.versionId === 'string' && typeof parsed.mediaType === 'string'
      ? parsed : undefined;
  } catch { return undefined; }
}

/** The student's own words for where the selection sits. */
function describeAnchors(anchors: readonly SourceAnchor[]): string {
  const first = anchors[0];
  if (first === undefined) return '选段';
  switch (first.locator.kind) {
    case 'pdf': return `第 ${String(first.locator.page)} 页`;
    case 'text': return `第 ${String(first.locator.start.line)} 行`;
    case 'image': return '图上一处';
    case 'docx': return '选段';
  }
}

/** The material's own text for formats whose preview renders it verbatim. */
function sourceTextOfVersion(version: MaterialVersion, data: Uint8Array): string {
  return version.mediaType === 'text/markdown' || version.mediaType === 'text/plain' ? decodeText(data) : '';
}

/** One day label for an import time; the Host's timestamp is the only source. */
function formatDay(timestamp: string): string {
  const time = new Date(timestamp);
  return Number.isNaN(time.getTime()) ? timestamp : new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(time);
}

function todayLabel(): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
}
