import type { Context } from '@deepseek-ai/cordis';
import type { TeachingRoundView, RoundActorView } from '@studyforge/contracts/teaching-rounds';
import { useCallback, useEffect, useState } from 'react';
import './rounds-panel.css';

const STAGES: Record<TeachingRoundView['stage'], string> = {
  writing: '出题中', answering: '待作答', awaiting_correction: '待勘误',
  completed: '已完成', failed: '出题失败', stopped: '已停止',
};
const ROLE_LABELS: Record<RoundActorView['role'], string> = { problem: '命题帮手', peer: '同伴', assistant: '助教' };
const ACTOR_STATE: Record<RoundActorView['state'], string> = {
  queued: '排队中', running: '进行中', completed: '已完成', failed: '未成功', stopped: '已停止',
};

function ActorLine({ actor }: { actor: RoundActorView }): React.JSX.Element {
  return <div className="sf-round-actor" data-role={actor.role} data-state={actor.state} data-testid={`round-actor-${actor.role}`}>
    <header><strong>{ROLE_LABELS[actor.role]}</strong><em>{ACTOR_STATE[actor.state] ?? actor.state}</em></header>
    {actor.text && <p className="sf-round-actor-text">{actor.text}</p>}
    {actor.state === 'failed' && actor.detail && <p className="sf-round-actor-detail">{actor.detail}</p>}
  </div>;
}

/** The student-facing round panel: question card, own answer, peer review and
 * assistant correction as a visible sequence. Hidden standards and helper
 * session ids never appear — the host view omits them. */
export function RoundsPanel({ ctx, sessionId }: { ctx: Context; sessionId: string }): React.JSX.Element {
  const [rounds, setRounds] = useState<TeachingRoundView[]>();
  const [selected, setSelected] = useState<string>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'' | 'answer' | 'correct' | 'stop'>('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback((): void => {
    void ctx.remote.studyforgeRounds.list({ sessionId })
      .then(reply => { if (reply.ok) setRounds(reply.value); else setNotice('回合列表暂时读不出来。'); })
      .catch(() => setNotice('回合列表暂时读不出来。'));
  }, [ctx, sessionId]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 4000);
    window.addEventListener('focus', refresh);
    window.addEventListener('studyforge:learning-changed', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('studyforge:learning-changed', refresh); };
  }, [refresh]);

  const round = (selected ? rounds?.find(item => item.ref === selected) : undefined) ?? rounds?.[0];

  const submit = async (): Promise<void> => {
    if (!round || !draft.trim()) { setNotice('先写下自己的答案再交。'); return; }
    setBusy('answer'); setNotice('');
    const reply = await ctx.remote.studyforgeRounds.answer({ sessionId, ref: round.ref, text: draft.trim() });
    setBusy('');
    if (reply.ok) { setDraft(''); setSelected(reply.value.ref); refresh(); }
    else setNotice(reply.error?.message ?? '这次提交没有成功，稍后再试。');
  };
  const correct = async (): Promise<void> => {
    if (!round) return;
    setBusy('correct'); setNotice('');
    const reply = await ctx.remote.studyforgeRounds.correct({ sessionId, ref: round.ref });
    setBusy('');
    if (reply.ok) { setSelected(reply.value.ref); refresh(); }
    else setNotice(reply.error?.message ?? '勘误这次没有成功，稍后再试。');
  };
  const stop = async (): Promise<void> => {
    if (!round) return;
    setBusy('stop'); setNotice('');
    const reply = await ctx.remote.studyforgeRounds.stop({ sessionId, ref: round.ref });
    setBusy('');
    if (reply.ok) { setSelected(reply.value.ref); refresh(); }
    else setNotice(reply.error?.message ?? '停止没有成功，稍后再试。');
  };

  if (rounds === undefined) return <aside className="sf-rounds" data-testid="rounds-panel"><p className="sf-rounds-empty">正在读回合…</p></aside>;
  if (rounds.length === 0) return <aside className="sf-rounds" data-testid="rounds-panel"><p className="sf-rounds-empty">这节课还没有出题回合。请老师开一个，或者自己说「出一道题考考我」。</p>{notice && <p className="sf-rounds-notice">{notice}</p>}</aside>;

  const active = round && (round.stage === 'writing' || round.stage === 'answering' || round.stage === 'awaiting_correction');
  return <aside className="sf-rounds" data-testid="rounds-panel">
    <header className="sf-rounds-head">
      <strong>出题回合</strong>
      {rounds.length > 1 && <select aria-label="选择回合" data-testid="rounds-picker" value={round?.ref} onChange={event => setSelected(event.target.value)}>
        {rounds.map(item => <option key={item.ref} value={item.ref}>{item.topic} · {STAGES[item.stage]}</option>)}
      </select>}
    </header>
    {round && <div className="sf-rounds-body" data-testid="round-body">
      <p className="sf-rounds-stage" data-testid="round-stage" data-stage={round.stage}>{round.topic} · {STAGES[round.stage]}</p>
      {round.questionFront && <section className="sf-rounds-question" data-testid="round-question">
        <h4>{round.questionTitle ?? '题目'}</h4>
        <p>{round.questionFront}</p>
        {round.cardRef && <small className="sf-rounds-cardref">已收进卡片库，以后照常复习</small>}
      </section>}
      {round.answer && <section className="sf-rounds-answer" data-testid="round-answer"><h4>我的作答</h4><p>{round.answer}</p></section>}
      {round.stage === 'answering' && <section className="sf-rounds-compose" data-testid="round-compose">
        <textarea aria-label="写下自己的答案" placeholder="用自己的话写下答案，先不要看别人的。" value={draft} onChange={event => setDraft(event.target.value)} />
        <button data-testid="round-submit" disabled={busy !== ''} onClick={() => { void submit(); }}>{busy === 'answer' ? '正在交…' : '交卷，请同伴看'}</button>
      </section>}
      {round.stage === 'awaiting_correction' && <section className="sf-rounds-compose">
        <button data-testid="round-correct" disabled={busy !== ''} onClick={() => { void correct(); }}>{busy === 'correct' ? '助教正在看…' : '请助教勘误'}</button>
      </section>}
      <section className="sf-rounds-actors" data-testid="round-actors">
        {round.actors.map(actor => <ActorLine key={actor.role} actor={actor} />)}
      </section>
      {active && <button className="sf-rounds-stop" data-testid="round-stop" disabled={busy !== ''} onClick={() => { void stop(); }}>停止这一轮</button>}
      {notice && <p className="sf-rounds-notice" data-testid="rounds-notice">{notice}</p>}
    </div>}
  </aside>;
}
