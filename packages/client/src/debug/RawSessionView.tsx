import type { SessionEventLikeEntry, SessionEventSource, SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { CourseView } from '@studyforge/contracts/courses';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { DomainRecordInspector } from './DomainRecordInspector.tsx';

/**
 * Debug-only Raw view over the SAME session binding the native Chat and
 * Trajectory read. It opens no second event source: it subscribes to
 * `ctx.sessions.binding(sessionId).eventSource`, the one contiguous window the
 * native surfaces share, and asks that binding's own `loadOlder()` for older
 * pages. The JSON is the raw event, unmodified.
 */
export interface RawDebugInjected {
  /** The current binding's window source; absent when the session has no binding. */
  readonly eventSource: SessionEventSource | undefined;
  /** The same binding's older-page request used by every native view. */
  loadOlder(): Promise<void>;
  readCourse(input: { sessionId: string }): Promise<RemoteResult<CourseView>>;
}

export type RawSessionViewProps = PropsRuntime<'conversation.view'> & RawDebugInjected;

export function RawSessionView({ eventSource, loadOlder, useSession, sessionId, readCourse, openView }: RawSessionViewProps): React.JSX.Element {
  const window = useEventWindow(eventSource);
  const hasMore = useSession(state => state.hasMore);
  const loadingOlder = useSession(state => state.loadingOlder);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  const entries = window?.entries ?? EMPTY_ENTRIES;
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => needle === '' || json(entry).toLowerCase().includes(needle)), [entries, needle]);
  const durable = entries.filter(entry => entry.type === 'event').length;
  const transient = entries.length - durable;

  const copy = useCallback(async (label: string, text: string) => {
    const ok = await writeClipboard(text);
    setCopied(ok ? label : null);
    if (ok) setTimeout(() => { setCopied(current => current === label ? null : current); }, 1500);
  }, []);

  return <div className="sf-raw" data-testid="sf-raw-view">
    <header className="sf-raw-head">
      <h2>原始记录</h2>
      <p className="sf-note">这是这节课真实的会话记录，只读。和 Chat、Trajectory 读的是同一个窗口。</p>
      <button type="button" className="sf-raw-button" data-testid="sf-raw-open-trajectory" onClick={() => { openView('trajectory', ''); }}>打开 Trajectory</button>
    </header>

    <div className="sf-raw-window" data-testid="sf-raw-window">
      本窗口 {entries.length} 条（持久 {durable} · 临时 {transient}）· {hasMore ? '更早还有记录' : '已到最早'} · 修订 {window?.revision ?? '—'}
    </div>

    <div className="sf-raw-tools">
      <input
        type="search"
        className="sf-raw-search"
        data-testid="sf-raw-search"
        placeholder="在这个窗口里搜"
        value={query}
        onChange={event => { setQuery(event.target.value); }}
      />
      <button type="button" className="sf-raw-button" data-testid="sf-raw-load-older" disabled={!hasMore || loadingOlder} onClick={() => { void loadOlder(); }}>
        {loadingOlder ? '正在加载…' : '加载更早'}
      </button>
      <button type="button" className="sf-raw-button" data-testid="sf-raw-copy-window" onClick={() => { void copy('window', entries.map(json).join('\n')); }}>
        {copied === 'window' ? '已复制' : '复制本窗口'}
      </button>
      <button type="button" className="sf-raw-button" onClick={() => { setExpanded(expanded.size === 0 ? new Set(shown.map(({ entry }) => key(entry))) : new Set()); }}>
        {expanded.size === 0 ? '全部展开' : '全部收起'}
      </button>
    </div>

    {needle !== '' && <p className="sf-note" data-testid="sf-raw-search-count">匹配 {shown.length} / {entries.length} 条</p>}

    {entries.length === 0 && <p className="sf-note" role="status">这个窗口还没有记录。</p>}
    {entries.length > 0 && shown.length === 0 && <p className="sf-note" role="status">这个窗口里没有匹配的记录。</p>}

    <ol className="sf-raw-list">
      {shown.map(({ entry, index }) => {
        const id = key(entry);
        const open = expanded.has(id);
        return <li key={id} className="sf-raw-entry" data-testid="sf-raw-entry" data-raw-kind={entry.type}>
          <button type="button" className="sf-raw-entry-head" aria-expanded={open} onClick={() => {
            setExpanded(current => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            });
          }}>
            <span className="sf-raw-badge">{entry.type === 'event' ? '持久' : '临时'}</span>
            <span className="sf-raw-kind">{entry.event.type}</span>
            <span className="sf-meta">#{index} · seq {entry.event.seq}</span>
          </button>
          {open && <div className="sf-raw-body">
            <button type="button" className="sf-raw-button" data-testid="sf-raw-copy-entry" onClick={() => { void copy(id, json(entry)); }}>
              {copied === id ? '已复制' : '复制这条'}
            </button>
            <pre className="sf-raw-json" data-testid="sf-raw-json">{json(entry)}</pre>
          </div>}
        </li>;
      })}
    </ol>

    <DomainRecordInspector sessionId={sessionId} readCourse={readCourse} />
  </div>;
}

/** Subscribe without owning a second window; the binding's snapshot is cached. */
function useEventWindow(source: SessionEventSource | undefined): SessionEventWindow | undefined {
  const subscribe = useCallback((onChange: () => void) => source?.subscribe(onChange) ?? (() => {}), [source]);
  const getSnapshot = useCallback(() => source?.getSnapshot(), [source]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function key(entry: SessionEventLikeEntry): string {
  // Native stable identity: a durable row is its event seq, a transient row is
  // its attempt plus the seq it sits at. Never an array position — prepending an
  // older page must not reset expansion state.
  return entry.type === 'event'
    ? `event:${entry.event.seq}`
    : `transient:${entry.event.data.attemptId}:${entry.event.seq}`;
}

const EMPTY_ENTRIES: readonly SessionEventLikeEntry[] = [];

function json(entry: SessionEventLikeEntry): string {
  return JSON.stringify(entry.event, null, 2);
}

/** Clipboard with a plain-DOM fallback so the copy path works on any origin. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}
