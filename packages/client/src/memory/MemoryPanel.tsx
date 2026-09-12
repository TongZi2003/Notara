/**
 * P7.2 the place a judgement about this student is read and corrected.
 *
 * It is a panel inside a lesson or the learning settings, not a new top-level
 * destination: what it holds belongs to the student, and nothing here is a
 * verdict — an empty list means nobody wrote anything down, never that the
 * student has learned nothing. Reading writes nothing, and only an explicit
 * edit saves.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryView } from '@studyforge/contracts/memory';
import { useEffect, useState } from 'react';
import { MemoryCard } from './MemoryCard.tsx';
import { MemoryEditor } from './MemoryEditor.tsx';

export interface MemoryPanelProps {
  readonly ctx: Context;
  readonly sessionId?: string;
  /**
   * Open exactly this record instead of the list. The caller owns the choice —
   * a lesson can point the panel at the judgement it was talking about without
   * turning the panel into a second navigation surface.
   */
  readonly target?: string;
  /** Open one real object a quote points at; the caller owns that preview. */
  readonly onSource?: (ref: string, version: string | number) => void;
}

type Editing = { readonly target?: string; readonly seed?: MemoryView } | undefined;

export function MemoryPanel({ ctx, sessionId, target, onSource }: MemoryPanelProps): React.JSX.Element {
  const [records, setRecords] = useState<readonly MemoryView[] | undefined>(undefined);
  const [unavailable, setUnavailable] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<readonly MemoryView[] | undefined>(undefined);
  const [editing, setEditing] = useState<Editing>(undefined);
  const [revision, setRevision] = useState(0);
  // A pinned target opens one record; the student can still ask for the whole list.
  const [one, setOne] = useState<MemoryView | undefined>(undefined);
  const [oneFailed, setOneFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const pinned = target !== undefined && !showAll;

  useMemoryStyles();

  useEffect(() => {
    let live = true;
    setUnavailable(false);
    ctx.remote.studyforgeMemory.list().then(
      result => { if (live) { if (result.ok) setRecords(result.value); else setUnavailable(true); } },
      () => { if (live) setUnavailable(true); },
    );
    return () => { live = false; };
  }, [ctx, revision]);

  useEffect(() => {
    if (!pinned || target === undefined) return undefined;
    let live = true;
    setOneFailed(false);
    ctx.remote.studyforgeMemory.read({ target }).then(
      result => { if (live) { if (result.ok) setOne(result.value); else setOneFailed(true); } },
      () => { if (live) setOneFailed(true); },
    );
    return () => { live = false; };
  }, [ctx, pinned, target, revision]);

  function reload(): void { setRevision(value => value + 1); }

  async function search(): Promise<void> {
    const text = query.trim();
    if (text === '') { setFound(undefined); return; }
    const result = await ctx.remote.studyforgeMemory.search({ query: text });
    if (!result.ok) { setUnavailable(true); return; }
    // A hit names a record; the panel shows the real record rather than a snippet build.
    const reads = await Promise.all(result.value.hits.map(hit => ctx.remote.studyforgeMemory.read({ target: hit.ref })));
    setFound(reads.flatMap(read => (read.ok ? [read.value] : [])));
  }

  if (editing !== undefined) return <section className="sf-memory" data-testid="memory-panel">
    <MemoryEditor ctx={ctx} {...(sessionId === undefined ? {} : { sessionId })}
      {...(editing.target === undefined ? {} : { target: editing.target })}
      {...(editing.seed === undefined ? {} : { seed: editing.seed })}
      onSaved={() => { setEditing(undefined); reload(); }}
      onCancel={() => { setEditing(undefined); }} />
  </section>;

  if (pinned) return <section className="sf-memory" data-testid="memory-panel" data-mode="one">
    <header className="sf-memory-panel-head">
      <h3>关于你的判断</h3>
      <button type="button" className="sf-quiet" data-testid="memory-show-all" onClick={() => { setShowAll(true); }}>看全部</button>
    </header>
    {oneFailed && <div className="sf-notice" data-testid="memory-one-unavailable">
      <p>这条判断现在读不出来。</p>
      <button type="button" className="sf-quiet" data-testid="memory-one-retry" onClick={reload}>再读一次</button>
    </div>}
    {!oneFailed && one === undefined && <p className="sf-note" data-testid="memory-loading">正在读…</p>}
    {!oneFailed && one !== undefined && <div className="sf-memory-list">
      <MemoryCard memory={one} {...(onSource === undefined ? {} : { onSource })}
        onEdit={edited => { setEditing({ target: edited.ref, seed: edited }); }} />
    </div>}
  </section>;

  const shown = found ?? records;
  return <section className="sf-memory" data-testid="memory-panel">
    <header className="sf-memory-panel-head">
      <h3>关于你的判断</h3>
      <span className="sf-meta">老师说过的、挂着你原话的判断。没有就是没记过。</span>
      <button type="button" className="sf-quiet" data-testid="memory-create" onClick={() => { setEditing({}); }}>记一条</button>
    </header>
    <div className="sf-memory-search">
      <input className="sf-cards-search" data-testid="memory-search" placeholder="找一条判断" value={query}
        onChange={event => { setQuery(event.target.value); if (event.target.value.trim() === '') setFound(undefined); }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }} />
      <button type="button" className="sf-quiet" data-testid="memory-search-run" onClick={() => { void search(); }}>查</button>
    </div>
    {unavailable && <div className="sf-notice" data-testid="memory-unavailable">
      <p>这些判断现在读不出来。</p>
      <button type="button" className="sf-quiet" data-testid="memory-retry" onClick={reload}>再读一次</button>
    </div>}
    {!unavailable && shown === undefined && <p className="sf-note" data-testid="memory-loading">正在读…</p>}
    {!unavailable && shown !== undefined && shown.length === 0 && <p className="sf-note" data-testid="memory-empty">
      {found === undefined ? '还没有关于你的判断。' : '没有找到这一条。'}
    </p>}
    {!unavailable && shown !== undefined && shown.length > 0 && <div className="sf-memory-list" data-testid="memory-list">
      {shown.map(memory => <MemoryCard key={memory.ref} memory={memory}
        {...(onSource === undefined ? {} : { onSource })}
        onEdit={edited => { setEditing({ target: edited.ref, seed: edited }); }} />)}
    </div>}
  </section>;
}

const MEMORY_CSS = `
.sf-memory{display:flex;flex-direction:column;gap:14px;max-width:78ch}
.sf-memory-panel-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;border-bottom:1px solid #d9d2bd;padding-bottom:10px}
.sf-memory-panel-head h3{margin:0;font-size:16px;font-weight:600;color:#26437c}
.sf-memory-panel-head .sf-quiet{margin-left:auto}
.sf-memory-search{display:flex;gap:8px;align-items:center}
.sf-memory-list{display:flex;flex-direction:column;gap:14px}
.sf-memory-card{display:flex;flex-direction:column;gap:8px;border:1px solid #d9d2bd;border-radius:4px;background:#fffdf6;padding:14px 16px}
.sf-memory-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px}
.sf-memory-head h4{margin:0;font-size:15px;color:#26437c}
.sf-memory-kind{border-radius:999px;background:#f6f1e3;color:#5a688a;font-size:12px;padding:2px 10px}
.sf-memory-basis h5,.sf-memory-pick h5,.sf-memory-editor h5{margin:0 0 6px;font-size:12px;letter-spacing:.08em;color:#777d88}
.sf-memory-basis ul,.sf-memory-history ul,.sf-memory-pick ul{list-style:none;display:flex;flex-direction:column;gap:6px;margin:0;padding:0}
.sf-memory-quote{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;font-size:13px;color:#26437c}
.sf-memory-quote-text{overflow-wrap:anywhere}
.sf-memory-history summary,.sf-memory-versions summary{cursor:pointer;font-size:12px;color:#777d88}
.sf-memory-editor{display:flex;flex-direction:column;gap:12px}
.sf-memory-editor label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:#777d88}
.sf-memory-editor input,.sf-memory-editor textarea{border:1px solid #d9d2bd;border-radius:3px;background:#fffdf6;color:#26437c;font:13px/1.7 inherit;padding:8px 10px}
.sf-memory-pick-row{display:flex;gap:8px;align-items:baseline;font-size:13px;color:#26437c}
@media(max-width:760px){.sf-memory-search{flex-wrap:wrap}}
`;

/** One stylesheet per mounted panel, removed with it. */
function useMemoryStyles(): void {
  useEffect(() => {
    const style = document.createElement('style');
    style.dataset.studyforgeStyle = 'memory';
    style.textContent = MEMORY_CSS;
    document.head.append(style);
    return () => { style.remove(); };
  }, []);
}
