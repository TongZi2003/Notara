import type { Context } from '@deepseek-ai/cordis';
import type { BookStructure } from '@studyforge/contracts/book-exploration';
import { useEffect, useState } from 'react';
import { catalogChapters, type CatalogChapter, type LibraryItem } from './library-catalog.ts';

/** Mounted only while the source is open. Closing a book resets its child
 * disclosure state, so reopening never dumps every previously visited card. */
export function LibrarySourceTree({ ctx, source, cards, revision, filtered, renderCards }: {
  ctx: Context; source: LibraryItem; cards: readonly LibraryItem[]; revision: string; filtered: boolean;
  renderCards(rows: readonly LibraryItem[]): React.JSX.Element;
}): React.JSX.Element {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'failed' } | { status: 'ready'; tree: BookStructure }>({ status: 'loading' });
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set()), [attempt, setAttempt] = useState(0);
  const material = source.source!;
  useEffect(() => {
    let live = true; setState({ status: 'loading' });
    void ctx.remote.studyforgeOrganization.book({ material }).then(result => {
      if (live) setState(result.ok ? { status: 'ready', tree: result.value } : { status: 'failed' });
    }).catch(() => { if (live) setState({ status: 'failed' }); });
    return () => { live = false; };
  }, [ctx, material.materialId, material.versionId, revision, attempt]);
  const toggle = (key: string): void => setOpened(prior => { const next = new Set(prior); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  if (state.status === 'loading') return <p className="sf-library-tree-status" role="status">正在读取目录…</p>;
  if (state.status === 'failed') return <p className="sf-library-tree-status" role="status">目录暂时没取到。<button className="sf-quiet" onClick={() => setAttempt(n => n + 1)}>重试</button></p>;
  const tree = catalogChapters(state.tree, cards);
  const children = (nodes: readonly CatalogChapter[]): React.JSX.Element => <ul className="sf-library-chapters">{nodes.filter(node => !filtered || node.count > 0).map(node => <li key={node.key} data-testid="library-chapter" data-path={node.path}>
    <button className="sf-library-chapter-toggle" aria-label={node.title} aria-expanded={opened.has(node.key)} disabled={node.count === 0 && node.children.length === 0} onClick={() => toggle(node.key)}><span className="sf-library-chevron" aria-hidden="true">{opened.has(node.key) ? '⌄' : '›'}</span><span>{node.title}</span>{node.count > 0 && <small>{node.count} 张卡片</small>}</button>
    {opened.has(node.key) && <>{children(node.children)}{node.cards.length > 0 && renderCards(node.cards)}</>}
  </li>)}</ul>;
  return <div className="sf-library-source-tree" data-testid="library-source-tree">{children(tree.chapters)}
    {tree.cards.length > 0 && <div className="sf-library-unplaced"><button className="sf-library-chapter-toggle" aria-label="未分章节" aria-expanded={opened.has('unplaced')} onClick={() => toggle('unplaced')}><span className="sf-library-chevron" aria-hidden="true">{opened.has('unplaced') ? '⌄' : '›'}</span><span>未分章节</span><small>{tree.cards.length} 张卡片</small></button>{opened.has('unplaced') && renderCards(tree.cards)}</div>}
  </div>;
}
