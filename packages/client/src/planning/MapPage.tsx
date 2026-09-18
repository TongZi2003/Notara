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
import type { AtlasView } from '@studyforge/contracts/atlas';
import type { BookStructure } from '@studyforge/contracts/book-exploration';
import type { CardView } from '@studyforge/contracts/cards';
import type { MaterialContext } from '@studyforge/contracts/materials';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cardOpenRequest } from '../cards/CardOpenRequest.tsx';
import type { MaterialNavigation } from '../materials/material-navigation.ts';
import { bookHint } from '../materials/lesson-materials-mindmap.ts';
import { Mindmap } from '../materials/mindmap.tsx';
import type { MindNode } from '../materials/mindmap-model.ts';

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
      empty={view === 'books' ? '还没有一本书被读过结构。在资料页打开一本书，读过的层级会出现在这里。' : '知识地图还是空的。给卡填一个主题归属，或让老师帮你整理，第一层就会长出来。'}
    />}
  </main>;
}
