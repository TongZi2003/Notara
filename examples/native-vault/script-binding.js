import { createHash } from 'node:crypto';
import { parseLessonSummaries } from './lesson-data.js';

/**
 * Host-side facts about a lesson's bound script. Kept out of lesson-data.js,
 * which the browser bundle also reaches (through calendar-data.js).
 */

/**
 * The revision of a lesson script's own text: its content with every classroom
 * summary block taken out. Saving a summary into the bound script changes the
 * file's revision but not this one, so the lessons bound to it stay bound.
 */
export function scriptBodyRevision(content) {
  const text = typeof content === 'string' ? content : '';
  let body = '', at = 0;
  for (const block of parseLessonSummaries({ content: text })) { body += text.slice(at, block.start); at = block.end; }
  body = (body + text.slice(at)).replace(/\n{3,}/g, '\n\n').trimEnd();
  return createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 24);
}

/** Whether a lesson's script binding no longer matches the script: a different
 * file revision whose text outside the summaries changed too (or a binding from
 * before body revisions were kept, which can only compare the file). */
export function scriptBindingStale({ revision, bodyRevision } = {}, document) {
  const current = typeof document?.revision === 'string' ? document.revision : '';
  if (!revision || !current || revision === current) return false;
  return !(bodyRevision && bodyRevision === scriptBodyRevision(document.content));
}
