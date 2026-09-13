import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { CourseView } from '@studyforge/contracts/courses';
import { useEffect, useRef, useState } from 'react';

export function registerLearningComposer(ctx: Context): void {
  const previous = document.body.getAttribute('data-sf-learning-ui');
  document.body.setAttribute('data-sf-learning-ui', 'true');
  ctx.effect(() => () => { if (previous === null) document.body.removeAttribute('data-sf-learning-ui'); else document.body.setAttribute('data-sf-learning-ui', previous); });
  ctx.effect(() => ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    { name: 'conversation.input.left', id: 'studyforge.secondary-actions', order: 0 },
    (props: PropsRuntime<'conversation.input.left'>) => <MoreActions {...props} ctx={ctx} />)));
  ctx.effect(() => ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
    { name: 'conversation.input.right', id: 'studyforge.learning-mode', order: 10 },
    (props: PropsRuntime<'conversation.input.right'>) => <LearningMode key={props.sessionId} {...props} ctx={ctx} />)));
}

function MoreActions({ ctx, sessionId, useSessions }: PropsRuntime<'conversation.input.left'> & { ctx: Context }): React.JSX.Element | null {
  const learning = useSessions(state => state.byId[sessionId]?.projectionValues?.agentPreset === 'studyforge-learning');
  const menu = useRef<HTMLDetailsElement>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const close = (event: PointerEvent): void => { if (menu.current?.open && !menu.current.contains(event.target as Node)) menu.current.open = false; };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  if (!learning) return null;
  const insert = (text: string): void => {
    if (ctx.sessions.list.getSnapshot().current !== sessionId || ctx.conversation.blocks.storeFor(sessionId).getSnapshot()) return;
    const actx = ctx.sessions.scope(sessionId);
    if (!actx) return;
    const state = ctx.conversation.input.for(actx).state.getSnapshot();
    if (state.phase !== 'plain') { setNotice('先完成当前输入，再添加学习请求。'); return; }
    // rc.2 represents each reference chip by one character in detect coordinates.
    // Append via the native revision-guarded edit: never flatten chips or replace
    // the draft, and leave ordered attachments and submission entirely native.
    const end = state.draft.length - state.occurrences.reduce((sum, ref) => sum + ref.length - 1, 0);
    const applied = actx.bail(actx, 'slash/input-insert-text', {
      text: (state.draft.length ? '\n\n' : '') + text,
      span: { start: end, end, draftRev: state.draftRev },
    });
    if (!applied) { setNotice('输入已变化，请再选一次。'); return; }
    setNotice('');
    if (menu.current) menu.current.open = false;
    document.querySelector<HTMLElement>('[data-composer-input]')?.focus();
  };
  return <details className="sf-composer-more" ref={menu} onKeyDown={event => { if (event.key === 'Escape' && menu.current) menu.current.open = false; }}>
    <summary aria-label="更多学习操作" title="更多学习操作">＋</summary>
    <div className="sf-composer-menu">
      <button type="button" onClick={() => insert('围绕当前学习的内容，出一道练习题，先不要给出答案。')}>出一道练习题</button>
      <button type="button" onClick={() => insert('请通过一道题或一个问题，检查我对当前内容的理解。')}>检查我的理解</button>
      <button type="button" onClick={() => insert('请根据这节课实际讨论的内容，整理本课要点。')}>整理本课要点</button>
      <hr />
      <button type="button" onClick={() => {
        if (ctx.sessions.list.getSnapshot().current !== sessionId) return;
        const picker = document.querySelector<HTMLInputElement>('[data-composer-seat] [data-testid="composer-import"] input[type="file"]');
        if (!picker || picker.disabled) { setNotice('请等当前资料上传完成后再添加。'); return; }
        if (menu.current) menu.current.open = false;
        picker.click();
      }}>上传新资料到资料库</button>
      {notice && <p role="status">{notice}</p>}
    </div>
  </details>;
}

function LearningMode({ ctx, sessionId, useSession, useSessions }: PropsRuntime<'conversation.input.right'> & { ctx: Context }): React.JSX.Element | null {
  const learning = useSessions(state => state.byId[sessionId]?.projectionValues?.agentPreset === 'studyforge-learning');
  const running = useSessions(state => state.byId[sessionId]?.running);
  const blank = useSession(state => state.blank);
  const [course, setCourse] = useState<CourseView>(), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const current = useRef(sessionId); current.current = sessionId;
  useEffect(() => {
    if (!learning) return;
    let live = true;
    void ctx.remote.studyforgeCourses.read({ sessionId }).then(result => { if (live && result.ok) setCourse(result.value); }).catch(() => {});
    return () => { live = false; };
  }, [ctx, sessionId, learning, running, blank]);
  if (!learning) return null;
  async function choose(guided: boolean): Promise<void> {
    if (!course || busy || ctx.conversation.blocks.storeFor(sessionId).getSnapshot()) return;
    setBusy(true); setNotice('');
    const block = { reason: '正在切换学习方式…' }; ctx.conversation.blocks.set(sessionId, block);
    try {
      const result = await ctx.remote.studyforgeCourses.update({ sessionId, operationId: crypto.randomUUID(), expectedVersion: course.version,
        patch: { guided, teachingRef: guided ? 'diagnose' : 'socratic' } });
      if (!result.ok) throw new Error('mode_failed');
      if (current.current === sessionId) setCourse(result.value);
    } catch { if (current.current === sessionId) setNotice('这次没能切换，请重试。'); }
    finally { setBusy(false); if (ctx.conversation.blocks.storeFor(sessionId).getSnapshot() === block) ctx.conversation.blocks.set(sessionId, undefined); }
  }
  const fixed = !!course?.data.learningContext || !!course?.data.closure;
  return <div className="sf-learning-mode">
    <select aria-label="学习方式" data-testid="learning-mode" value={course?.data.guided || course?.data.learningContext ? 'guided' : 'free'} disabled={!course || busy || fixed}
      title={fixed ? '本课已绑定学习路线或确认小结' : '选择学习方式'} onChange={event => { void choose(event.target.value === 'guided'); }}>
      <option value="free">自由学习</option><option value="guided">路线学习</option>
    </select>
    {notice && <span role="status">{notice}</span>}
  </div>;
}
