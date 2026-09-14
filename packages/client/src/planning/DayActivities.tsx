import type { CalendarDay } from '@studyforge/contracts/calendar';
import type { RouteNativeLesson, RouteNode } from '@studyforge/contracts/routes';
import { dayActivityGroups, activityKindLabel } from './day-activity.ts';
import './day-activities.css';

export function DayActivities({ day, lessons, nodes, onOpen }: {
  day: CalendarDay; lessons: readonly RouteNativeLesson[]; nodes: readonly RouteNode[]; onOpen(target: string): void;
}): React.JSX.Element {
  const groups = dayActivityGroups(day, lessons, nodes);
  return <div className="sf-day-activities" data-testid="calendar-day">
    {groups.length > 0 && <section aria-label="课程与学习记录"><h3>课程与学习记录</h3>
      <div className="sf-day-course-list">{groups.map(group => <details className="sf-day-course" key={group.key} data-testid="calendar-activity-group" data-owner={group.key}>
        <summary><svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="m7 4 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
          <span className="sf-day-course-heading"><span>{group.title}</span><small>{group.key === 'outside' ? `${group.items.length} 项记录` : `${group.planned ? '待开课' : '已开课'}${group.items.length ? ` · ${group.items.length} 项记录` : ''}`}</small></span>
        </summary>
        <div className="sf-day-course-content">
          {group.target && <button type="button" className="sf-day-course-link" data-testid="calendar-course" onClick={() => onOpen(group.target!)}>{group.planned ? '开始课程' : '进入对话'}<span aria-hidden="true"> →</span></button>}
          {group.items.length > 0 && <ul>{group.items.map(item => <li key={item.key} data-testid="calendar-activity-item">
            {item.target ? <button type="button" className="sf-day-object" onClick={() => onOpen(item.target!)}><span>{item.title}</span><small>{item.kinds.map(activityKindLabel).join(' · ')}</small></button>
              : <div className="sf-day-object"><span>{item.title}</span><small>{item.kinds.map(activityKindLabel).join(' · ')}</small></div>}
          </li>)}</ul>}
        </div>
      </details>)}</div>
    </section>}
    <section><h3>待复习</h3><p className="sf-day-due" data-testid="calendar-due">{day.relation === 'future' ? '预计到期' : '当天到期'} {day.dueCount} 张{day.relation === 'today' && day.overdueCount ? ` · 逾期 ${day.overdueCount} 张` : ''}</p></section>
  </div>;
}
