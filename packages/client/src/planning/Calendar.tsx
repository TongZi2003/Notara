import type { Context } from '@deepseek-ai/cordis';
import type { CalendarDay, DailyReportSettings } from '@studyforge/contracts/calendar';
import { useEffect, useRef, useState } from 'react';
import { LearningObject } from '../classroom/LearningObject.tsx';

function today(zone: string): string { return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function step(day: string, delta: number): string { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10); }
export function Calendar({ ctx, onOpen }: { ctx: Context; onOpen(target: string): void }): React.JSX.Element {
  const [zone, setZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone), [date, setDate] = useState(() => today(zone));
  const [day, setDay] = useState<CalendarDay>(), [settings, setSettings] = useState<DailyReportSettings>();
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
  return <main className="sf-page sf-organization" data-testid="studyforge-page-studyforge.calendar">
    <header className="sf-page-head"><span>{report ? '学习日报' : '日历'}</span><button className="sf-quiet" onClick={() => setReport(!report)}>{report ? '返回日历' : '查看日报'}</button></header>
    <div className="sf-calendar-body">
      <div className="sf-org-actions"><button className="sf-quiet" aria-label="前一天" onClick={() => setDate(step(date, -1))}>←</button>
        <input aria-label="查看日期" type="date" value={date} onChange={e => { if (e.target.value) setDate(e.target.value); }} />
        <button className="sf-quiet" aria-label="后一天" onClick={() => setDate(step(date, 1))}>→</button>
        <button className="sf-quiet" onClick={() => setDate(today(zone))}>今天</button><button className="sf-quiet" onClick={() => setRefresh(n => n + 1)}>刷新</button></div>
      <p className="sf-note">{zone}</p>
      {notice && <p role="status" className="sf-notice">{notice}</p>}
      {!day && !notice && <p role="status">正在读取这一天…</p>}
      {day && <div data-testid="calendar-day">
        <h2>{date}</h2>
        <p data-testid="calendar-due">{day.relation === 'future' ? '预计到期' : '当天到期'}：{day.dueCount} 张{day.relation === 'today' ? ` · 之前到期未复习：${day.overdueCount} 张` : ''}</p>
        <h3>{day.relation === 'future' ? '已安排' : '原有安排'}</h3>
        {day.scheduledCourses.length ? day.scheduledCourses.map(course => <button className="sf-org-row" key={course.target} data-testid="calendar-course" onClick={() => open(course.target)}>{course.title}<span>{course.opened ? '回到这节课' : '打开这节课'}</span></button>) : <p className="sf-note">没有安排课程。</p>}
        <h3>实际活动</h3>
        {day.activity.length ? day.activity.map((item, i) => <div className="sf-org-row" key={`${item.target ?? item.kind}:${i}`}>
          <span>{item.title}</span>{item.target && <button className="sf-quiet" onClick={() => open(item.kind === 'course' ? item.sourceRefs.find(ref => ref.startsWith('session:')) ?? item.target! : item.target!)}>查看</button>}
        </div>) : <p className="sf-note">这一天还没有学习活动记录。</p>}
      </div>}
      {target && <LearningObject key={target} ctx={ctx} target={target} onBack={() => setTarget(undefined)} />}
      <details className="sf-daily-settings"><summary>定时日报</summary>
        <form className="sf-org-form" onSubmit={e => { e.preventDefault(); void saveSettings(); }}>
          <label className="sf-org-check"><input aria-label="启用定时日报" type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />启用定时日报</label>
          <label>生成时间<input aria-label="日报时间" type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
          <label>时区<input aria-label="日报时区" value={settingZone} onChange={e => setSettingZone(e.target.value)} /></label>
          <button className="sf-action" disabled={busy}>保存日报设置</button>
          <p className="sf-note">{settings?.lastGenerated ? `最近生成：${new Date(settings.lastGenerated.at).toLocaleString('zh-CN', { timeZone: settings.timeZone })}` : '尚未定时生成。'}</p>
        </form>
      </details>
    </div>
  </main>;
}
