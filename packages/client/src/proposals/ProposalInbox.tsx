/**
 * P5.3 the confirmations waiting in this lesson.
 *
 * The list is the Host's own `studyforgeProposals.list`: a proposal that was
 * never confirmed is still there after a restart, and one that was confirmed
 * keeps its receipt instead of disappearing. With no proposal at all this
 * renders nothing, so a lesson without teacher proposals stays quiet.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ProposalView } from '@studyforge/contracts/proposals';
import { useEffect, useRef, useState } from 'react';
import { ProposalCard } from './ProposalCard.tsx';

export interface ProposalInboxProps {
  readonly ctx: Context;
  /** Only this lesson's proposals; absent leaves the workspace-wide list. */
  readonly sessionId?: string;
  /**
   * Changed by the caller when something outside this inbox can have changed the
   * list — a native turn settling, or a confirmation made elsewhere — so the
   * pending drafts on screen are the ones the Host really holds. Any stable
   * token works (`3`, `"running:7"`); a new value means "ask again", and only a
   * different `sessionId` starts the list over.
   */
  readonly refreshToken?: string | number;
  readonly onChanged?: (view: ProposalView) => void;
}

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly proposals: readonly ProposalView[] };

/** Teacher proposals for one lesson, newest decision state included. */
export function ProposalInbox({ ctx, sessionId, refreshToken, onChanged }: ProposalInboxProps): React.JSX.Element | null {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  /**
   * A refresh inside the same lesson only updates the snapshot; the cards on
   * screen keep their identity and their open editors. This flag says the last
   * read failed while a usable snapshot is still shown.
   */
  const [unreadable, setUnreadable] = useState(false);
  const loadedSession = useRef<string | undefined | null>(null);

  useEffect(() => {
    let live = true;
    // Only a different lesson starts from nothing: re-reading the same lesson
    // must not unmount the drafts the student is editing.
    if (loadedSession.current !== sessionId) {
      loadedSession.current = sessionId;
      setState({ status: 'loading' });
      setUnreadable(false);
    }
    const input = sessionId === undefined ? {} : { sessionId };
    ctx.remote.studyforgeProposals.list(input).then(
      result => {
        if (!live) return;
        if (result.ok) { setState({ status: 'ready', proposals: result.value }); setUnreadable(false); return; }
        setUnreadable(true);
        setState(current => (current.status === 'ready' ? current : { status: 'unavailable' }));
      },
      () => {
        if (!live) return;
        setUnreadable(true);
        setState(current => (current.status === 'ready' ? current : { status: 'unavailable' }));
      },
    );
    return () => { live = false; };
  }, [ctx, sessionId, revision, refreshToken]);

  // A list nobody could read is not an empty list: saying "no proposals" there
  // would tell the student their teacher proposed nothing.
  if (state.status === 'unavailable') return <section className="sf-proposals" data-testid="proposal-inbox-unavailable">
    <h2>等你确认</h2>
    <p className="sf-notice">这些待确认项现在读不出来。</p>
    <button type="button" className="sf-quiet" data-testid="proposal-inbox-retry"
      onClick={() => { setRevision(value => value + 1); }}>再读一次</button>
  </section>;
  if (state.status === 'loading') return null;
  if (state.proposals.length === 0 && !unreadable) return null;

  function changed(view: ProposalView): void {
    setState(current => current.status === 'ready'
      ? { status: 'ready', proposals: current.proposals.map(row => (row.ref === view.ref ? view : row)) }
      : current);
    setRevision(value => value + 1);
    if (onChanged !== undefined) onChanged(view);
  }

  const ordered = [...state.proposals].sort((left, right) => rank(left) - rank(right));
  const waiting = ordered.some(proposal => proposal.items.some(item => item.status === 'pending' || item.status === 'failed'));
  return <section className="sf-proposals" data-testid="proposal-inbox">
    <h2>{waiting ? '等你确认' : '提案记录'}</h2>
    {waiting && <p className="sf-note">尚未保存的内容，确认后才会记下；各项结果见下方。</p>}
    {unreadable && <div className="sf-notice" data-testid="proposal-inbox-unreadable">
      <p>刚才没能重新读取，下面还是你上回看到的那一版；正在改的草稿没有丢。</p>
      <button type="button" className="sf-quiet" data-testid="proposal-inbox-retry"
        onClick={() => { setRevision(value => value + 1); }}>再对一次</button>
    </div>}
    {ordered.map(proposal => <ProposalCard key={proposal.ref} ctx={ctx} proposal={proposal} onChanged={changed} />)}
  </section>;
}

/** Unfinished business first: waiting, then failed, then already decided. */
function rank(proposal: ProposalView): number {
  if (proposal.items.some(item => item.status === 'pending')) return 0;
  if (proposal.items.some(item => item.status === 'failed')) return 1;
  return 2;
}
