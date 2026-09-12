/**
 * P3.2 PDF reading with the pdf.js the product already ships
 * (pdfjs-dist@6.3.289, the same engine the native document preview renders
 * with). Pages are drawn onto a canvas one at a time, with paging and zoom under
 * the reader's control; nothing is fetched from a network path, because the
 * worker travels inside this client's own bundle (see `worker.ts`).
 *
 * Every render goes to its own offscreen canvas and reaches the visible one only
 * after it has actually finished, so a fast page turn or a burst of zooming can
 * never leave two renders drawing into one canvas, and the visible page is never
 * an older page dressed up as the requested one. A real failure clears the
 * canvas and says so; only a superseded (`live` false) or cancelled
 * (`RenderingCancelledException`) render is dropped without a word.
 *
 * One scale decides both the pixels and the displayed box, so the page always
 * keeps its own proportions and zooming really changes the size on screen; a
 * page wider than the column scrolls instead of being squeezed. A page opens at
 * fit-width and the fit button puts it back there.
 */
import { getDocument, RenderingCancelledException, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import { acquirePdfWorker, releasePdfWorker } from './worker.ts';

export interface PdfViewerProps {
  /** The exact version's bytes; the copy handed to pdf.js is this component's own. */
  readonly data: Uint8Array;
  readonly title: string;
  readonly revealPage?: number | undefined;
  readonly onPage?: ((page: number) => void) | undefined;
  /**
   * Reports the page that is really on screen, after it finished drawing. A
   * locator must be built from this, never from the page someone asked for.
   */
  readonly onDisplayed?: ((shown: { readonly page: number; readonly scale: number }) => void) | undefined;
}

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly pages: number };

/** One page at a time, at the reader's own zoom. */
export function PdfViewer({ data, title, onDisplayed, revealPage, onPage }: PdfViewerProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageBoxRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef<PDFDocumentProxy | undefined>(undefined);
  const taskRef = useRef<PDFDocumentLoadingTask | undefined>(undefined);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [requested, setRequested] = useState(1);
  const [scale, setScale] = useState(1.2);
  /** Whether the student set the size themselves; until they do, the page fits. */
  const [zoomed, setZoomed] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const [boxWidth, setBoxWidth] = useState<number | undefined>(undefined);
  const [displayed, setDisplayed] = useState<{ readonly page: number; readonly scale: number } | undefined>(undefined);
  const [drawing, setDrawing] = useState(false);
  const [failedPage, setFailedPage] = useState<number | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { if (displayed) onPage?.(displayed.page); }, [displayed?.page, onPage]);
  useEffect(() => { if (revealPage !== undefined && load.status === 'ready') setRequested(Math.min(revealPage, load.pages)); }, [revealPage, load]);

  // The column the page is shown in; its width is what fit-width fits into, and
  // a resize re-fits a page the student has not sized by hand.
  useEffect(() => {
    const box = pageBoxRef.current;
    if (box === null) return;
    const measure = (): void => { setBoxWidth(box.clientWidth); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => { observer.disconnect(); };
  }, [load.status]);

  useEffect(() => {
    let live = true;
    setLoad({ status: 'loading' });
    setRequested(1);
    setDisplayed(undefined);
    setFailedPage(undefined);
    acquirePdfWorker();
    const task = getDocument({ data: data.slice() });
    taskRef.current = task;
    task.promise.then(loaded => {
      if (!live) { void task.destroy(); return; }
      documentRef.current = loaded;
      setLoad({ status: 'ready', pages: loaded.numPages });
    }, () => {
      if (live) setLoad({ status: 'failed' });
    });
    return () => {
      live = false;
      documentRef.current = undefined;
      const loading = taskRef.current;
      taskRef.current = undefined;
      void loading?.destroy();
      releasePdfWorker();
    };
  }, [data]);

  useEffect(() => {
    const loaded = documentRef.current;
    const visible = canvasRef.current;
    if (load.status !== 'ready' || loaded === undefined || visible === null) return;
    const pageNumber = Math.min(Math.max(requested, 1), load.pages);
    let live = true;
    let render: RenderTask | undefined;
    setDrawing(true);
    // The offscreen canvas is this request's own; the visible one is written
    // once, at the end, and only by the request that is still current.
    const offscreen = document.createElement('canvas');
    void (async () => {
      try {
        const page = await loaded.getPage(pageNumber);
        if (!live) return;
        // One scale for pixels and for the box: the ratio cannot drift apart.
        const natural = page.getViewport({ scale: 1 });
        const shown = zoomed ? scale : fitWidthScale(natural.width, boxWidth);
        const viewport = page.getViewport({ scale: shown });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        offscreen.width = Math.floor(viewport.width * ratio);
        offscreen.height = Math.floor(viewport.height * ratio);
        const started = page.render({
          canvas: offscreen,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        render = started;
        await started.promise;
        if (!live) return;
        const context = visible.getContext('2d');
        if (context === null) throw new Error('pdf_canvas_unavailable');
        visible.width = offscreen.width;
        visible.height = offscreen.height;
        visible.style.width = `${String(round2(viewport.width))}px`;
        visible.style.height = `${String(round2(viewport.height))}px`;
        context.clearRect(0, 0, visible.width, visible.height);
        context.drawImage(offscreen, 0, 0);
        visible.dataset.sfPdfPage = JSON.stringify({
          page: pageNumber, rotate: page.rotate, view: page.view, transform: natural.transform,
          baseWidth: natural.width, baseHeight: natural.height, renderedWidth: viewport.width, renderedHeight: viewport.height,
        });
        setDisplayed({ page: pageNumber, scale: round2(shown) });
        setFailedPage(undefined);
        setDrawing(false);
        onDisplayed?.({ page: pageNumber, scale: round2(shown) });
      } catch (error) {
        if (!live) return;
        setDrawing(false);
        // A superseded render is not a failure; anything else is, and the older
        // page must not stay on screen as if it were this one.
        if (error instanceof RenderingCancelledException) return;
        const context = visible.getContext('2d');
        context?.clearRect(0, 0, visible.width, visible.height);
        setDisplayed(undefined);
        setFailedPage(pageNumber);
      }
    })();
    return () => { live = false; render?.cancel(); };
  }, [load, requested, scale, zoomed, boxWidth, fitNonce, attempt, onDisplayed]);

  if (load.status === 'failed') return <p className="sf-note" role="status" data-testid="pdf-failed">这份 PDF 读不出来，可能已经损坏。</p>;
  const label = load.status !== 'ready' ? '正在打开…'
    : displayed !== undefined ? `第 ${String(displayed.page)} / ${String(load.pages)} 页`
      : failedPage !== undefined ? '这一页没有画出来'
        : '正在画…';
  return <div className="sf-pdf" data-testid="pdf-viewer"
    data-pdf-requested-page={requested}
    data-pdf-displayed-page={displayed?.page}
    data-pdf-displayed-scale={displayed?.scale}>
    <div className="sf-pdf-tools">
      <button type="button" className="sf-pdf-button" data-testid="pdf-prev" disabled={load.status !== 'ready' || requested <= 1}
        onClick={() => { setRequested(value => Math.max(1, value - 1)); }}>上一页</button>
      <span className="sf-meta" data-testid="pdf-page">{label}</span>
      <button type="button" className="sf-pdf-button" data-testid="pdf-next" disabled={load.status !== 'ready' || requested >= load.pages}
        onClick={() => { setRequested(value => Math.min(load.status === 'ready' ? load.pages : value, value + 1)); }}>下一页</button>
      <button type="button" className="sf-pdf-button" data-testid="pdf-zoom-out"
        onClick={() => { setZoomed(true); setScale(clampScale((displayed?.scale ?? scale) - 0.2)); }}>缩小</button>
      <button type="button" className="sf-pdf-button" data-testid="pdf-zoom-in"
        onClick={() => { setZoomed(true); setScale(clampScale((displayed?.scale ?? scale) + 0.2)); }}>放大</button>
      <button type="button" className="sf-pdf-button" data-testid="pdf-fit"
        onClick={() => { setZoomed(false); setFitNonce(count => count + 1); }}>适应宽度</button>
      <span className="sf-meta" data-testid="pdf-scale">{displayed === undefined ? '—' : `${String(Math.round(displayed.scale * 100))}%`}</span>
    </div>
    {drawing && displayed?.page !== requested && <p className="sf-note" role="status" data-testid="pdf-drawing">正在画第 {requested} 页…</p>}
    {failedPage !== undefined && <p className="sf-note" role="status" data-testid="pdf-page-failed">
      第 {failedPage} 页画不出来，可能是这一页的内容有问题。<button type="button" className="sf-pdf-button" data-testid="pdf-retry"
        onClick={() => { setAttempt(value => value + 1); }}>再画一次</button>
    </p>}
    <div className="sf-pdf-page" data-testid="pdf-page-box" ref={pageBoxRef}>
      <canvas ref={canvasRef} aria-label={title} data-testid="pdf-canvas" />
    </div>
  </div>;
}

/** A width for fit-width that never grows absurdly past the page's own size. */
function fitWidthScale(pageWidth: number, boxWidth: number | undefined): number {
  if (boxWidth === undefined || boxWidth <= 0 || pageWidth <= 0) return 1.2;
  return Math.min(Math.max((boxWidth - 2) / pageWidth, 0.2), 2);
}

function clampScale(value: number): number {
  return Number(Math.min(Math.max(value, 0.2), 4).toFixed(2));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}
