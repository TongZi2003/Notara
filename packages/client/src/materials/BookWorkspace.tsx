/**
 * P6.6 the book's own structure area: a real node-and-edge map of what the Host
 * really read for this book, beside the original on the left.
 *
 * The tree is the book's own: the root, the skeleton sections it was read at,
 * and the cards and knowledge that really point at this book (the shared map
 * draws it). A card is a node like any other; opening one shows its detail
 * *here*, in the structural area, and 收起 returns to the map with everything
 * still expanded. Nothing here guesses an anchor, and reading — opening a node,
 * reading a card, locating an original — writes no session, fact or model call.
 * Only 继续拆解 acts, and it goes through the existing organization Remote, so
 * whatever it proposes still needs the student's own confirmation.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { BookBreakdownIntent, BookNode, BookStructure } from '@studyforge/contracts/book-exploration';
import type { MaterialContext, SourceAnchor } from '@studyforge/contracts/materials';
import { useEffect, useRef, useState } from 'react';
import { CardDetail } from '../cards/CardDetail.tsx';
import { ContentHistory } from './ContentHistory.tsx';
import { KnowledgeEditor } from '../cards/KnowledgeEditor.tsx';
import { ReviewScreen } from '../review/ReviewScreen.tsx';
import { Mindmap } from './mindmap.tsx';
import { bookMindNodes } from './lesson-materials-mindmap.ts';
import { bookNodeIntent, breakdownLabel, type BreakdownAction } from './book-breakdown.ts';

/** One book's structure, drawn and opened in place. */
export function BookWorkspace({ ctx, source, onSource }: { ctx: Context; source: MaterialContext; onSource(source: SourceAnchor): void }): React.JSX.Element {
  const [structure, setStructure] = useState<BookStructure>();
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const [mode, setMode] = useState<'map' | 'list'>('map');
  const [selected, setSelected] = useState<string | undefined>(undefined);
  /** The detail is a view of the pick; closing it keeps the pick itself. */
  const [detail, setDetail] = useState(false);
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [studying, setStudying] = useState<string>();
  const attempt = useRef<{ key: string; id: string }>();
  useEffect(() => {
    let live = true;
    void ctx.remote.studyforgeOrganization.book({ material: { materialId: source.materialId, versionId: source.versionId } }).then(result => {
      if (!live) return;
      if (result.ok) { setStructure(result.value); setNotice(''); }
      else { setStructure(undefined); setNotice('结构暂时无法读取，请刷新。'); }
    }).catch(() => { if (live) { setStructure(undefined); setNotice('结构暂时无法读取，请刷新。'); } });
    return () => { live = false; };
  }, [ctx, source.materialId, source.versionId, refresh]);
  useEffect(() => { const update = (): void => { setRefresh(n => n + 1); }; window.addEventListener('focus', update); return () => { window.removeEventListener('focus', update); }; }, []);
  const node: BookNode | undefined = structure?.nodes.find(item => item.key === selected);
  /** The exact node the student picked is the scope of anything this area does. */
  const nodes = structure === undefined ? [] : bookMindNodes(structure);
  async function breakdown(item: BookNode, action: BreakdownAction, range?: SourceAnchor): Promise<void> {
    if (!structure || item.kind !== 'book' && item.kind !== 'section') return;
    const intent: BookBreakdownIntent = { ...bookNodeIntent(structure, item, action), ...(range ? { sources: [range] } : {}) };
    const key = JSON.stringify(intent);
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    setBusy(true);
    try {
      const result = await ctx.remote.studyforgeOrganization.breakdown({ operationId: attempt.current.id, intent });
      if (!result.ok) { setNotice('这次未能开始整理。请刷新结构后重试；已有内容仍保留。'); return; }
      ctx.sessions.open(result.value.sessionId as SessionId); ctx.layout.selectPanel(null); attempt.current = undefined;
    } catch { setNotice('暂时未收到结果，再试会继续同一次整理。'); }
    finally { setBusy(false); }
  }
  return <aside className="sf-book-structure" data-testid="book-workspace">
    <div className="sf-org-actions">
      <h3>书的结构</h3>
      <nav className="sf-book-modes" aria-label="结构视图">
        <button type="button" className="sf-quiet" aria-pressed={mode === 'map'} onClick={() => { setMode('map'); }}>脑图</button>
        <button type="button" className="sf-quiet" aria-pressed={mode === 'list'} onClick={() => { setMode('list'); }}>目录树</button>
      </nav>
      <button type="button" className="sf-quiet" onClick={() => { setRefresh(n => n + 1); }}>刷新结构</button>
    </div>
    {notice !== '' && <p className="sf-notice" role="status">{notice}</p>}
    <ContentHistory ctx={ctx} query={{ source: { materialId: source.materialId, versionId: source.versionId } }} onSource={onSource} refreshToken={refresh}
      onRefine={anchor => { const root = structure?.nodes.find(item => item.kind === 'book'); if (root && !busy) void breakdown(root, 'directory', anchor); }} />
    {structure !== undefined && <Mindmap testId="book-nodes" label="这本书的结构" nodes={nodes} mode={mode}
      expanded={expanded} selected={selected} busy={busy}
      onPick={item => { setSelected(item.key); setStudying(undefined); setDetail(true); }}
      onExpand={(item, open) => { setExpanded(old => open ? (old.includes(item.key) ? old : [...old, item.key]) : old.filter(key => key !== item.key)); }}
      actions={(['directory', 'cards'] as const).map(action => ({ label: breakdownLabel(action), when: item => item.key === selected && (item.kind === 'book' || item.kind === 'section'),
        run: item => { const target = structure.nodes.find(candidate => candidate.key === item.key); if (target !== undefined) void breakdown(target, action); } }))} />}
    {detail && node !== undefined && <section className="sf-book-detail" data-testid="book-node-detail">
      <header className="sf-book-detail-head">
        <h3>{node.title}</h3>
        {/* 收起 closes the detail; the map keeps the branch open and the node picked. */}
        <button type="button" className="sf-quiet" data-testid="book-detail-back" onClick={() => { setDetail(false); setStudying(undefined); }}>收起</button>
      </header>
      {node.sources.length > 0 && <div className="sf-org-actions">{node.sources.map((anchor, index) =>
        <button key={`${anchor.versionId}-${String(index)}`} type="button" className="sf-quiet" onClick={() => { onSource(anchor); }}>定位原文{node.sources.length > 1 ? ` ${String(index + 1)}` : ''}</button>)}</div>}
      {node.kind === 'section' && node.sources.map((anchor, index) => <ContentHistory key={index} ctx={ctx} query={{ source: anchor }} onSource={onSource} refreshToken={refresh} />)}
      {node.kind === 'card' && (studying !== undefined ? <ReviewScreen ctx={ctx} start={studying} onBack={() => { setStudying(undefined); }} />
        : <><button type="button" className="sf-action" onClick={() => { setStudying(node.target); }}>开始学习</button>
          <CardDetail key={node.target} ctx={ctx} target={node.target} onSource={onSource} onChange={() => { setRefresh(n => n + 1); }} /></>)}
      {node.kind === 'knowledge' && <KnowledgeEditor key={node.target} ctx={ctx} target={node.target} onSaved={() => { setRefresh(n => n + 1); }} />}
    </section>}
  </aside>;
}
