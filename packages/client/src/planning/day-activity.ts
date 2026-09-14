import type { ActivityItem, CalendarDay } from '@studyforge/contracts/calendar';
import type { RouteNativeLesson, RouteNode } from '@studyforge/contracts/routes';

export interface DayActivityGroup {
  key: string; title: string; target?: string; planned: boolean;
  items: { key: string; title: string; target?: string; kinds: string[] }[];
}

/** A day's actions belong to their recorded session, never the current lesson. */
export function dayActivityGroups(day: CalendarDay, lessons: readonly RouteNativeLesson[], nodes: readonly RouteNode[]): DayActivityGroup[] {
  const native = new Map(lessons.map(lesson => [`session:${lesson.sessionId}`, lesson]));
  const routes = new Map(nodes.map(node => [`route:${node.id}`, node]));
  const groups = new Map<string, DayActivityGroup>();
  const ensure = (key: string, title?: string, planned = false): DayActivityGroup => {
    let group = groups.get(key);
    if (!group) {
      const lesson = native.get(key), route = routes.get(key);
      group = { key, title: lesson?.title ?? title ?? route?.title ?? (key === 'outside' ? '课外记录' : '未命名课堂'),
        ...(key !== 'outside' ? { target: key } : {}), planned, items: [] };
      groups.set(key, group);
    }
    return group;
  };
  for (const course of day.scheduledCourses) {
    const node = routes.get(course.target);
    ensure(node?.session ? `session:${node.session.sessionId}` : course.target, course.title, !course.opened);
  }
  const owners = (item: ActivityItem): string[] => {
    const sessions = item.sourceRefs.filter(ref => ref.startsWith('session:'));
    if (item.target?.startsWith('session:')) sessions.push(item.target);
    if (sessions.length) return [...new Set(sessions)];
    const route = item.target ? routes.get(item.target) : undefined;
    if (item.kind === 'course' && route) return [route.session ? `session:${route.session.sessionId}` : item.target!];
    return ['outside'];
  };
  // Course and participation events name the group; they are not duplicate child rows.
  for (const kind of ['participation', 'course']) for (const item of day.activity) if (item.kind === kind) {
    for (const key of owners(item)) if (key !== 'outside') ensure(key, item.title);
  }
  for (const [index, item] of day.activity.entries()) {
    for (const key of owners(item)) {
      const group = ensure(key);
      if (key !== 'outside' && (item.kind === 'course' || item.kind === 'participation')) { group.planned = false; continue; }
      const target = item.target, itemKey = target ?? `event:${index}`;
      const existing = group.items.find(entry => entry.key === itemKey);
      if (existing) { if (!existing.kinds.includes(item.kind)) existing.kinds.push(item.kind); }
      else group.items.push({ key: itemKey, title: item.title, ...(target ? { target } : {}), kinds: [item.kind] });
    }
  }
  return [...groups.values()].sort((a, b) => Number(a.key === 'outside') - Number(b.key === 'outside'));
}

export function activityKindLabel(kind: string): string {
  return ({ card: '题卡', knowledge: '知识', review: '复习', handoff: '课堂小结', memory: '学情',
    plan: '复习计划', route: '学习路线', skeleton: '资料目录', set: '学习集', material: '资料', course: '课堂' } as Record<string, string>)[kind] ?? '学习记录';
}
