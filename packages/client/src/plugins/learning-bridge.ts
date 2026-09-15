import type { Context } from '@deepseek-ai/cordis';
import type { WorkbenchContent } from '@studyforge/contracts/plugins';
import { PluginLinkSchema, SeminarStartSchema, SeminarRoleSchema } from '@studyforge/contracts/plugin-learning';
import { z } from 'zod';
import { requestLessonPane } from '../materials/lesson-pane-request.ts';
import { openContentClassroom } from '../materials/content-navigation.tsx';
import { revealWorkspaceView } from '../classroom/workspace-layout.ts';
import type {SessionId} from '@deepseek-ai/dsh-session/types';
import { openEntityReference } from '../materials/entity-reference.ts';

const permissions: Record<string,string> = { 'document-read':'document', 'document-write':'document', 'source-pick':'sources', 'source-open':'sources', compose:'compose', 'seminar-list':'seminar', 'seminar-start':'seminar', 'seminar-follow':'seminar', 'seminar-stop':'seminar', worldbook:'worldbook-context' };
permissions['math-publish']='document';permissions['math-compute']='document';
export async function learningAction(ctx:Context, sessionId:string, content:WorkbenchContent, action:string, payload:unknown, pick:()=>Promise<unknown>):Promise<unknown> {
  if (!permissions[action] || !content.permissions.includes(permissions[action]!)) throw new Error('permission');
  const target={sessionId,id:content.id,digest:content.digest};
  const unwrap=<T,>(reply:{ok:true;value:T}|{ok:false;error:unknown}):T=>{if(!reply.ok)throw new Error('action_failed');return reply.value;};
  if(action==='document-read') { z.object({}).strict().parse(payload);const row=unwrap(await ctx.remote.notaraWorkbench.readDocument(target));return {revision:row.revision,document:JSON.parse(row.json)}; }
  if(action==='math-publish') {const data=z.object({json:z.string().max(24000)}).strict().parse(payload);return unwrap(await ctx.remote.notaraWorkbench.publishMath({...target,...data}));}
  if(action==='math-compute') {const data=z.object({json:z.string().max(3000),expectedVersion:z.number().int().nonnegative()}).strict().parse(payload);return unwrap(await ctx.remote.notaraWorkbench.calculateMath({...target,...data}));}
  if(action==='document-write') { const data=z.object({json:z.string().max(60000),revision:z.number().int().nonnegative(),operationId:z.string().min(1).max(160)}).strict().parse(payload);const row=unwrap(await ctx.remote.notaraWorkbench.writeDocument({...target,json:data.json,expectedVersion:data.revision,operationId:data.operationId}));return {revision:row.revision,document:JSON.parse(row.json)}; }
  if(action==='source-pick'){z.object({}).strict().parse(payload);return pick();}
  if(action==='source-open'){
    const data=z.object({link:PluginLinkSchema}).strict().parse(payload),link=unwrap(await ctx.remote.notaraWorkbench.resolveLink({...target,link:data.link}));
    if(ctx.sessions.list.getSnapshot().current!==sessionId)throw new Error('classroom_changed');
    if(link.kind==='source')await openEntityReference(ctx,sessionId,{kind:'source',source:link.source});
    else if(link.kind==='card')await openEntityReference(ctx,sessionId,{kind:'card',ref:link.ref,version:link.version});
    else await openContentClassroom(ctx,{sessionId:link.sessionId});return {opened:true};
  }
  if(action==='compose'){
    const {text}=z.object({text:z.string().trim().min(1).max(12000)}).strict().parse(payload);
    const snapshot = content.documentKind ? unwrap(await ctx.remote.notaraWorkbench.readDocument(target)) : undefined;
    if(ctx.sessions.list.getSnapshot().current!==sessionId||ctx.conversation.blocks.storeFor(sessionId as SessionId).getSnapshot())throw new Error('classroom_changed');
    const scope=ctx.sessions.scope(sessionId as SessionId);if(!scope)throw new Error('input_unavailable');const input=ctx.conversation.input.for(scope).state.getSnapshot();if(input.phase!=='plain')throw new Error('input_busy');
    const end=input.draft.length-input.occurrences.reduce((sum,ref)=>sum+ref.length-1,0);
    if(!scope.bail(scope,'slash/input-insert-text',{text:(input.draft.length?'\n\n':'')+text,span:{start:end,end,draftRev:input.draftRev}}))throw new Error('input_changed');
    if (snapshot) {
      const composer = ctx.conversation.input.for(scope), fresh = composer.state.getSnapshot();
      if (fresh.phase !== 'plain') throw new Error('input_changed');
      const position = fresh.draft.length - fresh.occurrences.reduce((sum, ref) => sum + ref.length - 1, 0);
      if (!composer.insertReference({source:'studyforge-workbench',ref:JSON.stringify({...target,revision:snapshot.revision,title:content.title}),label:content.title,clipboardText:'【'+content.title+'】'}, {start:position,end:position,draftRev:fresh.draftRev})) throw new Error('input_changed');
    }
    revealWorkspaceView(sessionId,'chat');document.querySelector<HTMLElement>('[data-composer-input]')?.focus();return {staged:true};
  }
  if(action==='worldbook'){const data=z.object({query:z.string().max(2000)}).strict().parse(payload);return unwrap(await ctx.remote.notaraWorkbench.worldbookContext({...target,...data}));}
  if(action==='seminar-list'){z.object({}).strict().parse(payload);return unwrap(await ctx.remote.notaraWorkbench.seminars(target));}
  if(action==='seminar-start'){const data=SeminarStartSchema.parse(payload);return unwrap(await ctx.remote.notaraWorkbench.startSeminar({...target,...data}));}
  if(action==='seminar-follow'){const data=z.object({ref:z.string(),role:SeminarRoleSchema,text:z.string().min(1).max(8000),operationId:z.string().min(1).max(160)}).strict().parse(payload);return unwrap(await ctx.remote.notaraWorkbench.followSeminar({...target,...data}));}
  if(action==='seminar-stop'){const data=z.object({ref:z.string()}).strict().parse(payload);return unwrap(await ctx.remote.notaraWorkbench.stopSeminar({...target,...data}));}
  throw new Error('unknown_action');
}
