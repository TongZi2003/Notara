export const PDF_RESOURCE_PATH: string;
export const PDF_RESOURCE_FILES: Readonly<Record<string, string>>;
export function pdfDocumentOptions(data?: Uint8Array): {
  data?: Uint8Array;
  cMapUrl: string;
  cMapPacked: true;
  standardFontDataUrl: string;
  wasmUrl: string;
  isEvalSupported: false;
  stopAtErrors: true;
};
