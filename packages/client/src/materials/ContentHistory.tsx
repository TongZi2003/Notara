import type { Context } from '@deepseek-ai/cordis';
import type { SourceAnchor } from '@studyforge/contracts/materials';
import type { ContentHistory as History, ContentHistoryQuery, ContentOccurrence } from '@studyforge/contracts/content-history';
import { useEffect, useState } from 'react';
import { positionLabel } from './lesson-materials-mindmap.ts';
import { openContentClassroom } from './content-navigation.tsx';
import './content-history.css';

const USE: Record<ContentOccurrence['use'], string> = { declared: '本课可用', read: '备课阅读', cited: '本课引用', message: '消息引用', output: '保存成果', practice: '实际学习记录', planned: '安排学习' };
function rangeLabel(source: SourceAnchor): string {
  const at = source.locator;
  if (at.kind === 'pdf') return positionLabel(at) + (at.rect ? '（局部）' : '');
  if (at.kind === 'text') {
    const end = Math.max(at.start.line, at.end.column === 0 ? at.end.line - 1 : at.end.line);
    return `第 ${at.start.line}${at.start.line === end ? '' : '–' + end} 行` + (at.start.column > 0 || at.start.line === at.end.line ? '选段' : '');
  }
  return positionLabel(at);
}
export function ContentHistory({ ctx, query, onSource, onRefine, refreshToken, expanded = false }: { ctx: Context; query: ContentHistoryQuery; onSource?: ((source: SourceAnchor) => void) | undefined; onRefine?: ((source: SourceAnchor) => void) | undefined; refreshToken?: unknown; expanded?: boolean }): React.JSX.Element {
  const [history, setHistory] = useState<History>(), [failed, setFailed] = useState(false), [refresh, setRefresh] = useState(0);
  // Quotes belong to the original excerpt, not to the strict position query.
  const request: ContentHistoryQuery = query.source ? { source: { materialId: query.source.materialId, versionId: query.source.versionId,
    ...(query.source.locator ? { locator: query.source.locator } : {}) } } : query;
  const signature = JSON.stringify(request);
  useEffect(() => {
    let live = true; setHistory(undefined); setFailed(false);
    void ctx.remote.studyforgeMaterials.contentHistory(request).then(result => { if (live) { if (result.ok) setHistory(result.value); else setFailed(true); } }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [ctx, signature, refresh, refreshToken]);
  async function open(sessionId: string, occurrence?: ContentOccurrence): Promise<void> {
    try {
      await openContentClassroom(ctx, { sessionId, ...(occurrence?.sequence !== undefined ? { sequence: occurrence.sequence } : {}), ...(occurrence?.turn !== undefined ? { turn: occurrence.turn } : {}) });
    } catch { setFailed(true); }
  }
  return <section className="sf-content-history" data-testid="content-history">
    {query.source && history && <Coverage expanded={expanded} history={history} source={query.source} onSource={onSource} onRefine={onRefine} />}
    <details open={expanded || undefined}><summary>相关课堂{history ? ` · ${history.classrooms.length}` : ''}</summary>
      {failed ? <p role="status">相关课堂暂时读不出来。<button onClick={() => setRefresh(n => n + 1)}>重试</button></p> : !history ? <p>正在查阅…</p> : <>
        {history.classrooms.map(lesson => <details key={lesson.sessionId} className="sf-content-lesson">
          <summary>{lesson.title} <time>{lesson.occurredAt.slice(0, 10)}</time>{lesson.archived ? ' · 已归档' : ''}</summary>
          <button className="sf-quiet" onClick={() => { void open(lesson.sessionId); }}>打开课堂 →</button>
          <ul>{lesson.occurrences.map((row, index) => <li key={index}>
            <span>{USE[row.use]}{row.source?.locator ? ' · ' + positionLabel(row.source.locator) : ''}{row.via ? ' · 通过卡片' : ''}</span>
            {row.detail && <p>{row.detail}</p>}
            {row.messageId && <button className="sf-quiet" onClick={() => { void open(lesson.sessionId, row); }}>回到这一段 →</button>}
            {row.messageId && <button className="sf-quiet" onClick={() => { void openContentClassroom(ctx, { sessionId: lesson.sessionId, view: 'thoughts', ...(row.sequence !== undefined ? { sequence: row.sequence } : {}), ...(row.turn !== undefined ? { turn: row.turn } : {}) }).catch(() => setFailed(true)); }}>思维图</button>}
            {row.source?.locator && onSource && <button className="sf-quiet" onClick={() => onSource({ ...row.source!, locator: row.source!.locator! })}>原文</button>}
          </li>)}</ul>
        </details>)}
        {history.classrooms.length === 0 && <p>还没有可追溯的课堂引用。</p>}
        {history.planned.map(node => <p key={node.nodeId}>计划中 · {node.title}{node.date ? ` · ${node.date}` : ''}</p>)}
        {history.preparation.length > 0 && <p>另有 {history.preparation.length} 次备课检索，尚未算作课堂讲练。</p>}
        {history.unavailable > 0 && <p>部分旧课堂暂时不可读取。</p>}
      </>}
    </details>
  </section>;
}

function Coverage({ history, source, onSource, onRefine, expanded }: { history: History; source: NonNullable<ContentHistoryQuery['source']>; onSource?: ((source: SourceAnchor) => void) | undefined; onRefine?: ((source: SourceAnchor) => void) | undefined; expanded: boolean }): React.JSX.Element {
  const [picked, setPicked] = useState<SourceAnchor>();
  const pick = (anchor: SourceAnchor): void => { setPicked(anchor); onSource?.(anchor); };
  const coverage = history.coverage;
  const selected = history.classrooms.flatMap(lesson => lesson.occurrences).filter(row => row.use === 'cited' || row.use === 'message').flatMap(row => row.source?.locator ? [row.source] : []);
  const citedPages = new Set(selected.flatMap(item => item.locator?.kind === 'pdf' ? [item.locator.page] : []));
  const label = (anchors: readonly SourceAnchor[]): string => anchors.map(rangeLabel).join('、');
  return <details open={expanded || undefined} className="sf-source-coverage" data-testid="source-coverage"><summary>整理范围{citedPages.size ? ` · 课堂引用 ${citedPages.size} 页` : ''}</summary>
    <div className="sf-coverage-key"><span data-level="outline">未细化</span><span data-level="located">已定位</span><span data-level="refined">已保存细化</span></div>
    {coverage.pageCount && !source.locator && <div className="sf-coverage-pages">{Array.from({ length: coverage.pageCount }, (_, i) => {
      const page = i + 1, onPage = (anchor: SourceAnchor): boolean => anchor.locator.kind === 'pdf' && anchor.locator.page === page;
      const refined = coverage.refined.filter(onPage), located = coverage.located.filter(onPage);
      const level = refined.length ? 'refined' : located.length ? 'located' : 'outline';
      const partial = (refined.length ? refined : located).every(anchor => anchor.locator.kind === 'pdf' && !!anchor.locator.rect);
      return <button type="button" key={page} data-level={level} title={`第${page}页 · ${level === 'outline' ? '未细化' : level === 'refined' ? '已保存细化' : '已定位'}${level !== 'outline' && partial ? '（局部）' : ''}`}
        onClick={() => pick({ materialId: source.materialId, versionId: source.versionId, locator: { kind: 'pdf', page } })}>{page}{level !== 'outline' && partial ? '·' : ''}</button>;
    })}</div>}
    {(['located', 'refined'] as const).map(level => coverage[level].length > 0 && <p key={level}>{level === 'located' ? '实际定位' : '已保存细化'}：{label(coverage[level])}</p>)}
    {coverage.unrefined.length > 0 && <details><summary>尚未细化的范围</summary>{coverage.unrefined.map((anchor, i) => <button key={i} className="sf-quiet" onClick={() => pick(anchor)}>{rangeLabel(anchor)} →</button>)}</details>}
    {picked && onRefine && <button type="button" className="sf-quiet" onClick={() => onRefine(picked)}>继续细化 · {rangeLabel(picked)}</button>}
    {!coverage.refined.length && <p>这个范围还没有保存细化结果。</p>}
  </details>;
}
