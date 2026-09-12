/**
 * The client build inlines pdf.js's worker module as text (scripts/build.ts
 * text-loads `pdf.worker.mjs`), so the viewer can hand pdf.js a same-page Blob
 * URL instead of a network path. Nothing is fetched from a CDN at runtime.
 */
declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  /** The worker module's own source text, exactly as it was built. */
  const source: string;
  export default source;
}
