import { createVaultClient } from './remote-client.js';
import { VIEW_IDS } from './views-client.js';
import { civilDay } from './calendar-data.js';
import { addReviewDays, REVIEW_OUTCOMES, reviewAssessmentText } from './review-data.js';

const CSS = `
.nv-calendar{container-type:inline-size}.nv-calendar-top{display:flex;align-items:center;gap:6px;min-height:44px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}
.nv-calendar-modes{display:flex;gap:3px}.nv-calendar-modes button,.nv-review-filters button{font:inherit;border:0;border-radius:5px;padding:6px 10px;cursor:pointer;color:var(--dsw-alias-label-secondary);background:transparent}.nv-calendar-modes button[aria-pressed=true],.nv-review-filters button[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.nv-calendar-layout{display:grid;grid-template-columns:280px minmax(0,1fr);flex:1;min-height:0;overflow:auto}.nv-month{padding:20px;border-right:1px solid var(--dsw-alias-border-l1)}.nv-month-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.nv-month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}.nv-month-weekday{text-align:center;color:var(--dsw-alias-label-secondary);font-size:11px;padding:6px 0}.nv-month-day{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;aspect-ratio:1;border:0;border-radius:7px;background:transparent;font:inherit;color:inherit;cursor:pointer}.nv-month-day:hover{background:var(--dsw-alias-interactive-bg-hover)}.nv-month-day[data-outside]{opacity:.35}.nv-month-day[aria-current=date]{font-weight:700;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}.nv-month-day[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-link,var(--dsw-alias-label-primary))}.nv-date-dots{height:4px;display:flex;gap:2px}.nv-date-dot{height:3px;width:3px;background:currentColor;border-radius:50%}
.nv-day-agenda{padding:24px clamp(16px,3cqw,36px);min-width:0}.nv-day-title{display:flex;align-items:center;gap:4px;margin-bottom:20px}.nv-day-title h2{margin:0 auto 0 0;font-size:18px;font-weight:600}.nv-calendar-empty{padding:36px 0;color:var(--dsw-alias-label-secondary);line-height:1.8}.nv-agenda-list{list-style:none;margin:0;padding:0}.nv-agenda-item{display:flex;align-items:flex-start;gap:10px;padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.nv-agenda-main{flex:1;min-width:0}.nv-agenda-kind{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:5px}.nv-agenda-title{border:0;background:none;color:inherit;font:inherit;text-align:left;padding:0;cursor:pointer;overflow-wrap:anywhere;line-height:1.6}.nv-agenda-note{font-size:12px;line-height:1.65;white-space:pre-wrap;color:var(--dsw-alias-label-secondary);margin:6px 0 0}.nv-calendar-hint{font-size:12px;line-height:1.8;color:var(--dsw-alias-label-secondary);margin-top:24px}.nv-calendar-link{display:block;margin-top:12px;text-align:left}.nv-calendar-schedule{padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:12px}
.nv-review-filters{display:flex;gap:3px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}.nv-review-search{display:flex;gap:8px;padding:10px 14px}.nv-review-layout{display:grid;grid-template-columns:minmax(240px,1fr) minmax(260px,1fr);flex:1;min-height:0;overflow:auto}.nv-review-list{padding:0 14px;overflow:auto;border-right:1px solid var(--dsw-alias-border-l1)}.nv-review-row{width:100%;display:flex;justify-content:space-between;gap:12px;padding:14px 10px;text-align:left;background:transparent;color:inherit;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer}.nv-review-row[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-active);border-radius:5px}.nv-review-row small{display:block;margin-top:5px;color:var(--dsw-alias-label-secondary);font-size:11px}.nv-review-detail{padding:20px;min-width:0;overflow:auto}.nv-review-detail h2{font-size:18px;font-weight:600;margin:0 0 8px;overflow-wrap:anywhere}.nv-review-detail textarea{width:100%;min-height:92px;box-sizing:border-box;resize:vertical}.nv-review-actions{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0}.nv-review-history{border-top:1px solid var(--dsw-alias-border-l1);margin-top:24px;padding-top:14px}.nv-review-history summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}.nv-review-history ol{margin:12px 0 0;padding-left:18px}.nv-review-history li{font-size:12px;line-height:1.8;padding-bottom:12px;white-space:pre-wrap}.nv-review-history li[data-reverted]{opacity:.55}.nv-review-history time{color:var(--dsw-alias-label-secondary)}
@container(max-width:580px){.nv-calendar-layout{grid-template-columns:1fr}.nv-month{max-width:340px;border-right:0;padding-bottom:4px;width:100%;box-sizing:border-box;justify-self:center}.nv-calendar-hint{display:none}.nv-review-layout{grid-template-columns:1fr;overflow:auto}.nv-review-list{max-height:240px;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}.nv-review-detail{overflow:visible}.nv-review-search{flex-wrap:wrap}}
`;
const FILTERS = [['due','今日到期'],['pending','待评估'],['learning','复习中'],['familiar','熟悉'],['all','全部']];
const KIND_LABELS = { daily: '日记', lesson: '课程安排', log: '课堂小结', due: '到期复习', review: '评估记录' };
const monthStart = value => value.slice(0, 7) + '-01';
function gridDays(month) {
  const weekday = new Date(month + 'T12:00:00Z').getUTCDay(), start = addReviewDays(month, -((weekday + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => addReviewDays(start, index));
}
function moveMonth(month, offset) {
  const date = new Date(month + 'T12:00:00Z'); date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 10);
}
const changed = () => window.dispatchEvent(new Event('notara-vault-changed'));
const blankAssessments = () => [{ ability: '', outcome: 'not_observed' }];

export function createVaultCalendar(React, { STYLE, IconButton }) {
  const h = React.createElement, { useState, useMemo, useEffect, useRef } = React;
  const button = (label, onClick, extra = {}) => h('button', { type: 'button', style: STYLE.quiet, onClick, ...extra }, label);
  return function CalendarView(props) {
    const vault = useMemo(() => createVaultClient(props.ctx, props.sessionId), [props.ctx, props.sessionId]);
    const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
    const [today, setToday] = useState(() => civilDay(new Date(), timeZone));
    const [date, setDate] = useState(today), [month, setMonth] = useState(monthStart(today)), [mode, setMode] = useState('calendar');
    const [filter, setFilter] = useState('due'), [query, setQuery] = useState(''), [tag, setTag] = useState(''), [offset, setOffset] = useState(0);
    const [calendar, setCalendar] = useState(null), [queue, setQueue] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [selected, setSelected] = useState(''), [detail, setDetail] = useState(null), [detailError, setDetailError] = useState(''), [note, setNote] = useState('');
    const [assessments, setAssessments] = useState(blankAssessments);
    const [busy, setBusy] = useState(false), busyRef = useRef(false), [tick, setTick] = useState(0);
    const [scheduling, setScheduling] = useState(false), [routes, setRoutes] = useState(null), [lessonKey, setLessonKey] = useState('');
    const days = useMemo(() => gridDays(month), [month]);
    useEffect(() => {
      if (!props.viewRequest?.focus) return;
      const target = props.viewRequest.focus;
      if (/^\d{4}-\d{2}-\d{2}$/.test(target)) { setDate(target); setMonth(monthStart(target)); setMode('calendar'); }
      else { setSelected(target); setMode('review'); setFilter('all'); setOffset(0); setNote(''); setAssessments(blankAssessments()); }
      props.completeViewRequest();
    }, [props.viewRequest]);
    useEffect(() => {
      if (!props.visible) return;
      let live = true, pending = false;
      const refresh = async () => {
        if (pending) return; pending = true;
        try {
          const [cal, list] = await Promise.all([vault.calendar({ from: days[0], to: days.at(-1), timeZone }), vault.reviewQueue({ status: filter, query, tag, offset, limit: 50, timeZone })]);
          if (!cal?.ok || !list?.ok) throw new Error('read');
          if (live) { setCalendar(cal.value); setQueue(list.value); setToday(list.value.today); setError(''); }
        } catch { if (live) setError('日历和复习队列暂时读不出来，请刷新后重试。'); }
        finally { pending = false; }
      };
      void refresh(); const timer = setInterval(refresh, 15000);
      window.addEventListener('notara-vault-changed', refresh); window.addEventListener('focus', refresh);
      return () => { live = false; clearInterval(timer); window.removeEventListener('notara-vault-changed', refresh); window.removeEventListener('focus', refresh); };
    }, [vault, props.visible, days, filter, query, tag, offset, tick, timeZone]);
    const selectedRevision = queue?.hits.find(row => row.path === selected)?.revision;
    useEffect(() => {
      if (!selected || !props.visible) return;
      let live = true;
      setDetailError('');
      vault.reviewDetail({ path: selected }).then(result => {
        if (!live) return;
        if (!result?.ok) { setDetail(null); setDetailError('这张卡片的复习属性读不出来，请在资产页检查。'); }
        else setDetail(result.value);
      }).catch(() => { if (live) { setDetail(null); setDetailError('卡片可能已移动或发生修改，请刷新后重试。'); } });
      return () => { live = false; };
    }, [vault, selected, selectedRevision, props.visible, tick]);
    useEffect(() => {
      if (!scheduling) return;
      let live = true;
      vault.routes({}).then(result => { if (live) { if (result?.ok) setRoutes(result.value); else setNotice('课程暂时读不出来。'); } }).catch(() => { if (live) setNotice('课程暂时读不出来。'); });
      return () => { live = false; };
    }, [vault, scheduling, tick]);
    const mutate = async (run, success) => {
      if (busyRef.current) return;
      busyRef.current = true; setBusy(true); setNotice('');
      try {
        const result = await run();
        if (!result?.ok) { setNotice(result?.error?.message || '没有保存成功，请刷新后检查；当前输入已保留。'); return null; }
        setNotice(typeof success === 'function' ? success(result.value) : success); setTick(value => value + 1); changed(); return result.value;
      } catch { setNotice('没有保存成功，资料可能已被修改。请刷新后检查；当前输入已保留。'); return null; }
      finally { busyRef.current = false; setBusy(false); }
    };
    const pick = path => { setSelected(path); setDetail(null); setTick(value=>value+1); setNote(''); setAssessments(blankAssessments()); setNotice(''); setMode('review'); };
    const openDaily = async () => {
      const result = await mutate(() => vault.dailyNote({ date }), '');
      if (result) props.openView(VIEW_IDS.assets, result.path);
    };
    const bring = async path => {
      try {
        const result = await vault.read({ path });
        if (!result?.ok) throw new Error('read');
        if (!props.onBring(result.value, undefined, 1, '请围绕这张卡片带我回忆或练习，先读学生理解和最近评估，优先检验尚未观察到的能力。先让我尝试，不要提前展示答案；可以引导，但评估要看关键认知工作由谁完成，不按提示次数扣分。保存时按具体能力记录证据，未知不当失败，复习日期由复习流程计算。')) setNotice('当前输入框暂时不可用，请稍后重试。');
      } catch { setNotice('无法读取卡片，请刷新后再试。'); }
    };
    const assessmentReady = note.trim() && assessments.every(item => item.ability.trim()) && new Set(assessments.map(item => item.ability.trim())).size === assessments.length;
    const assess = async () => {
      if (!detail || detail.path !== selected || !assessmentReady) return;
      const result = await mutate(() => vault.recordReview({ path: selected, expectedRevision: detail.revision, assessments, note: note.trim(), timeZone }),
        value => value.scheduleChanged ? '已保存能力评估并更新复习安排。' : '已保存能力评估，原复习安排保持不变。');
      if (result) { setDetail(null); setNote(''); setAssessments(blankAssessments()); }
    };
    const undo = async () => {
      if (!detail || detail.path !== selected) return;
      const result = await mutate(() => vault.undoReview({ path: selected, expectedRevision: detail.revision }), '已撤销最近一次评估，恢复原来的复习安排。');
      if (result) setDetail(null);
    };
    const openEvent = event => {
      if (event.kind === 'due' || event.kind === 'review') { pick(event.path); return; }
      if (event.kind === 'lesson') {
        if (event.sessionId) props.ctx.sessions.open(event.sessionId);
        else void mutate(() => vault.openRouteLesson({ path: event.path, nodeId: event.nodeId, expectedRevision: event.revision }), '').then(async result => { if (result) { await props.ctx.sessions.refresh(); props.ctx.sessions.open(result.sessionId); } });
        return;
      }
      props.openView(VIEW_IDS.assets, event.path + (event.anchor ? `#${event.anchor}` : ''));
    };
    const schedule = async () => {
      const index = Number(lessonKey), lesson = routes?.nodes[index];
      if (!lessonKey || !lesson) return;
      const result = await mutate(() => vault.scheduleLesson({ path: lesson.routePath, nodeId: lesson.id, date, expectedRevision: lesson.routeRevision }), '已安排课程。');
      if (result) setScheduling(false);
    };
    const dayEvents = calendar?.events.filter(event => event.date === date) ?? [];
    const groups = new Map(); for (const event of calendar?.events ?? []) groups.set(event.date, new Set([...(groups.get(event.date) ?? []), event.kind]));
    const currentDetail = detail?.path === selected ? detail : null;
    const incomplete = !!(calendar?.truncated || queue?.truncated || calendar?.unreadable || queue?.unreadable || calendar?.invalid.length || queue?.invalid.length);
    const invalidPaths = [...new Set([...(calendar?.invalid??[]),...(queue?.invalid??[])].map(row=>row.path))];
    return h('div', { className: 'nv-calendar', style: STYLE.page }, h('style', null, CSS),
      h('header', { className: 'nv-calendar-top' },
        h('div', { className: 'nv-calendar-modes', 'aria-label': '日历视图' },
          ...[['calendar','日历'],['review','间隔复习']].map(([value,label]) => h('button', { key: value, 'aria-pressed': mode === value, onClick: () => setMode(value) }, label))),
        h('span', { style: { marginLeft: 'auto', ...STYLE.notice } }, today),
        h(IconButton, { icon: 'refresh', label: '刷新日历与复习', onClick: () => setTick(value => value + 1) })),
      (notice || error) && h('div', { role: error ? 'alert' : 'status', className: 'nv-notice' }, notice || error),
      incomplete && h('div', { className: 'nv-notice', role: 'status' }, '部分资料未能读入，当前列表可能不完整；有冲突的属性需要检查。',invalidPaths.map(path=>button(`检查 ${path.split('/').at(-1)}`,()=>props.openView(VIEW_IDS.assets,path),{key:path}))),
      mode === 'calendar' ? h('div', { className: 'nv-calendar-layout' },
        h('aside', { className: 'nv-month', 'aria-label': '月历' },
          h('div', { className: 'nv-month-head' }, h(IconButton, { icon: 'left', label: '上个月', onClick: () => setMonth(value => moveMonth(value,-1)) }), h('strong', null, `${Number(month.slice(0,4))} 年 ${Number(month.slice(5,7))} 月`), h(IconButton, { icon: 'right', label: '下个月', onClick: () => setMonth(value => moveMonth(value,1)) })),
          h('div', { className: 'nv-month-grid' }, ...['一','二','三','四','五','六','日'].map(day => h('span', { key:day, className:'nv-month-weekday' }, day)),
            ...days.map(day => h('button', { key:day, className:'nv-month-day', 'aria-label':`${day}${groups.has(day) ? ' 有学习安排或记录' : ''}`, 'aria-current':day===today?'date':undefined, 'aria-pressed':day===date, 'data-outside':day.slice(0,7)!==month.slice(0,7)||undefined, onClick:()=>setDate(day) }, Number(day.slice(8)), h('span', { className:'nv-date-dots', 'aria-hidden':true }, [...groups.get(day)??[]].slice(0,3).map(kind=>h('i',{key:kind,className:'nv-date-dot'})))))),
          button('今天', () => { setDate(today); setMonth(monthStart(today)); }, { className:'nv-calendar-link' }),
          h('div', { className:'nv-calendar-hint' }, '课程安排、课堂小结、复习与日记汇在同一天。', h('br'), '计划与真实学习记录分别展示。'),
          button(`今日待复习 ${queue?.counts.due ?? '…'} 张`, () => { setMode('review'); setFilter('due'); setTag(''); setQuery(''); setOffset(0); }, { className:'nv-calendar-link' })),
        h('section', { className:'nv-day-agenda', 'aria-label':'当天安排' },
          h('div', { className:'nv-day-title' }, h('h2',null,date===today?'今天':date), h(IconButton,{icon:'book',label:'打开或新建当日日记',disabled:busy,onClick:openDaily}), h(IconButton,{icon:'plus',label:'安排课程',disabled:busy,'aria-pressed':scheduling,onClick:()=>setScheduling(value=>!value)})),
          scheduling && h('div',{className:'nv-calendar-schedule'},
            !routes?h('p',null,'正在读取课程…'):!routes.nodes.length?h('p',null,'先在路线页准备课程，再安排日期。'):h(React.Fragment,null,
              h('select',{'aria-label':'选择要安排的课程',style:STYLE.templateInput,value:lessonKey,onChange:event=>setLessonKey(event.target.value)},h('option',{value:''},'选择课程…'),routes.nodes.map((lesson,index)=>h('option',{key:`${lesson.routePath}:${lesson.id}`,value:String(index)},`${routes.routes.find(route=>route.path===lesson.routePath)?.title ?? ''} · ${lesson.title}${lesson.scheduledOn?' · '+lesson.scheduledOn:''}`))),
              button('安排到这天',schedule,{disabled:busy||!lessonKey}))),
          !calendar?h('p',{className:'nv-calendar-empty'},'正在读取…'):!dayEvents.length?h('div',{className:'nv-calendar-empty'},'这一天还没有安排或记录。'):h('ul',{className:'nv-agenda-list'},dayEvents.map(event=>h('li',{key:event.key,className:'nv-agenda-item'},
            h('div',{className:'nv-agenda-main'},h('div',{className:'nv-agenda-kind'},KIND_LABELS[event.kind]),h('button',{className:'nv-agenda-title',onClick:()=>openEvent(event)},event.title),event.kind==='review'&&h('p',{className:'nv-agenda-note'},reviewAssessmentText(event)),event.note&&h('p',{className:'nv-agenda-note'},event.note)),
            event.kind==='lesson'&&h(IconButton,{icon:'close',label:`取消安排 ${event.title}`,disabled:busy,onClick:()=>mutate(()=>vault.scheduleLesson({path:event.path,nodeId:event.nodeId,date:null,expectedRevision:event.revision}),'已取消日期安排，课程仍保留。')}),
            event.kind==='log'&&event.sessionId&&h(IconButton,{icon:'chat',label:`回到课堂 ${event.title}`,onClick:()=>props.ctx.sessions.open(event.sessionId)}))))))
      : h(React.Fragment,null,
          h('div',{className:'nv-review-filters','aria-label':'复习队列分类'},FILTERS.map(([value,label])=>h('button',{key:value,'aria-pressed':filter===value,onClick:()=>{setFilter(value);setOffset(0);}},`${label} ${queue?.counts[value]??'…'}`))),
          h('div',{className:'nv-review-search'},h('input',{'aria-label':'搜索复习卡片',placeholder:'搜索卡片…',style:{...STYLE.templateInput,margin:0},value:query,onChange:event=>{setQuery(event.target.value);setOffset(0);}}),h('select',{'aria-label':'筛选复习标签',style:{...STYLE.templateInput,width:150,margin:0},value:tag,onChange:event=>{setTag(event.target.value);setOffset(0);}},h('option',{value:''},'全部标签'),queue?.tags.map(value=>h('option',{key:value,value},'#'+value)))),
          h('div',{className:'nv-review-layout'},
            h('section',{className:'nv-review-list','aria-label':'复习卡片列表'},
              !queue?h('p',{className:'nv-calendar-empty'},'正在读取…'):!queue.hits.length?h('div',{className:'nv-calendar-empty'},filter==='due'?'当前没有到期卡片。':'没有符合条件的卡片。'):queue.hits.map(row=>h('button',{key:row.path,className:'nv-review-row','aria-pressed':selected===row.path,onClick:()=>pick(row.path)},h('span',null,row.title,h('small',null,row.tags.map(value=>'#'+value).join(' '))),h('span',null,row.state.learned?row.state.next_review:'待评估',h('small',null,row.state.learned?`第 ${row.state.mastery} 档 · ${row.state.interval} 天`: '尚未开始复习')))),
              h('div',{className:'nv-review-actions'},offset>0&&button('上一页',()=>setOffset(Math.max(0,offset-50))),queue?.nextOffset!=null&&button('下一页',()=>setOffset(queue.nextOffset)))),
            h('section',{className:'nv-review-detail','aria-label':'卡片复习详情'},
              !selected?h('div',{className:'nv-calendar-empty'},'选择卡片，自己回忆，或带入对话让老师提问。'):detailError?h(React.Fragment,null,h('p',{role:'alert'},detailError),button('打开卡片',()=>props.openView(VIEW_IDS.assets,selected))):!currentDetail?h('p',null,'正在读取卡片…'):h(React.Fragment,null,
                h('h2',null,currentDetail.title),h('div',{style:STYLE.notice},currentDetail.state.learned?`第 ${currentDetail.state.mastery} 档 · 下次 ${currentDetail.state.next_review}`:'尚未开始间隔复习'),
                h('div',{className:'nv-review-actions'},button('带入对话复习',()=>bring(selected)),h(IconButton,{icon:'book',label:'打开卡片原文',onClick:()=>props.openView(VIEW_IDS.assets,selected)})),
                h('div',{'aria-label':'本次能力观察',style:{marginTop:20}},assessments.map((item,index)=>h('div',{key:index,style:{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}},
                  h('input',{'aria-label':`评估能力 ${index+1}`,placeholder:'本次要检验的能力，如自主选法',maxLength:200,style:{...STYLE.templateInput,flex:'1 1 180px'},value:item.ability,onChange:event=>setAssessments(rows=>rows.map((row,i)=>i===index?{...row,ability:event.target.value}:row))}),
                  h('select',{'aria-label':`能力表现 ${index+1}`,style:{...STYLE.templateInput,width:'auto'},value:item.outcome,onChange:event=>setAssessments(rows=>rows.map((row,i)=>i===index?{...row,outcome:event.target.value}:row))},Object.entries(REVIEW_OUTCOMES).map(([value,label])=>h('option',{key:value,value},label))),
                  h(IconButton,{icon:'close',label:`移除评估能力 ${index+1}`,disabled:busy||assessments.length===1,onClick:()=>setAssessments(rows=>rows.filter((_,i)=>i!==index))}))),
                  assessments.length<8&&button('添加能力',()=>setAssessments(rows=>[...rows,...blankAssessments()]),{disabled:busy})),
                h('label',{style:{fontSize:12,display:'block',marginTop:16}},'这次回忆或作答的情况',h('textarea',{'aria-label':'评估说明',placeholder:'自己提出了什么？老师提供了什么？哪些能力还没有机会观察？',maxLength:4000,style:{...STYLE.templateInput,marginTop:8},value:note,onChange:event=>setNote(event.target.value)})),
                h('div',{className:'nv-review-actions'},button('保存评估',assess,{disabled:busy||!assessmentReady})),
                h('p',{style:{...STYLE.notice,lineHeight:1.7}},'看关键认知工作由谁完成，不按提示次数扣分。尚未观察不当失败；提前成功不延长间隔。复习档位只用于安排时间。'),
                currentDetail.history.length>0&&h('details',{className:'nv-review-history'},h('summary',null,`评估经历 · ${currentDetail.historyCount} 次${currentDetail.historyCount>20?'（最近20次）':''}`),h('ol',null,[...currentDetail.history].reverse().map(record=>h('li',{key:record.id,'data-reverted':!!record.revertedAt||undefined},h('time',null,`${record.day} · ${record.actor==='self'?'自评':'课堂评估'}${record.revertedAt?' · 已撤销':''}`),h('div',null,reviewAssessmentText(record)),h('div',null,record.note)))),currentDetail.history.some(record=>!record.revertedAt)&&button('撤销最近一次评估',undo,{disabled:busy})))))));
  };
}
