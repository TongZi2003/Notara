import type { Context } from '@deepseek-ai/cordis';
import { useEffect, useMemo, useRef, useState } from 'react';
import { WorkbenchNoteSchema, WorkbenchDraftValueSchema, type WorkbenchChoice, type WorkbenchContent } from '@studyforge/contracts/plugins';
import { notifyPlugins } from './PluginManager.tsx';
import { WorldbookWorkbench } from './WorldbookWorkbench.tsx';
import { ClassroomWorkbench } from './ClassroomWorkbench.tsx';
import { draftSDK } from './workbench-sdk.ts';
import { learningAction } from './learning-bridge.ts';
import { PluginSourcePicker } from './PluginSourcePicker.tsx';
import type { PluginLink } from '@studyforge/contracts/plugin-learning';
import './plugins.css';

const CHANNEL = 'notara.workbench.v1';
const fonts = new Map<string, Promise<string>>();
const FONT_FILES: Record<string, string> = { 'SF Long Cang': 'longcang', 'SF Kalam': 'kalam', 'SF Ma Shan Zheng': 'mashanzheng', 'SF Patrick Hand': 'patrickhand', 'SF WenKai': 'wenkai', 'SF Caveat': 'caveat', 'SF Zhi Mang Xing': 'zhimangxing' };
async function themeFonts(family: string): Promise<string> {
  return (await Promise.all(Object.entries(FONT_FILES).filter(([name]) => family.includes(name)).map(([name, file]) => {
    if (!fonts.has(file)) fonts.set(file, fetch('/studyforge/notebook/fonts/' + file + '.woff2').then(reply => { if (!reply.ok) throw new Error('font_unavailable'); return reply.blob(); }).then(blob => new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve('@font-face{font-family:' + JSON.stringify(name) + ';src:url(' + JSON.stringify(reader.result) + ') format("woff2");font-display:swap}'); reader.onerror = reject; reader.readAsDataURL(blob);
    })).catch(() => ''));
    return fonts.get(file)!;
  }))).join('\n');
}
export function useWorkbenchChoices(ctx: Context, sessionId: string): WorkbenchChoice[] {
  const [rows, setRows] = useState<WorkbenchChoice[]>([]);
  useEffect(() => {
    let live = true;
    const read = (): void => { void ctx.remote.studyforgePlugins.workbenches({ sessionId }).then(reply => { if (live && reply.ok) setRows(reply.value); }).catch(() => {}); };
    read(); window.addEventListener('studyforge:learning-changed', read); window.addEventListener('focus', read);
    return () => { live = false; window.removeEventListener('studyforge:learning-changed', read); window.removeEventListener('focus', read); };
  }, [ctx, sessionId]);
  return rows;
}
export function workbenchDocument(content: string, nonce: string): string {
  const sdk = `(function(){const nonce=${JSON.stringify(nonce)},channel=${JSON.stringify(CHANNEL)};let listeners=[];window.Notara={saveNote(note){parent.postMessage({channel,nonce,type:'save-note',note},'*')},onSaved(fn){listeners.push(fn);return()=>{listeners=listeners.filter(item=>item!==fn)}}};${draftSDK()}const style=document.createElement('style');document.head.append(style);addEventListener('message',event=>{if(event.source!==parent||event.data?.channel!==channel||event.data?.nonce!==nonce)return;const data=event.data;if(data.type==='theme'){for(const [key,value] of Object.entries(data.tokens))document.documentElement.style.setProperty(key,value);document.documentElement.dataset.theme=data.theme;style.textContent=data.fonts||'';}if(data.type==='saved')listeners.forEach(fn=>fn({title:data.title}));});parent.postMessage({channel,nonce,type:'ready'},'*');})();`;
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'"><style>html,body{margin:0;color:var(--notara-text,#222);font:var(--notara-font-size,15px)/1.7 var(--notara-font,system-ui)}html{min-height:100%;background-color:var(--notara-background,#fff);background-image:var(--notara-lines,none);background-size:var(--notara-lines-size,auto);background-position:0 -4px}body{padding:18px;box-sizing:border-box}button,input,textarea,select{font:inherit;color:inherit;border:1px solid var(--notara-border,#ddd);border-radius:var(--notara-radius,8px);background:var(--notara-surface,#fff);padding:8px;box-sizing:border-box;max-width:100%}button{cursor:pointer}button:hover{color:var(--notara-accent,#3468c0)}h1,h2,h3{font-size:var(--notara-heading-size,18px);font-weight:600}textarea{resize:vertical}</style><script>' + sdk + '</script></head><body>' + content + '</body></html>';
}
export function PluginWorkbench({ ctx, sessionId, id }: { ctx: Context; sessionId: string; id: string }): React.JSX.Element {
  const [content, setContent] = useState<WorkbenchContent>(), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ title: string; body: string; operationId: string; documentRevision?: number | undefined }>();
  const pendingRef = useRef(false), frame = useRef<HTMLIFrameElement>(null), nonce = useMemo(() => crypto.randomUUID(), [id, sessionId]);
  const [picking,setPicking]=useState(false),picker=useRef<{resolve:(link:PluginLink)=>void;reject:()=>void}>();
  useEffect(() => { let live = true; void ctx.remote.studyforgePlugins.openWorkbench({ sessionId, id }).then(reply => { if (!live) return; if (reply.ok) setContent(reply.value); else setNotice('工作台暂时不可用，请在插件页检查状态。'); }).catch(() => { if (live) setNotice('工作台暂时无法打开，请稍后重试。'); }); return () => { live = false; }; }, [ctx, sessionId, id]);
  const srcDoc = useMemo(() => content ? workbenchDocument(content.html, nonce) : '', [content, nonce]);
  useEffect(() => {
    if (!content) return;
    let live = true, themeRevision = 0;
    const draftRequests = new Set<string>();
    const post = (data: object): void => { if (live) frame.current?.contentWindow?.postMessage({ channel: CHANNEL, nonce, ...data }, '*'); };
    const theme = async (): Promise<void> => {
      const revision = ++themeRevision, style = document.body.dataset.sfStyle;
      const css = getComputedStyle(document.body), family = css.getPropertyValue('--sf-ui-font');
      const mappings = { '--notara-background': '--nb-page', '--notara-surface': '--nb-hi', '--notara-text': '--nb-ink', '--notara-muted': '--nb-pencil', '--notara-border': '--nb-rule', '--notara-accent': '--nb-pen', '--notara-font': '--sf-ui-font', '--notara-font-size': '--sf-ui-size', '--notara-heading-size': '--sf-text-section', '--notara-radius': '--sf-ui-radius', '--notara-lines': '--nb-lines', '--notara-lines-size': '--nb-lines-size' };
      const tokens = Object.fromEntries(Object.entries(mappings).map(([key, token]) => [key, css.getPropertyValue(token).trim()]));
      const fontFaces = await themeFonts(family);
      if (revision === themeRevision) post({ type: 'theme', theme: style, tokens, fonts: fontFaces });
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frame.current?.contentWindow || !event.data || event.data.channel !== CHANNEL || event.data.nonce !== nonce) return;
      const data = event.data;
      if (data.type === 'ready') { void theme(); return; }
      if(data.type==='action'){
        if(Object.keys(data).some(k=>!['channel','nonce','type','requestId','action','payload'].includes(k))||typeof data.requestId!=='string'||!/^a[0-9]{1,12}$/.test(data.requestId)||typeof data.action!=='string'||draftRequests.has(data.requestId))return;
        if(draftRequests.size>=8){post({type:'action-result',requestId:data.requestId,ok:false});return;}draftRequests.add(data.requestId);
        void learningAction(ctx,sessionId,content,data.action,data.payload,()=>new Promise<PluginLink>((resolve,reject)=>{if(picker.current){reject(new Error('picker_busy'));return;}picker.current={resolve,reject:()=>reject(new Error('canceled'))};setPicking(true);})).then(value=>post({type:'action-result',requestId:data.requestId,ok:true,value})).catch(()=>post({type:'action-result',requestId:data.requestId,ok:false})).finally(()=>draftRequests.delete(data.requestId));return;
      }
      if (data.type === 'draft-read' || data.type === 'draft-save') {
        const save = data.type === 'draft-save', keys = save ? ['channel','nonce','type','requestId','value','expectedVersion'] : ['channel','nonce','type','requestId'];
        if (Object.keys(data).some(key => !keys.includes(key)) || typeof data.requestId !== 'string' || !/^[0-9]{1,12}$/.test(data.requestId) || draftRequests.has(data.requestId)) return;
        if (!content.permissions.includes('draft') || draftRequests.size >= 8 || save && (!Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 0 || !WorkbenchDraftValueSchema.safeParse(data.value).success)) { post({ type: 'draft-result', requestId: data.requestId, ok: false }); return; }
        draftRequests.add(data.requestId);
        const target = { sessionId, id, digest: content.digest };
        const task = save ? ctx.remote.studyforgePlugins.saveDraft({ ...target, operationId: nonce + ':' + data.requestId, expectedVersion: data.expectedVersion, json: JSON.stringify(data.value) }) : ctx.remote.studyforgePlugins.readDraft(target);
        void task.then(reply => post({ type: 'draft-result', requestId: data.requestId, ...(reply.ok ? { ok: true, value: { revision: reply.value.revision, value: JSON.parse(reply.value.json) } } : { ok: false }) })).catch(() => post({ type: 'draft-result', requestId: data.requestId, ok: false })).finally(() => draftRequests.delete(data.requestId));
        return;
      }
      if (data.type !== 'save-note' || !content.permissions.includes('save-note') || pendingRef.current) return;
      if (Object.keys(data).some(key => !['channel','nonce','type','note'].includes(key))) return;
      const note = WorkbenchNoteSchema.safeParse(data.note); if (!note.success) { setNotice('笔记内容不完整或过长，请在工作台中调整。'); return; }
      pendingRef.current = true; setPending({ ...note.data, operationId: crypto.randomUUID() }); setNotice('');
    };
    window.addEventListener('message', onMessage);
    const observer = new MutationObserver(() => { void theme(); }); observer.observe(document.body, { attributes: true, attributeFilter: ['data-sf-style','data-sf-scheme','data-sf-size','data-sf-tone','data-sf-paper','data-ds-dark-theme'] }); void theme();
    return () => { live = false; picker.current?.reject();picker.current=undefined;window.removeEventListener('message', onMessage); observer.disconnect(); };
  }, [content, nonce, ctx, sessionId, id]);
  if (content?.kind === 'worldbook') return <WorldbookWorkbench ctx={ctx} sessionId={sessionId} id={id} />;
  if (content?.kind === 'classroom') return <ClassroomWorkbench ctx={ctx} sessionId={sessionId} id={id} />;
  return <section className="sf-plugin-workbench">
    {picking&&content&&<PluginSourcePicker ctx={ctx} sessionId={sessionId} content={content} done={link=>{const current=picker.current;picker.current=undefined;setPicking(false);if(link)current?.resolve(link);else current?.reject();}}/>}
    {content ? <iframe ref={frame} title={content.title} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={srcDoc} /> : <p role="status">{notice || '正在打开工作台…'}</p>}
    {content && notice && <p role="status">{notice}</p>}
    {pending && <section className="sf-plugin-note" role="dialog" aria-modal="true" aria-label="保存笔记">
      <h3>保存到笔记本</h3><label>标题<input aria-label="笔记标题" disabled={busy} value={pending.title} onChange={event => setPending({ ...pending, title: event.target.value })} /></label>
      <label>正文<textarea aria-label="笔记正文" disabled={busy} value={pending.body} onChange={event => setPending({ ...pending, body: event.target.value })} /></label>
      <div className="sf-plugin-actions"><button className="sf-action" disabled={busy || !pending.title.trim() || !pending.body.trim()} onClick={() => {
        setBusy(true); void ctx.remote.studyforgePlugins.saveNote({ sessionId, id, digest: content!.digest, operationId: pending.operationId, note: { title: pending.title, body: pending.body, ...(pending.documentRevision === undefined ? {} : { documentRevision: pending.documentRevision }) } }).then(reply => {
          if (!reply.ok) { setNotice('笔记暂时无法保存，请检查插件状态后重试。'); return; }
          frame.current?.contentWindow?.postMessage({ channel: CHANNEL, nonce, type: 'saved', title: reply.value.content.title }, '*');
          setPending(undefined); pendingRef.current = false; setNotice('已保存：' + reply.value.content.title); notifyPlugins();
        }).catch(() => setNotice('暂时没收到保存结果，可以重试；同一笔记不会重复保存。')).finally(() => setBusy(false));
      }}>{busy ? '正在保存…' : '确认保存'}</button><button className="sf-quiet" disabled={busy} onClick={() => { setPending(undefined); pendingRef.current = false; }}>取消</button></div>
    </section>}
  </section>;
}
