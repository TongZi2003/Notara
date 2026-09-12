import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { visibleNodes, type BookNode, type BookStructure, type BookBreakdownIntent } from '@studyforge/contracts/book-exploration';
import type { MaterialContext, SourceAnchor } from '@studyforge/contracts/materials';
import { useEffect, useRef, useState } from 'react';
import { CardDetail } from '../cards/CardDetail.tsx';
import { KnowledgeEditor } from '../cards/KnowledgeEditor.tsx';
import { ReviewScreen } from '../review/ReviewScreen.tsx';

export function BookWorkspace({ ctx, source, onSource }: { ctx: Context; source: MaterialContext; onSource(source: SourceAnchor): void }): React.JSX.Element {
  const [structure, setStructure] = useState<BookStructure>(), [expanded, setExpanded] = useState<string[]>([]);
  const [mode, setMode] = useState<'map' | 'list'>('map'), [selected, setSelected] = useState<string>('book');
  const [notice, setNotice] = useState(''), [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false), [studying, setStudying] = useState<string>();
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
  useEffect(() => { const update = () => setRefresh(n => n + 1); window.addEventListener('focus', update); return () => window.removeEventListener('focus', update); }, []);
  const node = structure?.nodes.find(item => item.key === selected);
  function choose(item: BookNode): void {
    setSelected(item.key); setStudying(undefined);
    if (item.kind === 'book' || item.kind === 'section') setExpanded(old => old.includes(item.key) ? old.filter(key => key !== item.key) : [...old, item.key]);
  }
  async function breakdown(item: BookNode): Promise<void> {
    if (!structure || item.kind !== 'book' && item.kind !== 'section') return;
    const intent: BookBreakdownIntent = { material: structure.material, sources: item.sources,
      ...(item.kind === 'section' ? { nodePath: item.path } : {}), ...(structure.skeletonRevision ? { skeletonRevision: structure.skeletonRevision } : {}) };
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
    <div className="sf-org-actions"><h3>书的结构</h3><button className="sf-quiet" onClick={() => setRefresh(n => n + 1)}>刷新结构</button></div>
    <nav aria-label="结构视图"><button className="sf-quiet" aria-pressed={mode === 'map'} onClick={() => setMode('map')}>脑图</button><button className="sf-quiet" aria-pressed={mode === 'list'} onClick={() => setMode('list')}>列表</button></nav>
    {notice && <p className="sf-notice" role="status">{notice}</p>}
    {structure && <div className={'sf-book-nodes sf-book-' + mode} data-testid="book-nodes">
      {visibleNodes(structure, expanded).map(item => <div key={item.key} className="sf-book-node" data-kind={item.kind} data-selected={selected === item.key}
        style={{ marginInlineStart: depth(structure, item) * (mode === 'map' ? 18 : 10) }}>
        <button className="sf-org-row" onClick={() => choose(item)} aria-expanded={item.children.length ? expanded.includes(item.key) : undefined}>
          <span>{item.children.length ? expanded.includes(item.key) ? '▾ ' : '▸ ' : ''}{item.title}</span>
          <small>{item.kind === 'card' ? '卡片' : item.kind === 'knowledge' ? '知识' : ''}</small>
        </button>
        {(item.kind === 'book' || item.kind === 'section') && <button className="sf-quiet" disabled={busy} onClick={() => { void breakdown(item); }}>继续拆解</button>}
      </div>)}
    </div>}
    {node && <section className="sf-book-detail" data-testid="book-node-detail">
      {node.sources.length > 0 && <div className="sf-org-actions">{node.sources.map((anchor, i) => <button key={i} className="sf-quiet" onClick={() => onSource(anchor)}>定位原文{node.sources.length > 1 ? ` ${i + 1}` : ''}</button>)}</div>}
      {node.kind === 'card' && (studying ? <ReviewScreen ctx={ctx} start={studying} onBack={() => setStudying(undefined)} />
        : <><button className="sf-action" onClick={() => setStudying(node.target)}>开始学习</button><CardDetail key={node.target} ctx={ctx} target={node.target} onSource={onSource} onChange={() => setRefresh(n => n + 1)} /></>)}
      {node.kind === 'knowledge' && <KnowledgeEditor key={node.target} ctx={ctx} target={node.target} onSaved={() => setRefresh(n => n + 1)} />}
    </section>}
  </aside>;
}
function depth(structure: BookStructure, node: BookNode): number {
  let count = 0, parent = node.parentKey;
  while (parent) { count++; parent = structure.nodes.find(item => item.key === parent)?.parentKey; }
  return count;
}
