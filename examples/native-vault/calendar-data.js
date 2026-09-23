import { parseLessonSummaries, parseRoute } from './lesson-data.js';
import { validateDay, addReviewDays, reviewState, reviewHistory, reviewOutcome } from './review-data.js';

/** Civil dates stay dates. Only timestamped activity is converted through an
 * IANA zone; parsing a date at local midnight would break around DST. */
export function calendarZone(value = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (typeof value !== 'string' || value.length > 100) throw new Error('calendar_zone_invalid');
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); }
  catch { throw new Error('calendar_zone_invalid'); }
  return value;
}
export function civilDay(value = new Date(), timeZone = calendarZone()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('review_date_invalid');
  const parts = new Intl.DateTimeFormat('en', { timeZone: calendarZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = type => parts.find(item => item.type === type).value;
  return validateDay(`${part('year')}-${part('month')}-${part('day')}`);
}
export function calendarRange(from, to) {
  validateDay(from); validateDay(to);
  if (from > to || to > addReviewDays(from, 366)) throw new Error('calendar_range_invalid');
  return { from, to };
}

export function dailyDate(document) {
  if (document.type !== 'daily' && (document.frontmatter?.type || !/^(?:日记\/)?\d{4}-\d{2}-\d{2}\.md$/i.test(document.path ?? ''))) return null;
  const date = document.type === 'daily' ? document.frontmatter?.date : document.path?.split('/').at(-1)?.replace(/\.md$/i, '');
  try { return validateDay(date); } catch { return null; }
}

/** One projection over the files. No event database, automatic daily-note
 * writes, or inference that opening a file constitutes learning. */
export function calendarProjection(documents, { from, to, timeZone, today }) {
  calendarRange(from, to); calendarZone(timeZone); validateDay(today);
  const events = [], invalid = [], routes = [];
  const put = event => { if (event.date >= from && event.date <= to) events.push(event); };
  for (const doc of documents) {
    const base = { path: doc.path, title: doc.title, revision: doc.revision };
    const date = dailyDate(doc);
    if (date) put({ ...base, key: `daily:${doc.path}`, kind: 'daily', date });
    if (doc.type === 'card') {
      try {
        const state = reviewState(doc);
        if (state.learned) put({ ...base, key: `due:${doc.path}`, kind: 'due', date: state.next_review, state });
        for (const record of reviewHistory(doc)) {
          if (record.revertedAt) continue;
          put({ ...base, key: `review:${doc.path}:${record.id}`, kind: 'review', date: civilDay(record.at, timeZone),
            ...(record.assessments ? { assessments: record.assessments, outcome: reviewOutcome(record) } : { passed: record.passed }),
            note: record.note, actor: record.actor, sessionId: record.sessionId });
        }
      } catch { invalid.push({ path: doc.path, kind: 'review' }); }
    }
    if (doc.type === 'route') {
      try {
        const route = parseRoute(doc);
        routes.push({ ...base, nodes: route.nodes.map(node => ({ id: node.id, title: node.title, scheduledOn: node.scheduledOn ?? null })) });
        for (const node of route.nodes) if (node.scheduledOn) {
          put({ ...base, title: node.title, routeTitle: doc.title, nodeId: node.id, sessionId: node.sessionId ?? null, key: `lesson:${doc.path}:${node.id}`, kind: 'lesson', date: node.scheduledOn });
        }
      } catch { invalid.push({ path: doc.path, kind: 'route' }); }
    }
    try {
      for (const log of parseLessonSummaries(doc)) {
        const stamp = log.throughAt || log.startedAt;
        if (!stamp) continue;
        put({ ...base, title: log.title || doc.title, key: `log:${log.sessionId}:${log.anchor}`, kind: 'log', date: civilDay(stamp, timeZone), anchor: log.anchor, sessionId: log.sessionId, subjects: log.subjects });
      }
    } catch { invalid.push({ path: doc.path, kind: 'log' }); }
  }
  const unique = [...new Map(events.map(event => [event.key, event])).values()];
  unique.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title, 'zh'));
  return { from, to, today, timeZone, events: unique, routes, invalid };
}
