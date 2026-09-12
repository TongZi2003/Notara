/**
 * P7.2 the student's own edit of one judgement about themselves.
 *
 * A record is revised along its own identity: the draft survives, the newest
 * stored revision is shown read-only, and the baseline only moves when the
 * student says so. Changing the wording is not a new observation, so an edit
 * never carries fresh evidence — it keeps the sources the record already
 * adopted. A *new* judgement does need real words behind it, so creating one
 * picks from the student's own accepted utterances in this lesson instead of
 * letting anyone type a citation.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { EvidenceCatalogue, EvidenceEntry } from '@studyforge/domain/evidence';
import type { MemoryContent, MemoryDraft, MemoryView } from '@studyforge/contracts/memory';
import { useEffect, useState } from 'react';
import { attemptKey, UNKNOWN_WRITE_COPY, useStableOperationId } from '../cards/attempt.ts';
import { answerLost, codeOf, failureCode } from '../cards/format.ts';
import { kindLabel } from './MemoryCard.tsx';

export interface MemoryEditorProps {
  readonly ctx: Context;
  readonly sessionId?: string;
  /** The record to revise; absent means the student is writing a new judgement. */
  readonly target?: string;
  /** A record the caller already read, so the editor does not re-read it. */
  readonly seed?: MemoryView;
  readonly onSaved: (memory: MemoryView) => void;
  readonly onCancel?: () => void;
}

interface Draft {
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly subjects: string;
}

/** The three defaults are configuration, not a closed list: a longer kind is kept as typed. */
const KIND_CHOICES: readonly string[] = ['ability', 'habit', 'preference'];

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready' };

export function MemoryEditor({ ctx, sessionId, target, seed, onSaved, onCancel }: MemoryEditorProps): React.JSX.Element {
  const [state, setState] = useState<State>(seed !== undefined || target === undefined ? { status: 'ready' } : { status: 'loading' });
  const [baseline, setBaseline] = useState<MemoryView | undefined>(seed);
  const [draft, setDraft] = useState<Draft>(() => (seed === undefined
    ? { kind: 'ability', title: '', body: '', subjects: '' }
    : { kind: seed.content.kind, title: seed.content.title ?? '', body: seed.content.body, subjects: (seed.content.scope?.subjects ?? []).join('、') }));
  const [catalogue, setCatalogue] = useState<readonly EvidenceEntry[] | undefined>(undefined);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [conflict, setConflict] = useState<MemoryView | undefined>(undefined);
  // One attempt keeps one operation id: a lost answer is retried, not repeated.
  const operationFor = useStableOperationId();
  const creating = baseline === undefined;

  useEffect(() => {
    if (seed !== undefined || target === undefined) return undefined;
    let live = true;
    ctx.remote.studyforgeMemory.read({ target }).then(
      result => {
        if (!live) return;
        if (!result.ok) { setState({ status: 'unavailable' }); return; }
        setBaseline(result.value);
        setDraft({ kind: result.value.content.kind, title: result.value.content.title ?? '', body: result.value.content.body, subjects: (result.value.content.scope?.subjects ?? []).join('、') });
        setState({ status: 'ready' });
      },
      () => { if (live) setState({ status: 'unavailable' }); },
    );
    return () => { live = false; };
  }, [ctx, target, seed]);

  // Only a new judgement needs sources, and only the real ones this lesson has.
  useEffect(() => {
    if (!creating) return undefined;
    let live = true;
    const input = sessionId === undefined ? {} : { sessionId };
    ctx.remote.studyforgeMemory.catalogue(input).then(
      result => { if (live) setCatalogue(result.ok ? result.value.entries : []); },
      () => { if (live) setCatalogue([]); },
    );
    return () => { live = false; };
  }, [ctx, creating, sessionId]);

  const session = sessionId === undefined ? {} : { sessionId };

  function content(): MemoryContent {
    const subjects = draft.subjects.split(/[、,，\s]+/u).map(subject => subject.trim()).filter(subject => subject !== '');
    return {
      kind: draft.kind.trim() === '' ? 'ability' : draft.kind.trim(),
      body: draft.body,
      ...(draft.title.trim() === '' ? {} : { title: draft.title.trim() }),
      ...(subjects.length === 0 ? {} : { scope: { subjects } }),
    };
  }

  async function save(): Promise<void> {
    if (draft.body.trim() === '') { setNotice('先写一句话，说明你现在怎么看。'); return; }
    if (creating && picked.length === 0) { setNotice('新判断要挂上你自己说过的话：下面挑一条。'); return; }
    setSaving(true);
    setNotice(undefined);
    try {
      if (baseline === undefined) {
        const body = content();
        const memory: MemoryDraft = { ...body, evidenceRefs: [...picked] };
        const noted = await ctx.remote.studyforgeMemory.note({
          operationId: operationFor(attemptKey('note', JSON.stringify(memory))), ...session, draft: memory,
        });
        if (!noted.ok) {
          // No answer: the judgement may already be stored, so the retry is the
          // same write rather than a second observation.
          if (answerLost(failureCode(noted.error))) { setNotice(UNKNOWN_WRITE_COPY); return; }
          setNotice(saveFailureCopy(noted.error.message)); return;
        }
        setBaseline(noted.value);
        onSaved(noted.value);
        return;
      }
      const edit = { content: content() };
      const saved = await ctx.remote.studyforgeMemory.edit({
        operationId: operationFor(attemptKey('edit', baseline.ref, String(baseline.revision), JSON.stringify(edit))),
        ...session, target: baseline.ref, expectedVersion: baseline.revision, edit,
      });
      if (saved.ok) {
        setBaseline(saved.value);
        setConflict(undefined);
        onSaved(saved.value);
        return;
      }
      if (answerLost(failureCode(saved.error))) { setNotice(UNKNOWN_WRITE_COPY); return; }
      if (codeOf(saved.error.message) === 'version_conflict') {
        const latest = await ctx.remote.studyforgeMemory.read({ target: baseline.ref });
        if (latest.ok) { setConflict(latest.value); return; }
      }
      setNotice(saveFailureCopy(saved.error.message));
    } catch {
      // The Host may have stored it and the answer got lost; retry the same write.
      setNotice(UNKNOWN_WRITE_COPY);
    } finally {
      setSaving(false);
    }
  }

  if (state.status === 'loading') return <p className="sf-note" role="status" data-testid="memory-editor-loading">正在打开这条判断…</p>;
  if (state.status === 'unavailable') return <p className="sf-note" role="status" data-testid="memory-editor-unavailable">这条判断暂时打不开，稍后再看一次。</p>;

  return <form className="sf-memory-editor" data-testid="memory-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
    <header><h4>{creating ? '记一条关于自己的判断' : '改这条判断'}</h4></header>
    <div className="sf-chip-row" data-testid="memory-kind-choices">
      {KIND_CHOICES.map(kind => <button key={kind} type="button" data-testid={`memory-kind-${kind}`}
        className={draft.kind === kind ? 'sf-chip sf-chip-on' : 'sf-chip'}
        onClick={() => { setDraft({ ...draft, kind }); }}>{kindLabel(kind)}</button>)}
      <input className="sf-cards-search" data-testid="memory-editor-kind" aria-label="分类" value={draft.kind}
        onChange={event => { setDraft({ ...draft, kind: event.target.value }); }} />
    </div>
    <label className="sf-field"><span>说法（可以留空，只写正文）</span>
      <input data-testid="memory-editor-title" value={draft.title} onChange={event => { setDraft({ ...draft, title: event.target.value }); }} />
    </label>
    <label className="sf-field"><span>现在怎么看你</span>
      <textarea data-testid="memory-editor-body" rows={5} value={draft.body} onChange={event => { setDraft({ ...draft, body: event.target.value }); }} />
    </label>
    <label className="sf-field"><span>适用科目（留空就是所有科目）</span>
      <input data-testid="memory-editor-subjects" value={draft.subjects} onChange={event => { setDraft({ ...draft, subjects: event.target.value }); }} />
    </label>

    {creating && <section className="sf-memory-pick" data-testid="memory-evidence-picker">
      <h5>挂上你自己说过的话</h5>
      {catalogue === undefined && <p className="sf-note">正在看这节课里你真正说过的话…</p>}
      {catalogue?.length === 0 && <p className="sf-note" data-testid="memory-evidence-empty">
        这节课还没有能引用的话。先上着课，等你真的说了什么再记。
      </p>}
      <ul>{catalogue?.map(entry => <li key={entry.alias}>
        <label className="sf-memory-pick-row">
          <input type="checkbox" data-testid="memory-evidence-item" checked={picked.includes(entry.alias)}
            onChange={() => { setPicked(current => current.includes(entry.alias) ? current.filter(alias => alias !== entry.alias) : [...current, entry.alias]); }} />
          <span>「{entry.quote}」</span>
          <span className="sf-meta">{entry.occurredAt.slice(0, 10)} · {entry.source === 'student_statement' ? '你说的' : '课堂表现'}</span>
        </label>
      </li>)}</ul>
    </section>}

    {!creating && baseline !== undefined && <section className="sf-memory-pick" data-testid="memory-current-basis">
      <h5>这条判断现在引用的原话（改说法不会换掉它）</h5>
      <ul>{baseline.basis.current.map(quote => <li key={`${quote.messageId}:${quote.quote}`}>
        <span>「{quote.quote}」</span><span className="sf-meta"> · {quote.occurredAt.slice(0, 10)}</span>
      </li>)}</ul>
    </section>}

    {conflict !== undefined && <section className="sf-conflict" data-testid="memory-editor-conflict">
      <p className="sf-notice">这条判断刚在别处更新过：现在已经是第 {String(conflict.revision)} 版。下面是最新的说法。</p>
      <dl className="sf-conflict-latest" data-testid="memory-editor-latest">
        <dt>分类</dt><dd>{kindLabel(conflict.content.kind)}</dd>
        <dt>说法</dt><dd>{conflict.content.body}</dd>
      </dl>
      <div className="sf-conflict-actions">
        <button type="button" className="sf-action" data-testid="memory-editor-rebase"
          onClick={() => { setBaseline(conflict); setConflict(undefined); setNotice('已按最新版为基线：你的草稿还在。'); }}>以最新版为基线继续改</button>
        <button type="button" className="sf-quiet" data-testid="memory-editor-take-latest"
          onClick={() => {
            setBaseline(conflict);
            setDraft({ kind: conflict.content.kind, title: conflict.content.title ?? '', body: conflict.content.body, subjects: (conflict.content.scope?.subjects ?? []).join('、') });
            setConflict(undefined);
          }}>用最新版替换我的草稿</button>
      </div>
    </section>}
    {notice !== undefined && <p className="sf-notice" role="status" data-testid="memory-editor-notice">{notice}</p>}
    <footer className="sf-card-editor-actions">
      <button type="submit" className="sf-action" data-testid="memory-editor-save" disabled={saving}>{saving ? '正在保存…' : '保存'}</button>
      {onCancel !== undefined && <button type="button" className="sf-quiet" data-testid="memory-editor-cancel" onClick={onCancel}>取消</button>}
    </footer>
  </form>;
}

/** The refusal codes this write really produces, in the student's words. */
function saveFailureCopy(message: string): string {
  switch (codeOf(message)) {
    case 'version_conflict': return '这条判断刚被别人改过，先看最新版再决定。';
    case 'memory_evidence_unknown': return '引用的那句话已经找不到了，重新挑一条。';
    case 'memory_evidence_required': return '新判断要挂上你自己说过的话。';
    case 'memory_expected_version_required': return '先重新打开这条判断，再改。';
    default: return '这次没有保存成功，稍后再试一次。';
  }
}
