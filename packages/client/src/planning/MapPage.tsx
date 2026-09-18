/**
 * 知识地图页：一张画布，两个真实投影。
 *
 * 「按书籍」画每本书自己的树——书根、骨架节、真的挂在这本书上的卡与知识叶；
 * 「知识地图」画工作区级的 atlas——主题层加上按 `topic` 归属的卡，没归图的卡
 * 收在末尾的「未归图」下，让学生看见还没组织的那部分。
 *
 * 本页只读不写：改归属走卡编辑器的 topic 字段或 AI 提案确认，结构修改走
 * propose_atlas 提案；这里没有第二个脑图编辑模型。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type { AtlasChangeDraft, AtlasPreview, AtlasView } from '@studyforge/contracts/atlas';
import type { BookStructure } from '@studyforge/contracts/book-exploration';
import type { CardView } from '@studyforge/contracts/cards';
import type { MaterialContext } from '@studyforge/contracts/materials';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cardOpenRequest } from '../cards/CardOpenRequest.tsx';
import type { MaterialNavigation } from '../materials/material-navigation.ts';
import { bookHint } from '../materials/lesson-materials-mindmap.ts';
import { Mindmap, type MindAction } from '../materials/mindmap.tsx';
import type { MindNode } from '../materials/mindmap-model.ts';
import './map-page.css';

/** Registered `main` key and matching sidebar row id. */
export const MAP_PAGE_ID = 'studyforge.map';

/** 点中一个节点做什么：进卡库看那张卡，或去资料页看那段原文；`none` 只选中。 */
type Pick =
  | { readonly kind: 'target'; readonly ref: string }
  | { readonly kind: 'source'; readonly material: MaterialContext }
  | { readonly kind: 'none' };

interface MapProjection {
  readonly nodes: readonly MindNode[];
  readonly picks: ReadonlyMap<string, Pick>;
}

/** 书视图：每本书自己的树并排成森林，key 加材料前缀防两本书的节撞名。 */
function bookForest(books: readonly BookStructure[]): MapProjection {
  const nodes: MindNode[] = [], picks = new Map<string, Pick>();
  for (const structure of books) {
    const prefix = `m:${structure.material.materialId}/`;
    for (const node of structure.nodes) {
      const key = prefix + node.key;
      nodes.push({
        key, title: node.title, kind: node.kind, hint: bookHint(node, structure.nodes),
        parent: node.parentKey === undefined ? undefined : prefix + node.parentKey,
        children: node.children.map(child => prefix + child),
      });
      if (node.kind === 'card' || node.kind === 'knowledge') {
        picks.set(key, { kind: 'target', ref: node.target });
      } else {
        const anchor = node.sources[0];
        picks.set(key, {
          kind: 'source',
          material: anchor === undefined
            ? structure.material
            : { materialId: anchor.materialId, versionId: anchor.versionId, locator: anchor.locator },
        });
      }
    }
  }
  return { nodes, picks };
}

/** 「未归图」伪根的 key：收所有没写 topic 的卡。 */
const UNFILED_KEY = 'unfiled';
const TOPIC_PREFIX = 'topic:';
const CARD_PREFIX = 'card:';

/** One in-flight atlas edit the confirm panel holds: the change plus its preview. */
interface AtlasDraft {
  readonly kind: 'rename' | 'move' | 'child' | 'remove';
  /** The topic path being edited. */
  readonly path: string;
  /** New name (rename/child). */
  readonly input: string;
  /** New parent path ('' = 顶层); drag-drops land pre-filled. */
  readonly target: string;
  readonly preview: AtlasPreview | undefined;
  readonly change: AtlasChangeDraft | undefined;
  readonly detach: boolean;
  readonly busy: boolean;
  readonly error: string | undefined;
}

/** The change one draft builds, in the atlas's own vocabulary. */
function changeOf(draft: AtlasDraft): AtlasChangeDraft {
  const leaf = draft.path.slice(draft.path.lastIndexOf('/') + 1);
  const parent = draft.path.slice(0, draft.path.lastIndexOf('/'));
  switch (draft.kind) {
    case 'rename': return { repath: [{ from: draft.path, to: (parent === '' ? '' : parent + '/') + draft.input.trim() }] };
    case 'move': return { repath: [{ from: draft.path, to: (draft.target === '' ? '' : draft.target + '/') + leaf }] };
    case 'child': return { nodes: [{ path: draft.path + '/' + draft.input.trim(), detail: 'refined' }] };
    case 'remove': return { removePaths: [draft.path], detachDependents: draft.detach };
  }
}

const DRAFT_TITLE: Record<AtlasDraft['kind'], string> = { rename: '改层名', move: '移动层', child: '新建子层', remove: '删除层' };

/** atlas 视图：主题层按路径建树，卡按自己的 topic 落到真实存在的最近一层。 */
function atlasTree(atlas: AtlasView, cards: readonly CardView[]): MapProjection {
  const nodes: MindNode[] = [], picks = new Map<string, Pick>();
  const known = new Set(atlas.nodes.map(node => node.path));
  /** 最近的、真实存在的祖先路径；不存在就不合成中间层。 */
  const parentPath = (path: string): string | undefined => {
    let index = path.lastIndexOf('/');
    while (index > 0) {
      const candidate = path.slice(0, index);
      if (known.has(candidate)) return candidate;
      index = candidate.lastIndexOf('/');
    }
    return undefined;
  };
  /** 一张卡真正落在哪一层：自己的 topic，topic 不在图里就退到最近祖先，再没有就未归图。 */
  const hostOf = (topic: string | undefined): string | undefined => {
    if (topic === undefined) return undefined;
    return known.has(topic) ? topic : parentPath(topic);
  };
  // 一层 topic 之下（含所有下级）有多少张卡——卡先按自己的落层计数。
  const cardCount = new Map<string, number>();
  for (const card of cards) {
    const host = hostOf(card.content.topic);
    if (host !== undefined) cardCount.set(host, (cardCount.get(host) ?? 0) + 1);
  }
  const descendantCards = (path: string): number => {
    let count = cardCount.get(path) ?? 0;
    for (const [other, own] of cardCount) if (other.startsWith(path + '/')) count += own;
    return count;
  };
  for (const node of atlas.nodes) {
    const parent = parentPath(node.path);
    const key = `topic:${node.path}`;
    const count = descendantCards(node.path);
    nodes.push({
      key, title: node.path.slice(node.path.lastIndexOf('/') + 1), kind: 'section',
      hint: (node.detail === 'refined' ? '已整理' : '主题层') + (count ? ` · ${String(count)} 张卡` : ' · 尚无卡') + (node.note ? ` · ${node.note}` : ''),
      ...(parent === undefined ? {} : { parent: `topic:${parent}` }),
      children: [],
    });
    const anchor = node.sources?.[0];
    picks.set(key, anchor === undefined ? { kind: 'none' } : {
      kind: 'source',
      material: { materialId: anchor.materialId, versionId: anchor.versionId, locator: anchor.locator },
    });
  }
  const unfiled: string[] = [];
  for (const card of cards) {
    const host = hostOf(card.content.topic);
    const parent = host === undefined ? UNFILED_KEY : `topic:${host}`;
    const key = `card:${card.ref}`;
    nodes.push({ key, title: card.content.title, kind: 'card', hint: '卡片', parent, children: [] });
    picks.set(key, { kind: 'target', ref: card.ref });
    if (host === undefined) unfiled.push(key);
  }
  // 物化 children：每个节点认领指向自己的子节点，顺序就是路径声明的顺序。
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parent === undefined) continue;
    children.set(node.parent, [...children.get(node.parent) ?? [], node.key]);
  }
  if (unfiled.length > 0) {
    nodes.push({ key: UNFILED_KEY, title: '未归图', kind: 'book', hint: `${String(unfiled.length)} 张卡`, children: unfiled });
    picks.set(UNFILED_KEY, { kind: 'none' });
  }
  return { nodes: nodes.map(node => ({ ...node, children: children.get(node.key) ?? node.children })), picks };
}

/** 学生页：地图本体 + 视图切换；数据改动后重新拉取，不本地拼写结果。 */
export function MapPage({ ctx, navigation }: { ctx: Context; navigation: MaterialNavigation }): React.JSX.Element {
  const [view, setView] = useState<'books' | 'atlas'>('books');
  const [mode, setMode] = useState<'map' | 'list'>('map');
  const [data, setData] = useState<{ books: BookStructure[]; atlas: AtlasView } | undefined>(undefined);
  const [cards, setCards] = useState<readonly CardView[] | undefined>(undefined);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setFailed(undefined);
    Promise.all([
      ctx.remote.studyforgeOrganization.map({}),
      ctx.remote.studyforgeLearning.cards(),
    ]).then(([map, list]) => {
      if (!alive) return;
      if (!map.ok || !list.ok) {
        const failure = !map.ok ? map.error : !list.ok ? list.error : undefined;
        setFailed(failure?.message ?? '读取失败');
        return;
      }
      setData(map.value); setCards(list.value);
    }).catch((error: unknown) => { if (alive) setFailed(error instanceof Error ? error.message : String(error)); });
    return () => { alive = false; };
  }, [ctx, reload]);
  const projection = useMemo(() => data === undefined || cards === undefined
    ? undefined
    : view === 'books' ? bookForest(data.books) : atlasTree(data.atlas, cards), [data, cards, view]);
  const pick = useCallback((node: MindNode): void => {
    setSelected(node.key);
    const target = projection?.picks.get(node.key);
    if (target === undefined || target.kind === 'none') return;
    if (target.kind === 'target') {
      cardOpenRequest.request(target.ref);
      ctx.layout.selectPanel('studyforge.cards' as MainPanelId);
      return;
    }
    navigation.show(target.material);
    ctx.layout.selectPanel('studyforge.materials' as MainPanelId);
  }, [ctx, navigation, projection]);
  const expand = useCallback((node: MindNode, open: boolean): void => {
    setExpanded(current => open ? [...new Set([...current, node.key])] : current.filter(key => key !== node.key));
  }, []);
  const [draft, setDraft] = useState<AtlasDraft | undefined>(undefined);
  const openDraft = useCallback((kind: AtlasDraft['kind'], path: string, target = ''): void => {
    setDraft({ kind, path, input: '', target, preview: undefined, change: undefined, detach: false, busy: false, error: undefined });
  }, []);
  const atlasActions: readonly MindAction[] = useMemo(() => [
    { label: '改名', when: node => node.key.startsWith(TOPIC_PREFIX), run: node => { openDraft('rename', node.key.slice(TOPIC_PREFIX.length)); } },
    { label: '移动到', when: node => node.key.startsWith(TOPIC_PREFIX), run: node => { openDraft('move', node.key.slice(TOPIC_PREFIX.length)); } },
    { label: '新建子层', when: node => node.key.startsWith(TOPIC_PREFIX), run: node => { openDraft('child', node.key.slice(TOPIC_PREFIX.length)); } },
    { label: '删除', when: node => node.key.startsWith(TOPIC_PREFIX), run: node => { openDraft('remove', node.key.slice(TOPIC_PREFIX.length)); } },
  ], [openDraft]);
  /** Topic repaths go through preview+confirm; card drops edit the card's own topic directly. */
  const onAtlasDrop = useCallback((source: string, target: string): void => {
    if (source.startsWith(TOPIC_PREFIX) && target.startsWith(TOPIC_PREFIX)) {
      const from = source.slice(TOPIC_PREFIX.length), to = target.slice(TOPIC_PREFIX.length);
      if (from.slice(0, from.lastIndexOf('/')) === to) return;
      setDraft({ kind: 'move', path: from, input: '', target: to, preview: undefined, change: undefined, detach: false, busy: false, error: undefined });
      return;
    }
    if (!source.startsWith(CARD_PREFIX)) return;
    const ref = source.slice(CARD_PREFIX.length);
    const card = cards?.find(row => row.ref === ref);
    const topic = target === UNFILED_KEY ? null : target.startsWith(TOPIC_PREFIX) ? target.slice(TOPIC_PREFIX.length) : undefined;
    if (card === undefined || topic === undefined || (card.content.topic ?? null) === topic) return;
    void ctx.remote.studyforgeLearning.editCard({ operationId: crypto.randomUUID(), target: ref, expectedVersion: card.version, patch: { topic, links_add: [], links_remove: [] } })
      .then(reply => { if (reply.ok) setReload(value => value + 1); else setFailed('归属没有改成功：' + (reply.error?.message ?? '')); })
      .catch(() => setFailed('归属没有改成功。'));
  }, [cards, ctx]);
  const dropDenied = useCallback((source: string, target: string): boolean =>
    source === target || (source.startsWith(TOPIC_PREFIX) && target.startsWith(source + '/')), []);
  const runPreview = useCallback(async (): Promise<void> => {
    if (draft === undefined || data === undefined || draft.busy) return;
    const change = changeOf(draft);
    setDraft({ ...draft, busy: true, error: undefined });
    const reply = await ctx.remote.studyforgeOrganization.previewAtlas({ version: data.atlas.revision ?? 0, change });
    setDraft(reply.ok
      ? { ...draft, preview: reply.value, change, busy: false, error: undefined }
      : { ...draft, preview: undefined, busy: false, error: reply.error?.message ?? '预览没有成功' });
  }, [ctx, draft, data]);
  const runSave = useCallback(async (): Promise<void> => {
    if (draft?.change === undefined || data === undefined || draft.busy) return;
    setDraft({ ...draft, busy: true, error: undefined });
    const reply = await ctx.remote.studyforgeOrganization.saveAtlas({
      operationId: crypto.randomUUID(), expectedVersion: data.atlas.revision ?? 0,
      change: { ...draft.change, detachDependents: draft.detach },
    });
    if (reply.ok) { setDraft(undefined); setReload(value => value + 1); return; }
    setDraft({ ...draft, busy: false, error: reply.error?.message ?? '保存没有成功' });
  }, [ctx, draft, data]);
  return <main className="sf-map-page" data-testid="studyforge-page-map">
    <header className="sf-map-head">
      <span>知识地图</span>
      <nav className="sf-map-views" aria-label="视图" data-testid="map-views">
        <button type="button" className={view === 'books' ? 'sf-chip sf-chip-on' : 'sf-chip'} data-testid="map-view-books" onClick={() => { setView('books'); setSelected(undefined); }}>按书籍</button>
        <button type="button" className={view === 'atlas' ? 'sf-chip sf-chip-on' : 'sf-chip'} data-testid="map-view-atlas" onClick={() => { setView('atlas'); setSelected(undefined); }}>知识地图</button>
      </nav>
      <nav className="sf-map-views" aria-label="形态" data-testid="map-modes">
        <button type="button" className={mode === 'map' ? 'sf-chip sf-chip-on' : 'sf-chip'} data-testid="map-mode-map" onClick={() => { setMode('map'); }}>图</button>
        <button type="button" className={mode === 'list' ? 'sf-chip sf-chip-on' : 'sf-chip'} data-testid="map-mode-list" onClick={() => { setMode('list'); }}>列表</button>
      </nav>
      <button type="button" className="sf-quiet" data-testid="map-reload" onClick={() => { setReload(value => value + 1); }}>刷新</button>
    </header>
    {failed !== undefined && <p className="sf-notice sf-notice-error" role="alert">地图没有读出来：{failed}</p>}
    {projection === undefined && failed === undefined && <p className="sf-note" role="status">正在铺开你的知识地图…</p>}
    {projection !== undefined && <Mindmap
      testId="map-canvas" label={view === 'books' ? '按书籍分布的结构' : '跨书知识地图'}
      nodes={projection.nodes} mode={mode} expanded={expanded} selected={selected}
      onPick={pick} onExpand={expand}
      actions={view === 'atlas' ? atlasActions : undefined}
      onDrop={view === 'atlas' ? onAtlasDrop : undefined}
      dropDenied={view === 'atlas' ? dropDenied : undefined}
      empty={view === 'books' ? '还没有一本书被读过结构。在资料页打开一本书，读过的层级会出现在这里。' : '知识地图还是空的。给卡填一个主题归属，或让老师帮你整理，第一层就会长出来。'}
    />}
    {draft !== undefined && data !== undefined && <section className="sf-atlas-edit" data-testid="atlas-edit" aria-label="修改知识地图">
      <header className="sf-atlas-edit-head"><strong>{DRAFT_TITLE[draft.kind]}</strong><code>{draft.path}</code><button type="button" className="sf-quiet" aria-label="取消" onClick={() => { setDraft(undefined); }}>×</button></header>
      {draft.kind === 'rename' && <label className="sf-atlas-edit-row">新名称<input data-testid="atlas-edit-input" value={draft.input} onChange={e => { setDraft({ ...draft, input: e.target.value, preview: undefined }); }} /></label>}
      {draft.kind === 'move' && <label className="sf-atlas-edit-row">移动到<select data-testid="atlas-edit-target" value={draft.target} onChange={e => { setDraft({ ...draft, target: e.target.value, preview: undefined }); }}>
        <option value="">顶层</option>
        {data.atlas.nodes.map(node => node.path).filter(path => path !== draft.path && !path.startsWith(draft.path + '/')).map(path => <option key={path} value={path}>{path}</option>)}
      </select></label>}
      {draft.kind === 'child' && <label className="sf-atlas-edit-row">子层名<input data-testid="atlas-edit-input" value={draft.input} onChange={e => { setDraft({ ...draft, input: e.target.value, preview: undefined }); }} /></label>}
      {draft.kind === 'remove' && <p className="sf-atlas-edit-note">这一层连同它的下层一起移出地图；挂在它们身上的卡归属见下方影响。</p>}
      {draft.preview !== undefined && <div className="sf-atlas-impact" data-testid="atlas-impact">
        <p>{draft.preview.impact.cards.length === 0 && draft.preview.impact.removedPaths.length === 0 ? '没有卡或层受这次修改影响。'
          : `${String(draft.preview.impact.cards.length)} 张卡的归属会随之调整${draft.preview.impact.removedPaths.length === 0 ? '。' : `；一并移出 ${draft.preview.impact.removedPaths.join('、')}。`}`}</p>
        {draft.preview.requiresDetach && <label className="sf-atlas-edit-row"><input type="checkbox" data-testid="atlas-detach" checked={draft.detach} onChange={e => { setDraft({ ...draft, detach: e.target.checked }); }} />这些卡的地图归属一并清空（卡本身保留）</label>}
      </div>}
      {draft.error !== undefined && <p className="sf-notice sf-notice-error" role="alert">{draft.error}</p>}
      <div className="sf-atlas-edit-actions">
        {draft.preview === undefined
          ? <button type="button" className="sf-action" data-testid="atlas-preview-run" disabled={draft.busy || ((draft.kind === 'rename' || draft.kind === 'child') && draft.input.trim() === '')} onClick={() => { void runPreview(); }}>{draft.busy ? '正在预览…' : '查看影响'}</button>
          : <button type="button" className="sf-action" data-testid="atlas-save-run" disabled={draft.busy || (draft.preview.requiresDetach && !draft.detach)} onClick={() => { void runSave(); }}>{draft.busy ? '正在保存…' : '确认修改'}</button>}
      </div>
    </section>}
  </main>;
}
