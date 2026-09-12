/**
 * P5.2/P5.5 the one private knowledge record, edited by the student.
 *
 * A knowledge record is one identity with one free body: collecting it never
 * copies it into a second card, and changing a relation never rewrites the
 * body. Editing keeps the same identity and the same conflict rule as a card —
 * the draft survives, the newest stored version is shown read-only, and the
 * baseline only moves when the student says so.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { KnowledgeNote, KnowledgePatch, KnowledgeView } from '@studyforge/contracts/knowledge';
import { useEffect, useState } from 'react';
import { MarkdownBody } from './MarkdownBody.tsx';
import { attemptKey, UNKNOWN_WRITE_COPY, useStableOperationId } from './attempt.ts';
import { answerLost, codeOf, failureCode, saveFailureCopy } from './format.ts';

export interface KnowledgeEditorProps {
  readonly ctx: Context;
  readonly sessionId?: string;
  /** The record to revise; absent means the student is writing a new note. */
  readonly target?: string;
  readonly seed?: KnowledgeView;
  readonly onSaved: (view: KnowledgeView) => void;
  /**
   * The record is really gone. Cards that cite it and learning records that
   * point at it stay exactly as they are — only this note stops being listed.
   */
  readonly onDeleted?: () => void;
  readonly onCancel?: () => void;
}

interface Draft {
  readonly title: string;
  readonly body: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly links: readonly string[];
}

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready' };

/** One write that was really sent; frozen verbatim when its answer was lost. */
type FrozenWrite = { readonly sessionId?: string } & (
  | { readonly kind: 'note'; readonly operationId: string; readonly content: KnowledgeNote }
  | { readonly kind: 'revise'; readonly operationId: string; readonly target: string; readonly expectedVersion: number; readonly patch: KnowledgePatch });

/** One knowledge record: note it, or revise it along its own identity. */
export function KnowledgeEditor({ ctx, sessionId, target, seed, onSaved, onDeleted, onCancel }: KnowledgeEditorProps): React.JSX.Element {
  const [state, setState] = useState<State>(seed !== undefined || target === undefined ? { status: 'ready' } : { status: 'loading' });
  const [baseline, setBaseline] = useState<KnowledgeView | undefined>(seed);
  const [draft, setDraft] = useState<Draft>(() => (seed === undefined
    ? { title: '', body: '', category: '', tags: [], links: [] }
    : draftOf(seed)));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [conflict, setConflict] = useState<KnowledgeView | undefined>(undefined);
  // Deleting is a decision of its own: it asks once, and a lost answer keeps the
  // same write alive instead of leaving the student guessing whether it landed.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteUnknown, setDeleteUnknown] = useState(false);
  // One attempt keeps one operation id: a lost answer is retried, not repeated.
  const operationFor = useStableOperationId();

  useEffect(() => {
    if (seed !== undefined || target === undefined) return undefined;
    let live = true;
    ctx.remote.studyforgeLearning.method({ target }).then(
      result => {
        if (!live) return;
        if (!result.ok) { setState({ status: 'unavailable' }); return; }
        setBaseline(result.value);
        setDraft(draftOf(result.value));
        setState({ status: 'ready' });
      },
      () => { if (live) setState({ status: 'unavailable' }); },
    );
    return () => { live = false; };
  }, [ctx, target, seed]);


  // A write whose answer never came back keeps its exact request; see CardEditor.
  const [frozen, setFrozen] = useState<FrozenWrite | undefined>(undefined);

  async function send(write: FrozenWrite): Promise<void> {
    const session = write.sessionId === undefined ? {} : { sessionId: write.sessionId };
    if (write.kind === 'note') {
      const noted = await ctx.remote.studyforgeLearning.noteMethod({
        operationId: write.operationId, ...session, content: write.content,
      });
      if (!noted.ok) {
        // No answer: the note may already exist, so the form freezes around the
        // request that was really sent instead of claiming it failed.
        if (answerLost(failureCode(noted.error))) { setFrozen(write); setNotice(UNKNOWN_WRITE_COPY); return; }
        setFrozen(undefined);
        setNotice(saveFailureCopy(noted.error.message));
        return;
      }
      setFrozen(undefined);
      setBaseline(noted.value);
      setDraft(draftOf(noted.value));
      onSaved(noted.value);
      return;
    }
    const saved = await ctx.remote.studyforgeLearning.reviseMethod({
      operationId: write.operationId, ...session, target: write.target, expectedVersion: write.expectedVersion, patch: write.patch,
    });
    if (!saved.ok) {
      if (answerLost(failureCode(saved.error))) { setFrozen(write); setNotice(UNKNOWN_WRITE_COPY); return; }
      setFrozen(undefined);
      if (codeOf(saved.error.message) === 'version_conflict') {
        const latest = await ctx.remote.studyforgeLearning.method({ target: write.target });
        if (latest.ok) { setConflict(latest.value); return; }
      }
      setNotice(saveFailureCopy(saved.error.message));
      return;
    }
    setFrozen(undefined);
    setBaseline(saved.value);
    setDraft(draftOf(saved.value));
    setConflict(undefined);
    onSaved(saved.value);
  }

  async function submit(write: FrozenWrite): Promise<void> {
    setSaving(true);
    setNotice(undefined);
    try { await send(write); }
    catch {
      // The Host may have stored it and the answer got lost; retry the same write.
      setNotice(UNKNOWN_WRITE_COPY);
    } finally {
      setSaving(false);
    }
  }

  async function save(): Promise<void> {
    if (frozen !== undefined) return;
    if (draft.title.trim() === '' || draft.body.trim() === '') { setNotice('标题和正文都要写一点。'); return; }
    if (baseline === undefined) {
      const content: KnowledgeNote = {
        title: draft.title.trim(), body: draft.body, tags: [...draft.tags], links: [...draft.links], publicSources: [],
        ...(draft.category === '' ? {} : { category: draft.category }),
      };
      await submit({ ...(sessionId ? { sessionId } : {}), kind: 'note', operationId: operationFor(attemptKey('note', sessionId ?? '', JSON.stringify(content))), content });
      return;
    }
    const patch = {
      ...(draft.title.trim() === baseline.content.title ? {} : { title: draft.title.trim() }),
      ...(draft.body === baseline.content.body ? {} : { body: draft.body }),
      ...(draft.category === (baseline.content.category ?? '') ? {} : { category: draft.category === '' ? null : draft.category }),
      ...(draft.tags.join('\u0000') === baseline.content.tags.join('\u0000') ? {} : { tags: [...draft.tags] }),
      links_add: draft.links.filter(link => !baseline.content.links.includes(link)),
      links_remove: baseline.content.links.filter(link => !draft.links.includes(link)),
    };
    await submit({
      ...(sessionId ? { sessionId } : {}), kind: 'revise', operationId: operationFor(attemptKey('revise', sessionId ?? '', baseline.ref, String(baseline.version), JSON.stringify(patch))),
      target: baseline.ref, expectedVersion: baseline.version, patch,
    });
  }

  /** The only write allowed while an answer is missing: the same request again. */
  async function retry(): Promise<void> {
    if (frozen === undefined) return;
    await submit(frozen);
  }

  /**
   * Remove this note for good. A retry after an unanswered attempt is the same
   * operation, so the Host's own tombstone decides: the same op never deletes
   * twice, and a record that is already gone still answers `deleted`.
   */
  async function remove(): Promise<void> {
    if (baseline === undefined) return;
    setSaving(true);
    setNotice(undefined);
    try {
      // The Host's delete takes exactly one target at one revision — no
      // session, and no second shape to keep in sync.
      const result = await ctx.remote.studyforgeLearning.deleteMethod({
        operationId: operationFor(attemptKey('delete', baseline.ref, String(baseline.version))),
        target: baseline.ref, expectedVersion: baseline.version,
      });
      if (!result.ok) {
        setDeleteUnknown(false);
        if (answerLost(failureCode(result.error))) {
          // The tombstone may already be written; the same operation is the retry.
          setDeleteUnknown(true);
          setNotice(UNKNOWN_WRITE_COPY);
          return;
        }
        const code = codeOf(result.error.message);
        if (code === 'record_missing') {
          // Somebody else already removed it: the student's intent holds, so the
          // list refreshes instead of leaving a row that can never be deleted.
          if (onDeleted !== undefined) onDeleted();
          else onCancel?.();
          return;
        }
        if (code === 'version_conflict') {
          // Re-asking can only conflict again at the same baseline, so the
          // confirm step closes until the student has seen the newest revision.
          setConfirmingDelete(false);
          const latest = await ctx.remote.studyforgeLearning.method({ target: baseline.ref });
          if (latest.ok) { setConflict(latest.value); return; }
        }
        setNotice(deleteFailureCopy(result.error.message));
        return;
      }
      if (onDeleted !== undefined) onDeleted();
      else onCancel?.();
    } catch {
      setDeleteUnknown(true);
      setNotice(UNKNOWN_WRITE_COPY);
    } finally {
      setSaving(false);
    }
  }

  if (state.status === 'loading') return <p className="sf-note" role="status" data-testid="knowledge-editor-loading">正在打开这条知识…</p>;
  if (state.status === 'unavailable') return <p className="sf-note" role="status" data-testid="knowledge-editor-unavailable">这条知识暂时打不开，稍后再看一次。</p>;

  const frozenNow = frozen !== undefined;
  return <form className="sf-knowledge-editor" data-testid="knowledge-editor" data-frozen={frozenNow ? 'true' : undefined}
    onSubmit={event => { event.preventDefault(); void save(); }}>
    <fieldset className="sf-write-frozen" disabled={frozenNow}>
    <header><h3>{baseline === undefined ? '记一条知识' : '修改这条知识'}</h3>
      {baseline !== undefined && <span className="sf-meta">{baseline.collection === undefined ? '还没收录' : '已经收录'}</span>}
    </header>
    <label className="sf-field"><span>标题</span>
      <input data-testid="knowledge-editor-title" value={draft.title} onChange={event => { setDraft({ ...draft, title: event.target.value }); }} />
    </label>
    <label className="sf-field"><span>正文</span>
      <textarea data-testid="knowledge-editor-body" rows={8} value={draft.body} onChange={event => { setDraft({ ...draft, body: event.target.value }); }} />
    </label>
    <label className="sf-field"><span>分类（可留空）</span>
      <input data-testid="knowledge-editor-category" value={draft.category} onChange={event => { setDraft({ ...draft, category: event.target.value }); }} />
    </label>
    <label className="sf-field"><span>标签</span>
      <input data-testid="knowledge-editor-tags" value={draft.tags.join('、')}
        onChange={event => { setDraft({ ...draft, tags: event.target.value.split(/[、,，\s]+/u).map(tag => tag.trim()).filter(tag => tag !== '') }); }} />
    </label>
    {draft.body !== '' && <section className="sf-knowledge-preview"><h4>预览</h4><MarkdownBody text={draft.body} testId="knowledge-editor-preview" /></section>}
    {conflict !== undefined && <section className="sf-conflict" data-testid="knowledge-editor-conflict">
      <p className="sf-notice">这条知识刚在别处更新过：现在已经是第 {String(conflict.version)} 版。下面是最新版，先看一眼再决定。</p>
      <dl className="sf-conflict-latest" data-testid="knowledge-editor-latest">
        <dt>标题</dt><dd>{conflict.content.title}</dd><dt>正文</dt><dd>{conflict.content.body}</dd>
      </dl>
      <div className="sf-conflict-actions">
        <button type="button" className="sf-action" data-testid="knowledge-editor-rebase"
          onClick={() => { setBaseline(conflict); setConflict(undefined); setNotice('已按最新版为基线：你的草稿还在。'); }}>以最新版为基线继续改</button>
        <button type="button" className="sf-quiet" data-testid="knowledge-editor-take-latest"
          onClick={() => { setBaseline(conflict); setDraft(draftOf(conflict)); setConflict(undefined); }}>用最新版替换我的草稿</button>
      </div>
    </section>}
    </fieldset>

    {notice !== undefined && <p className="sf-notice" role="status" data-testid="knowledge-editor-notice">{notice}</p>}
    {confirmingDelete && !deleteUnknown && baseline !== undefined && <section className="sf-conflict" data-testid="knowledge-editor-delete-confirm">
      <p className="sf-notice">要删掉的是这条知识本身。跟它相关的卡还在，学习记录也还在；删掉之后这里就不再列它了。</p>
      <div className="sf-conflict-actions">
        <button type="button" className="sf-action" data-testid="knowledge-editor-delete-yes" disabled={saving}
          onClick={() => { void remove(); }}>确认删掉</button>
        <button type="button" className="sf-quiet" data-testid="knowledge-editor-delete-no"
          onClick={() => { setConfirmingDelete(false); }}>先不删</button>
      </div>
    </section>}
    <footer className="sf-card-editor-actions">
      {frozenNow
        ? <button type="button" className="sf-action" data-testid="knowledge-editor-retry" disabled={saving}
          onClick={() => { void retry(); }}>{saving ? '正在重试…' : '用同一次再试一次'}</button>
        : deleteUnknown
          ? <button type="button" className="sf-action" data-testid="knowledge-editor-delete-retry" disabled={saving}
            onClick={() => { void remove(); }}>用同一次再试一次</button>
          : <>
            <button type="submit" className="sf-action" data-testid="knowledge-editor-save" disabled={saving}>{saving ? '正在保存…' : '保存'}</button>
            {baseline !== undefined && <button type="button" className="sf-quiet" data-testid="knowledge-editor-delete" disabled={saving}
              onClick={() => { setConfirmingDelete(true); }}>删掉这条知识</button>}
            {onCancel !== undefined && <button type="button" className="sf-quiet" onClick={onCancel}>取消</button>}
          </>}
    </footer>
  </form>;
}

/** The refusals a delete really produces, in the student's words. */
function deleteFailureCopy(message: string): string {
  switch (codeOf(message)) {
    case 'version_conflict': return '这条知识刚被改过，先看最新版再删。';
    case 'record_missing': return '这条知识已经不在了，返回列表看看。';
    default: return '这次没有删成功，稍后再试一次。';
  }
}

function draftOf(view: KnowledgeView): Draft {
  return {
    title: view.content.title, body: view.content.body,
    category: view.content.category ?? '', tags: [...view.content.tags], links: [...view.content.links],
  };
}
