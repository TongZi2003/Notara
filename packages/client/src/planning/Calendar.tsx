/**
 * P6.5 日历，月历默认移植自 B@3831987 `app/js/screens/calendar.js`（RiLi 母版）。
 *
 * 三种日子与 B 同源，但每一格都来自本机真实合同：`studyforgeLearning.cards`
 * 的复习档给「到期 N」（跟 B 读卡上的 next_due 是同一件事），
 * `studyforgeOrganization.route` 的节点日期给「◇ 排好的课」，选中的那一天再用
 * `studyforgeCalendar.day` 读出当天安排与实际活动。列表视图是 B 的未来 14 天，
 * 同样由这两份真实投影算出来；日报设置与打开真实对象的行为一个也没少。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type { CalendarDay, DailyReportSettings } from '@studyforge/contracts/calendar';
import type { CardView } from '@studyforge/contracts/cards';
import type { RouteNode } from '@studyforge/contracts/routes';
import { useEffect, useRef, useState } from 'react';
import { LearningObject } from '../classroom/LearningObject.tsx';

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
  const [day, setDay] = useState<CalendarDay>(), [settings, setSettings] = useState<DailyReportSettings>();
  const [cards, setCards] = useState<readonly CardView[]>([]), [nodes, setNodes] = useState<readonly RouteNode[]>([]);
  const [notice, setNotice] = useState(''), [refresh, setRefresh] = useState(0), [report, setReport] = useState(false);
  const [enabled, setEnabled] = useState(false), [time, setTime] = useState(''), [settingZone, setSettingZone] = useState(zone), [busy, setBusy] = useState(false);
  const request = useRef(0);
  const [target, setTarget] = useState<string>();
  function open(ref: string): void {
    if (ref.startsWith('route:') || ref.startsWith('session:')) onOpen(ref);
    else setTarget(ref);
  }
  useEffect(() => {
    let live = true;
    void ctx.remote.studyforgeCalendar.settings().then(result => {
      if (!live || !result.ok) return;
      setSettings(result.value); setEnabled(result.value.enabled); setTime(result.value.localTime ?? ''); setSettingZone(result.value.timeZone);
    }).catch(() => { if (live) setNotice('日报设置暂时不可用。'); });
    return () => { live = false; };
  }, [ctx, refresh]);
  // One real card read and one real route read answer every month cell; a
  // failed read shows nothing rather than an invented count.
  useEffect(() => {
    let live = true;
    void ctx.remote.studyforgeLearning.cards().then(result => { if (live && result.ok) setCards(result.value); }, () => { if (live) setCards([]); });
    void ctx.remote.studyforgeOrganization.route().then(result => { if (live && result.ok) setNodes(result.value.nodes); }, () => { if (live) setNodes([]); });
    return () => { live = false; };
  }, [ctx, refresh]);
  useEffect(() => {
    const seq = ++request.current;
    setDay(undefined); setNotice('');
    const work = report ? ctx.remote.studyforgeCalendar.report({ date, timeZone: zone }).then(result => result.ok ? { ok: true as const, value: result.value.day } : result)
      : ctx.remote.studyforgeCalendar.day({ date, timeZone: zone });
    void work.then(result => { if (request.current !== seq) return; if (result.ok) setDay(result.value); else setNotice('这一天暂时无法读取，请刷新重试。'); })
      .catch(() => { if (request.current === seq) setNotice('这一天暂时无法读取，请刷新重试。'); });
    return () => { request.current++; };
  }, [ctx, date, zone, report, refresh]);
  useEffect(() => {
    const update = () => setRefresh(value => value + 1);
    window.addEventListener('focus', update);
    const timer = window.setInterval(update, 30_000);
    return () => { window.removeEventListener('focus', update); window.clearInterval(timer); };
  }, []);
  async function saveSettings(): Promise<void> {
    setBusy(true);
    try {
      const result = await ctx.remote.studyforgeCalendar.configure({ operationId: crypto.randomUUID(), patch: { enabled, timeZone: settingZone, localTime: time || null } });
      if (result.ok) { setSettings(result.value); setZone(result.value.timeZone); setNotice('日报设置已保存。'); }
      else setNotice('请填写有效时区；启用日报时需要选择时间。');
    } catch { setNotice('日报设置未收到保存结果，请重试。'); }
    finally { setBusy(false); }
  }
  const dueByDay = new Map<string, number>();
  for (const card of cards) if (card.review !== undefined) dueByDay.set(card.review.nextDue, (dueByDay.get(card.review.nextDue) ?? 0) + 1);
  const nodesByDay = new Map<string, RouteNode[]>();
  for (const node of nodes) if (node.date !== undefined) nodesByDay.set(node.date, [...(nodesByDay.get(node.date) ?? []), node]);
  const listDays = Array.from({ length: 14 }, (_value, index) => step(view === 'list' ? date : today(zone), index))
    .filter(day => (dueByDay.get(day) ?? 0) > 0 || (nodesByDay.get(day)?.length ?? 0) > 0);
  return <main className="sf-orig sf-page-scroll" data-testid="studyforge-page-studyforge.calendar">
    <div className="plain-wrap">
      <div className="cal-top">
        <h2>{report ? '学习日报' : view === 'list' ? '未来 14 天' : `${String(cursor.getFullYear())} · ${String(cursor.getMonth() + 1)} 月`}</h2>
        {!report && view === 'month' && <><button className="nv" aria-label="上个月" onClick={() => { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)); }}>◀</button>
          <button className="nv" aria-label="下个月" onClick={() => { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)); }}>▶</button></>}
        <div className="views">
          <button className="chip" data-testid="calendar-new-route" onClick={() => { ctx.layout.selectPanel('studyforge.courses' as MainPanelId); }}>新建排课</button>
          <button className="chip" onClick={() => { setReport(!report); }}>{report ? '返回日历' : '查看日报'}</button>
          {!report && <><button className={`chip${view === 'month' ? ' on' : ''}`} data-testid="calendar-view-month" onClick={() => { setView('month'); }}>月</button>
            <button className={`chip${view === 'list' ? ' on' : ''}`} data-testid="calendar-view-list" onClick={() => { setView('list'); }}>列表</button></>}
        </div>
      </div>

      {!report && view === 'month' && <>
        <div className="cal-dow">{Array.from(WEEKDAYS, letter => <div key={letter}>{letter}</div>)}</div>
        <div className="cal-grid" data-testid="calendar-month">
          {monthCells(cursor.getFullYear(), cursor.getMonth()).map((cell, index) => {
            const isToday = cell.day === today(zone), due = dueByDay.get(cell.day) ?? 0, planned = nodesByDay.get(cell.day) ?? [];
            // B labels the first of the month and the very first cell as M-D, every other with the day alone.
            const dayNumber = Number(cell.day.slice(8, 10));
            const cellLabel = dayNumber === 1 || index === 0 ? `${String(Number(cell.day.slice(5, 7)))}-${String(dayNumber)}` : String(dayNumber);
            return <button className={`cal-c${cell.inMonth ? '' : ' out'}${isToday ? ' today' : ''}`} key={cell.day} data-testid="calendar-cell" data-day={cell.day}
              aria-current={cell.day === date}
              onClick={() => { setDate(cell.day); }}>
              <i>{isToday ? `${cellLabel} 今` : cellLabel}</i>
              {planned.slice(0, 2).map(node => <span className={`lb route${node.session !== undefined ? ' done' : ''}`} key={node.id}>◇ {node.title}</span>)}
              {planned.length > 2 && <span className="lb">◇ +{String(planned.length - 2)}</span>}
              {due > 0 && <span className="du">到期 {due}</span>}
            </button>;
          })}
        </div>
      </>}

      {!report && view === 'list' && <div className="cal-list" data-testid="calendar-list">
        {listDays.length === 0
          ? <div className="empty-hint">未来两周没有排课、安排或到期，日拱一卒的小兵正在休息……</div>
          : listDays.map(day => <div className={`cal-lday${day === today(zone) ? ' today' : ''}`} key={day}>
            <div className="cal-ldate">{day.slice(5)} 周{WEEKDAYS[new Date(day + 'T12:00:00Z').getUTCDay()]}{day === today(zone) ? ' · 今天' : ''}</div>
            {(nodesByDay.get(day) ?? []).map(node => <button className="cal-lrow" key={node.id} onClick={() => { open(`route:${node.id}`); }}>
              <span className="k">路线</span>◇ {node.title}{node.session !== undefined && <small>已开课</small>}</button>)}
            {(dueByDay.get(day) ?? 0) > 0 && <button className="cal-lrow" onClick={() => { setDate(day); }}>
              <span className="k dim">期</span>到期 {dueByDay.get(day) ?? 0} 张</button>}
          </div>)}
      </div>}

      <div className="set-card-row">
        <button className="sf-quiet" aria-label="前一天" onClick={() => { setDate(step(date, -1)); }}>←</button>
        <input aria-label="查看日期" type="date" value={date} onChange={e => { if (e.target.value) setDate(e.target.value); }} />
        <button className="sf-quiet" aria-label="后一天" onClick={() => { setDate(step(date, 1)); }}>→</button>
        <button className="sf-quiet" onClick={() => { setDate(today(zone)); setCursor(new Date()); }}>今天</button><button className="sf-quiet" onClick={() => { setRefresh(n => n + 1); }}>刷新</button>
        <span className="mini-note">{zone}</span>
      </div>
      {notice && <p role="status" className="mini-note">{notice}</p>}
      {!day && !notice && <p role="status" className="mini-note">正在读取这一天…</p>}
      {day && <div className="set-editor" data-testid="calendar-day">
        <h2>{date}</h2>
        <p data-testid="calendar-due">{day.relation === 'future' ? '预计到期' : '当天到期'}：{day.dueCount} 张{day.relation === 'today' ? ` · 之前到期未复习：${day.overdueCount} 张` : ''}</p>
        <h3>{day.relation === 'future' ? '已安排' : '原有安排'}</h3>
        {day.scheduledCourses.length ? day.scheduledCourses.map(course => <button className="cal-lrow" key={course.target} data-testid="calendar-course" onClick={() => { open(course.target); }}>{course.title}<span>{course.opened ? '回到这节课' : '打开这节课'}</span></button>) : <p className="mini-note">没有安排课程。</p>}
        <h3>实际活动</h3>
        {day.activity.length ? day.activity.map((item, i) => <div className="cal-lrow" key={`${item.target ?? item.kind}:${String(i)}`}>
          <span>{item.title}</span>{item.target && <button className="sf-quiet" onClick={() => { open(item.kind === 'course' ? item.sourceRefs.find(ref => ref.startsWith('session:')) ?? item.target! : item.target!); }}>查看</button>}
        </div>) : <p className="mini-note">这一天还没有学习活动记录。</p>}
      </div>}
      {target && <LearningObject key={target} ctx={ctx} target={target} onBack={() => { setTarget(undefined); }} />}
      <details className="mini-note" data-testid="calendar-legend"><summary style={{ cursor: 'pointer' }}>图例 ▸</summary>
        {view === 'list'
          ? '路线=树上排好的那一节；期=到期卡。'
          : '两种日子：路线=树上排好的那一节，期=到期该复习的卡。'}
      </details>
      <details className="sf-daily-settings"><summary>定时日报</summary>
        <form className="sf-org-form" onSubmit={e => { e.preventDefault(); void saveSettings(); }}>
          <label className="sf-org-check"><input aria-label="启用定时日报" type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); }} />启用定时日报</label>
          <label>生成时间<input aria-label="日报时间" type="time" value={time} onChange={e => { setTime(e.target.value); }} /></label>
          <label>时区<input aria-label="日报时区" value={settingZone} onChange={e => { setSettingZone(e.target.value); }} /></label>
          <button className="sf-action" disabled={busy}>保存日报设置</button>
          <p className="mini-note">{settings?.lastGenerated ? `最近生成：${new Date(settings.lastGenerated.at).toLocaleString('zh-CN', { timeZone: settings.timeZone })}` : '尚未定时生成。'}</p>
        </form>
      </details>
    </div>
  </main>;
}
