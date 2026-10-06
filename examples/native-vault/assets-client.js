import { buildMarkdownCardContent, markdownSections } from './graph.js';
import { buildPdfCardContent, cardPathFor } from './pdf.js';
import { embedTarget, isCodePath, mediaForPath, parseMediaTarget, PDF_FILE_LIMIT_NOTICE } from './media.js';
import { VIEW_IDS } from './views-client.js';
import { createVaultClient, visibleInterval } from './remote-client.js';
import { createDraftStore } from './draft-client.js';
import { createFileActions } from './file-actions-client.js';
import { createFileTree } from './file-tree-client.js';
import { announceSkillsChanged } from './skills-client.js';
import { parseBoard } from './board-data.js';
import { exportBoard } from './board-render.js';
import { mathStyleText } from './math-latex.js';

const USER_SKILL_DIRECTORY = '技能';
export function assetFailureNotice(error){
  return `${error?.code??''} ${error?.message??''}`.includes('vault_pdf_too_large')?PDF_FILE_LIMIT_NOTICE:'无法打开这个文件，可能已被移动或删除。';
}
/** Why a page did not save, in the student's words; the Host's reason code decides. */
export function saveFailureNotice(error) {
  const reason = `${error?.code ?? ''} ${error?.message ?? ''}`;
  if (reason.includes('vault_frontmatter_invalid')) return '页头（开头两行 --- 之间的属性）格式不对，这一页没有保存。每行写成“名称: 值”，列表写成 [甲, 乙] 或逐行“- 甲”，改好后再保存。';
  if (reason.includes('vault_revision_conflict')) return '页面已经被别人改过，请刷新后决定保留哪一版。';
  return '保存失败，当前修改仍保留在页面中。';
}

/** Why a new file was not created, in the student's words. */
export function createFailureNotice(error, what = '页面') {
  const reason = `${error?.code ?? ''} ${error?.message ?? ''}`;
  if (reason.includes('vault_path_not_portable')) return '没有创建：文件名里不能有 < > : " | ? *，不能以点或空格结尾，也不能叫 CON、NUL 这类系统保留的名字。换个名字再试。';
  if (reason.includes('vault_revision_conflict')) return `没有创建：同名的${what}已经存在。`;
  if (reason.includes('vault_path_invalid')) return `没有创建：这个位置不能放${what}，例如以点开头的文件夹。`;
  return `没有创建${what}，请检查名字后再试。`;
}

export function createVaultAssets(React,{STYLE,EmptyState,CodeMirrorMarkdown,CodeEditor,PdfReader,AssetPreview,insertVaultReference,IconButton,Menu,Dialog,ensureSession,openLessonBoard=()=>{}}) {
const {useState,useEffect,useMemo,useCallback,useRef}=React, h=React.createElement;
const buttonStyle=active=>({...STYLE.row,...(active?STYLE.rowActive:{})});
const useFileActions=createFileActions(React,{STYLE,Dialog});
    const Tree = createFileTree(React, { STYLE });

    const drafts = createDraftStore('asset-draft');
    function App({ ctx, sessionId, visible, global = false, openView, viewRequest, completeViewRequest, onSelectedChange }) {
      // ctx.remote.* returns a fresh proxy per access; pin it once or every
      // render would re-fire the effects and loops that take it as a dep.
      // The whole page — files, templates, embeds, PDF cards — stays in this
      // session's workspace, the same root the model writes to.
      const vault = useMemo(() => createVaultClient(ctx, sessionId), [ctx, sessionId]);
      const fileActions=useFileActions(vault);
      const [files, setFiles] = useState([]);
      // Whether the file list has been read: an empty library is only claimed after a successful read.
      const [listing, setListing] = useState('loading');
      const [tree, setTree] = useState({ name: '', children: [] });
      const [selected, setSelected] = useState(drafts.get(sessionId)?.path ?? (viewRequest?.focus ? parseMediaTarget(viewRequest.focus).path : ''));
      const [anchor, setAnchor] = useState('');
      const [sidebar, setSidebar] = useState(false), [searching, setSearching] = useState(false), [creating, setCreating] = useState(false);
      // In the Vault section the panel holds the file tree; the page keeps its own only beside a lesson.
      useEffect(()=>{setSidebar(false);},[global]);
      useEffect(()=>{if(global)onSelectedChange?.(selected);},[global,selected]);
      const [extracting, setExtracting] = useState(false), [extractTitle, setExtractTitle] = useState(''), [extractQuote, setExtractQuote] = useState(''), [section, setSection] = useState('');
      const [assetLocator, setAssetLocator] = useState(null), [contextMenu, setContextMenu] = useState(null);
      useEffect(() => {
        if (!contextMenu) return undefined;
        const close = event => { if (!event.target.closest?.('.nv-context-menu')) setContextMenu(null); };
        const key = event => { if (event.key === 'Escape') setContextMenu(null); };
        window.addEventListener('pointerdown', close); window.addEventListener('keydown', key);
        return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key); };
      }, [contextMenu]);
      const [busy, setBusy] = useState(false);
      const [document, setDocument] = useState(undefined);
      const [asset, setAsset] = useState(undefined);
      const [assetPage, setAssetPage] = useState(1);
      const [pdfSelection, setPdfSelection] = useState(undefined);
      const [draft, setDraft] = useState('');
      const [selection, setSelection] = useState('');
      const [dirty, setDirty] = useState(false);
      // The code editor keeps its own buffer; it reports here so a switch never drops unsaved code.
      const [codeDirty, setCodeDirty] = useState(false);
      const [saving, setSaving] = useState(false);
      const [backlinks, setBacklinks] = useState([]);
      const [templates, setTemplates] = useState([]);
      const [query, setQuery] = useState('');
      const [hits, setHits] = useState([]);
      const [notice, setNotice] = useState('正在读取…');
      const [error, setError] = useState('');
      const [templatePath, setTemplatePath] = useState('');
      const [newPath, setNewPath] = useState('路线/新页面.md');
      const [creatingCode, setCreatingCode] = useState(false), [codePath, setCodePath] = useState('代码/新建.py');
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
        catch { setNotice('文件树暂时无法读取。'); setListing(value => value === 'ready' ? value : 'failed'); return false; }
        if (!result?.ok) { setNotice('文件树暂时无法读取。'); setListing(value => value === 'ready' ? value : 'failed'); return false; }
        setFiles(result.value.files); setTree(result.value.tree); setListing('ready');
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
        catch(error) { media = {ok:false,error}; }
        if (!media?.ok) {
          if (sequence !== openSequence.current) return;
          openedRef.current = path; setSelected(path); setDocument(undefined); setAsset(undefined); setNotice('');
          setError(assetFailureNotice(media?.error)); return;
        }
        if (sequence !== openSequence.current) return;
        openedRef.current = path;
        setExtracting(false);
        setSelected(path); setDocument(undefined); setAsset(media.value); setAssetPage(locator?.page ?? 1); setAssetLocator(locator); setPdfSelection(undefined); setDraft(''); setSelection(''); setDirty(false); setBacklinks([]); setNotice(notice ?? '');
      }, [vault, sessionId]);

      useEffect(() => {
        if (!viewRequest?.focus) return;
        const target = parseMediaTarget(viewRequest.focus);
        if (dirty || codeDirty || (drafts.has(sessionId) && drafts.get(sessionId).path !== target.path)) { setNotice('当前页面有未保存修改，请先保存或放弃。'); completeViewRequest(); return; }
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
        // The list follows outside changes whenever the view is visible, even
        // with nothing open (or a file that failed to open); only the open file
        // below needs one.
        if (!visible) return undefined;
        let live = true, checking = false;
        const syncExternal = async () => {
          if (checking) return;
          checking = true;
          try {
            const result = await vault.list({});
            if (!live || !result.ok) return;
            setFiles(result.value.files); setTree(result.value.tree);
            if (!selected || (!document && !asset)) return;
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
        const timer = visibleInterval(syncExternal, 2500);
        const onFocus = () => { void syncExternal(); };
        window.addEventListener('focus', onFocus);
        window.addEventListener('visibilitychange', onFocus);
        return () => { live = false; timer(); window.removeEventListener('focus', onFocus); window.removeEventListener('visibilitychange', onFocus); };
      }, [visible, selected, document?.path, document?.revision, asset?.path, asset?.revision, dirty, vault]);

      const shownFiles = useMemo(() => query.trim() ? hits : files, [files, hits, query]);
      // A lesson board is written only through the classroom: the library shows its
      // archive read-only (the export renderer, sandboxed) and leads back to the lesson.
      const boardArchive = useMemo(() => {
        if (document?.type !== 'lesson-board') return null;
        try {
          const session = document.frontmatter?.session;
          const html = exportBoard(parseBoard(document.content, session), { hint: true, reference: true, attempt: true, mathCss: mathStyleText() }).html;
          return { session, html };
        } catch { return { error: true }; }
      }, [document?.path, document?.revision]);
      const selectPage = path => {
        if (!path || path === selected) return;
        if (dirty || codeDirty) { setNotice('当前页面有未保存修改，请先保存或放弃。'); return; }
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
          if (result?.ok && document.path.split('/')[0] === USER_SKILL_DIRECTORY) announceSkillsChanged();
          if (result.ok) {
            setDocument(result.value); setDraft(result.value.content); setDirty(false); setNotice('已保存');
            await refresh(result.value.path);
          } else setNotice(saveFailureNotice(result.error));
        } catch { setNotice('保存失败，当前修改仍保留在页面中。'); }
        setSaving(false);
      };
      const discard = () => { if (document) { setDraft(document.content); setDirty(false); setNotice('已放弃未保存修改'); } };
      const pdfLocator = value => value ? { kind: 'pdf-region', page: value.page, rect: value.rect } : { kind: 'pdf-page', page: assetPage };
      const activeSession = async () => {
        if (sessionId) return sessionId;
        try {
          const value = await ensureSession?.(ctx);
          if (typeof value === 'string' && value) return value;
        } catch { /* show the same honest notice below */ }
        setNotice('请先开始一节课，再把资料带入对话。');
        return undefined;
      };
      const bringIntoConversation = async (assetSelection, selectedText = '') => {
        const currentSessionId = await activeSession();
        if (!currentSessionId) return false;
        if (asset) {
          const locator = asset.assetKind === 'pdf' ? pdfLocator(assetSelection || pdfSelection) : undefined;
          const quote = assetSelection?.quote || pdfSelection?.quote;
          const pin = { kind: 'asset', sessionId: currentSessionId, path: asset.path, revision: asset.revision, title: asset.title, ...(locator ? { locator } : {}), ...(quote ? { selection: quote } : {}) };
          if (!insertVaultReference(ctx, currentSessionId, pin, openView)) { setNotice('当前对话输入框正在变化，请稍后重试。'); return false; }
          setNotice('已将媒体文件带入对话');
          return true;
        }
        if (!document) return false;
        if (dirty) { setNotice('请先保存或放弃当前修改，再带入对话。'); return false; }
        const pin = { kind: 'page', sessionId: currentSessionId, path: document.path, revision: document.revision, title: document.title, ...(selectedText ? { selection: selectedText } : {}) };
        if (!insertVaultReference(ctx, currentSessionId, pin, openView)) { setNotice('当前对话输入框正在变化，请稍后重试。'); return false; }
        setNotice(selectedText ? '已将所选内容带入对话' : '已将当前页面带入对话');
        return true;
      };
      const bringPath = async path => {
        setContextMenu(null);
        if (!path) return false;
        if (path === selected && (document || asset)) return bringIntoConversation();
        if (dirty) { setNotice('请先保存或放弃当前修改，再带入对话。'); return false; }
        const currentSessionId = await activeSession();
        if (!currentSessionId) return false;
        try {
          const page = await vault.read({ path });
          if (page?.ok) {
            const pin = { kind: 'page', sessionId: currentSessionId, path: page.value.path, revision: page.value.revision, title: page.value.title };
            if (!insertVaultReference(ctx, currentSessionId, pin, openView)) { setNotice('当前对话输入框正在变化，请稍后重试。'); return false; }
            setNotice('已将整个文件带入对话'); return true;
          }
          const media = await vault.readAsset({ path });
          if (!media?.ok) throw new Error('read');
          const locator = media.value.assetKind === 'pdf' ? { kind: 'pdf-page', page: 1 } : undefined;
          const pin = { kind: 'asset', sessionId: currentSessionId, path: media.value.path, revision: media.value.revision, title: media.value.title, ...(locator ? { locator } : {}) };
          if (!insertVaultReference(ctx, currentSessionId, pin, openView)) { setNotice('当前对话输入框正在变化，请稍后重试。'); return false; }
          setNotice('已将媒体文件带入对话'); return true;
        } catch { setNotice('无法读取这个文件，请刷新后重试。'); return false; }
      };
      // The Vault panel asks this page for its own actions (新建, 导入, 带入对话, 回收站).
      useEffect(()=>{
        const command=viewRequest?.command;if(!command)return;
        completeViewRequest();
        if(command.type==='create-page')setCreating(true);
        else if(command.type==='create-code')setCreatingCode(true);
        else if(command.type==='upload')uploadRef.current?.click();
        else if(command.type==='bring')void bringPath(command.path);
        else if(command.type==='trash')fileActions.requestDelete(command.path);
        else if(command.type==='trash-list')fileActions.showTrash();
      },[viewRequest]);
      const copyAssetEmbed = async selectionValue => {
        if (!asset) return;
        const chosen=selectionValue||pdfSelection;
        const locator = asset.assetKind === 'pdf' ? {...pdfLocator(chosen),...(chosen?.annotationId?{annotationId:chosen.annotationId}:{}),revision:asset.revision} : undefined;
        const text = embedTarget(asset.path, locator);
        try { await navigator.clipboard.writeText(text); } catch {
          const area = window.document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; window.document.body.append(area); area.select(); window.document.execCommand('copy'); area.remove();
        }
        const brought = await bringIntoConversation(chosen);
        setNotice(brought ? `已复制并带入对话：${text}` : `已复制：${text}`);
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
        if (codeDirty) { setNotice('当前页面有未保存修改，请先保存或放弃。'); return; }
        try {
          const bytes = new Uint8Array(await file.arrayBuffer()), parts = [];
          for (let index = 0; index < bytes.length; index += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)));
          const dataBase64 = btoa(parts.join('')), path = `媒体/${file.name}`;
          const result = await vault.saveAsset({ path, dataBase64, mime: file.type || 'application/octet-stream', expectedRevision: null });
          if (!result.ok) { setNotice(createFailureNotice(result.error, '媒体文件')); return; }
          await refresh(path); setSelected(path); setNotice('媒体文件已保存'); window.dispatchEvent(new Event('notara-vault-changed'));
        } catch { setNotice('媒体文件保存失败，文件可能过大或格式不受支持。'); }
      };
      // A code file starts empty and opens in the code editor; the extension decides the language.
      const createCode = async event => {
        event.preventDefault();
        const path = codePath.trim();
        if (codeDirty) { setNotice('当前页面有未保存修改，请先保存或放弃。'); return; }
        if (!isCodePath(path)) { setNotice('请用代码文件的扩展名，例如 .py、.js、.cpp。'); return; }
        try {
          const result = await vault.saveAsset({ path, dataBase64: '', mime: mediaForPath(path).mime, expectedRevision: null });
          if (!result.ok) { setNotice(createFailureNotice(result.error, '代码文件')); return; }
          setCreatingCode(false); await refresh(path); setSelected(path); setNotice(`已创建代码文件：${path}`); window.dispatchEvent(new Event('notara-vault-changed'));
        } catch { setNotice('代码文件没有创建，请检查路径后再试。'); }
      };
      const create = async event => {
        event.preventDefault();
        if (dirty || codeDirty) { setNotice('当前页面有未保存修改，请先保存或放弃。'); return; }
        if (!templatePath || !newPath.trim()) return;
        const result = await vault.createFromTemplate({ templatePath, path: newPath.trim(), values: { title: newTitle.trim() || '新页面', date: new Date().toISOString().slice(0, 10) }, expectedRevision: null });
        if (result.ok) { setCreating(false); setNewPath('路线/新页面.md'); await refresh(result.value.path); setSelected(result.value.path); window.dispatchEvent(new Event('notara-vault-changed')); }
        else setNotice(createFailureNotice(result.error, '页面'));
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
        current && {label:'带入整个文件',disabled:dirty,run:()=>{void bringPath(selected);}},
        {label:'在图谱中查看',run:()=>openView(VIEW_IDS.graph,selected)},
        document?.type==='card' && {label:'查看复习安排',disabled:dirty,run:()=>openView(VIEW_IDS.calendar,selected)},
        asset && {label:'复制并带入对话',run:()=>{void copyAssetEmbed();}},
        current && {label:'移到回收站',disabled:dirty,run:()=>fileActions.requestDelete(current.path)},
        {label:'回收站',run:fileActions.showTrash},
      ];


      return h('div',{className:'nv-assets',style:STYLE.page},
        h('div',{className:'nv-bar'},
          !global&&h(IconButton,{icon:'sidebar',label:sidebar?'收起文件栏':'展开文件栏',onClick:()=>setSidebar(v=>!v)}),
          h(IconButton,{icon:'plus',label:'新建页面',onClick:()=>setCreating(true)}),
          // Beside a lesson the page keeps its own search; in the Vault section it lives in the panel.
          !global&&h(IconButton,{icon:'search',label:'搜索文件',onClick:()=>{setSidebar(true);setSearching(v=>!v);}}),
          h('span',{className:'nv-breadcrumb',title:current?.path},current?.path ?? '文件'),
          document && dirty && h(IconButton,{icon:'save',label:saving?'保存中…':'保存',disabled:saving,onClick:save}),
          document && h(IconButton,{icon:'extract',label:'打开摘录工具',disabled:dirty,'aria-pressed':extracting,onClick:startExtract}),
          current && h(IconButton,{icon:'chat',label:document?'带入整个文件':'带入媒体文件',disabled:dirty,onClick:()=>{void bringIntoConversation();}}),
          h(Menu,{label:'文件操作',items:menuItems}),
        ),
        notice && h('div',{className:'nv-notice',role:'status'},notice),
        error && h('div',{className:'nv-notice',role:'alert'},error),
        h('input',{ref:uploadRef,type:'file',style:{display:'none'},onChange:upload}),
        h('div',{className:'nv-asset-body'},
          sidebar && h('aside',{className:'nv-file-rail','aria-label':'文件列表'},
            h('div',{className:'nv-bar'},h('span',{className:'nv-breadcrumb'},'文件'),
              h(IconButton,{icon:'upload',label:'导入媒体文件',onClick:()=>uploadRef.current?.click()}),
              h(Menu,{label:'文件列表操作',items:[{label:'从模板新建',run:()=>setCreating(true)},{label:'新建代码文件',run:()=>setCreatingCode(true)},{label:'刷新文件列表',run:()=>refresh()},{label:'回收站',run:fileActions.showTrash}]})),
            searching && h('input',{style:{...STYLE.search,margin:'8px',width:'calc(100% - 16px)'},autoFocus:true,placeholder:'搜索标题、内容或路径…',value:query,onChange:event=>runSearch(event.target.value)}),
            query.trim()?shownFiles.map(item=>h('button',{key:item.path,style:buttonStyle(item.path===selected),onClick:()=>selectFromResult(item.path)},item.path)):
              h(Tree,{node:tree,selected,onSelect:selectPage,onContext:(path,event)=>setContextMenu({path,x:event.clientX,y:event.clientY})})),
          h('main',{className:'nv-document'+(asset?.assetKind==='pdf'?' nv-document-pdf':'')},current?h('article',null,
            document ? h(React.Fragment,null,
              boardArchive&&!boardArchive.error?h('section',{className:'nv-board-archive','aria-label':'课堂白板存档'},
                h('p',{style:{...STYLE.notice,display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}},'这是课堂白板的存档，这里只能查看；作答、拖动与排版在课堂的白板里进行。',
                  h('button',{className:'nv-quiet',disabled:!ctx.sessions.list.getSnapshot().byId?.[boardArchive.session],title:ctx.sessions.list.getSnapshot().byId?.[boardArchive.session]?undefined:'这节课已不在课堂列表里',onClick:()=>openLessonBoard(ctx,boardArchive.session)},'在课堂白板中打开')),
                h('iframe',{title:'课堂白板存档',sandbox:'',srcDoc:boardArchive.html,style:{width:'100%',height:'calc(100dvh - 240px)',border:'1px solid var(--dsw-alias-border-l1)',borderRadius:12,background:'#fff'}})):
              h(CodeMirrorMarkdown,{key:`${document.path}:${Object.values(embeddedAssets).map(item=>item.revision).join(',')}`,content:draft,assets:embeddedAssets,anchor,onChange:value=>{setDraft(value);setDirty(value!==document.content.replace(/\r\n?/g,'\n'));setNotice('');},onSelectionChange:setSelection,onTag:tag=>openView(VIEW_IDS.graph,'tag:'+encodeURIComponent(tag)),onOpenPage:path=>{const target=parseMediaTarget(path);if(target.locator||target.invalidLocator)openView(VIEW_IDS.assets,path);else selectPage(target.path);}}),
              extracting && h('section',{className:'nv-extract','aria-label':'摘录工具'},
                h('label',null,'摘录段落',h('select',{'aria-label':'摘录段落',style:STYLE.templateInput,value:section,onChange:event=>{const next=sections.find(item=>item.anchor===event.target.value);setSection(next.anchor);setAnchor(next.anchor);setExtractQuote(next.content);setExtractTitle(`${document.title} · ${next.anchor}`);}},sections.map(item=>h('option',{key:item.anchor,value:item.anchor},item.anchor)))),
                h('label',null,'摘录内容',h('textarea',{'aria-label':'摘录内容',style:STYLE.templateInput,value:extractQuote,onChange:event=>setExtractQuote(event.target.value)})),
                h('label',null,'卡片标题',h('input',{'aria-label':'卡片标题',style:STYLE.templateInput,value:extractTitle,onChange:event=>setExtractTitle(event.target.value)})),
                h('button',{className:'nv-quiet',disabled:busy||dirty||!extractTitle.trim()||!extractQuote.trim(),onClick:saveExtract},'提取段落为卡片')),
              (document.links.length>0||backlinks.length>0) && h('details',{style:{marginTop:28,fontSize:12}},h('summary',{style:{cursor:'pointer',color:'var(--dsw-alias-label-secondary)'}},'相关链接'),
                h('section',{style:STYLE.links},document.links.map(path=>h('button',{key:'out:'+path,className:'nv-link',style:STYLE.link,onClick:()=>selectFromResult(path)},'→ '+path)),backlinks.map(path=>h('button',{key:'in:'+path,className:'nv-link',style:STYLE.link,onClick:()=>selectFromResult(path)},'← '+path))))) :
            asset.assetKind==='code'&&CodeEditor?h(CodeEditor,{key:asset.path,vault,asset,onDirty:setCodeDirty,onSaved:value=>setAsset(current=>current?.path===value.path?{...current,...value}:current)}):
            asset.assetKind==='pdf'?h(PdfReader,{key:asset.path+JSON.stringify(assetLocator),vault,asset,page:assetPage,initialRegion:assetLocator?.kind==='pdf-region'?assetLocator:undefined,onPage:setAssetPage,onSelectionChange:setPdfSelection,onCopyEmbed:copyAssetEmbed,onBring:bringIntoConversation,onCreateCard:createPdfCard,busy}):
              h(AssetPreview,{asset,onCopyEmbed:copyAssetEmbed,onBring:bringIntoConversation})
          ):files.length?h('div',{style:STYLE.empty},'选择一个文件')
            :listing==='loading'?h('div',{style:STYLE.empty},h('p',{role:'status'},'正在读取…'))
            :listing==='failed'?h('div',{style:STYLE.empty},h('p',{role:'alert',style:{marginBottom:14}},'文件列表暂时读不出来。'),h('button',{type:'button',className:'nv-quiet',onClick:()=>{setListing('loading');void refresh();window.dispatchEvent(new Event('notara-vault-changed'));}},'重试'))
            :!EmptyState?h('div',{style:STYLE.empty},'还没有文件。点击 + 新建页面。'):h(EmptyState,{kind:'vault',onAction:[()=>uploadRef.current?.click(),()=>setCreating(true)]}))),
        creatingCode && h(Dialog,{title:'新建代码文件',onClose:()=>setCreatingCode(false)},
          h('form',{onSubmit:createCode},
            h('label',null,'文件路径',h('input',{'aria-label':'代码文件路径',style:STYLE.templateInput,value:codePath,onChange:event=>setCodePath(event.target.value)})),
            h('p',{style:STYLE.notice},'扩展名决定语言，例如 .py、.js、.cpp；运行与测试用本机的工具链。'),
            h('button',{type:'submit',className:'nv-quiet'},'创建代码文件'))),
        creating && h(Dialog,{title:'从模板新建',onClose:()=>setCreating(false)},
          h('form',{onSubmit:create},
            h('label',null,'模板',h('select',{'aria-label':'模板',style:STYLE.templateInput,value:templatePath,onChange:event=>setTemplatePath(event.target.value)},templates.map(item=>h('option',{key:item.path,value:item.path},item.title||item.path)))),
            h('label',null,'页面标题',h('input',{'aria-label':'页面标题',style:STYLE.templateInput,value:newTitle,onChange:event=>setNewTitle(event.target.value)})),
            h('label',null,'目标路径',h('input',{'aria-label':'目标路径',style:STYLE.templateInput,value:newPath,onChange:event=>setNewPath(event.target.value)})),
            h('button',{type:'submit',className:'nv-quiet',disabled:!templates.length||dirty},'创建 Markdown 页面'))),
        contextMenu && h('div',{className:'nv-context-menu',role:'menu',style:{left:Math.min(contextMenu.x,Math.max(8,window.innerWidth-224)),top:Math.min(contextMenu.y,Math.max(8,window.innerHeight-260))},onContextMenu:event=>event.preventDefault()},[
          ['打开文件',()=>selectPage(contextMenu.path)],
          ['将整个文件带入对话',()=>{void bringPath(contextMenu.path);}],
          ['在图谱中查看',()=>openView(VIEW_IDS.graph,contextMenu.path)],
          ['从模板新建',()=>setCreating(true)],
          ['新建代码文件',()=>setCreatingCode(true)],
          ['移到回收站',()=>fileActions.requestDelete(contextMenu.path)],
        ].map(([label,run])=>h('button',{key:label,role:'menuitem',onClick:()=>{setContextMenu(null);run();}},label))),
        fileActions.dialog
      );
    }
return App;
}
