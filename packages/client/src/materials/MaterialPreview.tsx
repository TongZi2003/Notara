/**
 * P3.2 the shared format adapter for reading one original.
 *
 * One component, one set of bytes, every entry: the materials page mounts it
 * with the Host's bytes, and a classroom document tab mounts the same pieces
 * (the DOCX body is this component's own `DocxPreview`). Readable formats are
 * read here — Word through `DocxPreview`, PDF through pdf.js, Markdown through
 * the product's own Markdown renderer, plus images, HTML and plain text — so the
 * standalone library and a session cannot drift apart. Reading never opens a
 * lesson and never needs one.
 */
import { useEffect, useState } from 'react';
import type { MaterialVersion } from '@studyforge/contracts/material-records';
import type { DocxIndex } from '@studyforge/domain/docx';
import type { SourceLocator } from '@studyforge/contracts/materials';
import { DOCX_MEDIA_TYPE, decodeText } from './files.ts';
import { MarkdownView } from './MarkdownView.tsx';
import { DocxPreview } from './docx/DocxPreview.tsx';
import { PdfViewer } from './pdf/PdfViewer.tsx';

export interface MaterialPreviewProps {
  /** The exact version whose bytes were read; its type is the Host's own. */
  readonly version: MaterialVersion;
  readonly data: Uint8Array;
  /** Present for DOCX only, so the preview can carry the Host's stable block ids. */
  readonly index: DocxIndex | undefined;
  readonly locator?: SourceLocator | undefined;
  readonly onPage?: ((page: number) => void) | undefined;
}

/** Show one version's real content in the reader its format calls for. */
export function MaterialPreview({ version, data, index, locator, onPage }: MaterialPreviewProps): React.JSX.Element {
  const mediaType = version.mediaType;
  const needsObjectUrl = mediaType.startsWith('image/') || mediaType === 'text/html';
  const objectUrl = useObjectUrl(data, mediaType, needsObjectUrl);

  if (mediaType === DOCX_MEDIA_TYPE) return <DocxPreview data={data} index={index} />;
  if (mediaType === 'application/pdf') return <PdfViewer data={data} title={version.title} revealPage={locator?.kind === 'pdf' || locator?.kind === 'pdftext' ? locator.page : undefined} onPage={onPage} />;
  if (mediaType === 'text/markdown') return <MarkdownView text={decodeText(data)} />;

  if (mediaType.startsWith('image/')) {
    return objectUrl === undefined
      ? <p className="sf-note" role="status">正在展开图片…</p>
      : <img className="sf-material-image" data-testid="material-image" src={objectUrl} alt={version.title} />;
  }

  if (mediaType === 'text/html') {
    // Scripts may run, but the opaque origin stays: no `allow-same-origin`, so the
    // page cannot reach this application or its file reader.
    return objectUrl === undefined
      ? <p className="sf-note" role="status">正在展开网页…</p>
      : <iframe className="sf-material-html" data-testid="material-html" sandbox="allow-scripts" src={objectUrl} title={version.title} />;
  }

  return <pre className="sf-material-text" data-testid="material-text">{decodeText(data)}</pre>;
}

/**
 * One Blob URL for the bytes a browser must decode from a URL, released as soon
 * as the bytes or the format change and again when the reader unmounts.
 */
function useObjectUrl(data: Uint8Array, mediaType: string, needed: boolean): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!needed) { setUrl(undefined); return undefined; }
    const next = URL.createObjectURL(new Blob([data.slice()], { type: mediaType }));
    setUrl(next);
    return () => { setUrl(undefined); URL.revokeObjectURL(next); };
  }, [data, mediaType, needed]);
  return url;
}
