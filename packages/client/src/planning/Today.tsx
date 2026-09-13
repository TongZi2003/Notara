/**
 * P6.1 首页，移植自 B@3831987 `app/js/screens/home.js`（四框小样 A）。
 *
 * B 的规矩一条不改：问候语按钟点、日期一行、四个方框——今天要做的 / 接着上次 /
 * 开一件新的 / 今天的痕迹。数据全部来自本机真实合同：`studyforgeCalendar.day`
 * 给当天到期与排好的课，`studyforgeLearning.cards` 给还没学的张数，native Session
 * 列表给「今天的痕迹」与「接着上次」。
 *
 * 三个动作真的走各自的合同：翻卡与讲义开现有组件，「开始学习」开一节新的原生课
 * （`ctx.uiWorkspace.startSession()`），「继续这节课」在有课后小结时用
 * `studyforgeHandoffs.openContinuation` 开接续的那一节，没小结则回到那一节本身。
 * 读失败时一个数字都不编：`studyforgeCalendar.day` 读不到就说读不到，不写「今天没有到期的卡」。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CalendarDay } from '@studyforge/contracts/calendar';
import type { HandoffView } from '@studyforge/contracts/handoffs';
import { useEffect, useState } from 'react';
import { ReviewScreen } from '../review/ReviewScreen.tsx';
import { ReviewHandout } from '../review/ReviewHandout.tsx';

/** One native lesson row, as the frame's own Session list spells it. */
export interface HomeLessonRow {
  readonly id: string;
  readonly title: string;
  readonly running: boolean;
  /** Durable last-activity instant; the only way to answer "今天的痕迹". */
  readonly updatedAt: number;
}

export interface TodayProps {
  readonly ctx: Context;
  readonly lessons: readonly HomeLessonRow[];
  readonly lessonsLoaded: boolean;
  /** B's 开始学习: open a new native lesson, never a return to the old one. */
  onStartLesson(): void;
  /** Another student page this client already owns. */
  onPage(page: 'studyforge.courses' | 'studyforge.materials' | 'studyforge.sets' | 'studyforge.calendar' | 'studyforge.cards'): void;
  /** Open a real target the Host knows (`route:<node>` / `session:<id>`). */
  onOpenTarget(target: string): void;
  /** Select one existing native Session. */
  onOpenLesson(id: string): void;
}

/** B's own greeting, hour for hour. */
export function greeting(hour: number): string {
  if (hour >= 23 || hour < 5) return '夜深了。';
  if (hour < 11) return '早上好。';
  if (hour < 14) return '中午好。';
  if (hour < 18) return '下午好。';
  return '晚上好。';
}

const WEEKDAYS = '日一二三四五六';
const civilDay = (at: number, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

export function Today({ ctx, lessons, lessonsLoaded, onStartLesson, onPage, onOpenTarget, onOpenLesson }: TodayProps): React.JSX.Element {
  const [day, setDay] = useState<CalendarDay>();
  const [unlearned, setUnlearned] = useState<number>();
  const [handoff, setHandoff] = useState<HandoffView>();
  const [panel, setPanel] = useState<'home' | 'review' | 'handout'>('home');
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = civilDay(Date.now(), zone);
  const now = new Date();
  const last = lessons[0];
  const todayLessons = lessons.filter(row => civilDay(row.updatedAt, zone) === today);
  const recentToday = todayLessons.slice(0, 3);
  const olderToday = todayLessons.slice(3);
  const due = (day?.dueCount ?? 0) + (day?.overdueCount ?? 0);

  useEffect(() => {
    let live = true;
    void ctx.remote.studyforgeCalendar.day({ date: today, timeZone: zone }).then(
      result => { if (live) { if (result.ok) { setDay(result.value); setUnavailable(false); } else setUnavailable(true); } },
      () => { if (live) setUnavailable(true); },
    );
    void ctx.remote.studyforgeLearning.cards().then(
      result => { if (live && result.ok) setUnlearned(result.value.filter(card => card.review === undefined).length); },
      () => { /* A card read that failed shows no count; it never invents one. */ },
    );
    return () => { live = false; };
  }, [ctx, today, zone, panel]);

  useEffect(() => {
    if (last === undefined) { setHandoff(undefined); return undefined; }
    let live = true;
    void ctx.remote.studyforgeHandoffs.read({ sessionId: last.id }).then(
      result => { if (live) setHandoff(result.ok ? result.value : undefined); },
      () => { if (live) setHandoff(undefined); },
    );
    return () => { live = false; };
  }, [ctx, last]);

  /**
   * B's 继续这节课 opens the next lesson from the summary the student just read.
   * The operation id is derived from the exact handoff revision, so a lost answer
   * retries the same lesson instead of opening a second one; a lesson that has no
   * summary yet is simply reopened.
   */
  async function continueLesson(): Promise<void> {
    if (last === undefined) return;
    if (handoff === undefined) { onOpenLesson(last.id); return; }
    setBusy(true); setNotice(undefined);
    try {
      const result = await ctx.remote.studyforgeHandoffs.openContinuation({
        operationId: `studyforge.home.continue:${handoff.ref}:${String(handoff.version)}`,
        ref: handoff.ref, version: handoff.version,
      });
      if (!result.ok) { setNotice('新的一节没开起来，再点一次会用同一次开课重试。'); return; }
      onOpenLesson(result.value.sessionId);
    } catch { setNotice('新的一节没开起来，再点一次会用同一次开课重试。'); }
    finally { setBusy(false); }
  }

  if (panel === 'review') return <main className="sf-orig sf-page-scroll" data-testid="studyforge-page-studyforge.home">
    <div className="plain-wrap"><ReviewScreen ctx={ctx} onBack={() => { setPanel('home'); }} /></div>
  </main>;
  if (panel === 'handout') return <main className="sf-orig sf-page-scroll" data-testid="studyforge-page-studyforge.home">
    <div className="plain-wrap"><ReviewHandout ctx={ctx} onOpen={target => { onOpenTarget(target); }} /></div>
  </main>;

  const box = (title: string, body: React.ReactNode, count = '', cls = ''): React.JSX.Element =>
    <div className={`home-box${cls}`}><div className="bh"><span className="t">{title}</span><div className="line" />{count !== '' && <span className="c">{count}</span>}</div>{body}</div>;

  const todo = [
    due > 0 ? <div className="row" key="due"><span className="badge hot">到期 {due}</span>
      <span className="txt" data-testid="today-due">{day !== undefined && day.overdueCount > 0 ? `逾期 ${day.overdueCount} 张 · 今天到期 ${day.dueCount} 张` : `${due} 张学过的卡片等你复习`}</span>
      <span className="acts"><button className="chip hot" data-testid="today-flip" onClick={() => { setPanel('review'); }}>翻卡</button>
        <button className="chip" data-testid="today-handout" onClick={() => { setPanel('handout'); }}>讲义</button></span></div> : null,
    ...(day?.scheduledCourses ?? []).map(course => <div className="row" key={course.target}><span className="badge">排课</span>
      <span className="txt">{course.title}</span>
      <span className="acts"><button className="chip hot" data-testid="today-open-course" onClick={() => { onOpenTarget(course.target); }}>{course.opened === true ? '回到这节课' : '打开这节课'}</button></span></div>),
    unlearned !== undefined && unlearned > 0 ? <div className="row" key="fresh"><span className="badge">还没学 {unlearned}</span>
      <span className="txt">装进来、还没学过的卡——第一次学过才进复习</span>
      <span className="acts"><button className="chip hot" data-testid="today-fresh" onClick={() => { onPage('studyforge.cards'); }}>去看看</button></span></div> : null,
  ].filter(entry => entry !== null);

  return <main className="sf-orig sf-page-scroll" data-testid="studyforge-page-studyforge.home">
    <div className="home-wrap">
      <div className="home-greet"><h1>{greeting(now.getHours())}</h1>
        <div className="date" data-testid="today-date">{now.getMonth() + 1} 月 {now.getDate()} 日 · 星期{WEEKDAYS[now.getDay()]}</div></div>
      {unavailable && <p className="mini-note" role="status">今天的安排暂时无法读取。</p>}

      {todo.length > 0
        ? box('今天要做的', <div className="sf-linear-tree">{todo}</div>, `${todo.length} 件`, ' now')
        : box('今天要做的', unavailable
          // Nothing was read, so nothing may be claimed: this is a read failure, not an empty day.
          ? <p className="mini-note" data-testid="today-unavailable">今天的安排暂时读不出来。稍后再看一次，别当成今天没事。</p>
          : <p className="mini-note" data-testid="today-nothing">今天没有到期的卡——想学新的，往下开一节课。</p>)}

      {last !== undefined
        ? box('接着上次', <div className="continue-card">
          <span className="bk">课</span>
          <span className="tt"><b>{handoff?.title ?? last.title}</b>
            <span>{[`${String(new Date(last.updatedAt).getMonth() + 1)} 月 ${String(new Date(last.updatedAt).getDate())} 日`,
              handoff !== undefined && handoff.facts.length > 0 ? `带过 ${String(handoff.facts.length)} 样` : ''].filter(Boolean).join(' · ')}
              <button type="button" className="ho-past" data-testid="home-last-transcript" onClick={() => { onOpenLesson(last.id); }}>看上次对话 ▸</button></span></span>
          <button type="button" className="btn primary" data-testid="home-continue" disabled={busy} onClick={() => { void continueLesson(); }}>继续这节课</button></div>)
        : lessonsLoaded && box('从资料开始', <p className="mini-note">还没有上过课。挑一份资料，或者直接回课堂开口。</p>)}

      {box('开一件新的', <><div className="home-actions">
        <button className="home-act" data-testid="open-classroom" onClick={() => { onStartLesson(); }}><b>开始学习</b><span>开一节新的课，写下想学的主题</span></button>
      </div><details className="home-more"><summary>更多学习</summary><div>
        <button className="home-link" data-testid="home-materials" onClick={() => { onPage('studyforge.materials'); }}>从资料开始</button>
        <button className="home-link" data-testid="home-courses" onClick={() => { onPage('studyforge.courses'); }}>看课程地图</button>
        <button className="home-link" data-testid="home-calendar" onClick={() => { onPage('studyforge.calendar'); }}>翻开日历</button>
        <button className="home-link" data-testid="home-sets" onClick={() => { onPage('studyforge.sets'); }}>整理学习集</button>
      </div></details></>)}
      {notice !== undefined && <p className="mini-note" role="status" data-testid="home-notice">{notice}</p>}

      {box('今天的痕迹', recentToday.length > 0
        ? <><div className="home-ledger-main sf-linear-tree">{recentToday.map(row => <button className="ledger-row" key={row.id} data-testid="today-lesson" onClick={() => { onOpenLesson(row.id); }}>
          <span className="dot free" /><div className="t">{row.title}<small>对话</small></div>
          <span className="time">{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(row.updatedAt)}</span></button>)}</div>
          {olderToday.length > 0 && <details className="home-ledger-more"><summary>还有 {olderToday.length} 节今天的记录</summary>
            <div className="sf-linear-tree">{olderToday.map(row => <button className="ledger-row" key={row.id} data-testid="today-lesson" onClick={() => { onOpenLesson(row.id); }}>
              <span className="dot free" /><div className="t">{row.title}<small>对话</small></div>
              <span className="time">{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(row.updatedAt)}</span></button>)}</div>
            <button className="home-all-lessons" data-testid="home-all-lessons" onClick={() => { onPage('studyforge.courses'); }}>查看全部课程 →</button></details>}</>
        : <p className="mini-note">{lessonsLoaded ? '今天还没有学习记录。' : '正在读今天的记录…'}</p>)}
    </div>
  </main>;
}
