import { describe, it, expect } from 'vitest';
import { CalendarDaySchema } from '@studyforge/contracts/calendar';
import { RouteViewSchema } from '@studyforge/contracts/routes';
import { dayActivityGroups } from '../../packages/client/src/planning/day-activity.ts';

describe('calendar activity ownership', () => {
  it('keeps same-card activity under each recorded classroom and outside activity separate', () => {
    const day = CalendarDaySchema.parse({ date: '2026-09-14', timeZone: 'UTC', asOf: '2026-09-14T12:00:00Z', relation: 'today', dueCount: 0, overdueCount: 0,
      activity: [
        { kind: 'participation', title: '函数课', target: 'session:one' },
        { kind: 'course', title: '本课设置', target: 'course:one', sourceRefs: ['session:one'] },
        { kind: 'card', title: '定义域', target: 'card:one', sourceRefs: ['card:one', 'session:one'] },
        { kind: 'review', title: '定义域', target: 'card:one', sourceRefs: ['session:one'] },
        { kind: 'participation', title: '复习课', target: 'session:two' },
        { kind: 'review', title: '定义域', target: 'card:one', sourceRefs: ['session:two'] },
        { kind: 'card', title: '课外笔记', target: 'card:outside' },
      ] });
    const groups = dayActivityGroups(day, [], []);
    expect(groups.map(group => group.key)).toEqual(['session:one', 'session:two', 'outside']);
    expect(groups[0]).toMatchObject({ title: '函数课', items: [{ target: 'card:one', kinds: ['card', 'review'] }] });
    expect(groups[1]).toMatchObject({ title: '复习课', items: [{ target: 'card:one', kinds: ['review'] }] });
    expect(groups[2]).toMatchObject({ title: '课外记录', items: [{ target: 'card:outside' }] });
    expect(day.activity).toHaveLength(7);
  });
  it('merges the scheduled course with its actual classroom and does not infer by title', () => {
    const route = RouteViewSchema.parse({ ref: 'route:tree', version: 1, nodes: [{ id: 'p_1', title: '函数课', materials: { materials: [] }, session: { sessionId: 'one', openingKey: 'open-one', openedAt: '2026-09-14T10:00:00Z' } }], layout: [] });
    const day = CalendarDaySchema.parse({ date: '2026-09-14', timeZone: 'UTC', asOf: '2026-09-14T12:00:00Z', relation: 'today', dueCount: 0, overdueCount: 0,
      scheduledCourses: [{ target: 'route:p_1', title: '函数课', opened: true }], activity: [
        { kind: 'course', title: '函数课', target: 'route:p_1', sourceRefs: ['session:one'] },
        { kind: 'card', title: '函数课', target: 'card:one' },
      ] });
    const groups = dayActivityGroups(day, [], route.nodes);
    expect(groups.map(group => group.key)).toEqual(['session:one', 'outside']);
    expect(groups[0]?.items).toEqual([]);
    expect(groups[1]?.items[0]?.target).toBe('card:one');
  });
});
