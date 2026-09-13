import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { useEffect, useRef, useState } from 'react';
import { SubjectPicker } from './SubjectPicker.tsx';
import { insertTaskSkill } from './skill-draft.ts';
import type { TeachingChoice } from '@studyforge/contracts/teaching';
import { RolePicker } from '../creation/RolePicker.tsx';

export function registerLearningComposer(ctx: Context): void {
  const previous = document.body.getAttribute('data-sf-learning-ui');
  document.body.setAttribute('data-sf-learning-ui', 'true');
  ctx.effect(() => () => { if (previous === null) document.body.removeAttribute('data-sf-learning-ui'); else document.body.setAttribute('data-sf-learning-ui', previous); });
  ctx.effect(() => ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    { name: 'conversation.input.left', id: 'studyforge.secondary-actions', order: 0 },
    (props: PropsRuntime<'conversation.input.left'>) => <MoreActions {...props} ctx={ctx} />)));
  ctx.effect(() => ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
    { name: 'conversation.input.right', id: 'studyforge.subjects', order: 20 },
    (props: PropsRuntime<'conversation.input.right'>) => <SubjectPicker key={props.sessionId} {...props} ctx={ctx} />)));
  ctx.effect(() => ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
    { name: 'conversation.input.right', id: 'studyforge.learning-mode', order: 10 },
    (props: PropsRuntime<'conversation.input.right'>) => <RolePicker key={props.sessionId} {...props} ctx={ctx} />)));
}

function MoreActions({ ctx, sessionId, useSessions }: PropsRuntime<'conversation.input.left'> & { ctx: Context }): React.JSX.Element | null {
  const learning = useSessions(state => state.byId[sessionId]?.projectionValues?.agentPreset === 'studyforge-learning');
  const menu = useRef<HTMLDetailsElement>(null);
  const [notice, setNotice] = useState('');
  const [skills, setSkills] = useState<TeachingChoice[]>([]);
  useEffect(() => {
    let live = true;
    const read = (): void => { void ctx.remote.studyforgeTeaching.tasks().then(result => { if (live && result.ok) setSkills(result.value); }).catch(() => { if (live) setNotice('技能暂时读不出来。'); }); };
    read(); window.addEventListener('studyforge:learning-changed', read);
    return () => { live = false; window.removeEventListener('studyforge:learning-changed', read); };
  }, [ctx]);
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
      {skills.map(skill => <button type="button" key={skill.id} title={skill.description} onClick={() => {
        if (!insertTaskSkill(ctx, sessionId, skill)) { setNotice('请等当前输入准备完成，再选择技能。'); return; }
        setNotice(''); if (menu.current) menu.current.open = false;
        document.querySelector<HTMLElement>('[data-composer-input]')?.focus();
      }}>{skill.title}</button>)}
      <button type="button" onClick={() => insert('请通过一道题或一个问题，检查我对当前内容的理解。')}>检查我的理解</button>
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
