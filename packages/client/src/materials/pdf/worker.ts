/**
 * One shared Blob URL for pdf.js's bundled worker (main
 * `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` PDF body, so a page that
 * opens and closes viewers never accumulates a worker URL per mount.
 */
import { GlobalWorkerOptions } from 'pdfjs-dist';
import workerSource from 'pdfjs-dist/build/pdf.worker.mjs';

let url: string | undefined;
let holders = 0;

/** Take one reference to the shared worker URL, creating it on the first reader. */
export function acquirePdfWorker(): void {
  holders += 1;
  if (url !== undefined) return;
  url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  GlobalWorkerOptions.workerSrc = url;
}

/** Release one reference; the last reader frees the URL it created. */
export function releasePdfWorker(): void {
  holders = Math.max(0, holders - 1);
  if (holders > 0 || url === undefined) return;
  URL.revokeObjectURL(url);
  url = undefined;
  GlobalWorkerOptions.workerSrc = '';
}
