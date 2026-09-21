import { embedTarget } from './media.js';

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

export function buildPdfCardContent(template, input) {
  if (typeof template !== 'string' || !input || typeof input.title !== 'string' || typeof input.source !== 'string' || typeof input.revision !== 'string') throw new Error('pdf_card_invalid');
  if (!Number.isInteger(input.page) || input.page < 1) throw new Error('pdf_page_invalid');
  const rect = normalizedRect(input.rect), title = input.title.trim() || 'PDF 摘录卡片';
  const quote = typeof input.quote === 'string' && input.quote.trim() ? input.quote.trim().split(/\r?\n/).map(line => `> ${line}`).join('\n') : '> （此区域没有可提取的文字，保留框选位置）';
  const embed = embedTarget(input.source, { kind: 'pdf-region', page: input.page, rect });
  const details = [
    '',
    '## 来源定位',
    `- 文件：${input.source}`,
    `- 版本：${input.revision}`,
    `- 页码：第 ${input.page} 页`,
    `- 选区：${embed}`,
    `- 区域：\`${JSON.stringify(rect)}\``,
    '',
    '## 原文摘录',
    quote,
    '',
  ].join('\n');
  // A card extracted from a template is a card, not a template — drop the
  // registry markers from the frontmatter copy.
  const rendered = renderValues(template, { title, date: input.date ?? '' }).replace(/\s+$/, '')
    .replace(/^---\n([\s\S]*?)\n---/, (block, frontmatter) => `---\n${frontmatter.split('\n').filter(line => !/^(template|name)\s*:/.test(line)).join('\n')}\n---`);
  return `${rendered}\n${details}`;
}

