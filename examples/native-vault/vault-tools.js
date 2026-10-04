import { createAgentVaultIO, vaultScopes } from './agent-io.js';
import { dispatchVaultCommand, COMMANDS } from './vault-cli.js';
import { pathKey, safeRelativePath, searchDocuments, parseMarkdownDocument, revisionFor } from './vault.js';
import { readFile } from 'node:fs/promises';
import { isCodePath } from './media.js';
import { readTeachingSettings } from './teaching-state.js';
import { workerAllows } from './worker-catalog.js';

const fail=code=>{throw new Error(code);};
const string=(description,maxLength)=>({type:'string',description,...(maxLength?{maxLength}:{})});
const integer=(description,minimum,maximum)=>({type:'integer',description,minimum,maximum});
const schema=(properties,required)=>({type:'object',properties,required,additionalProperties:false});
export const VAULT_AGENT_TOOL_NAMES=Object.freeze(['vault_read','vault_search','vault_save','vault_command']);
const VAULT_AGENT_WRITE_TOOLS=new Set(['vault_save']);
const approvedWrites=new WeakSet();
const pendingWrites=new WeakSet();
export const isVaultCommandWrite=exec=>exec?.name==='vault_command'&&!!COMMANDS[exec.arguments?.command]?.write;
export const isVaultAgentWrite=exec=>VAULT_AGENT_WRITE_TOOLS.has(exec?.name)||isVaultCommandWrite(exec);
export function markVaultAgentWriteApproved(exec) { if(exec&&typeof exec==='object')approvedWrites.add(exec); }
export function isVaultAgentWriteApproved(exec) { return !!exec&&approvedWrites.has(exec); }
export function markVaultAgentWritePending(exec) { if(exec&&typeof exec==='object')pendingWrites.add(exec); }
export function grantVaultAgentWriteAfterApproval(exec) {
  if(!exec||!pendingWrites.delete(exec))return false;
  approvedWrites.add(exec);
  return true;
}

function ioFor(ctx,exec,writeApproved=false) {
  return createAgentVaultIO(ctx,exec,{writeApproved});
}

async function readVaultDocument(io,path,signal) {
  try { return isCodePath(path)?await io.readCode(path):await io.read(path); }
  catch(error) {
    // A new classroom may not have opened the template UI yet. Reading a
    // reference must not seed files or replace the student's own template.
    const name=/^_templates\/([^/]+\.md)$/.exec(path)?.[1];
    if(error.message!=='vault_file_not_found'||!name)throw error;
    let bytes;
    try { bytes=await readFile(new URL(`./templates/${encodeURIComponent(name)}`,import.meta.url),{signal}); }
    catch(readError) { if(readError.code==='ENOENT')throw error; throw readError; }
    return {...parseMarkdownDocument(path,bytes.toString('utf8'),revisionFor(bytes)),templateSource:'bundled',
      notice:'包内模板参考，尚未写入当前 Vault；此 revision 标识参考文本，不是普通资料的写入凭据。'};
  }
}

/** DSH history persists attachment references, never inline base64 image blocks. */
export async function vaultToolMedia(ctx,exec,value) {
  if(typeof value?.imageData!=='string')return value;
  const {imageData,imageMimeType,...receipt}=value;
  const route=exec.agent?.session?.requestHeader?.()?.config??exec.agent?.options;
  const info=route?.provider&&route?.model?await ctx.get('llm')?.resolveModelInfo(route.provider,route.model,exec.signal):null;
  if(!info?.inputModalities?.includes('image'))return {...receipt,imageAvailable:false,
    warnings:[...(receipt.warnings??[]),'当前模型未声明图像输入能力，本次只返回文字层，不能据此声称已核对原页图。需要图像证据时使用支持图像的模型。']};
  const attachments=ctx.get('attachments');
  if(!attachments)fail('vault_image_storage_unavailable');
  exec.signal?.throwIfAborted();
  const imageAttachment=await attachments.saveImage({data:Buffer.from(imageData,'base64'),mediaType:imageMimeType??'image/png',name:`${receipt.title??'PDF'} · p${receipt.page}.png`});
  return {...receipt,imageAvailable:true,imageAttachment};
}

export function registerVaultAgentTools(ctx,service) {
  const add=(name,description,parameters,execute,write=false)=>ctx.effect(()=>ctx.tools.register({
    name,description,parameters,
    output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>{
      if(value?.imageAttachment) {
        const {imageAttachment,...receipt}=value;
        return [{type:'text',text:JSON.stringify(receipt)},{type:'image',attachment:imageAttachment}];
      }
      return [{type:'text',text:JSON.stringify(value)}];
    }},
    isConcurrencySafe:()=>!write,
    async execute(args,exec) {
      if(!service.isTeaching(exec.agent)||(exec.agent?.session?.header?.origin==='subagent'&&!workerAllows(exec.agent.session,name))) fail('teaching_session_required');
      return JSON.parse(JSON.stringify(await vaultToolMedia(ctx,exec,await execute(args,exec))));
    },
  }));
  add('vault_read','读取当前课堂授权 Vault 内的 Markdown 或代码文件全文与真实 revision；可按起止行截取，行号从1开始。',schema({path:string('Vault 内相对路径，不含 vault/ 前缀。',1000),startLine:integer('可选，首行，含该行。',1,10000000),endLine:integer('可选，末行，含该行。',1,10000000)},['path']),async(args,exec)=>{
    if(args.startLine!==undefined&&args.endLine!==undefined&&args.endLine<args.startLine)fail('vault_line_range_invalid');
    const io=ioFor(ctx,exec),doc=await readVaultDocument(io,args.path,exec.signal);
    if(args.startLine===undefined&&args.endLine===undefined)return doc;
    const lines=doc.content.split(/\r?\n/),start=(args.startLine??1)-1,end=args.endLine??lines.length;
    return {...doc,content:lines.slice(start,end).join('\n')};
  });
  add('vault_search','按文本在当前 Vault 的 Markdown 标题、路径和正文中检索候选；命中需要 vault_read 精读。',schema({query:string('检索文本。',2000),limit:integer('最多返回条数，默认50。',1,100)},['query']),async(args,exec)=>{
    if(typeof args.query!=='string')fail('vault_query_invalid');
    const io=ioFor(ctx,exec),scan=await io.scan({includeContent:true,limit:5000});
    if(scan.errors.length||scan.truncated)fail('vault_scan_incomplete');
    return {query:args.query,hits:searchDocuments(scan.documents,args.query,args.limit??50),totalDocuments:scan.documents.length,workspaceId:io.workspace.id};
  });
  add('vault_save','用真实 expectedRevision 对当前 Vault 中的 Markdown 或代码文件完整保存；白板与技能保留专用入口。',schema({path:string('当前 Vault 内的相对路径。',1000),content:string('完整 UTF-8 正文。',2000000),expectedRevision:{oneOf:[string('读取时返回的真实 revision；新建必须为 null。',100),{type:'null'}]}},['path','content','expectedRevision']),async(args,exec)=>{
    if(!isVaultAgentWriteApproved(exec))fail('vault_write_approval_required');
    const path=safeRelativePath(args.path),first=pathKey(path.split('/')[0]);
    if(first===pathKey('lesson-board'))fail('board_path_reserved');
    if(first===pathKey('技能'))fail('skill_path_reserved');
    const io=ioFor(ctx,exec,true),saved=isCodePath(args.path)
      ?await io.saveCode(args.path,args.content,args.expectedRevision)
      :await io.save(args.path,args.content,args.expectedRevision);
    return {saved:true,path:saved.path,title:saved.title,revision:saved.revision,ref:saved.ref,kind:isCodePath(args.path)?'code':'page'};
  },true);
  add('vault_command','直接调用 Vault 确定性领域命令，不启动 shell。用 command=command-help、input.command=命令名查看准确字段。Host 绑定身份、根目录和本地时间。',schema({command:string('help、command-help 或 vault-cli 固定命令。',80),input:{type:'object',description:'命令自己的 JSON 字段；身份、根目录和执行时间不可在这里指定。',additionalProperties:true}},['command']),async(args,exec)=>{
    const write=!!COMMANDS[args.command]?.write;
    if(write&&!isVaultAgentWriteApproved(exec))fail('vault_write_approval_required');
    const workspace=vaultScopes(ctx,exec)[0],io=ioFor(ctx,exec,write),settings=readTeachingSettings(exec.agent.session);
    const workspaces=vaultScopes(ctx,exec,'all');
    const bound=settings.scriptPath?workspaces.find(item=>item.id===(settings.scriptWorkspaceId??workspace.id)):null;
    const lesson=bound?JSON.stringify({workspacePath:bound.path,workspaceId:bound.id,path:settings.scriptPath,revision:settings.scriptRevision,...(settings.scriptBodyRevision?{bodyRevision:settings.scriptBodyRevision}:{})}):'';
    const env={...process.env,DSH_NOTARA_WORKSPACE:workspace.path,DSH_NOTARA_WORKSPACE_ID:workspace.id,DSH_SESSION_ID:exec.agent.session.id,DSH_NOTARA_CALL_ID:exec.callId??'',DSH_NOTARA_LESSON:lesson};
    return dispatchVaultCommand(args.command,args.input??{},{fs:ctx.fs,root:workspace.path,env,signal:exec.signal,io,context:ctx,exec,inlineMedia:true});
  },true);
}
