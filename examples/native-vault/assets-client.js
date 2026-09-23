import { buildMarkdownCardContent, markdownSections } from './graph.js';
import { buildPdfCardContent, cardPathFor } from './pdf.js';
import { embedTarget, parseMediaTarget } from './media.js';
import { VIEW_IDS } from './views-client.js';
import { createVaultClient } from './remote-client.js';
import { createDraftStore } from './draft-client.js';
import { createFileActions } from './file-actions-client.js';
export function createVaultAssets(React,{STYLE,CodeMirrorMarkdown,PdfReader,AssetPreview,insertVaultReference,IconButton,Menu,Dialog}) {
const {useState,useEffect,useMemo,useCallback,useRef}=React, h=React.createElement;
const buttonStyle=active=>({...STYLE.row,...(active?STYLE.rowActive:{})});
const useFileActions=createFileActions(React,{STYLE,Dialog});
    function Tree({ node, selected, onSelect, onContext, depth = 0 }) {
      return React.createElement(React.Fragment, null, node.children.map(child => child.path
        ? React.createElement('button', { key: child.path, style: { ...buttonStyle(child.path === selected), paddingLeft: 10 + depth * 12 }, onContextMenu: event => { event.preventDefault(); onContext(child.path); }, onClick: () => onSelect(child.path) }, `${child.kind === 'asset' ? '▧ ' : ''}${child.name}`)
        : React.createElement('details', { key: `${depth}:${child.name}`, open: true },
          React.createElement('summary', { style: { ...STYLE.treeFolder, paddingLeft: 10 + depth * 12 } }, child.name),
          React.createElement(Tree, { node: child, selected, onSelect, onContext, depth: depth + 1 }),
        )),
      );
    }

    const drafts = createDraftStore('asset-draft');
    function App({ ctx, sessionId, visible, openView, viewRequest, completeViewRequest }) {
      // ctx.remote.* returns a fresh proxy per access; pin it once or every
      // render would re-fire the effects and loops that take it as a dep.
      // The whole page — files, templates, embeds, PDF cards — stays in this
      // session's workspace, the same root the model writes to.
      const vault = useMemo(() => createVaultClient(ctx, sessionId), [ctx, sessionId]);
      const fileActions=useFileActions(vault);
      const [files, setFiles] = useState([]);
      const [tree, setTree] = useState({ name: '', children: [] });
      const [selected, setSelected] = useState(drafts.get(sessionId)?.path ?? (viewRequest?.focus ? parseMediaTarget(viewRequest.focus).path : ''));
      const [anchor, setAnchor] = useState('');
      const [sidebar, setSidebar] = useState(false), [searching, setSearching] = useState(false), [creating, setCreating] = useState(false);
      const [extracting, setExtracting] = useState(false), [extractTitle, setExtractTitle] = useState(''), [extractQuote, setExtractQuote] = useState(''), [section, setSection] = useState('');
      const [assetLocator, setAssetLocator] = useState(null), [contextPath, setContextPath] = useState(null);
      const [busy, setBusy] = useState(false);
      const [document, setDocument] = useState(undefined);
      const [asset, setAsset] = useState(undefined);
      const [assetPage, setAssetPage] = useState(1);
      const [pdfSelection, setPdfSelection] = useState(undefined);
      const [draft, setDraft] = useState('');
      const [selection, setSelection] = useState('');
      const [dirty, setDirty] = useState(false);
      const [saving, setSaving] = useState(false);
      const [backlinks, setBacklinks] = useState([]);
      const [templates, setTemplates] = useState([]);
      const [query, setQuery] = useState('');
      const [hits, setHits] = useState([]);
      const [notice, setNotice] = useState('正在读取…');
      const [error, setError] = useState('');
      const [templatePath, setTemplatePath] = useState('');
      const [newPath, setNewPath] = useState('路线/新页面.md');
      const [newTitle, setNewTitle] = useState('新页面');
      const [embeddedAssets, setEmbeddedAssets] = useState({});
      const uploadRef = useRef(null);
      const pdfCardSaving = useRef(false);
      const openSequence = useRef(0);
      useEffect(() => {
        if (dirty && document) drafts.set(sessionId, { path: document.path, document, draft });
        else if (document && drafts.get(sessionId)?.path === document.path) drafts.delete(sessionId);
      }, [dirty, document, draft, sessionId]);

      const refresh = useCallback(async (preferred) => {
        let result;
        try { result = await vault.list({}); }
        catch { setNotice('文件树暂时无法读取。'); return false; }
        if (!result?.ok) { setNotice('文件树暂时无法读取。'); return false; }
        setFiles(result.value.files); setTree(result.value.tree);
        setSelected(previous => preferred || previous || result.value.files[0]?.path || '');
        setNotice('');
        return true;
      }, [selected, vault]);

      // Tracks the path `open()` last displayed so the `selected` effect below
      // does not re-open (and wipe notices) after a programmatic open.
      const openedRef = useRef('');
      const open = useCallback(async (path, notice, locator) => {
        if (!path) return;
        setError('');
        const sequence = ++openSequence.current;
        let read;
        try { read = await vault.read({ path }); } catch { read = undefined; }
        if (read?.ok) {
          let links;
          try { links = await vault.links({ path }); } catch { links = undefined; }
          if (sequence !== openSequence.current) return;
          openedRef.current = path;
          setExtracting(false);
          const retained = drafts.get(sessionId), restored = retained?.path === path ? retained : undefined;
          setSelected(path); setDocument(restored?.document ?? read.value); setAsset(undefined); setPdfSelection(undefined); setDraft(restored?.draft ?? read.value.content); setSelection(''); setDirty(!!restored); setBacklinks(links?.ok ? links.value.incoming : []); setNotice(restored ? '已恢复未保存修改' : notice ?? '');
          return;
        }
        let media;
        try { media = await vault.readAsset({ path }); }
        catch { media = undefined; }
        if (!media?.ok) {
          if (sequence !== openSequence.current) return;
          openedRef.current = path; setSelected(path); setDocument(undefined); setAsset(undefined); setNotice('');
          setError('无法打开这个文件，可能已被移动或删除。'); return;
        }
        if (sequence !== openSequence.current) return;
        openedRef.current = path;
        setExtracting(false);
        setSelected(path); setDocument(undefined); setAsset(media.value); setAssetPage(locator?.page ?? 1); setAssetLocator(locator); setPdfSelection(undefined); setDraft(''); setSelection(''); setDirty(false); setBacklinks([]); setNotice(notice ?? '');
      }, [vault, sessionId]);

      useEffect(() => {
        if (!viewRequest?.focus) return;
        const target = parseMediaTarget(viewRequest.focus);
        if (dirty || (drafts.has(sessionId) && drafts.get(sessionId).path !== target.path)) { setNotice('当前页面有未保存修改，请先保存或放弃。'); completeViewRequest(); return; }
        setAnchor(target.locator?.anchor ?? '');
        void open(target.path, target.invalidLocator ? '引用位置无效，已打开原文件，请核对页码或区域。' : undefined, target.locator);
        completeViewRequest();
      }, [viewRequest]);

      useEffect(()=>{
        const before=event=>{if(event.detail?.sessionId===vault.sessionId&&event.detail.path===document?.path&&dirty)event.preventDefault();};
        const changed=event=>{
          if(event.detail?.sessionId!==vault.sessionId)return;
          if(event.detail.action==='trashed'&&event.detail.path===selected){
            ++openSequence.current;openedRef.current='';setSelected('');setDocument(undefined);setAsset(undefined);setDraft('');setDirty(false);setPdfSelection(undefined);setSelection('');setBacklinks([]);
          }
          void refresh();
        };
        window.addEventListener('notara-vault-before-trash',before);window.addEventListener('notara-vault-files-changed',changed);
        return()=>{window.removeEventListener('notara-vault-before-trash',before);window.removeEventListener('notara-vault-files-changed',changed);};
      },[vault,selected,document?.path,dirty,refresh]);

      useEffect(() => {
        let live = true, attempts = 0;
        const tick = async () => {
          attempts += 1;
          const ok = await refresh();
          if (!ok && live && attempts < 20) setTimeout(tick, 1200);
        };
        void tick();
        return () => { live = false; };
      }, []);
      useEffect(() => { if (!viewRequest?.focus && selected && selected !== openedRef.current) void open(selected); }, [selected]);
      useEffect(() => { void vault.templates({}).then(result => { if (result.ok) { setTemplates(result.value); if (!templatePath) setTemplatePath(result.value[0]?.path || ''); } }); }, []);
      const embedPaths = JSON.stringify([...new Set([...draft.matchAll(/!\[\[([^\]]+)\]\]/g)].map(match => parseMediaTarget(match[1]).path))]);
      useEffect(() => {
        if (!document) { setEmbeddedAssets({}); return undefined; }
        let live = true;
        const targets = [...draft.matchAll(/!\[\[([^\]]+)\]\]/g)].map(match => parseMediaTarget(match[1]).path);
        const unique = [...new Set(targets)];
        void Promise.all(unique.filter(path => !path.toLowerCase().endsWith('.md')).map(async path => { try { return [path, await vault.readAsset({ path })]; } catch { return [path, null]; } })).then(rows => {
          if (!live) return;
          const next = {};
          for (const [path, result] of rows) if (result?.ok) next[path] = result.value;
          setEmbeddedAssets(next);
        });
        return () => { live = false; };
      }, [document?.path, document?.revision, embedPaths, vault]);
      useEffect(() => {
        if (!visible || !selected || (!document && !asset)) return undefined;
        let live = true, checking = false;
        const syncExternal = async () => {
          if (checking) return;
          checking = true;
          try {
            const result = await vault.list({});
            if (!live || !result.ok) return;
            setFiles(result.value.files); setTree(result.value.tree);
            const summary = result.value.files.find(item => item.path === selected);
            if(!summary){
              if(dirty){setNotice('文件已被移走，未保存修改仍保留在编辑器中。');return;}
              ++openSequence.current;openedRef.current='';setSelected('');setDocument(undefined);setAsset(undefined);setPdfSelection(undefined);setDraft('');setSelection('');setBacklinks([]);return;
            }
            if (asset && summary?.revision !== asset.revision) {
              const media = await vault.readAsset({ path: selected });
              if (live && media.ok) { setAsset(media.value); setPdfSelection(undefined); setNotice('媒体文件已从文件刷新'); }
              return;
            }
            if (asset) return;
            if (!summary || summary.revision === document.revision) return;
            if (dirty) { setNotice('当前页面在外部发生变化，请先保存或放弃本地修改。'); return; }
            const [read, links] = await Promise.all([vault.read({ path: selected }), vault.links({ path: selected })]);
            if (!live || !read.ok) return;
            setDocument(read.value); setDraft(read.value.content); setSelection(''); setBacklinks(links.ok ? links.value.incoming : []); setNotice('页面已从文件刷新');
          } catch { if (live) setNotice('暂时无法刷新文件，请稍后重试。'); }
          finally { checking = false; }
        };
        void syncExternal();
        const timer = setInterval(syncExternal, 2500);
        const onFocus = () => { void syncExternal(); };
        window.addEventListener('focus', onFocus);
        window.addEventListener('visibilitychange', onFocus);
        return () => { live = false; clearInterval(timer); window.removeEventListener('focus', onFocus); window.removeEventListener('visibilitychange', onFocus); };
      }, [visible, selected, document?.path, document?.revision, asset?.path, asset?.revision, dirty, vault]);

      const shownFiles = useMemo(() => query.trim() ? hits : files, [files, hits, query]);
      const selectPage = path => {
        if (!path || path === selected) return;
        if (dirty) { setNotice('当前页面有未保存修改，请先保存或放弃。'); return; }
        if (!files.some(file => file.path === path)) { setNotice(`还没有这个页面：${path}`); return; }
        setQuery(''); setHits([]); setAnchor(''); setSelected(path);
      };
      const runSearch = async value => {
        setQuery(value);
        if (!value.trim()) { setHits([]); return; }
        const result = await vault.search({ query: value, limit: 50 });
        if (result.ok) setHits(result.value);
      };
      const save = async () => {
        if (!document || !dirty || saving) return;
        setSaving(true);
        try {
          const result = await vault.save({ path: document.path, content: draft, expectedRevision: document.revision });
          if (result.ok) {
            setDocument(result.value); setDraft(result.value.content); setDirty(false); setNotice('已保存');
            await refresh(result.value.path);
          } else setNotice('页面已经被别人改过，请刷新后决定保留哪一版。');
        } catch { setNotice('保存失败，当前修改仍保留在页面中。'); }
        setSaving(false);
      };
      const discard = () => { if (document) { setDraft(document.content); setDirty(false); setNotice('已放弃未保存修改'); } };
      const pdfLocator = value => value ? { kind: 'pdf-region', page: value.page, rect: value.rect } : { kind: 'pdf-page', page: assetPage };
      const bringIntoConversation = (assetSelection, selectedText = '') => {
        if (asset) {
          const locator = asset.assetKind === 'pdf' ? pdfLocator(assetSelection || pdfSelection) : undefined;
          const quote = assetSelection?.quote || pdfSelection?.quote;
          const pin = { kind: 'asset', sessionId, path: asset.path, revision: asset.revision, title: asset.title, ...(locator ? { locator } : {}), ...(quote ? { selection: quote } : {}) };
          if (!insertVaultReference(ctx, sessionId, pin, openView)) { setNotice('当前对话输入框正在变化，请稍后重试。'); return; }
          setNotice('已将媒体文件带入对话');
          return;
        }
        if (!document) return;
        if (dirty) { setNotice('请先保存或放弃当前修改，再带入对话。'); return; }
        const pin = { sessionId, path: document.path, revision: document.revision, title: document.title, ...(selectedText ? { selection: selectedText } : {}) };
        if (!insertVaultReference(ctx, sessionId, pin, openView)) { setNotice('当前对话输入框正在变化，请稍后重试。'); return; }
        setNotice(selectedText ? '已将所选内容带入对话' : '已将当前页面带入对话');
      };
      const copyAssetEmbed = async selectionValue => {
        if (!asset) return;
        const chosen=selectionValue||pdfSelection;
        const locator = asset.assetKind === 'pdf' ? {...pdfLocator(chosen),...(chosen?.annotationId?{annotationId:chosen.annotationId}:{}),revision:asset.revision} : undefined;
        const text = embedTarget(asset.path, locator);
        try { await navigator.clipboard.writeText(text); } catch {
          const area = window.document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; window.document.body.append(area); area.select(); window.document.execCommand('copy'); area.remove();
        }
        setNotice(`已复制：${text}`);
      };
      const createPdfCard = async value => {
        if (!asset || asset.assetKind !== 'pdf' || !value || pdfCardSaving.current) return;
        pdfCardSaving.current=true;setBusy(true);
        try {
        let pool = templates;
        if (!pool.length) {
          try {
            const listed = await vault.templates({});
            if (listed.ok) { pool = listed.value; setTemplates(listed.value); }
          } catch { /* fall through to the not-found notice */ }
        }
        const template = pool.find(item => item.type === 'card') || pool.find(item => item.path === 'card.md');
        if (!template) { setNotice('找不到知识卡片模板。'); return; }
        const title = value.title?.trim() || `${asset.title} · 第 ${value.page} 页`, path = cardPathFor(title);
        const content = buildPdfCardContent(template.content, { title, date: new Date().toISOString().slice(0, 10), source: asset.path, revision: asset.revision, page: value.page, rect: value.rect, annotationId: value.annotationId, note: value.note });
        try {
          const result = await vault.save({ path, content, expectedRevision: null });
          if (!result.ok) { setNotice(`卡片保存失败：${path} 已经存在。`); return; }
          // refresh() without a preferred path keeps `selected` untouched so the
          // effect can't race a notice-less open against ours; open() then runs
          // once with the confirmation notice.
          window.dispatchEvent(new Event('notara-vault-changed'));await refresh(); await open(result.value.path, `已创建区域引用卡片：${path}`);
        } catch { setNotice('卡片保存失败，当前 PDF 仍然保留。'); }
        } finally {pdfCardSaving.current=false;setBusy(false);}
      };
      const upload = async event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        try {
          const bytes = new Uint8Array(await file.arrayBuffer()), parts = [];
          for (let index = 0; index < bytes.length; index += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)));
          const dataBase64 = btoa(parts.join('')), path = `媒体/${file.name}`;
          const result = await vault.saveAsset({ path, dataBase64, mime: file.type || 'application/octet-stream', expectedRevision: null });
          if (!result.ok) { setNotice('媒体文件保存失败：目标文件可能已经存在。'); return; }
          await refresh(path); setSelected(path); setNotice('媒体文件已保存');
        } catch { setNotice('媒体文件保存失败，文件可能过大或格式不受支持。'); }
      };
      const create = async event => {
        event.preventDefault();
        if (dirty) { setNotice('当前页面有未保存修改，请先保存或放弃。'); return; }
        if (!templatePath || !newPath.trim()) return;
        const result = await vault.createFromTemplate({ templatePath, path: newPath.trim(), values: { title: newTitle.trim() || '新页面', date: new Date().toISOString().slice(0, 10) }, expectedRevision: null });
        if (result.ok) { setCreating(false); setNewPath('路线/新页面.md'); await refresh(result.value.path); setSelected(result.value.path); }
        else setNotice('创建失败：目标页面可能已经存在。');
      };
      const selectFromResult = path => selectPage(path);
      const sections = useMemo(() => document ? markdownSections(document.content) : [], [document?.content]);
      const startExtract = () => {
        const found = sections.find(item => item.anchor === anchor) ?? sections[0];
        setSection(found?.anchor ?? ''); setExtractQuote(selection || found?.content || '');
        setExtractTitle(`${document?.title ?? ''} · ${found?.anchor || '摘录'}`); setExtracting(value => !value);
      };
      const saveExtract = async () => {
        if (busy || dirty || !document) return; setBusy(true);
        try {
          const template = templates.find(item => item.type === 'card');
          if (!template) throw new Error('template');
          const content = buildMarkdownCardContent({ template: template.content, title: extractTitle, source: document.path, anchor: section, quote: extractQuote, ...(document.type === 'card' ? {parent: document.path} : {}) });
          const path = cardPathFor(extractTitle), result = await vault.save({path, content, expectedRevision:null});
          if (!result.ok) throw new Error('save');
          window.dispatchEvent(new Event('notara-vault-changed')); await refresh(); setNotice(`已提取为 Markdown 卡片：${path}`);
        } catch { setNotice('卡片保存失败，请检查标题是否重复后重试。'); }
        finally { setBusy(false); }
      };
      useEffect(() => {
        const handler = event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='s' && event.target.closest('.nv-assets')) { event.preventDefault(); void save(); } };
        window.addEventListener('keydown',handler); return()=>window.removeEventListener('keydown',handler);
      },[save]);
      const current=document ?? asset;
      const menuItems=[
        {label:'刷新',run:()=>{void refresh(selected);void open(selected);}},
        document && {label:'放弃修改',disabled:!dirty,run:discard},
        document && {label:'带入所选内容',disabled:dirty || !selection.trim(),run:()=>bringIntoConversation(undefined,selection)},
        {label:'在图谱中查看',run:()=>openView(VIEW_IDS.graph,selected)},
        document?.type==='card' && {label:'查看复习安排',disabled:dirty,run:()=>openView(VIEW_IDS.calendar,selected)},
        asset && {label:'复制嵌入标记',run:()=>copyAssetEmbed()},
        current && {label:'移到回收站',disabled:dirty,run:()=>fileActions.requestDelete(current.path)},
        {label:'回收站',run:fileActions.showTrash},
      ];


      return h('div',{className:'nv-assets',style:STYLE.page},
        h('div',{className:'nv-bar'},
          h(IconButton,{icon:'sidebar',label:sidebar?'收起文件栏':'展开文件栏',onClick:()=>setSidebar(v=>!v)}),
          h(IconButton,{icon:'plus',label:'新建页面',onClick:()=>setCreating(true)}),
          h(IconButton,{icon:'search',label:'搜索文件',onClick:()=>{setSidebar(true);setSearching(v=>!v);}}),
          h('span',{className:'nv-breadcrumb',title:current?.path},current?.path ?? '资产'),
          document && dirty && h(IconButton,{icon:'save',label:saving?'保存中…':'保存',disabled:saving,onClick:save}),
          document && h(IconButton,{icon:'extract',label:'打开摘录工具',disabled:dirty,'aria-pressed':extracting,onClick:startExtract}),
          current && h(IconButton,{icon:'chat',label:'带入对话',disabled:dirty,onClick:()=>bringIntoConversation()}),
          h(Menu,{label:'文件操作',items:menuItems}),
        ),
        notice && h('div',{className:'nv-notice',role:'status'},notice),
        error && h('div',{className:'nv-notice',role:'alert'},error),
        h('input',{ref:uploadRef,type:'file',style:{display:'none'},onChange:upload}),
        h('div',{className:'nv-asset-body'},
          sidebar && h('aside',{className:'nv-file-rail','aria-label':'文件列表'},
            h('div',{className:'nv-bar'},h('span',{className:'nv-breadcrumb'},'文件'),
              h(IconButton,{icon:'upload',label:'导入媒体文件',onClick:()=>uploadRef.current?.click()}),
              h(Menu,{label:'文件列表操作',items:[{label:'从模板新建',run:()=>setCreating(true)},{label:'刷新文件列表',run:()=>refresh()},{label:'回收站',run:fileActions.showTrash}]})),
            searching && h('input',{style:{...STYLE.search,margin:'8px',width:'calc(100% - 16px)'},autoFocus:true,placeholder:'搜索标题、内容或路径…',value:query,onChange:event=>runSearch(event.target.value)}),
            query.trim()?shownFiles.map(item=>h('button',{key:item.path,style:buttonStyle(item.path===selected),onClick:()=>selectFromResult(item.path)},item.path)):
              h(Tree,{node:tree,selected,onSelect:selectPage,onContext:setContextPath})),
          h('main',{className:'nv-document'+(asset?.assetKind==='pdf'?' nv-document-pdf':'')},current?h('article',null,
            document ? h(React.Fragment,null,
              h(CodeMirrorMarkdown,{key:`${document.path}:${Object.values(embeddedAssets).map(item=>item.revision).join(',')}`,content:draft,assets:embeddedAssets,anchor,onChange:value=>{setDraft(value);setDirty(value!==document.content.replace(/\r\n?/g,'\n'));setNotice('');},onSelectionChange:setSelection,onTag:tag=>openView(VIEW_IDS.graph,'tag:'+encodeURIComponent(tag)),onOpenPage:path=>{const target=parseMediaTarget(path);if(target.locator||target.invalidLocator)openView(VIEW_IDS.assets,path);else selectPage(target.path);}}),
              extracting && h('section',{className:'nv-extract','aria-label':'摘录工具'},
                h('label',null,'摘录段落',h('select',{'aria-label':'摘录段落',style:STYLE.templateInput,value:section,onChange:event=>{const next=sections.find(item=>item.anchor===event.target.value);setSection(next.anchor);setAnchor(next.anchor);setExtractQuote(next.content);setExtractTitle(`${document.title} · ${next.anchor}`);}},sections.map(item=>h('option',{key:item.anchor,value:item.anchor},item.anchor)))),
                h('label',null,'摘录内容',h('textarea',{'aria-label':'摘录内容',style:STYLE.templateInput,value:extractQuote,onChange:event=>setExtractQuote(event.target.value)})),
                h('label',null,'卡片标题',h('input',{'aria-label':'卡片标题',style:STYLE.templateInput,value:extractTitle,onChange:event=>setExtractTitle(event.target.value)})),
                h('button',{style:STYLE.quiet,disabled:busy||dirty||!extractTitle.trim()||!extractQuote.trim(),onClick:saveExtract},'提取段落为卡片')),
              (document.links.length>0||backlinks.length>0) && h('details',{style:{marginTop:28,fontSize:12}},h('summary',{style:{cursor:'pointer',color:'var(--dsw-alias-label-secondary)'}},'相关链接'),
                h('section',{style:STYLE.links},document.links.map(path=>h('button',{key:'out:'+path,style:STYLE.link,onClick:()=>selectFromResult(path)},'→ '+path)),backlinks.map(path=>h('button',{key:'in:'+path,style:STYLE.link,onClick:()=>selectFromResult(path)},'← '+path))))) :
            asset.assetKind==='pdf'?h(PdfReader,{key:asset.path+JSON.stringify(assetLocator),vault,asset,page:assetPage,initialRegion:assetLocator?.kind==='pdf-region'?assetLocator:undefined,onPage:setAssetPage,onSelectionChange:setPdfSelection,onCopyEmbed:copyAssetEmbed,onBring:bringIntoConversation,onCreateCard:createPdfCard,busy}):
              h(AssetPreview,{asset,onCopyEmbed:copyAssetEmbed,onBring:bringIntoConversation})
          ):h('div',{style:STYLE.empty},files.length?'选择一个文件':'还没有文件。点击 + 新建页面。'))),
        creating && h(Dialog,{title:'从模板新建',onClose:()=>setCreating(false)},
          h('form',{onSubmit:create},
            h('label',null,'模板',h('select',{'aria-label':'模板',style:STYLE.templateInput,value:templatePath,onChange:event=>setTemplatePath(event.target.value)},templates.map(item=>h('option',{key:item.path,value:item.path},item.title||item.path)))),
            h('label',null,'页面标题',h('input',{'aria-label':'页面标题',style:STYLE.templateInput,value:newTitle,onChange:event=>setNewTitle(event.target.value)})),
            h('label',null,'目标路径',h('input',{'aria-label':'目标路径',style:STYLE.templateInput,value:newPath,onChange:event=>setNewPath(event.target.value)})),
            h('button',{type:'submit',style:STYLE.quiet,disabled:!templates.length||dirty},'创建 Markdown 页面'))),
        contextPath && h(Dialog,{title:contextPath.split('/').pop(),onClose:()=>setContextPath(null)},
          h('div',{style:{display:'grid',gap:8,marginTop:16}},[
            ['打开文件',()=>selectPage(contextPath)],['在图谱中查看',()=>openView(VIEW_IDS.graph,contextPath)],['从模板新建',()=>setCreating(true)],['移到回收站',()=>fileActions.requestDelete(contextPath)]
          ].map(([label,run])=>h('button',{key:label,style:STYLE.quiet,onClick:()=>{run();setContextPath(null);}},label)))),
        fileActions.dialog
      );
    }
return App;
}
