/**
 * One immutable original, read inside the pane that opened it.
 *
 * The lesson's own grant resolves the version first (`resolveForSession`), then
 * the bytes of exactly that version are read — never the current one, and never
 * another lesson's. Reading here is the same act as reading in the native file
 * tab: the body is the shared `SourceCapture`, so selecting a stretch or a crop
 * stages through the composer's own ledger (see `source-references-holder`).
 *
 * A pane that cannot reach the ledger still reads: it falls back to the shared
 * read-only preview and says so, rather than offering a selection that would
 * never reach the message.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { MaterialContext, SourceLocator } from '@studyforge/contracts/materials';
import type { MaterialBytes, MaterialResource } from '@studyforge/contracts/material-api';
import type { MaterialRef, MaterialVersion } from '@studyforge/contracts/material-records';
import type { DocxIndex } from '@studyforge/domain/docx';
import { useEffect, useState } from 'react';
import { MaterialPreview } from './MaterialPreview.tsx';
import { SourceCapture } from './SourceCapture.tsx';
import { DOCX_MEDIA_TYPE, decodeBase64 } from './files.ts';
import { heldSourceReferences } from './source-references-holder.ts';

/** The lesson-bound reads one original needs; the Host owns every answer. */
export interface SourcePaneFace {
  resolveForSession(input: { readonly sessionId: string; readonly source: MaterialContext }): Promise<RemoteResult<MaterialResource>>;
  bytes(ref: MaterialRef): Promise<RemoteResult<MaterialBytes>>;
  docxIndex(ref: MaterialRef): Promise<RemoteResult<DocxIndex>>;
}

export interface SourcePaneProps {
  readonly face: SourcePaneFace;
  readonly sessionId: string;
  /**
   * Every position this node really points at, as the material context the Host
   * itself resolves; one original may be read in two places, and a row whose
   * reference carries no position reads the version from its start.
   */
  readonly anchors: readonly MaterialContext[];
  /**
   * The pane's own browse identity — the right column tab it is drawn in — so
   * the composer remembers what is on screen. Absent leaves capture on but no
   * "you are reading this" mark.
   */
  readonly browseId?: string | undefined;
}

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly text: string }
  | { readonly status: 'ready'; readonly version: MaterialVersion; readonly data: Uint8Array; readonly index: DocxIndex | undefined };

/** Read one position of one original; a second position re-reads the same version. */
export function SourcePane({ face, sessionId, anchors, browseId }: SourcePaneProps): React.JSX.Element {
  const [at, setAt] = useState(0);
  const anchor = anchors[Math.min(at, Math.max(anchors.length - 1, 0))];
  if (anchor === undefined) return <p className="sf-note" role="status">这处原文暂时读不出来。</p>;
  return <>
    {anchors.length > 1 && <nav className="sf-source-anchors" aria-label="这处原文的位置">
      {anchors.map((item, index) => <button key={`${item.versionId}-${String(index)}`} type="button" className="sf-quiet"
        aria-pressed={index === at} data-testid="source-anchor" onClick={() => { setAt(index); }}>{anchorName(item, index)}</button>)}
    </nav>}
    <SourceBody key={`${anchor.materialId}@${anchor.versionId}:${String(at)}`} face={face} sessionId={sessionId} anchor={anchor} browseId={browseId} />
  </>;
}

/** One original's own bytes, at one position, in the pane that opened it. */
function SourceBody({ face, sessionId, anchor, browseId }: { readonly face: SourcePaneFace; readonly sessionId: string; readonly anchor: MaterialContext; readonly browseId?: string | undefined }): React.JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [page, setPage] = useState<number | undefined>(undefined);
  const references = heldSourceReferences();
  useEffect(() => {
    let live = true;
    setPage(undefined);
    setState({ status: 'loading' });
    void (async () => {
      const source: MaterialContext = { materialId: anchor.materialId, versionId: anchor.versionId, ...(anchor.locator === undefined ? {} : { locator: anchor.locator }) };
      let resolved: RemoteResult<MaterialResource>;
      try { resolved = await face.resolveForSession({ sessionId, source }); }
      catch { if (live) setState({ status: 'failed', text: '网络没接上，稍后再点一次。' }); return; }
      if (!live) return;
      if (!resolved.ok) { setState({ status: 'failed', text: '这节课暂时打不开这份资料：可能已经不在，或这节课没有读它的授权。' }); return; }
      const ref: MaterialRef = { materialId: resolved.value.version.materialId, versionId: resolved.value.version.versionId };
      try {
        const bytes = await face.bytes(ref);
        if (!live) return;
        if (!bytes.ok) { setState({ status: 'failed', text: '这个版本暂时读不出来，稍后再试一次。' }); return; }
        let index: DocxIndex | undefined;
        if (bytes.value.version.mediaType === DOCX_MEDIA_TYPE) {
          const docx = await face.docxIndex(ref);
          if (!live) return;
          index = docx.ok ? docx.value : undefined;
        }
        if (!live) return;
        setState({ status: 'ready', version: bytes.value.version, data: decodeBase64(bytes.value.base64), index });
      } catch { if (live) setState({ status: 'failed', text: '这个版本暂时读不出来，稍后再试一次。' }); }
    })();
    return () => { live = false; };
  }, [face, sessionId, anchor.materialId, anchor.versionId, anchor.locator]);
  // What the composer remembers this pane is showing; the version is the
  // resolved one, so a stale anchor can never stand in for another version.
  const locator: SourceLocator | undefined = page !== undefined && (anchor.locator?.kind !== 'pdf' || page !== anchor.locator.page)
    ? { kind: 'pdf', page } : anchor.locator;
  useEffect(() => {
    if (state.status !== 'ready' || references === undefined || browseId === undefined) return undefined;
    return references.browse(browseId, {
      sessionId, label: state.version.title,
      context: { currentMaterial: { kind: 'source', source: { materialId: state.version.materialId, versionId: state.version.versionId, ...(locator === undefined ? {} : { locator }) } } },
    });
  }, [references, browseId, sessionId, state, anchor.locator, page]);
  if (state.status === 'loading') return <p className="sf-note" role="status">正在取原件…</p>;
  if (state.status === 'failed') return <p className="sf-note" role="status">{state.text}</p>;
  if (references === undefined) return <>
    <p className="sf-note" role="status">这里按原文只读；到资料页打开可以圈选引用。</p>
    <MaterialPreview version={state.version} data={state.data} index={state.index} locator={anchor.locator} />
  </>;
  return <SourceCapture version={state.version} data={state.data} index={state.index} references={references}
    sessionId={sessionId} locator={anchor.locator} onPage={setPage} />;
}

/** What one position of one original is called, in the student's words. */
function anchorName(anchor: MaterialContext, index: number): string {
  const locator = anchor.locator;
  if (locator === undefined) return `原文 ${String(index + 1)}`;
  switch (locator.kind) {
    case 'text': return `第 ${String(locator.start.line)} 行`;
    case 'pdf': return `第 ${String(locator.page)} 页`;
    case 'image': return '图上选区';
    case 'docx': return '选段';
  }
}
