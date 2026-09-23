import { embedTarget } from './media.js';
import { insertIntoSection } from './graph.js';

function renderValues(content, values) {
  return content.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\s*\}\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
}

function normalizedRect(rect) {
  if (!Array.isArray(rect) || rect.length !== 4 || rect.some(value => !Number.isFinite(value))) throw new Error('pdf_region_invalid');
  return rect.map(value => Math.round(Math.min(1, Math.max(0, value)) * 1_000_000) / 1_000_000);
}

function overlapRatio(item, rect) {
  const width = Math.min(item[0] + item[2], rect[0] + rect[2]) - Math.max(item[0], rect[0]);
  const height = Math.min(item[1] + item[3], rect[1] + rect[3]) - Math.max(item[1], rect[1]);
  if (width <= 0 || height <= 0 || item[2] <= 0 || item[3] <= 0) return 0;
  return (width * height) / (item[2] * item[3]);
}

/**
 * Collect the text a rectangle selection covers. `items` are text-layer entries
 * in reading order (`{ rect: [x, y, w, h], str }`, all normalized to the page);
 * `rect` is the normalized selection. Items whose area mostly falls inside the
 * rectangle join the quote — same-line items merge with a space, a new line
 * starts on a clear vertical step.
 */
export function quoteFromItems(items, rect) {
  if (!Array.isArray(items) || !Array.isArray(rect) || rect.length !== 4) return '';
  const hits = items.filter(item => Array.isArray(item?.rect) && typeof item.str === 'string' && item.str.trim() && overlapRatio(item.rect, rect) > 0.3);
  let quote = '', previous;
  for (const item of hits) {
    const lineStep = previous !== undefined && Math.abs(item.rect[1] - previous) > Math.max(0.004, item.rect[3] * 0.5);
    quote += (quote ? (lineStep ? '\n' : ' ') : '') + item.str.trim();
    previous = item.rect[1];
  }
  return quote;
}

export function cardPathFor(title) {
  const value = String(title ?? '').trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '');
  return `卡片/${value || 'pdf-card'}.md`;
}

/** The one line every region-reference card carries: the region image is the
 * original, a PDF text layer is not a faithful transcription of it, and nobody
 * has checked that extraction against the page yet. */
export const UNTRANSCRIBED_REGION_NOTE = '> 尚未转写原文（文字层未核对）：本卡保留原始区域图像，题干与参考解答需要对照原页补写。';

export function buildPdfCardContent(template, input) {
  if (typeof template !== 'string' || !input || typeof input.title !== 'string' || typeof input.source !== 'string' || typeof input.revision !== 'string') throw new Error('pdf_card_invalid');
  if (!Number.isInteger(input.page) || input.page < 1) throw new Error('pdf_page_invalid');
  const rect = normalizedRect(input.rect), title = input.title.trim() || 'PDF 摘录卡片';
  // Preserve the original mathematical typesetting. Extracted PDF text is not
  // a faithful transcription and must never become a card's claimed original.
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  const embed = embedTarget(input.source, { kind: 'pdf-region', page: input.page, rect, revision: input.revision, ...(input.annotationId ? { annotationId: input.annotationId } : {}) });
  const provenance = [
    `- 文件：${input.source}`,
    `- 版本：${input.revision}`,
    `- 页码：第 ${input.page} 页`,
    `- 选区：${embed.slice(1)}`,
    `- 区域：\`${JSON.stringify(rect)}\``,
  ];
  // A card extracted from a template is a card, not a template — drop the
  // registry markers from the frontmatter copy.
  const rendered = renderValues(template, { title, date: input.date ?? '' }).replace(/\s+$/, '')
    .replace(/^---\n([\s\S]*?)\n---/, (block, frontmatter) => `---\n${frontmatter.split('\n').filter(line => !/^(template|name)\s*:/.test(line)).join('\n')}\n---`);
  // Current contract: 内容 holds the original region image and its provenance,
  // and says plainly that the text is not transcribed. Older, student-authored
  // templates keep the appended shape below.
  const fact = [
    UNTRANSCRIBED_REGION_NOTE,
    '',
    embed,
    '',
    ...provenance,
    '',
    '### 我的批注',
    '',
    note,
  ].join('\n');
  const withFact = insertIntoSection(rendered, '内容', fact);
  if (withFact !== null) return `${withFact}\n`;
  const details = [
    '',
    '## 来源定位',
    ...provenance,
    '',
    '## 原始区域',
    embed,
    '',
    '## 我的批注',
    note,
    '',
  ].join('\n');
  return `${rendered}\n${details}`;
}
