import type { CardContent, HostContext, ObjectChange } from '@studyforge/contracts';
import type { CardChangeView, TextChange } from '@studyforge/contracts/changes';
import type { CardRecordStore } from './card-service.ts';

/** Keep each display-math/code block intact so an old line never breaks its renderer. */
export function textUnits(text: string): string[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [], units: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!, trimmed = line.trim();
    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    const end = fence ? new RegExp('^' + fence[1]![0] + '{' + fence[1]!.length + ',}\\s*$')
      : trimmed === '$$' ? /^\$\$$/ : trimmed === '\\[' ? /^\\\]$/ : null;
    if (!end) { units.push(line); continue; }
    let block = line;
    while (index + 1 < lines.length) { const next = lines[++index]!; block += next; if (end.test(next.trim())) break; }
    units.push(block);
  }
  return units;
}

/** Hirschberg LCS: exact alignment without a quadratic table, preserving repeated lines. */
function lcs(a: readonly string[], b: readonly string[]): string[] {
  if (!a.length || !b.length) return [];
  if (a.length === 1) return b.includes(a[0]!) ? [a[0]!] : [];
  const lengths = (left: readonly string[], right: readonly string[]): number[] => {
    let row = new Array<number>(right.length + 1).fill(0);
    for (const line of left) {
      const next = [0];
      for (let j = 1; j <= right.length; j++) next[j] = line === right[j - 1] ? row[j - 1]! + 1 : Math.max(row[j]!, next[j - 1]!);
      row = next;
    }
    return row;
  };
  const middle = Math.floor(a.length / 2), first = a.slice(0, middle), last = a.slice(middle);
  const front = lengths(first, b), back = lengths([...last].reverse(), [...b].reverse());
  let split = 0, best = -1;
  for (let index = 0; index <= b.length; index++) {
    const score = front[index]! + back[b.length - index]!;
    if (score > best) { best = score; split = index; }
  }
  return [...lcs(first, b.slice(0, split)), ...lcs(last, b.slice(split))];
}
export function compareText(before: string, after: string): TextChange[] {
  const a = textUnits(before), b = textUnits(after), equal = lcs(a, b), result: TextChange[] = [];
  const add = (kind: TextChange['kind'], text: string): void => {
    if (!text) return;
    const last = result.at(-1);
    if (last?.kind === kind) last.text += text; else result.push({ kind, text });
  };
  let i = 0, j = 0;
  for (const common of equal) {
    while (a[i] !== common) add('remove', a[i++]!);
    while (b[j] !== common) add('add', b[j++]!);
    add('equal', common); i++; j++;
  }
  while (i < a.length) add('remove', a[i++]!);
  while (j < b.length) add('add', b[j++]!);
  return result;
}

function authorFields(content: CardContent, showBack: boolean): Record<string, string> {
  return { title: content.title, front: content.front, ...(showBack ? { back: content.sections.map(section => '## ' + section.heading + '\n' + section.body).join('\n\n'), notes: content.notes } : {}) };
}
const metadataFields = ['presentation', 'sources', 'chapter', 'tags', 'links'] as const;

/** Per-operation reads never fold interleaved lessons into a false net edit. */
export function cardChanges(records: CardRecordStore, context: HostContext, target: string, options: { sessionId?: string; showBack?: boolean } = {}): CardChangeView[] {
  return records.changes(context, target).filter(change => change.beforeRevision !== null && (!options.sessionId || change.sessionId === options.sessionId))
    .flatMap(operation => projectChange(records, context, target, operation, options.showBack === true));
}
function projectChange(records: CardRecordStore, context: HostContext, target: string, operation: ObjectChange, showBack: boolean): CardChangeView[] {
  try {
    const before = records.read(context, target, operation.beforeRevision!).data.content;
    const after = records.read(context, target, operation.afterRevision).data.content;
    if (JSON.stringify(before) === JSON.stringify(after)) return []; // Schedule/history/collection are not authored edits.
    const a = authorFields(before, showBack), b = authorFields(after, showBack);
    const fields = Object.keys(a).filter(field => a[field] !== b[field]).map(field => ({ field, before: a[field]!, after: b[field]!, lines: compareText(a[field]!, b[field]!) }));
    return [{ operation, state: 'available', fields, metadata: metadataFields.filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field])),
      hiddenBackChanged: !showBack && (JSON.stringify(before.sections) !== JSON.stringify(after.sections) || before.notes !== after.notes), unavailableReason: null }];
  } catch (error) {
    return [{ operation, state: 'unavailable', fields: [], metadata: [], hiddenBackChanged: false,
      unavailableReason: error instanceof Error ? error.message : 'revision_unavailable' }];
  }
}
