import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type { LearningPath } from '@studyforge/contracts/courses';
import type { CardView } from '@studyforge/contracts/cards';
import { useEffect, useState } from 'react';
import { cardOpenRequest } from '../cards/CardOpenRequest.tsx';
import './learning-entry.css';

/** Only real route continuations and due cards; no invented daily recommendations. */
export function LearningEntry({ ctx, sessionId, useSession }: PropsRuntime<'conversation.composer.dock'> & { ctx: Context }): React.JSX.Element | null {
  const blank = useSession(state => state.blank);
  const [paths, setPaths] = useState<LearningPath[]>([]), [cards, setCards] = useState<CardView[]>([]);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!blank) return;
    let live = true; setPaths([]); setCards([]); setNotice('');
    void Promise.all([ctx.remote.studyforgeCourses.learningPaths(), ctx.remote.studyforgeLearning.cards()]).then(([routes, allCards]) => {
      if (!live) return;
      if (routes.ok) setPaths(routes.value.filter(path => path.status !== 'complete' && path.originSessionId !== sessionId && path.next));
      if (allCards.ok) {
        const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        setCards(allCards.value.filter(card => card.review && card.review.nextDue <= today).sort((a, b) => a.review!.nextDue.localeCompare(b.review!.nextDue)).slice(0, 8));
      }
      if (!routes.ok || !allCards.ok) setNotice('学习建议暂时读不出来。');
    }).catch(() => { if (live) setNotice('学习建议暂时读不出来。'); });
    return () => { live = false; };
  }, [ctx, sessionId, blank, refresh]);
  if (!blank || (!paths.length && !cards.length && !notice)) return null;
  async function open(path: LearningPath): Promise<void> {
    if (!path.next || busy) return;
    setBusy(true); setNotice('');
    try {
      let id = path.next.sessionId;
      if (!id && path.next.nodeId) {
        const result = await ctx.remote.studyforgeOrganization.openPlannedLesson({ operationId: crypto.randomUUID(), nodeId: path.next.nodeId });
        if (!result.ok) throw new Error('open_failed');
        id = result.value.sessionId;
      }
      if (id) {
        await ctx.sessions.refresh();
        if (ctx.sessions.list.getSnapshot().current === sessionId) { ctx.sessions.open(id as SessionId); ctx.layout.selectPanel(null); }
      }
    } catch { setNotice('这节课暂时打不开，可以重试。'); }
    finally { setBusy(false); }
  }
  return <div className="sf-learning-entry" data-testid="learning-entry">
    <div className="sf-learning-suggestions" aria-label="学习建议">
      {paths.map(path => <button key={path.originSessionId} disabled={busy} onClick={() => { void open(path); }}>
        <small>接着学 · {path.title}</small><span>{path.next?.title}</span></button>)}
      {cards.map(card => <button key={card.ref} onClick={() => { cardOpenRequest.request(card.ref); ctx.layout.selectPanel('studyforge.cards' as MainPanelId); }}>
        <small>待复习</small><span>{card.content.title}</span></button>)}
    </div>
    {notice && <p role="status">{notice}<button disabled={busy} onClick={() => setRefresh(n => n + 1)}>重试</button></p>}
  </div>;
}
