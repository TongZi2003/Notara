import type { Context } from '@deepseek-ai/cordis';
import type { CalendarDay } from '@studyforge/contracts/calendar';
import { useEffect, useState } from 'react';
import { ReviewScreen } from '../review/ReviewScreen.tsx';

/** The home reads today's actual schedule; unlearned inventory produces no reminder. */
export function Today({ ctx, onOpen }: { ctx: Context; onOpen(target?: string): void }): React.JSX.Element {
  const [day, setDay] = useState<CalendarDay>(), [reviewing, setReviewing] = useState(false), [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let live = true;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    void ctx.remote.studyforgeCalendar.day({ date, timeZone: zone }).then(result => { if (live) { if (result.ok) setDay(result.value); else setUnavailable(true); } })
      .catch(() => { if (live) setUnavailable(true); });
    return () => { live = false; };
  }, [ctx, reviewing]);
  return <main className="sf-page" data-testid="studyforge-page-studyforge.home">
    <header className="sf-page-head"><span>今天</span><span className="sf-page-date">{day?.date}</span></header>
    <div className="sf-calendar-body">
      {reviewing ? <ReviewScreen ctx={ctx} onBack={() => setReviewing(false)} /> : <>
        <h1>今天想学什么</h1><p>从课堂继续讨论，或打开一本书开始。</p>
        <button className="sf-action" data-testid="open-classroom" onClick={() => onOpen()}>回到课堂 ↗</button>
        {unavailable && <p role="status">今天的安排暂时无法读取。</p>}
        {day && day.dueCount + day.overdueCount > 0 && <section data-testid="today-review"><h2>温习一下</h2><p>{day.dueCount + day.overdueCount} 张学过的卡片等你复习。</p>
          <button className="sf-action" onClick={() => setReviewing(true)}>开始复习</button></section>}
        {!!day?.scheduledCourses.length && <section><h2>今天安排的课</h2>{day.scheduledCourses.map(course => <button className="sf-org-row" key={course.target} onClick={() => onOpen(course.target)}>{course.title}</button>)}</section>}
      </>}
    </div>
  </main>;
}
