import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { CardView } from '@studyforge/contracts/cards';
import type { KnowledgeView } from '@studyforge/contracts/knowledge';
import type { SetView } from '@studyforge/contracts/sets';
import type { LibraryRelation } from '@studyforge/contracts/library';
import type { SourceReferences } from './source-selection.ts';
import type { SourceContext } from '@studyforge/contracts/source-context';
import { useEffect, useState } from 'react';
import { CardDetail } from '../cards/CardDetail.tsx';
import { KnowledgeEditor } from '../cards/KnowledgeEditor.tsx';
import { insertTaskSkill } from '../classroom/skill-draft.ts';
import { requestLessonPane } from './lesson-pane-request.ts';
import { revealWorkspaceView } from '../classroom/workspace-layout.ts';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';

export interface LibraryItem { ref: string; title: string; kind: 'material' | 'card' | 'knowledge'; version: number; source?: { materialId: string; versionId: string } }
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

export function LibraryBrowser({ ctx, materials, cards, references, onOpen, onChange }: { ctx: Context; materials: readonly MaterialView[]; cards: readonly CardView[]; references: SourceReferences; onOpen(material: MaterialView): void; onChange(): void }): React.JSX.Element {
  const [knowledge, setKnowledge] = useState<KnowledgeView[]>([]), [sets, setSets] = useState<SetView[]>([]), [relations, setRelations] = useState<LibraryRelation[]>([]);
  const [query, setQuery] = useState(''), [kind, setKind] = useState('all'), [set, setSet] = useState(''), [selected, setSelected] = useState<string>(), [target, setTarget] = useState(''), [label, setLabel] = useState('相关'), [notice, setNotice] = useState(''), [tick, setTick] = useState(0);
  const changed = (): void => { setTick(n => n + 1); onChange(); window.dispatchEvent(new Event('studyforge:learning-changed')); };
  useEffect(() => { let live = true; void Promise.all([ctx.remote.studyforgeLearning.knowledge(), ctx.remote.studyforgeOrganization.sets({}), ctx.remote.studyforgeLibrary.relations()]).then(([notes, groups, edges]) => {
    if (!live) return; if (notes.ok) setKnowledge(notes.value); if (groups.ok) setSets(groups.value); if (edges.ok) setRelations(edges.value);
  }).catch(() => { if (live) setNotice('部分资料暂时读不出来。'); }); return () => { live = false; }; }, [ctx, tick]);
  const items: LibraryItem[] = [...materials.map(m => ({ ref: 'material:' + m.materialId, title: m.title, kind: 'material' as const, version: m.revision, source: { materialId: m.materialId, versionId: m.currentVersion.versionId } })), ...cards.map(c => ({ ref: c.ref, title: c.content.title, kind: 'card' as const, version: c.version })), ...knowledge.map(k => ({ ref: k.ref, title: k.content.title, kind: 'knowledge' as const, version: k.version }))];
  const member = (group: SetView, item: LibraryItem): boolean => item.source ? group.materials.includes(item.source.materialId) : group.members.includes(item.ref) || (cards.find(c => c.ref === item.ref)?.content.sources.some(source => group.materials.includes(source.materialId)) ?? false);
  const visible = items.filter(item => (kind === 'all' || kind === item.kind) && item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (!set || !!sets.find(group => group.ref === set && member(group, item))));
  const active = items.find(item => item.ref === selected);
  const related = relations.filter(edge => edge.from === selected || edge.to === selected);
  return <section className="sf-library-browser" data-testid="library-browser">
    <div className="sf-library-filters"><input aria-label="搜索资料" placeholder="搜索资料" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="资料类型" value={kind} onChange={e => setKind(e.target.value)}><option value="all">全部类型</option><option value="material">原文</option><option value="card">题卡与笔记</option><option value="knowledge">知识</option></select><select aria-label="筛选学习集" value={set} onChange={e => setSet(e.target.value)}><option value="">全部学习集</option>{sets.map(s => <option key={s.ref} value={s.ref}>{s.name}</option>)}</select><button className="sf-quiet" data-testid="materials-open-cards" onClick={() => ctx.layout.selectPanel('studyforge.cards' as MainPanelId)}>学习与复习</button></div>
    <div className="sf-library-columns"><ul className="sf-linear-tree" data-testid="materials-list">{visible.map(item => <li key={item.ref} data-testid="material-row" data-material-title={item.title}><button className="sf-library-row" aria-pressed={selected === item.ref} onClick={() => setSelected(item.ref)}><strong>{item.title}</strong><small>{item.kind === 'material' ? '原文' : item.kind === 'card' ? '卡片' : '知识'}</small></button></li>)}</ul>
    {active && <section className="sf-library-detail" data-testid="library-detail"><header><h2>{active.title}</h2><button className="sf-quiet" onClick={() => setSelected(undefined)} aria-label="关闭资料详情">×</button></header>
      <div className="sf-org-actions">{active.kind === 'material' && <button className="sf-action" onClick={() => onOpen(materials.find(m => 'material:' + m.materialId === active.ref)!)}>阅读原文</button>}<button className="sf-quiet" onClick={() => { void libraryDraft(ctx, references, active, false).catch(() => setNotice('暂时没能准备课堂引用。')); }}>带入课堂</button><button className="sf-quiet" onClick={() => { void libraryDraft(ctx, references, active, true).catch(() => setNotice('暂时没能准备查找草稿。')); }}>按语义查找</button></div>
      {active.kind === 'card' && <CardDetail ctx={ctx} target={active.ref} onSource={source => { const m = materials.find(m => m.materialId === source.materialId); if (m) onOpen(m); }} onChange={changed} />}
      {active.kind === 'knowledge' && <KnowledgeEditor ctx={ctx} target={active.ref} onSaved={changed} />}
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
