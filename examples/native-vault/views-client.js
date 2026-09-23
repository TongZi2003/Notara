import { MATERIAL_TYPES, childCardsOf, childMaterialsOf, filterVaultGraph, tagGroups } from './graph.js';
import { mediaLocatorSuffix, parseMediaTarget } from './media.js';
import { CANVAS_CSS, KNOWLEDGE_ROLES, createVaultCanvas } from './canvas-client.js';
import { createVaultClient } from './remote-client.js';
import { createFileActions } from './file-actions-client.js';

export const VIEW_IDS = { assets: 'notara-vault', graph: 'notara-vault-graph', cards: 'notara-vault-cards', routes: 'notara-vault-routes', calendar: 'notara-vault-calendar' };
// A source whose position could not be read says so, instead of looking like a
// reference to page one of a PDF the card never quoted.
export const sourceLabel = source => `${source.path}${source.locator?.page ? ` · 第 ${source.locator.page} 页` : ''}${source.locator?.anchor ? ` · ${source.locator.anchor}` : ''}${source.invalidLocator ? ' · 位置无法识别' : ''}`;
export const focusFor = (path, locator) => `${path}${mediaLocatorSuffix(locator)}`;
// 锦囊 is a card with its own type, so both kinds belong to the card library.
const LIBRARY_TYPES = new Set(['card', 'insight']);
const CARD_TYPE_LABEL = { insight: '锦囊' };
// 源目录/教学专题 carry their own type, so the graph labels them from `type`
// instead of reusing the topology role（原书（根））and reading a 教学专题 as the
// book itself.
const MATERIAL_TYPE_LABEL = { source: '源目录', topic: '教学专题' };
const roleLabelOf = node => MATERIAL_TYPE_LABEL[node?.type] ?? KNOWLEDGE_ROLES[node?.role] ?? '';
/** A node's parent link names what the parent actually is: a 源目录/教学专题 (or
 * the 原书 PDF) is not a card, and only the card library holds cards. */
const parentLabelOf = (graph, path) => {
  const parent = path ? (graph?.nodes ?? []).find(item => item.path === path) : undefined;
  return parent && !LIBRARY_TYPES.has(parent.type) ? '父资料' : '父卡';
};
const CSS = `
.nv-cards-scroll{padding:20px;overflow:auto;flex:1}.nv-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr));gap:14px}.nv-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:16px;background:var(--dsw-alias-bg-layer-1);min-width:0}.nv-card h3{font-size:16px;margin:0}.nv-card p{font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;min-height:44px}.nv-card button{overflow-wrap:anywhere}.nv-card-source{display:grid;gap:8px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px}
.nv-tag-group{display:flex;align-items:center;gap:6px;flex-wrap:wrap;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 10px;background:var(--dsw-alias-bg-layer-1)}
.nv-tag-group button{border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;padding:2px 4px;border-radius:6px}
.nv-tag-group button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.nv-tag-members{flex-basis:100%;display:flex;flex-wrap:wrap;gap:6px;padding:6px 0 8px}
.nv-graph-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:16px;color:var(--dsw-alias-label-secondary)}
.nv-graph-tag{display:inline-flex;align-items:baseline;gap:3px;max-width:100%;border:1px solid transparent;border-radius:999px;padding:2px 9px;background:var(--dsw-alias-markdown-tag,color-mix(in srgb,currentColor 8%,transparent));color:inherit;font:400 12px/20px var(--dsw-font-family,system-ui);cursor:pointer;overflow-wrap:anywhere}
.nv-graph-tag-hash{opacity:.55;flex:none}
.nv-graph-tag:hover,.nv-graph-tag[aria-pressed=true]{border-color:var(--dsw-alias-link,#6370ff);color:var(--dsw-alias-link,#6370ff)}
@container (max-width:650px){.nv-view-top{padding:12px}.nv-cards-scroll{padding:12px}}
`;

/** Slot-local projections share one small UI factory with the existing reader. */
export function createVaultViews(React, { STYLE, IconButton, Menu, Dialog }) {
  const h = React.createElement;
  const { useState, useEffect, useMemo, useRef } = React;
  const { useRemembered, NodeMark, Board } = createVaultCanvas(React, { STYLE, IconButton });
  const useFileActions=createFileActions(React,{STYLE,Dialog});
  const sessions = new Map();
  const stateFor = sessionId => { if (!sessions.has(sessionId)) sessions.set(sessionId, { graph: {}, cards: {} }); return sessions.get(sessionId); };
  const btn = (label, onClick, extra = {}) => h('button', { style: STYLE.quiet, onClick, ...extra }, label);
  const changed = () => window.dispatchEvent(new Event('notara-vault-changed'));
  // Every projection (图谱、卡片) reads the workspace this session really is in.
  function useVault(ctx, sessionId) { return useMemo(() => createVaultClient(ctx, sessionId), [ctx, sessionId]); }
  function useGraph(vault, visible) {
    const [state, setState] = useState({ graph: { nodes: [], edges: [] }, loading: true, error: '' });
    useEffect(() => {
      if (!visible) return;
      let live = true, pending = false;
      const refresh = async () => {
        if (pending) return;
        pending = true;
        try {
          const result = await vault.graph({});
          if (!result?.ok) throw new Error('read');
          if (live) setState(previous => ({ graph: JSON.stringify(previous.graph) === JSON.stringify(result.value) ? previous.graph : result.value, loading: false, error: '' }));
        } catch { if (live) setState(previous => ({ ...previous, loading: false, error: '暂时无法读取文件，请稍后重试。' })); }
        finally { pending = false; }
      };
      void refresh();
      const timer = setInterval(refresh, 2500);
      window.addEventListener('notara-vault-changed', refresh); window.addEventListener('focus', refresh);
      return () => { live = false; clearInterval(timer); window.removeEventListener('notara-vault-changed', refresh); window.removeEventListener('focus', refresh); };
    }, [vault, visible]);
    return state;
  }
  function useFocus(props, onFocus) {
    const callback = useRef(onFocus); callback.current = onFocus;
    useEffect(() => {
      if (!props.viewRequest?.focus) return;
      callback.current(parseMediaTarget(props.viewRequest.focus));
      props.completeViewRequest();
    }, [props.viewRequest]);
  }
  function Frame({ title, status, tools, children }) {
    return h('div', { className: 'nv-views', style: STYLE.page }, h('style', null, CSS), h('style', null, CANVAS_CSS),
      h('header', { className: 'nv-view-top' }, h('strong', { style: STYLE.brand }, title), tools,
        h('span', { role: 'status', style: { ...STYLE.notice, marginLeft: 'auto' } }, status)), children);
  }
  /** 层级分组 is the card library's own reading order, so both kinds group the same way. */
  function CardsView(props) {
    const vault = useVault(props.ctx, props.sessionId), { graph, loading, error } = useGraph(vault, props.visible);
    const [search, setSearch] = useState(''), [source, setSource] = useState(''), [grouped, setGrouped] = useState(true);
    const cards = graph.nodes.filter(node => LIBRARY_TYPES.has(node.type));
    const insights = cards.filter(node => node.type === 'insight').length;
    const sources = [...new Set(cards.flatMap(node => [...node.sources.map(item => item.path), ...(node.parent ? [node.parent] : [])]))].sort();
    const filtered = cards.filter(node => (!source || node.parent === source || node.sources.some(item => item.path === source)) && `${node.title}\n${node.excerpt}\n${node.path}\n${CARD_TYPE_LABEL[node.type] ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    const groups = new Map();
    for (const card of filtered) { const level = grouped ? card.depth : 'all'; if (!groups.has(level)) groups.set(level, []); groups.get(level).push(card); }
    return h(Frame, { title: '卡片库', status: error || `${cards.length} 张卡片${insights ? ` · ${insights} 张锦囊` : ''}`, tools: h(React.Fragment, null,
      h('input', { style: { ...STYLE.search, width: 180, margin: 0 }, placeholder: '搜索卡片…', value: search, onChange: event => setSearch(event.target.value) }),
      h('select', { style: { ...STYLE.templateInput, width: 170, margin: 0 }, 'aria-label': '来源过滤', value: source, onChange: event => setSource(event.target.value) }, h('option', { value: '' }, '全部来源'), sources.map(path => h('option', { key: path, value: path }, path))),
      h('label', { style: STYLE.notice }, h('input', { type: 'checkbox', checked: grouped, onChange: event => setGrouped(event.target.checked) }), ' 按层级分组')) },
      h('div', { className: 'nv-cards-scroll' }, loading ? h('div', { style: STYLE.empty }, '正在读取…') : !cards.length ? h('div', { style: STYLE.empty }, '还没有卡片。从资产页选取一段内容开始。') : !filtered.length ? h('div', { style: STYLE.empty }, '没有符合条件的卡片。')
        : [...groups.entries()].sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity)).map(([level, nodes]) => h('section', { key: String(level) },
          grouped && h('h2', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)', margin: '10px 0 14px' } }, level === null ? '层级未确定' : `第 ${level} 层`),
          h('div', { className: 'nv-card-grid' }, nodes.map(node => h('article', { className: 'nv-card', key: node.path },
            h('h3', null, h('button', { style: { ...STYLE.link, fontSize: 16, textDecoration: 'none' }, 'aria-label': `打开卡片 ${node.title}`, onClick: () => props.openView(VIEW_IDS.assets, node.path) }, node.title),
              CARD_TYPE_LABEL[node.type] && h('span', { className: 'nv-tag-group', style: { marginLeft: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, CARD_TYPE_LABEL[node.type])),
            h('p', null, node.excerpt || '这张卡片还没有摘录。'),
            h('div', { className: 'nv-card-source' },
              node.sources.map((item, index) => h('button', { key: `${item.path}:${index}`, style: { ...STYLE.link, textAlign: 'left', fontSize: 12 }, 'aria-label': `阅读来源 ${sourceLabel(item)}`, onClick: () => props.openView(VIEW_IDS.assets, focusFor(item.path, item.locator)) }, `↩ ${sourceLabel(item)}`)),
              node.parent && !node.sources.some(item => item.path === node.parent) && h('button', { style: STYLE.link, onClick: () => props.openView(VIEW_IDS.graph, node.parent) }, `${parentLabelOf(graph, node.parent)}：${node.parent}`),
              node.type==='card' && h('button', { style: { ...STYLE.link, textAlign: 'left', fontSize: 12 }, onClick: () => props.openView(VIEW_IDS.calendar, node.path) }, '复习安排'),
              h('button', { style: { ...STYLE.link, textAlign: 'left', fontSize: 12 }, onClick: () => props.openView(VIEW_IDS.graph, node.path) }, '在图谱中查看')))))))));
  }

  function GraphView(props) {
    const vault=useVault(props.ctx,props.sessionId), {graph,loading,error}=useGraph(vault, props.visible), state=stateFor(props.sessionId).graph;
    const fileActions=useFileActions(vault);
    const [selected,setSelected]=useRemembered(state,'selected',''), [focus,setFocus]=useRemembered(state,'focus',''), [hops,setHops]=useRemembered(state,'hops',1), [tags,setTags]=useRemembered(state,'tags',[]);
    const [openGroup,setOpenGroup]=useRemembered(state,'tagGroup','');
    const [centerVersion,setCenterVersion]=useState(0);
    const [notice,setNotice]=useState(''), [filtering,setFiltering]=useState(false),[menu,setMenu]=useState(null),[paneWidth,setPaneWidth]=useRemembered(state,'paneWidth',300);
    const root=useRef(null),resize=useRef(null),detailTimer=useRef(null);
    const [detailsOpen,setDetailsOpen]=useState(!!state.selected);
    useEffect(()=>{if(loading)return;const paths=new Set(graph.nodes.map(item=>item.path));if(selected&&!paths.has(selected)){setSelected('');setDetailsOpen(false);}if(focus&&!paths.has(focus))setFocus('');if(menu&&!paths.has(menu.path))setMenu(null);},[graph,loading,selected,focus,menu]);
    useEffect(()=>()=>clearTimeout(detailTimer.current),[]);
    useFocus(props,target=>{
      if(target.path.startsWith('tag:')){setTags([decodeURIComponent(target.path.slice(4))]);setFocus('');setSelected('');setFiltering(true);return;}
      setDetailsOpen(true);setSelected(target.path);setFocus('');setTags([]);
    });
    const filtered=useMemo(()=>filterVaultGraph(graph,{focus:focus||null,hops,tags}),[graph,focus,hops,tags]);
    // 标签聚合：一个标签一组，显示真实资产数量；同一资产多标签只在本组出现一次。
    const groups=useMemo(()=>tagGroups(graph),[graph]);
    const titles=new Map(graph.nodes.map(node=>[node.path,node.title]));
    const node=graph.nodes.find(item=>item.path===selected);
    const menuNode=graph.nodes.find(item=>item.path===menu?.path);
    const children=node?childCardsOf(graph,node.path):[], materials=node?childMaterialsOf(graph,node.path):[], materialNode=!!node&&MATERIAL_TYPES.has(node.type);
    const cardKind=node&&CARD_TYPE_LABEL[node.type]?CARD_TYPE_LABEL[node.type]:'';
    const select=path=>{setSelected(path);setMenu(null);setNotice('');if(!detailsOpen){clearTimeout(detailTimer.current);detailTimer.current=setTimeout(()=>setDetailsOpen(true),250);}};
    const open=node=>props.openView(VIEW_IDS.assets,node.path);
    const center=target=>{setFocus(target.path);setCenterVersion(value=>value+1);setMenu(null);};
    const canvasNodes=useMemo(()=>filtered.nodes.map(item=>({key:item.path,title:item.title,role:item.type==='insight'?'insight':item.role,hint:[roleLabelOf(item),CARD_TYPE_LABEL[item.type]].filter(Boolean).join(' · '),node:item})),[filtered]);
    const bring=async target=>{
      setMenu(null);
      try {
        const result=await (target.kind==='page'?vault.read({path:target.path}):vault.readAsset({path:target.path}));
        if(!result?.ok)throw new Error('read');
        const targetChildren=childCardsOf(graph,target.path), targetMaterials=childMaterialsOf(graph,target.path);
        const listed=[targetMaterials.length?'已有子资料：\n'+targetMaterials.map(item=>`- ${item.title}（${item.path}）`).join('\n'):'',targetChildren.length?'已有子卡片：\n'+targetChildren.map(child=>`- ${child.title}（${child.path}）`).join('\n'):''].filter(Boolean).join('\n');
        const intent='请读取这份资料及其已有子资料与子卡片，按知识点提出拆分方案，避免重复已有内容；先和我确认，再创建卡片。'+(listed?'\n'+listed:'\n目前没有子资料或子卡片。');
        if(!props.onBring(result.value,undefined,1,intent))setNotice('当前对话输入框正在变化，请稍后重试。');
      }catch{setNotice('无法读取这个文件，请刷新后重试。');}
    };
    const tagPanel = filtering && h('div', { className: 'nv-bar', style: { flexWrap: 'wrap', padding: '8px 16px', gap: 8 }, 'aria-label': '图谱标签' },
      groups.length
        ? groups.map(group => h('div', { key: group.tag, className: 'nv-tag-group' },
            h('label', { style: STYLE.notice },
              h('input', { type: 'checkbox', 'aria-label': '标签 ' + group.tag, checked: tags.includes(group.tag), onChange: event => setTags(prev => event.target.checked ? [...prev, group.tag] : prev.filter(item => item !== group.tag)) }),
              ' #' + group.tag),
            h('button', { 'aria-label': `${openGroup === group.tag ? '收起' : '展开'}标签组 ${group.tag}`, 'aria-expanded': openGroup === group.tag, onClick: () => setOpenGroup(openGroup === group.tag ? '' : group.tag) }, `${group.count} 个文件`),
            openGroup === group.tag && h('div', { className: 'nv-tag-members' },
              btn(tags.length === 1 && tags[0] === group.tag ? '已在筛选中' : '只看这一组', () => setTags([group.tag]), { 'aria-label': `只看标签组 ${group.tag}` }),
              group.paths.map(path => h('button', { key: path, style: { ...STYLE.link, fontSize: 12 }, 'aria-label': `聚焦 ${path}`, onClick: () => select(path) }, titles.get(path) ?? path)))))
        : h('span', { style: STYLE.notice }, '文件还没有标签。'),
      tags.length > 0 && btn('清除筛选', () => setTags([])));
    const tools=h(React.Fragment,null,
      focus&&btn('全局图谱',()=>setFocus('')),
      focus&&h('span',{style:STYLE.notice},graph.nodes.find(item=>item.path===focus)?.title ?? '中心'),
      focus&&h('select',{'aria-label':'关联深度',style:{...STYLE.templateInput,width:86,margin:0},value:hops,onChange:event=>setHops(Number(event.target.value))},h('option',{value:1},'1 跳关系'),h('option',{value:2},'2 跳关系')),
      h(IconButton,{icon:'filter',label:'标签筛选','aria-pressed':filtering||tags.length>0,onClick:()=>setFiltering(value=>!value)}),
      tags.length>0&&h('span',{style:STYLE.notice},tags.map(tag=>'#'+tag).join(' ')));
    return h(Frame,{title:'图谱',tools,status:notice||error||(loading?'正在读取…':`${filtered.nodes.length} 个文件 · ${filtered.edges.length} 条关系`)},
      tagPanel,
      h('div',{ref:root,className:'nv-graph-layout','data-detail':!!node&&detailsOpen,style:{'--nv-pane-width':paneWidth+'px',position:'relative'},onPointerDown:event=>{if(event.button===0&&!event.ctrlKey&&!event.target.closest('[role="menu"]'))setMenu(null);},onKeyDown:event=>{if(event.key==='Escape')setMenu(null);}},
        !loading&&!error&&!graph.nodes.length?h('div',{style:STYLE.empty},'还没有文件。在资产页导入资料或创建页面。'):
          !filtered.nodes.length&&!loading?h('div',{style:STYLE.empty},'没有符合条件的文件。'):
          h(Board,{nodes:canvasNodes,edges:filtered.edges,focus,centerVersion,selected,state,onSelect:item=>select(item.key),onOpen:item=>open(item.node),onContext:(item,event)=>{clearTimeout(detailTimer.current);const bounds=root.current.getBoundingClientRect();setMenu({path:item.key,x:Math.max(0,Math.min(event.clientX-bounds.left,bounds.width-230)),y:Math.max(0,Math.min(event.clientY-bounds.top,bounds.height-200))});}}),
        node&&detailsOpen&&h(React.Fragment,null,
          h('div',{className:'nv-resize',role:'separator','aria-label':'调整详情宽度','aria-orientation':'vertical','aria-valuenow':paneWidth,tabIndex:0,onKeyDown:event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();setPaneWidth(width=>Math.max(240,Math.min(800,width+(event.key==='ArrowLeft'?20:-20))));}},onPointerDown:event=>{resize.current={x:event.clientX,width:paneWidth};event.currentTarget.setPointerCapture(event.pointerId);},onPointerMove:event=>{if(resize.current)setPaneWidth(Math.max(240,Math.min(root.current.clientWidth-200,resize.current.width+resize.current.x-event.clientX)));},onPointerUp:event=>{resize.current=null;event.currentTarget.releasePointerCapture(event.pointerId);},onPointerCancel:()=>{resize.current=null;}}),
          h('aside',{className:'nv-graph-pane','aria-label':'节点详情'},
            h('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between'}},h('span',{style:STYLE.notice},[roleLabelOf(node),cardKind].filter(Boolean).join(' · ')),h(IconButton,{icon:'close',label:'关闭详情',onClick:()=>{setSelected('');setDetailsOpen(false);setMenu(null);}})),
            h('h2',null,node.title),h('p',{style:STYLE.path},node.path),
            h('div',{style:{display:'flex',gap:4,marginBottom:20}},
              h(IconButton,{icon:'book',label:'打开文件',onClick:()=>open(node)}),
              h(IconButton,{icon:'target',label:'以此为中心',onClick:()=>center(node)}),
              h(IconButton,{icon:'chat',label:'带入对话拆分',onClick:()=>bring(node)})),
            (materialNode||materials.length>0)&&h(React.Fragment,{key:'materials'},h('h3',{style:{fontSize:13,margin:'20px 0 10px'}},`子资料 ${materials.length}`),
              materials.length?h('ul',{style:{listStyle:'none',margin:0,padding:0}},materials.map(child=>h('li',{key:child.path},h('button',{style:{...STYLE.row,padding:'9px 0'},onClick:()=>select(child.path)},child.title)))):
                h('p',{style:STYLE.notice},'暂无子资料')),
            h('h3',{style:{fontSize:13,margin:'20px 0 10px'}},`子卡片 ${children.length}`),
            children.length?h('ul',{style:{listStyle:'none',margin:0,padding:0}},children.map(child=>h('li',{key:child.path},h('button',{style:{...STYLE.row,padding:'9px 0'},onClick:()=>select(child.path)},child.title)))):
              h('p',{style:STYLE.notice},'暂无子卡片'),
            node.parent&&h('p',{style:STYLE.notice},`${parentLabelOf(graph,node.parent)}：`,h('button',{style:STYLE.link,onClick:()=>select(node.parent)},titles.get(node.parent)??node.parent)),
            node.tags.length>0&&h('div',{className:'nv-graph-tags',role:'group','aria-label':'节点标签'},node.tags.map(tag=>h('button',{key:tag,type:'button',className:'nv-graph-tag','aria-pressed':tags.length===1&&tags[0]===tag,onClick:()=>setTags([tag])},h('span',{className:'nv-graph-tag-hash'},'#'),h('span',null,tag)))),
            node.sources.length>0&&h('details',{style:{fontSize:12,marginTop:24}},h('summary',{style:{cursor:'pointer',color:'var(--dsw-alias-label-secondary)'}},'来源'),
              node.sources.map((source,index)=>h('p',{key:index},h('button',{style:STYLE.link,'aria-label':'跳回原文 '+sourceLabel(source),onClick:()=>props.openView(VIEW_IDS.assets,focusFor(source.path,source.locator))},sourceLabel(source))))))),
        menu&&menuNode&&h('div',{className:'nv-menu',role:'menu',style:{left:menu.x,top:menu.y}},
          btn('以此为中心',()=>center(menuNode),{role:'menuitem'}),
          btn('带入对话拆分',()=>bring(menuNode),{role:'menuitem'}),
          btn('在资产页中定位',()=>{setMenu(null);open(menuNode);},{role:'menuitem'}),
          btn('查看原始资产详情',()=>{setMenu(null);props.openView(VIEW_IDS.assets,menuNode.sources[0]?focusFor(menuNode.sources[0].path,menuNode.sources[0].locator):menuNode.parent??menuNode.path);},{role:'menuitem'}),
          btn('移到回收站',()=>{setMenu(null);void fileActions.requestDelete(menuNode.path);},{role:'menuitem'}))),
      fileActions.dialog,
      h('details',{style:{padding:'6px 16px',fontSize:11,color:'var(--dsw-alias-label-secondary)'}},h('summary',{style:{cursor:'pointer'}},'图例'),h('div',{className:'nv-legend'},Object.entries(KNOWLEDGE_ROLES).map(([role,label])=>h('span',{key:role},h('svg',{width:24,height:26,viewBox:'-20 -20 40 40','aria-hidden':true},h(NodeMark,{role})),label)),h('span',{key:'material'},h('svg',{width:24,height:26,viewBox:'-20 -20 40 40','aria-hidden':true},h(NodeMark,{role:'root'})),'源目录 / 教学专题'),h('span',null,'— 拆分'),h('span',null,'┄ 引用'))));
  }
  return {GraphView,CardsView};
}
