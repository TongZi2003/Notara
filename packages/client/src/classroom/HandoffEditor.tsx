/**
 * P7.5 the saved summary of one lesson, and its confirmed correction.
 *
 * The lesson's own summary is a real record: the teacher's prose plus the Host
 * facts that were frozen when the student accepted it. This surface shows those
 * facts as they are — never a re-read "latest" list — and a correction writes a
 * NEW immutable revision of the same ref. Older revisions stay readable, which is
 * what keeps a lesson that already continued from this summary teaching the exact
 * version it received.
 *
 * Nothing here closes a lesson. Closing is the confirmed `propose_handoff`
 * proposal; this is the after-the-fact reading and rewording surface.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { HandoffView } from '@studyforge/contracts/handoffs';
import { useEffect, useState } from 'react';
import { attemptKey, useStableOperationId } from '../cards/attempt.ts';

export interface HandoffEditorProps {
  readonly ctx: Context;
  /** The lesson whose summary is shown: its own saved summary, or the one it continued from. */
  readonly sessionId: string;
  /**
   * The lesson this displayed revision should be continued *into*, with that
   * lesson's current course version. Only pass it where the student really is
   * opening a continuation; without it this surface has no continue action.
   */
  readonly continueInto?: { readonly sessionId: string; readonly courseVersion: number };
  /**
   * Fired once a real next lesson exists and is pinned to the shown revision, so
   * the root can navigate into it. Without it the surface only says it is ready.
   */
  readonly onContinued?: (sessionId: string) => void;
  /** Fired after a correction really wrote a new revision. */
  readonly onChanged?: (view: HandoffView) => void;
}

const FACT_LABEL = { material: '课上用了', saved: '当时保存了', pending: '当时还没确认' } as const;

type State = { readonly status: 'loading' } | { readonly status: 'missing' } | { readonly status: 'error'; readonly notice: string }
  | { readonly status: 'ready'; readonly view: HandoffView };

export function HandoffEditor({ ctx, sessionId, continueInto, onContinued, onChanged }: HandoffEditorProps): React.JSX.Element | null {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  // One attempt keeps one operation id: a lost answer retries the same opening
  // instead of opening a second lesson on the next click.
  const operationFor = useStableOperationId();

  useEffect(() => {
    let dropped = false;
    setState({ status: 'loading' });
    setEditing(false);
    void ctx.remote.studyforgeHandoffs.read({ sessionId }).then(result => {
      if (dropped) return;
      if (!result.ok) { setState({ status: 'missing' }); return; }
      setState({ status: 'ready', view: result.value });
    }, () => { if (!dropped) setState({ status: 'error', notice: '这一课的小结暂时读不出来。' }); });
    return () => { dropped = true; };
  }, [ctx, sessionId]);

  if (state.status === 'loading') return null;
  if (state.status === 'missing') return null;
  if (state.status === 'error') return <p className="sf-notice" data-testid="handoff-error">{state.notice}</p>;
  const view = state.view;

  function startEditing(): void {
    setEditing(true);
    setNotice(undefined);
    setTitle(view.title);
    setBody(view.body);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setNotice(undefined);
    const result = await ctx.remote.studyforgeHandoffs.correct({
      operationId: crypto.randomUUID(), ref: view.ref, expectedVersion: view.version,
      correction: { ...(title.trim() === '' || title.trim() === view.title ? {} : { title: title.trim() }), body },
    });
    setBusy(false);
    if (!result.ok) {
      // A stale version is a real conflict: re-read instead of overwriting a
      // revision the student never saw.
      setNotice(result.error.message.includes('conflict') ? '小结刚被改过，重新打开看一眼再改。' : '这次更正没保存，稍后再试一次。');
      const latest = await ctx.remote.studyforgeHandoffs.read({ sessionId });
      if (latest.ok) setState({ status: 'ready', view: latest.value });
      return;
    }
    setState({ status: 'ready', view: result.value });
    setEditing(false);
    if (onChanged !== undefined) onChanged(result.value);
  }

  /**
   * Continue the target lesson from exactly the revision on screen. The student
   * chose this version by reading it; nothing here resolves "the latest one".
   */
  async function continueFrom(): Promise<void> {
    if (continueInto === undefined) return;
    setBusy(true);
    setNotice(undefined);
    const result = await ctx.remote.studyforgeHandoffs.continue({
      operationId: operationFor(attemptKey('continue-into', continueInto.sessionId, view.ref, String(view.version))), sessionId: continueInto.sessionId, ref: view.ref, version: view.version,
    });
    setBusy(false);
    setNotice(result.ok
      ? '这节课会接着这一版上。'
      : result.error.message.includes('continuation_fixed') ? '这节课已经接在别的版本上了，先按那一版上完。' : '这次接续没记上，稍后再试一次。');
  }

  /**
   * Open the real next lesson from exactly the revision on screen. The student
   * chose this version by reading it; the Host derives one stable native id from
   * the operation, so a retry answers with the lesson it already opened.
   */
  async function startNext(): Promise<void> {
    setBusy(true);
    setNotice(undefined);
    const result = await ctx.remote.studyforgeHandoffs.openContinuation({
      operationId: operationFor(attemptKey('handoff-continue', view.ref, String(view.version))),
      ref: view.ref, version: view.version,
    });
    setBusy(false);
    if (!result.ok) { setNotice('新的一节没开起来，再点一次会用同一次开课重试。'); return; }
    if (onContinued !== undefined) onContinued(result.value.sessionId);
    else setNotice('新的一节已经开好。');
  }

  return <section className="sf-handoff" data-testid="handoff-editor" data-handoff-version={String(view.version)}>
    <header className="sf-handoff-head">
      <h4>课后小结{view.title === '' ? '' : `「${view.title}」`}</h4>
      <span className="sf-meta" data-testid="handoff-version">第 {String(view.version)} 版</span>
    </header>

    {!editing && <>
      <p className="sf-handoff-body" data-testid="handoff-body">{view.body}</p>
    </>}

    {view.facts.length > 0 && <ul className="sf-proposal-lines" data-testid="handoff-facts">
      {view.facts.map((fact, index) => <li key={`${String(index)}:${fact.kind}:${fact.title}`} className="sf-meta">
        {FACT_LABEL[fact.kind]}《{fact.title}》
      </li>)}
    </ul>}
    <p className="sf-note" data-testid="handoff-frozen-note">
      这份小结写在老师提出来的时候，上面就是当时手上的东西；后来改的只是正文，这一版之后也一直读得到。
    </p>

    {editing ? <form className="sf-proposal-edit" data-testid="handoff-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className="sf-field"><span>标题</span>
        <input data-testid="handoff-title" value={title} onChange={event => { setTitle(event.target.value); }} />
      </label>
      <label className="sf-field"><span>正文</span>
        <textarea data-testid="handoff-body-input" rows={6} value={body} onChange={event => { setBody(event.target.value); }} />
      </label>
      <div className="sf-conflict-actions">
        <button type="submit" className="sf-action" data-testid="handoff-save" disabled={busy || body.trim() === ''}>存成新的一版</button>
        <button type="button" className="sf-quiet" data-testid="handoff-cancel" onClick={() => { setEditing(false); }}>取消</button>
      </div>
    </form> : <div className="sf-conflict-actions">
      <button type="button" className="sf-quiet" data-testid="handoff-edit" disabled={busy} onClick={startEditing}>更正正文</button>
      <button type="button" className="sf-action" data-testid="handoff-start-next" disabled={busy}
        onClick={() => { void startNext(); }}>从这版接着学</button>
      {continueInto !== undefined && <button type="button" className="sf-quiet" data-testid="handoff-continue" disabled={busy}
        onClick={() => { void continueFrom(); }}>把这节课接在这一版</button>}
    </div>}

    {notice !== undefined && <p className="sf-notice" data-testid="handoff-notice">{notice}</p>}
  </section>;
}
