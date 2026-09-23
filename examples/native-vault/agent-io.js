import { basename,join,resolve } from 'node:path';
import { safeRelativePath,parseMarkdownDocument,revisionFor } from './vault.js';
import { mediaForPath } from './media.js';

const MAX_FILE_BYTES=50*1024*1024, MAX_TEXT_BYTES=2*1024*1024;
const fail=code=>{throw new Error(code);};

export function vaultScopes(ctx,exec,scope='current') {
  const cwd=exec.agent?.session?.header?.cwd;
  if(!cwd) fail('vault_session_required');
  const rows=ctx.get?.('workspaceRegistry')?.list()??[];
  const current=rows.find(row=>resolve(row.path)===resolve(cwd));
  if(!current) fail('vault_scope_unavailable');
  const ordered=[current,...rows.filter(row=>row.id!==current.id)];
  if(scope==='current'||!scope) return [current];
  if(scope==='all') return ordered;
  const selected=ordered.find(row=>row.id===scope);
  if(!selected) fail('vault_scope_unavailable');
  return [selected];
}

export function sourceRef(workspaceId,path,revision,locator) {
  return 'vault:'+Buffer.from(JSON.stringify({workspaceId,path,revision,...(locator?{locator}:{})})).toString('base64url');
}
export function parseSourceRef(ref) {
  if(typeof ref!=='string'||!ref.startsWith('vault:')||ref.length>8000) fail('vault_reference_invalid');
  let value;try{value=JSON.parse(Buffer.from(ref.slice(6),'base64url').toString('utf8'));}catch{fail('vault_reference_invalid');}
  if(!value||typeof value.workspaceId!=='string'||typeof value.revision!=='string'||value.revision.length!==24) fail('vault_reference_invalid');
  safeRelativePath(value.path);
  return value;
}

/** All model reads/writes use the native filesystem seam. writeApproved is an
 * internal capability supplied after the outer permission decision allows the
 * operation (standing full access or a requested one-time approval). */
export function createAgentVaultIO(ctx,exec,{scope='current',writeApproved=false,editorWorkspace,boundWrite}={}) {
  const workspace=editorWorkspace??vaultScopes(ctx,exec,scope)[0],rootPath=join(workspace.path,'vault');
  const fs=ctx.fs,signal=exec.signal;
  const checkAbort=()=>signal?.throwIfAborted();

  async function target(path) {
    checkAbort();
    const value=safeRelativePath(path);
    if(value.split('/').some(part=>part.startsWith('.')||part==='node_modules')||value.startsWith('_templates/')) fail('vault_path_invalid');
    const parts=['vault',...value.split('/')];
    let absolute=workspace.path;
    for(const part of parts){
      absolute=join(absolute,part);
      const item=await fs.lstat(absolute,undefined,signal);
      if(item?.type==='symlink') fail('vault_path_invalid');
    }
    const root=await fs.resolve(rootPath,{cwd:workspace.path,signal});
    const result=await fs.resolve(absolute,{cwd:workspace.path,signal});
    if(!fs.contains(root,result)) fail('vault_path_invalid');
    return result;
  }

  async function raw(path,maximum=MAX_FILE_BYTES) {
    const t=await target(path),before=await fs.stat(t,signal);
    if(!before) fail('vault_file_not_found');
    if(before.type!=='file') fail('vault_file_required');
    if(before.size!==undefined&&before.size>maximum) fail('vault_file_too_large');
    const bytes=await fs.readBytes(t,signal,maximum),after=await fs.stat(t,signal);
    if(!after||before.version!==after.version) fail('vault_revision_conflict');
    ctx.emit?.('fs/observed',t,{kind:'present',version:after.version},exec);
    return {bytes,revision:revisionFor(bytes),nativeVersion:after.version,target:t};
  }

  async function read(path,expectedRevision) {
    const value=safeRelativePath(path);
    if(!value.toLowerCase().endsWith('.md')) fail('vault_markdown_required');
    const data=await raw(value,MAX_TEXT_BYTES);
    if(expectedRevision!==undefined&&expectedRevision!==data.revision) fail('vault_reference_stale');
    return {...parseMarkdownDocument(value,Buffer.from(data.bytes).toString('utf8'),data.revision),workspaceId:workspace.id,ref:sourceRef(workspace.id,value,data.revision)};
  }

  async function readAsset(path,expectedRevision) {
    const data=await raw(path);
    if(expectedRevision!==undefined&&expectedRevision!==data.revision) fail('vault_reference_stale');
    const media=mediaForPath(path);
    return {path,title:basename(path),kind:'asset',assetKind:media.kind,mime:media.mime,revision:data.revision,bytes:data.bytes,workspaceId:workspace.id,ref:sourceRef(workspace.id,path,data.revision)};
  }

  async function scan({includeContent=true,limit=1000}={}) {
    checkAbort();
    const rootInfo=await fs.lstat(rootPath,undefined,signal);
    if(!rootInfo) return {documents:[],files:[],errors:[],truncated:false,workspaceId:workspace.id};
    if(rootInfo.type!=='directory') fail('vault_path_invalid');
    const root=await fs.resolve(rootPath,{cwd:workspace.path,signal});
    const documents=[],files=[],errors=[];let truncated=false;
    async function walk(directory,prefix='') {
      for(const entry of await fs.listDir(directory,signal)) {
        checkAbort();
        if(files.length>=limit){truncated=true;return;}
        if(entry.name.startsWith('.')||entry.name==='_templates'||entry.name==='node_modules') continue;
        const path=prefix?`${prefix}/${entry.name}`:entry.name;
        try{
          const t=await target(path),info=await fs.stat(t,signal);
          if(info?.type==='directory'){await walk(t,path);continue;}
          if(info?.type!=='file') continue;
          const row={path,title:entry.name,kind:path.toLowerCase().endsWith('.md')?'page':'asset',size:info.size??null};
          files.push(row);
          if(includeContent&&row.kind==='page') documents.push(await read(path));
        }catch(error){if(error.name==='AbortError') throw error;errors.push({path,code:error.message});}
      }
    }
    await walk(root);
    return {documents,files,errors,truncated,workspaceId:workspace.id};
  }

  async function save(path,content,expectedRevision) {
    if(!writeApproved) fail('vault_write_approval_required');
    const bound=boundWrite?.workspaceId===workspace.id&&boundWrite?.path===path;
    if(!editorWorkspace&&!bound&&workspace.path!==vaultScopes(ctx,exec,'current')[0].path) fail('vault_write_scope_invalid');
    if(typeof content!=='string'||Buffer.byteLength(content)>MAX_TEXT_BYTES) fail('vault_content_invalid');
    safeRelativePath(path);parseMarkdownDocument(path,content);
    const t=await target(path),info=await fs.stat(t,signal);
    let expected={kind:'createIfAbsent'};
    if(info){
      if(expectedRevision===null||expectedRevision===undefined) fail('vault_revision_conflict');
      const current=await raw(path,MAX_TEXT_BYTES);
      if(current.revision!==expectedRevision) fail('vault_revision_conflict');
      expected={kind:'replaceIfVersion',version:current.nativeVersion};
    }else if(expectedRevision!==null) fail('vault_revision_conflict');
    const policy=editorWorkspace||bound?{mode:'workspace-write',workspaceRoot:workspace.path}:ctx.get?.('sandboxPolicy')?.resolve({session:exec.agent.session,mode:'workspace-write'})??{mode:'workspace-write',workspaceRoot:workspace.path};
    try{
      const result=await fs.writeText(t,content,expected,signal,policy);
      ctx.emit?.('fs/observed',t,{kind:'present',version:result.version},exec);
    }catch(error){if(['FS_STALE_VERSION','FS_NOT_OBSERVED'].includes(error.code)) fail('vault_revision_conflict');throw error;}
    return read(path);
  }
  return {workspace,rootPath,read,readAsset,scan,save};
}

/** Authenticated editor actions carry their workspace from the Host, not from
 * model arguments. They share the exact writer and native CAS with agent IO. */
export function createEditorVaultIO(ctx,workspacePath,signal=new AbortController().signal) {
  const workspace=ctx.get?.('workspaceRegistry')?.list().find(row=>resolve(row.path)===resolve(workspacePath))??{id:resolve(workspacePath),path:resolve(workspacePath),title:basename(workspacePath)};
  return createAgentVaultIO(ctx,{signal},{editorWorkspace:workspace,writeApproved:true});
}
