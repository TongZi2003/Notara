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
import { useEffect, useRef, useState } from 'react';
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
  const [filtering, setFiltering] = useState(false);
  const searchRequest = useRef(0);
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
    const request = ++searchRequest.current;
    const text = query.trim();
    if (text === '') { setFound(undefined); return; }
    try {
      const result = await ctx.remote.studyforgeMemory.search({ query: text });
      if (request !== searchRequest.current) return;
      if (!result.ok) { setUnavailable(true); return; }
      const reads = await Promise.all(result.value.hits.map(hit => ctx.remote.studyforgeMemory.read({ target: hit.ref })));
      if (request === searchRequest.current) { setUnavailable(false); setFound(reads.flatMap(read => (read.ok ? [read.value] : []))); }
    } catch { if (request === searchRequest.current) setUnavailable(true); }
  }

  if (editing !== undefined) return <section className="sf-orig sf-memory" data-testid="memory-panel">
    <MemoryEditor ctx={ctx} {...(sessionId === undefined ? {} : { sessionId })}
      {...(editing.target === undefined ? {} : { target: editing.target })}
      {...(editing.seed === undefined ? {} : { seed: editing.seed })}
      onSaved={() => { setEditing(undefined); reload(); }}
      onCancel={() => { setEditing(undefined); }} />
  </section>;

  // B's screen head: 记忆 · N 块, one line, and the one write the student owns.
  const head = (count: number | undefined, extra?: React.ReactNode): React.JSX.Element =>
    <div className="sec-head" data-testid="memory-panel-head">
      <h2>学情</h2>
      {count !== undefined && count > 0 && <span className="cnt">{count} 条</span>}
      <div className="line" />
      {extra}
    </div>;

  if (pinned) return <section className="sf-orig sf-memory" data-testid="memory-panel" data-mode="one">
    {head(undefined,
      <button type="button" className="btn" data-testid="memory-show-all" onClick={() => { setShowAll(true); }}>看全部</button>)}
    {oneFailed && <div className="sf-notice" data-testid="memory-one-unavailable">
      <p>这条判断现在读不出来。</p>
      <button type="button" className="sf-quiet" data-testid="memory-one-retry" onClick={reload}>再读一次</button>
    </div>}
    {!oneFailed && one === undefined && <p className="sf-note" data-testid="memory-loading">正在读…</p>}
    {!oneFailed && one !== undefined && <div className="sf-memory-list sf-linear-tree">
      <MemoryCard memory={one} {...(onSource === undefined ? {} : { onSource })}
        onEdit={edited => { setEditing({ target: edited.ref, seed: edited }); }} />
    </div>}
  </section>;

  const shown = found ?? records;
  const observedAt = (memory: MemoryView): string => memory.history.at(-1)?.basis.map(item => item.occurredAt).sort().at(-1) ?? '';
  const ordered = shown && [...shown].sort((left, right) => observedAt(right).localeCompare(observedAt(left)));
  return <section className="sf-orig sf-memory" data-testid="memory-panel">
    {head(ordered?.length,
      <button type="button" className="btn primary" data-testid="memory-create" onClick={() => { setEditing({}); }}>新建学情</button>)}
    <p className="mini-note">从课堂中积累的学习观察，可以查看依据，也可以纠正。</p>
    <div className="mem-toolbar">
      <button type="button" className={!filtering ? 'chip on' : 'chip'} aria-pressed={!filtering} data-testid="memory-sort-time" onClick={() => { searchRequest.current++; setFiltering(false); setQuery(''); setFound(undefined); }}>按时间</button>
      <button type="button" className={filtering ? 'chip on' : 'chip'} aria-pressed={filtering} data-testid="memory-sort-tag" onClick={() => setFiltering(true)}>按关键词筛选</button>
    </div>
    {filtering && <div className="sf-memory-search">
      <input autoFocus className="mem-search" aria-label="筛选学情关键词" data-testid="memory-search" placeholder="输入想查的内容" value={query}
        onChange={event => { searchRequest.current++; setQuery(event.target.value); if (event.target.value.trim() === '') setFound(undefined); }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }} />
      <button type="button" className="btn" data-testid="memory-search-run" onClick={() => { void search(); }}>筛选</button>
    </div>}
    {unavailable && <div className="sf-notice" data-testid="memory-unavailable">
      <p>这些判断现在读不出来。</p>
      <button type="button" className="btn" data-testid="memory-retry" onClick={reload}>再读一次</button>
    </div>}
    {!unavailable && shown === undefined && <p className="sf-note" data-testid="memory-loading">正在读…</p>}
    {!unavailable && ordered !== undefined && ordered.length === 0 && <p className="sf-note" data-testid="memory-empty">
      {found === undefined ? '课堂中的学习观察会记录在这里。' : '没有找到包含这个关键词的学情。'}
    </p>}
    {!unavailable && ordered !== undefined && ordered.length > 0 && <div className="sf-memory-list sf-linear-tree" data-testid="memory-list">
      {ordered.map(memory => <MemoryCard key={memory.ref} memory={memory}
        {...(onSource === undefined ? {} : { onSource })}
        onEdit={edited => { setEditing({ target: edited.ref, seed: edited }); }} />)}
    </div>}
  </section>;
}

const MEMORY_CSS = `
/* B's screen is a paper column of memory blocks; the ported sheet owns its look. */
.sf-memory{display:flex;flex-direction:column;gap:14px;max-width:78ch;min-width:0}
.sf-memory-search{display:flex;gap:8px;align-items:center}
.sf-memory-list{display:flex;flex-direction:column;gap:14px}
.sf-memory-pick h5,.sf-memory-editor h5{margin:0 0 6px;font-size:12px;letter-spacing:.08em;color:var(--ink-3,#777d88)}
.sf-memory-pick ul{list-style:none;display:flex;flex-direction:column;gap:6px;margin:0;padding:0}
.sf-memory-pick-row{display:flex;gap:8px;align-items:baseline;font-size:13px;color:var(--ink-2,#26437c)}
.sf-memory-editor{display:flex;flex-direction:column;gap:12px}
.sf-memory-editor > header h4{font-family:var(--font-song,"Songti SC",serif);font-size:15px;font-weight:600}
.sf-memory-editor > footer{display:flex;gap:8px;align-items:center}
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
