import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { CardView } from '@studyforge/contracts/cards';
import type { KnowledgeView } from '@studyforge/contracts/knowledge';
import type { SetView } from '@studyforge/contracts/sets';
import type { LibraryRelation } from '@studyforge/contracts/library';
import type { LearningSearchHit, LearningSearchResult } from '@studyforge/contracts/learning-search';
import type { MaterialContext } from '@studyforge/contracts/materials';
import type { SourceReferences } from './source-selection.ts';
import type { SourceContext } from '@studyforge/contracts/source-context';
import { useEffect, useRef, useState } from 'react';
import { CardDetail } from '../cards/CardDetail.tsx';
import { cardOpenRequest } from '../cards/CardOpenRequest.tsx';
import { KnowledgeEditor } from '../cards/KnowledgeEditor.tsx';
import { insertTaskSkill } from '../classroom/skill-draft.ts';
import { requestLessonPane } from './lesson-pane-request.ts';
import { revealWorkspaceView } from '../classroom/workspace-layout.ts';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import { belongsToSet, libraryCatalog, libraryItems, type LibraryItem, type LibraryKind } from './library-catalog.ts';
import './library-browser.css';
import { LibrarySourceTree } from './LibrarySourceTree.tsx';

export async function libraryDraft(ctx: Context, references: SourceReferences, item: LibraryItem, search: boolean): Promise<void> {
  let sessionId = ctx.sessions.list.getSnapshot().current;
  if (!sessionId || ctx.sessions.list.getSnapshot().byId[sessionId]?.projectionValues?.agentPreset !== 'studyforge-learning') {
    const reply = await ctx.remote.studyforgeCreation.openTeacher(); if (!reply.ok) throw new Error('lesson_unavailable');
    await ctx.sessions.refresh(); sessionId = reply.value.sessionId as SessionId; ctx.sessions.open(sessionId);
  }
  ctx.layout.selectPanel(null);
  if (search && !insertTaskSkill(ctx, sessionId, { id: 'studyforge-semantic-search', title: '按语义查找' })) throw new Error('draft_busy');
  const context: SourceContext | undefined = item.source ? { currentMaterial: { kind: 'source', source: item.source } } : item.kind === 'card' ? { currentMaterial: { kind: 'card', cardRef: item.ref, cardVersion: item.version } } : undefined;
  if (context) references.stage(sessionId, item.title, context);
  if (item.kind === 'knowledge') {
    const scope = ctx.sessions.scope(sessionId); if (!scope) throw new Error('draft_unavailable');
    const input = ctx.conversation.input.for(scope), state = input.state.getSnapshot();
    const end = state.draft.length - state.occurrences.reduce((sum, ref) => sum + ref.length - 1, 0);
    if (!input.insertReference({ source: 'studyforge-knowledge', ref: JSON.stringify({ target: item.ref, version: item.version }), label: item.title, clipboardText: '【' + item.title + '】' }, { start: end, end, draftRev: state.draftRev })) throw new Error('draft_busy');
  }
  requestLessonPane(sessionId, item.source ? { kind: 'source', title: item.title, anchors: [item.source] } : { kind: item.kind === 'card' ? 'card' : 'knowledge', title: item.title, target: item.ref, version: item.version });
  revealWorkspaceView(sessionId, 'chat');
  document.querySelector<HTMLElement>('[data-composer-input]')?.focus();
}

type SearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly result: LearningSearchResult }
  | { readonly status: 'failed' };

export function LibraryBrowser({ ctx, materials, cards, references, onOpen, onSource, onChange }: { ctx: Context; materials: readonly MaterialView[]; cards: readonly CardView[]; references: SourceReferences; onOpen(material: MaterialView): void; onSource(material: MaterialView, source: MaterialContext): void; onChange(): void }): React.JSX.Element {
  const [knowledge, setKnowledge] = useState<KnowledgeView[]>([]), [sets, setSets] = useState<SetView[]>([]), [relations, setRelations] = useState<LibraryRelation[]>([]);
  const [query, setQuery] = useState(''), [kind, setKind] = useState<LibraryKind>('all'), [tag, setTag] = useState(''), [set, setSet] = useState(''), [selected, setSelected] = useState<string>(), [target, setTarget] = useState(''), [label, setLabel] = useState('相关'), [notice, setNotice] = useState(''), [tick, setTick] = useState(0);
  const [search, setSearch] = useState<SearchState>({ status: 'idle' });
  const searchSeq = useRef(0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const changed = (): void => { setTick(n => n + 1); onChange(); window.dispatchEvent(new Event('studyforge:learning-changed')); };
  useEffect(() => { let live = true; void Promise.all([ctx.remote.studyforgeLearning.knowledge(), ctx.remote.studyforgeOrganization.sets({}), ctx.remote.studyforgeLibrary.relations()]).then(([notes, groups, edges]) => {
    if (!live) return; if (notes.ok) setKnowledge(notes.value); if (groups.ok) setSets(groups.value); if (edges.ok) setRelations(edges.value);
  }).catch(() => { if (live) setNotice('部分资料暂时读不出来。'); }); return () => { live = false; }; }, [ctx, tick]);
  const items = libraryItems(materials, cards, knowledge);
  const member = belongsToSet;
  const scoped = items.filter(item => !set || sets.some(group => group.ref === set && member(group, item)));
  const catalog = libraryCatalog(items, scoped, { kind, query, tag });
  const tags = [...new Set(scoped.filter(item => kind === 'all' || kind === item.kind).flatMap(item => item.tags))].sort();
  const chooseTag = (value: string): void => { setTag(value); };
  const chooseKind = (value: LibraryKind): void => { setKind(value); if (value === 'material') setTag(''); };
  const toggle = (ref: string): void => setExpanded(prior => { const next = new Set(prior); if (next.has(ref)) next.delete(ref); else next.add(ref); return next; });
  const treeRevision = tick + ':' + cards.map(card => card.ref + '@' + card.version).join(',');
  const active = items.find(item => item.ref === selected);
  const related = relations.filter(edge => edge.from === selected || edge.to === selected);
  /** Full-text search across material bodies; the box keeps its live title/tag filter while typing. */
  const runSearch = (): void => {
    const text = query.trim();
    const seq = ++searchSeq.current;
    if (text.length === 0) { setSearch({ status: 'idle' }); return; }
    setSearch({ status: 'loading' });
    void ctx.remote.studyforgeMaterials.search({ query: text, limit: 50 }).then(reply => {
      if (searchSeq.current !== seq) return;
      setSearch(reply.ok ? { status: 'ready', result: reply.value } : { status: 'failed' });
    }).catch(() => { if (searchSeq.current === seq) setSearch({ status: 'failed' }); });
  };
  const clearSearch = (): void => { searchSeq.current += 1; setSearch({ status: 'idle' }); };
  const openHit = (hit: LearningSearchHit): void => {
    if (hit.corpus === 'material' && hit.source !== null) {
      const view = materials.find(material => material.materialId === hit.source!.materialId);
      if (view !== undefined) { onSource(view, hit.source); return; }
    }
    if (hit.ref !== null) {
      if (items.some(item => item.ref === hit.ref)) { setSelected(hit.ref); return; }
      if (hit.corpus === 'card') { cardOpenRequest.request(hit.ref); ctx.layout.selectPanel('studyforge.cards' as MainPanelId); return; }
    }
    setNotice('这条命中暂时没有可打开的条目。');
  };
  const entries = (rows: readonly LibraryItem[]): React.JSX.Element => <ul className="sf-library-entries">{rows.map(item => <li key={item.ref} data-testid="material-row" data-material-title={item.title} data-ref={item.ref} className="sf-library-item" data-selected={selected === item.ref}>
    <button className="sf-library-item-open" aria-pressed={selected === item.ref} onClick={() => setSelected(item.ref)}><LibraryIcon kind={item.kind} /><span title={item.title}>{item.title}</span></button>
    {(item.tags.length > 0 || item.materialIds.length > 1) && <div className="sf-library-item-meta">{item.materialIds.length > 1 && <span>来自 {item.materialIds.length} 份原文</span>}{item.tags.map(value => <button key={value} className="sf-library-tag" aria-label={`筛选标签：${value}`} aria-pressed={tag === value} onClick={() => chooseTag(tag === value ? '' : value)}>{value}</button>)}</div>}
  </li>)}</ul>;
  return <section className="sf-library-browser" data-testid="library-browser">
    <div className="sf-library-toolbar"><nav aria-label="资料类型" className="sf-library-types">{([['all', '全部'], ['material', '原文'], ['card', '题卡与笔记'], ['knowledge', '知识']] as const).map(([value, title]) => <button key={value} aria-pressed={kind === value} onClick={() => chooseKind(value)}>{title}<span>{value === 'all' ? scoped.length : scoped.filter(item => item.kind === value).length}</span></button>)}</nav><button className="sf-quiet" data-testid="materials-open-cards" onClick={() => ctx.layout.selectPanel('studyforge.cards' as MainPanelId)}>学习与复习 <span aria-hidden="true">↗</span></button></div>
    <div className="sf-library-searchbar"><label className="sf-library-search"><LibraryIcon kind="search" /><input aria-label="搜索资料" placeholder="搜标题或标签，回车搜全文" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runSearch(); }} /></label>
      <button className="sf-quiet" data-testid="materials-search-run" disabled={!query.trim() || search.status === 'loading'} onClick={runSearch}>搜全文</button>
      <select aria-label="筛选标签" value={tag} disabled={kind === 'material'} onChange={e => chooseTag(e.target.value)}><option value="">全部标签</option>{tag && !tags.includes(tag) && <option value={tag}>{tag}</option>}{tags.map(value => <option key={value} value={value}>{value}</option>)}</select>
      <select aria-label="筛选学习集" value={set} onChange={e => { setSet(e.target.value); setTag(''); }}><option value="">全部学习集</option>{sets.map(s => <option key={s.ref} value={s.ref}>{s.name}</option>)}</select>
      {(query || tag || search.status !== 'idle') && <button className="sf-quiet" onClick={() => { setQuery(''); chooseTag(''); clearSearch(); }}>清除筛选</button>}
    </div>
    <div className="sf-library-columns" data-inspecting={!!active}><div className="sf-library-catalog" data-testid="materials-list">
      {search.status !== 'idle' && <section className="sf-search-hits" data-testid="materials-search-results">
        <header className="sf-search-hits-head">
          {search.status === 'loading' && <span role="status">正在检索资料正文…</span>}
          {search.status === 'failed' && <span role="alert">检索没有成功，请重试。</span>}
          {search.status === 'ready' && <span>{search.result.hits.length === 0 ? '没有命中' : `${String(search.result.hits.length)} 条命中`}{search.result.hasMore ? '，还有更多，换个更准的词' : ''}</span>}
          <button type="button" className="sf-quiet" data-testid="materials-search-close" onClick={clearSearch}>返回目录</button>
        </header>
        {search.status === 'ready' && search.result.hits.map((hit, index) => <button key={`${hit.corpus}:${hit.ref ?? hit.source?.materialId ?? ''}:${String(index)}`} type="button" className="sf-search-hit" data-testid="search-hit" data-corpus={hit.corpus} onClick={() => openHit(hit)}>
          <span className="sf-search-hit-row"><LibraryIcon kind={hit.corpus} /><strong>{hit.title}</strong><small>{corpusLabel(hit)}{hitField(hit) === '' ? '' : ' · ' + hitField(hit)}</small></span>
          <span className="sf-search-hit-quote">{snippetText(hit.snippets[0]!)}</span>
        </button>)}
      </section>}
      {search.status === 'idle' && <>{catalog.groups.map(group => <section className="sf-library-source-group" data-testid="library-source-group" data-source={group.source.source!.materialId} key={group.source.ref}>
        <header className="sf-library-source-head" data-testid="material-row" data-material-title={group.source.title} data-selected={selected === group.source.ref}>
          <button className="sf-library-source-open" aria-expanded={expanded.has(group.source.ref)} onClick={() => toggle(group.source.ref)}><span className="sf-library-chevron" aria-hidden="true">{expanded.has(group.source.ref) ? '⌄' : '›'}</span><LibraryIcon kind="material" /><span><strong>{group.source.title}</strong><small>原文</small></span></button>
          <span className="sf-library-source-count">{group.cards.length || group.total} 张卡片</span>
          <button className="sf-library-source-preview" aria-label={`预览：${group.source.title}`} title="预览原文" onClick={() => setSelected(group.source.ref)}><LibraryIcon kind="preview" /></button>
        </header>
        {expanded.has(group.source.ref) && <LibrarySourceTree ctx={ctx} source={group.source} cards={group.cards} revision={treeRevision} filtered={!!query || !!tag || kind === 'card'} renderCards={entries} />}
      </section>)}
      {catalog.cards.length > 0 && <section className="sf-library-loose-group" data-testid="library-loose-cards"><button className="sf-library-chapter-toggle" aria-expanded={expanded.has('loose-cards')} onClick={() => toggle('loose-cards')}><span aria-hidden="true">{expanded.has('loose-cards') ? '⌄' : '›'}</span><span>其他题卡与笔记</span><small>{catalog.cards.length}</small></button>{expanded.has('loose-cards') && entries(catalog.cards)}</section>}
      {catalog.knowledge.length > 0 && <section className="sf-library-loose-group" data-testid="library-knowledge"><button className="sf-library-chapter-toggle" aria-expanded={expanded.has('knowledge')} onClick={() => toggle('knowledge')}><span aria-hidden="true">{expanded.has('knowledge') ? '⌄' : '›'}</span><span>知识</span><small>{catalog.knowledge.length}</small></button>{expanded.has('knowledge') && entries(catalog.knowledge)}</section>}
      {catalog.count === 0 && items.length > 0 && <p className="sf-library-no-results" role="status">没有符合筛选条件的资料</p>}
      </>}
    </div>
    {active && <section className="sf-library-detail" data-testid="library-detail"><header><h2>{active.title}</h2><button className="sf-quiet" onClick={() => setSelected(undefined)} aria-label="关闭资料详情">×</button></header>
      <div className="sf-org-actions">{active.kind === 'material' && <button className="sf-action" onClick={() => onOpen(materials.find(m => 'material:' + m.materialId === active.ref)!)}>阅读原文</button>}<button className="sf-quiet" onClick={() => { void libraryDraft(ctx, references, active, false).catch(() => setNotice('暂时没能准备课堂引用。')); }}>带入课堂</button><button className="sf-quiet" onClick={() => { void libraryDraft(ctx, references, active, true).catch(() => setNotice('暂时没能准备查找草稿。')); }}>按语义查找</button></div>
      {active.kind === 'card' && <CardDetail key={active.ref} ctx={ctx} target={active.ref} onSource={source => { const m = materials.find(m => m.materialId === source.materialId); if (m) onOpen(m); }} onChange={changed} />}
      {active.kind === 'knowledge' && <KnowledgeEditor key={active.ref} ctx={ctx} target={active.ref} onSaved={changed} />}
      <details><summary>所属学习集</summary>{sets.map(group => <label key={group.ref}><input type="checkbox" checked={member(group, active)} onChange={e => {
        const field = active.source ? e.target.checked ? 'materials_add' : 'materials_remove' : e.target.checked ? 'members_add' : 'members_remove';
        void ctx.remote.studyforgeOrganization.updateSet({ ref: group.ref, expectedVersion: group.version, operationId: crypto.randomUUID(), patch: { [field]: [active.source?.materialId ?? active.ref] } }).then(reply => { if (reply.ok) changed(); else setNotice('分类已变化，请刷新后重试。'); }).catch(() => setNotice('暂时没能修改分类。'));
      }} />{group.name}</label>)}</details>
      <details open><summary>联系</summary>{related.map(edge => <div className="sf-org-actions" key={edge.ref}><button className="sf-quiet" onClick={() => setSelected(edge.from === selected ? edge.to : edge.from)}>{edge.label} · {items.find(i => i.ref === (edge.from === selected ? edge.to : edge.from))?.title}</button><button className="sf-quiet" aria-label="移除联系" onClick={() => { void ctx.remote.studyforgeLibrary.removeRelation({ ref: edge.ref, expectedVersion: edge.version, operationId: crypto.randomUUID() }).then(r => { if (r.ok) changed(); else setNotice('联系已变化，请重试。'); }).catch(() => setNotice('暂时没能移除联系。')); }}>×</button></div>)}
        <form className="sf-library-filters" onSubmit={e => { e.preventDefault(); void ctx.remote.studyforgeLibrary.relate({ from: active.ref, to: target, label, operationId: crypto.randomUUID() }).then(r => { if (r.ok) { changed(); setTarget(''); } else setNotice('暂时没能添加联系。'); }).catch(() => setNotice('暂时没能添加联系。')); }}><select aria-label="联系到资料" value={target} onChange={e => setTarget(e.target.value)}><option value="">选择资料</option>{items.filter(i => i.ref !== selected).map(i => <option key={i.ref} value={i.ref}>{i.title}</option>)}</select><input aria-label="联系名称" value={label} onChange={e => setLabel(e.target.value)} maxLength={80} /><button disabled={!target || !label.trim()}>连接</button></form>
      </details>
    </section>}</div>{notice && <p role="status">{notice}</p>}
  </section>;
}

/** The corpus a search hit really came from, in the student's words. */
function corpusLabel(hit: LearningSearchHit): string {
  return hit.corpus === 'material' ? '原文' : hit.corpus === 'card' ? '题卡' : '知识';
}

/** Where inside the object the match landed; the locator already names material pages. */
function hitField(hit: LearningSearchHit): string {
  const field = hit.snippets[0]?.field ?? '';
  if (hit.corpus === 'material') {
    const locator = hit.source?.locator;
    if (locator === undefined || locator === null) return '';
    switch (locator.kind) {
      case 'pdf': return `第 ${String(locator.page)} 页`;
      case 'pdftext': return `第 ${String(locator.page)} 页摘录`;
      case 'text': return `第 ${String(locator.start.line)} 行`;
      case 'docx': return '文档选段';
      case 'image': return '图上选区';
    }
  }
  if (field === 'title') return '标题';
  if (field === 'front') return '题面';
  if (field === 'body' || field === 'text') return '正文';
  if (field === 'notes') return '备注';
  if (field.startsWith('sections')) return '正文';
  return field;
}

/** One snippet with the matched span marked; null offsets mean "no match point" and show as-is. */
function snippetText(snippet: LearningSearchHit['snippets'][number]): React.ReactNode {
  if (snippet.start === null || snippet.end === null) return snippet.text;
  return <>{snippet.text.slice(0, snippet.start)}<mark>{snippet.text.slice(snippet.start, snippet.end)}</mark>{snippet.text.slice(snippet.end)}</>;
}

function LibraryIcon({ kind }: { kind: LibraryItem['kind'] | 'search' | 'preview' }): React.JSX.Element {
  return <svg className="sf-library-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === 'material' ? <><path d="M4 4h6a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H4z" /><path d="M13 7a3 3 0 0 1 3-3h4v14h-4a3 3 0 0 0-3 3" /></> : kind === 'preview' ? <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></> : kind === 'search' ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></> : kind === 'card' ? <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 10h8M8 14h5" /></> : <><path d="M8 19h8M9 22h6M8 15a7 7 0 1 1 8 0v1H8z" /></>}</svg>;
}
