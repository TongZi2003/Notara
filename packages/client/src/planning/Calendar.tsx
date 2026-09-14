/**
 * P6.5 日历，月历默认移植自 B@3831987 `app/js/screens/calendar.js`（RiLi 母版）。
 *
 * 三种日子与 B 同源，但每一格都来自本机真实合同：`studyforgeLearning.cards`
 * 的复习档给「到期 N」（跟 B 读卡上的 next_due 是同一件事），
 * `studyforgeOrganization.route` 的节点日期给「◇ 排好的课」，选中的那一天再用
 * `studyforgeCalendar.day` 读出当天安排与实际活动。列表视图是 B 的未来 14 天，
 * 同样由这两份真实投影算出来；选择日期在右侧展示详情，日报入口暂不展示。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type { CalendarDay } from '@studyforge/contracts/calendar';
import type { CardView } from '@studyforge/contracts/cards';
import type { RouteNativeLesson, RouteNode } from '@studyforge/contracts/routes';
import { useEffect, useRef, useState } from 'react';
import { LearningObject } from '../classroom/LearningObject.tsx';
import { PlanEditor } from './PlanEditor.tsx';
import { DayActivities } from './DayActivities.tsx';

const WEEKDAYS = '日一二三四五六';
function civilDay(at: Date, timeZone: string): string { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at); }
function today(zone: string): string { return civilDay(new Date(), zone); }
function step(day: string, delta: number): string { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10); }
/** B's 42-cell month: from the first Sunday on or before the 1st. */
function monthCells(year: number, month: number): { day: string; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month, 1));
  const start = new Date(first); start.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_value, index) => {
    const d = new Date(start); d.setUTCDate(start.getUTCDate() + index);
    return { day: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === month };
  });
}

export function Calendar({ ctx, onOpen }: { ctx: Context; onOpen(target: string): void }): React.JSX.Element {
  const [zone, setZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone), [date, setDate] = useState(() => today(zone));
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<'month' | 'list'>('month');
  const [day, setDay] = useState<CalendarDay>();
  const [cards, setCards] = useState<readonly CardView[]>([]), [nodes, setNodes] = useState<readonly RouteNode[]>([]);
  const [lessons, setLessons] = useState<readonly RouteNativeLesson[]>([]);
  const [notice, setNotice] = useState(''), [refresh, setRefresh] = useState(0), [detailsOpen, setDetailsOpen] = useState(false);
  const [planning, setPlanning] = useState(false);
  const request = useRef(0);
  const [target, setTarget] = useState<string>();
  const pick = (value: string): void => { setDate(value); setTarget(undefined); setPlanning(false); setDetailsOpen(true); };
  function open(ref: string): void {
    if (ref.startsWith('route:') || ref.startsWith('session:')) onOpen(ref);
    else setTarget(ref);
  }
  useEffect(() => {
    let live = true;
    // Respect the saved calendar zone, without exposing or changing scheduling.
    void ctx.remote.studyforgeCalendar.settings().then(result => {
      if (live && result.ok) { setZone(result.value.timeZone); setDate(today(result.value.timeZone)); }
    }).catch(() => {});
    return () => { live = false; };
  }, [ctx]);
  useEffect(() => {
    let live = true;
    void ctx.remote.studyforgeLearning.cards().then(result => { if (live && result.ok) setCards(result.value); }, () => { if (live) setCards([]); });
    void ctx.remote.studyforgeOrganization.route().then(result => { if (live && result.ok) setNodes(result.value.nodes); }, () => { if (live) setNodes([]); });
    return () => { live = false; };
  }, [ctx, refresh]);
  useEffect(() => {
    if (!detailsOpen) return;
    let live = true;
    void ctx.remote.studyforgeOrganization.routeLessons().then(result => { if (live && result.ok) setLessons(result.value); }, () => {});
    return () => { live = false; };
  }, [ctx, refresh, detailsOpen]);
  useEffect(() => {
    if (!detailsOpen) return;
    const seq = ++request.current;
    setDay(undefined); setNotice('');
    void ctx.remote.studyforgeCalendar.day({ date, timeZone: zone }).then(result => {
      if (request.current !== seq) return;
      if (result.ok) setDay(result.value); else setNotice('这一天暂时无法读取，请重试。');
    }).catch(() => { if (request.current === seq) setNotice('这一天暂时无法读取，请重试。'); });
    return () => { request.current++; };
  }, [ctx, date, zone, detailsOpen, refresh]);
  useEffect(() => {
    const update = () => setRefresh(value => value + 1);
    window.addEventListener('focus', update);
    const timer = window.setInterval(update, 30_000);
    return () => { window.removeEventListener('focus', update); window.clearInterval(timer); };
  }, []);
  const dueByDay = new Map<string, number>();
  for (const card of cards) if (card.review !== undefined) dueByDay.set(card.review.nextDue, (dueByDay.get(card.review.nextDue) ?? 0) + 1);
  const nodesByDay = new Map<string, RouteNode[]>();
  for (const node of nodes) if (node.date !== undefined) nodesByDay.set(node.date, [...(nodesByDay.get(node.date) ?? []), node]);
  const listDays = Array.from({ length: 14 }, (_value, index) => step(date, index))
    .filter(value => (dueByDay.get(value) ?? 0) > 0 || (nodesByDay.get(value)?.length ?? 0) > 0);
  return <main className="sf-orig sf-page-scroll sf-calendar-page" data-testid="studyforge-page-studyforge.calendar">
    <header className="sf-calendar-header">
      <div className="sf-calendar-period">
        <h1>{view === 'month' ? `${cursor.getFullYear()}年${cursor.getMonth() + 1}月` : '接下来两周'}</h1>
        <button className="sf-quiet" aria-label={view === 'month' ? '上个月' : '前两周'} onClick={() => { if (view === 'month') setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)); else setDate(step(date, -14)); }}>‹</button>
        <button className="sf-quiet" aria-label={view === 'month' ? '下个月' : '后两周'} onClick={() => { if (view === 'month') setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)); else setDate(step(date, 14)); }}>›</button>
        <button className="sf-quiet" onClick={() => { pick(today(zone)); setCursor(new Date(today(zone) + 'T12:00:00')); }}>今天</button>
      </div>
      <div className="sf-calendar-actions">
        <nav aria-label="日历视图">
          <button className={`chip${view === 'month' ? ' on' : ''}`} aria-pressed={view === 'month'} data-testid="calendar-view-month" onClick={() => setView('month')}>月历</button>
          <button className={`chip${view === 'list' ? ' on' : ''}`} aria-pressed={view === 'list'} data-testid="calendar-view-list" onClick={() => setView('list')}>日程</button>
        </nav>
        <button className="sf-quiet" data-testid="calendar-review-plans" onClick={() => { setPlanning(true); setDetailsOpen(true); }}>复习安排</button>
        <button className="btn primary" data-testid="calendar-new-route" onClick={() => { ctx.layout.selectPanel('studyforge.courses' as MainPanelId); }}>安排课程</button>
      </div>
    </header>
    <div className="sf-calendar-workspace" data-detail-open={detailsOpen}>
      <section className="sf-calendar-main" aria-label={view === 'month' ? '月历' : '日程'}>
        {view === 'month' ? <>
          <div className="cal-dow">{Array.from(WEEKDAYS, letter => <div key={letter}>周{letter}</div>)}</div>
          <div className="cal-grid" data-testid="calendar-month">
            {monthCells(cursor.getFullYear(), cursor.getMonth()).map((cell, index) => {
              const isToday = cell.day === today(zone), due = dueByDay.get(cell.day) ?? 0, planned = nodesByDay.get(cell.day) ?? [];
              const dayNumber = Number(cell.day.slice(8, 10));
              const cellLabel = dayNumber === 1 || index === 0 ? `${Number(cell.day.slice(5, 7))}/${dayNumber}` : String(dayNumber);
              return <button className={`cal-c${cell.inMonth ? '' : ' out'}${isToday ? ' today' : ''}`} key={cell.day} data-testid="calendar-cell" data-day={cell.day}
                aria-label={cell.day} aria-pressed={detailsOpen && cell.day === date} onClick={() => pick(cell.day)}>
                <i>{cellLabel}{isToday ? ' 今天' : ''}</i>
                {planned.slice(0, 2).map(node => <span className={`lb route${node.session ? ' done' : ''}`} key={node.id}>{node.title}</span>)}
                {planned.length > 2 && <span className="lb">另有 {planned.length - 2} 节课</span>}
                {due > 0 && <span className="du">复习 {due} 张</span>}
              </button>;
            })}
          </div>
        </> : <div className="cal-list sf-linear-tree" data-testid="calendar-list">
          {listDays.length === 0 ? <p className="empty-hint">接下来两周还没有学习安排。</p> : listDays.map(value => <div className="cal-lday" key={value}>
            <button className="cal-ldate sf-calendar-day-link" onClick={() => pick(value)}>{value.slice(5).replace('-', '月')}日 · 周{WEEKDAYS[new Date(value + 'T12:00:00Z').getUTCDay()]}</button>
            {(nodesByDay.get(value) ?? []).map(node => <button className="cal-lrow" key={node.id} onClick={() => pick(value)}>{node.title}{node.session && <small>已开课</small>}</button>)}
            {(dueByDay.get(value) ?? 0) > 0 && <button className="cal-lrow" onClick={() => pick(value)}>复习 {dueByDay.get(value)} 张题卡</button>}
          </div>)}
        </div>}
      </section>
      {detailsOpen && <aside className="sf-calendar-detail" data-panel={planning ? 'plans' : 'day'} aria-label={planning ? '复习安排' : '当天安排'} data-testid="calendar-detail">
        <header><h2>{planning ? '复习安排' : date.slice(5).replace('-', '月') + '日'}</h2><button className="sf-quiet" aria-label="关闭日期详情" onClick={() => setDetailsOpen(false)}>×</button></header>
        {planning ? <PlanEditor ctx={ctx} /> : <><div className="sf-calendar-date-picker">
          <button className="sf-quiet" aria-label="前一天" onClick={() => pick(step(date, -1))}>‹</button>
          <input aria-label="查看日期" type="date" value={date} onChange={event => { if (event.target.value) pick(event.target.value); }} />
          <button className="sf-quiet" aria-label="后一天" onClick={() => pick(step(date, 1))}>›</button>
        </div>
        {notice && <p role="status" className="mini-note">{notice}<button className="sf-quiet" onClick={() => setRefresh(n => n + 1)}>重试</button></p>}
        {!day && !notice && <p role="status" className="mini-note">正在读取安排…</p>}
        {target ? <LearningObject key={target} ctx={ctx} target={target} onBack={() => setTarget(undefined)} /> : day && <DayActivities key={date} day={day} lessons={lessons} nodes={nodes} onOpen={open} />}</>}
      </aside>}
    </div>
  </main>;
}
