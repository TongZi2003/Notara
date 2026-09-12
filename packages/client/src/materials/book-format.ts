/**
 * Which originals can carry a book's structure. An image or a lone page is an
 * original, not a book, so it never offers to open into sections.
 */
import { DOCX_MEDIA_TYPE } from './files.ts';

export function isBookFormat(mediaType: string): boolean {
  return mediaType === 'application/pdf' || mediaType === 'text/markdown' || mediaType === 'text/plain' || mediaType === DOCX_MEDIA_TYPE;
}
