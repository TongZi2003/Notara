import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { useEffect, useState } from 'react';
import { SubjectPicker } from './SubjectPicker.tsx';
import { insertTaskSkill } from './skill-draft.ts';
import type { TeachingChoice } from '@studyforge/contracts/teaching';
import { RolePicker } from '../creation/RolePicker.tsx';
import { ControlPopover } from './ControlPopover.tsx';

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
  const [notice, setNotice] = useState('');
  const [skills, setSkills] = useState<TeachingChoice[]>([]);
  useEffect(() => {
    let live = true;
    const read = (): void => { void ctx.remote.studyforgeTeaching.tasks().then(result => { if (live && result.ok) setSkills(result.value); }).catch(() => { if (live) setNotice('技能暂时读不出来。'); }); };
    read(); window.addEventListener('studyforge:learning-changed', read);
    return () => { live = false; window.removeEventListener('studyforge:learning-changed', read); };
  }, [ctx]);
  if (!learning) return null;
  const insert = (text: string, close: () => void): void => {
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
    close();
    document.querySelector<HTMLElement>('[data-composer-input]')?.focus();
  };
  return <ControlPopover key={sessionId} className="sf-composer-more" menuClassName="sf-composer-menu" title="更多学习操作" chevron={false}
    label={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg>}>
    {close => <LearningActionsMenu skills={skills} notice={notice} onSkill={skill => {
        if (!insertTaskSkill(ctx, sessionId, skill)) { setNotice('请等当前输入准备完成，再选择技能。'); return; }
        setNotice(''); close();
        document.querySelector<HTMLElement>('[data-composer-input]')?.focus();
      }} onCheck={() => insert('请通过一道题或一个问题，检查我对当前内容的理解。', close)} onUpload={() => {
        if (ctx.sessions.list.getSnapshot().current !== sessionId) return;
        const picker = document.querySelector<HTMLInputElement>('[data-composer-seat] [data-testid="composer-import"] input[type="file"]');
        if (!picker || picker.disabled) { setNotice('请等当前资料上传完成后再添加。'); return; }
        close();
        picker.click();
      }} />}
  </ControlPopover>;
}

function LearningActionsMenu({ skills, notice, onSkill, onCheck, onUpload }: {
  skills: readonly TeachingChoice[]; notice: string; onSkill: (skill: TeachingChoice) => void; onCheck: () => void; onUpload: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const needle = query.trim().normalize('NFKC').toLocaleLowerCase();
  const matches = (text: string): boolean => text.normalize('NFKC').toLocaleLowerCase().includes(needle);
  const visible = skills.filter(skill => matches(skill.title + ' ' + skill.description));
  const check = matches('检查我的理解');
  return <>
    <div className="sf-composer-search"><LearningActionIcon kind="studyforge-semantic-search" /><input type="search" aria-label="搜索学习操作" placeholder="搜索技能…" autoFocus value={query} onChange={event => setQuery(event.target.value)} /></div>
    <div className="sf-composer-skills" role="group" aria-label="学习技能" key={needle}>
      {visible.map(skill => <button type="button" key={skill.id} title={skill.description} onClick={() => onSkill(skill)}><LearningActionIcon kind={skill.id} /><span>{skill.title}</span></button>)}
      {check && <button type="button" onClick={onCheck}><LearningActionIcon kind="check" /><span>检查我的理解</span></button>}
      {!visible.length && !check && <p className="sf-composer-empty">没有匹配的学习操作</p>}
    </div>
    <footer className="sf-composer-upload"><button type="button" onClick={onUpload}><LearningActionIcon kind="upload" /><span>上传新资料到资料库</span></button></footer>
    {notice && <p className="sf-composer-notice" role="status">{notice}</p>}
  </>;
}

/** One restrained line-icon family; installed skills get a plugin symbol. */
function LearningActionIcon({ kind }: { kind: string }): React.JSX.Element {
  const drawings: Record<string, React.ReactNode> = {
    'studyforge-semantic-search': <><circle cx="8.5" cy="8.5" r="5.5" /><path d="m12.5 12.5 4 4" /></>,
    'studyforge-essay-review': <><path d="m5 12 8-8 3 3-8 8-4 1zM11 6l3 3M3 18h14" /></>,
    'studyforge-quiz': <><rect x="3" y="2" width="14" height="16" rx="2" /><path d="m6 7 1 1 2-2M11 7h3M6 12h2M11 12h3" /></>,
    'studyforge-markdown-handout': <><path d="M11 2H4v16h12V7zM11 2v5h5M7 11h6M7 14h6" /></>,
    'studyforge-html-demo': <><rect x="2" y="3" width="16" height="12" rx="2" /><path d="m8 6 5 3-5 3zM7 18h6M10 15v3" /></>,
    check: <><circle cx="10" cy="10" r="7.5" /><path d="m6 10 3 3 5-6" /></>,
    upload: <><path d="M3 12v5h14v-5M10 13V3M6 7l4-4 4 4" /></>,
  };
  return <svg className="sf-menu-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {drawings[kind] ?? <path d="M7 3H3v5h2a2 2 0 1 1 0 4H3v5h5v-2a2 2 0 1 1 4 0v2h5v-5h-2a2 2 0 1 1 0-4h2V3h-5v2a2 2 0 1 1-4 0V3z" />}
  </svg>;
}
