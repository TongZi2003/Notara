/**
 * P4.1 "本课用到什么", read from the Host's own projection.
 *
 * The rows come from three real things — the lesson's declared references, the
 * sources accepted messages carried, and the objects the lesson really saved —
 * so the list can say where each row came from without inventing a deck ledger.
 * A row opens the immutable version it names; two positions inside one version
 * are two rows that focus the same native tab, because the position is the way
 * back to the source and the tab is only where it is shown.
 *
 * Nothing here writes: opening, focusing and splitting are the native column's,
 * and closing a tab never removes a row.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { MaterialContext, SourceLocator } from '@studyforge/contracts/materials';
import type { MaterialResource } from '@studyforge/contracts/material-api';
import type { LessonResource, LessonResourcesProjection } from '@studyforge/domain/lesson-resources';
import { useEffect, useState } from 'react';
import { openLessonSource, type NativePreviewHost, type OpenOutcome } from './native-preview-adapter.ts';

/** The Host reads this list needs; the open path is the shared adapter's. */
export interface LessonResourcesFace extends NativePreviewHost {
  lessonResources(input: { readonly sessionId: string }): Promise<RemoteResult<LessonResourcesProjection>>;
  openCard(target: string): void;
}

export interface LessonResourcesProps {
  readonly sessionId: string;
  readonly host: LessonResourcesFace;
  /** The lesson on stage right now; a click only lands in its own lesson. */
  readonly currentSession: () => string | undefined;
  readonly onOpenObject?: (target: string) => void;
}

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly rows: readonly LessonResource[] };

/** The lesson's materials, each row opening the version it names. */
export function LessonResources({ sessionId, host, currentSession, onOpenObject }: LessonResourcesProps): React.JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [opening, setOpening] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    host.lessonResources({ sessionId }).then(
      result => {
        // An unreadable projection is not an empty lesson: the copy says which.
        if (!live) return;
        setState(result.ok ? { status: 'ready', rows: result.value.resources } : { status: 'unavailable' });
      },
      () => { if (live) setState({ status: 'unavailable' }); },
    );
    return () => { live = false; };
  }, [host, sessionId]);

  async function open(row: LessonResource): Promise<void> {
    const source: MaterialContext | null = row.source;
    if (source === null) {
      if (row.kind !== 'card' && row.target) { onOpenObject?.(row.target); return; }
      if (row.kind === 'card' && row.target && currentSession() === sessionId) {
        try { host.openCard(row.target); } catch { setNotice('这张卡暂时打不开。'); }
      }
      return;
    }
    const key = `${row.tabKey}:${JSON.stringify(row.source)}`;
    setOpening(key);
    setNotice(undefined);
    const outcome = await openLessonSource(host, sessionId, source, currentSession);
    setOpening(undefined);
    const copy = outcomeCopy(outcome);
    if (copy !== undefined) setNotice(copy);
  }

  if (state.status === 'loading') return <p className="sf-note" role="status">正在看这节课用到什么…</p>;
  if (state.status === 'unavailable') return <p className="sf-note" role="status">这节课用到的资料暂时取不到，稍后再看一次。</p>;
  if (state.rows.length === 0) return <p className="sf-note" data-testid="lesson-resources-empty">这节课还没有用到资料。</p>;
  return <>
    <ul data-testid="lesson-resources">{state.rows.map((row, index) => <li key={`${row.tabKey}-${String(index)}`} data-testid="lesson-resource-row" data-kind={row.kind}>
      <span className="sf-resource-title">{row.title ?? kindLabel(row.kind)}</span>
      <span className="sf-meta">{originLabel(row)}</span>
      {row.source?.locator !== undefined && <span className="sf-meta" data-testid="lesson-resource-position">{positionLabel(row.source.locator)}</span>}
      {row.quote !== null && <span className="sf-resource-quote">“{row.quote}”</span>}
      {(row.source !== null || row.kind === 'card') && <button type="button" className="sf-resource-open" data-testid="lesson-resource-open"
        disabled={opening !== undefined}
        onClick={() => { void open(row); }}>打开</button>}
    </li>)}</ul>
    {notice !== undefined && <p className="sf-note" role="status" data-testid="lesson-resources-notice">{notice}</p>}
  </>;
}

/** Where inside the original this row points, in the student's words. */
function positionLabel(locator: SourceLocator): string {
  switch (locator.kind) {
    case 'text': return `第 ${String(locator.start.line)} 行`;
    case 'pdf': return `第 ${String(locator.page)} 页`;
    case 'image': return '图上选区';
    case 'docx': return '选段';
  }
}

/** The student-facing name of a saved object kind. */
function kindLabel(kind: LessonResource['kind']): string {
  switch (kind) {
    case 'material': return '资料';
    case 'card': return '卡片';
    case 'knowledge': return '知识';
    default: return '学习产出';
  }
}

/** Where a row came from, in the student's words; the ids stay inside. */
function originLabel(row: LessonResource): string {
  const from = new Set(row.origins.map(origin => origin.from));
  const parts: string[] = [];
  if (from.has('course')) parts.push('本节课安排');
  if (from.has('message')) parts.push('对话里引用过');
  if (from.has('output')) parts.push('课上产出');
  return parts.join(' · ');
}

/** What to tell the student when the open did not land; success says nothing. */
function outcomeCopy(outcome: OpenOutcome): string | undefined {
  switch (outcome) {
    case 'opened': return undefined;
    case 'moved': return '课已经换到另一节了，再点一次就在现在这节课里打开。';
    case 'refused': return '这节课暂时打不开这份资料：可能已经不在，或这节课没有读它的授权。';
    case 'unsupported': return '这个格式还没有课堂预览，先到资料页里读。';
    case 'unavailable': return '网络没接上，稍后再点一次。';
  }
}
