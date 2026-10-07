import { basename,join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { symbols } from '@deepseek-ai/cordis';
import { safeRelativePath,parseMarkdownDocument,revisionFor,resolveVaultRoot,deepFreeze,pathKey,portablePath } from './vault.js';
import { isCodePath, isToolCacheDirectory, mediaForPath, PDF_FILE_MAX_BYTES } from './media.js';
import { projectionRevision } from './projection-runtime.js';

const MAX_FILE_BYTES=50*1024*1024, MAX_TEXT_BYTES=2*1024*1024;
const fail=code=>{throw new Error(code);};
// Pages parsed by earlier scans, keyed by resolved path and the native version
// token (inode, size, nanosecond mtime/ctime). A scan still stats every file and
// records the observation; only files whose version changed are read again.
const SCAN_CACHE_LIMIT=50000;
const scanCache=new Map();
// Only content hashes are retained, scoped to the native filesystem instance.
// The first observation hashes the whole file in bounded windows; subsequent
// page reads reuse the hash only while the native file version is unchanged.
const pdfRevisions=new WeakMap(),PDF_HASH_CACHE_LIMIT=64,PDF_READ_CHUNK_BYTES=1024*1024,PDF_RANGE_MAX_BYTES=32*1024*1024;
const pdfRevisionJobs=new WeakMap();

// Concurrent callers share only the hash work. Each keeps its own cancellation,
// file-version validation and observation; cancelling one does not cancel another.
function waitForPdfHash(job,signal) {
  signal?.throwIfAborted();job.users++;
  return new Promise((resolve,reject)=>{
    let finished=false;
    const finish=()=>{if(finished)return false;finished=true;signal?.removeEventListener('abort',abort);job.users--;if(!job.done&&job.users===0)job.controller.abort();return true;};
    const abort=()=>{if(finish())reject(signal.reason);};
    signal?.addEventListener('abort',abort,{once:true});
    job.promise.then(value=>{if(finish())resolve(value);},error=>{if(finish())reject(error);});
    if(signal?.aborted)abort();
  });
}

function pdfHashJob(fs,identity,key,target,before,cache) {
  let jobs=pdfRevisionJobs.get(identity);if(!jobs){jobs=new Map();pdfRevisionJobs.set(identity,jobs);}
  let job=jobs.get(key);
  if(job&&!job.controller.signal.aborted&&job.version===before.version&&job.size===before.size)return job;
  job={controller:new AbortController(),users:0,done:false,version:before.version,size:before.size};
  jobs.set(key,job);
  job.promise=Promise.resolve().then(async()=>{
    const signal=job.controller.signal,hash=createHash('sha256');
    for(let offset=0;offset<before.size;offset+=PDF_READ_CHUNK_BYTES){
      signal.throwIfAborted();const length=Math.min(PDF_READ_CHUNK_BYTES,before.size-offset);
      const bytes=await fs.readByteRange(target,{offset,length},signal);
      if(!(bytes instanceof Uint8Array)||bytes.length!==length)fail('vault_revision_conflict');
      hash.update(bytes);
    }
    signal.throwIfAborted();const after=await fs.stat(target,signal);signal.throwIfAborted();
    if(!after||after.type!=='file'||after.size!==before.size||after.version!==before.version)fail('vault_revision_conflict');
    const revision=hash.digest('hex').slice(0,24);
    cache.delete(key);cache.set(key,{version:before.version,size:before.size,revision});
    if(cache.size>PDF_HASH_CACHE_LIMIT)cache.delete(cache.keys().next().value);
    return revision;
  }).finally(()=>{job.done=true;if(jobs.get(key)===job)jobs.delete(key);});
  return job;
}

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
  const workspace=editorWorkspace??vaultScopes(ctx,exec,scope)[0],rootPath=resolveVaultRoot(workspace.path);
  const fs=ctx.fs,signal=exec.signal;
  // Cordis creates a fresh tracing proxy at each service access. Its public
  // original symbol supplies stable cache identity only; every IO still uses fs.
  const fsIdentity=fs[symbols.original]??fs;
  const checkAbort=()=>signal?.throwIfAborted();

  async function target(path,{readTemplate=false}={}) {
    checkAbort();
    const value=safeRelativePath(path);
    if(value.split('/').some(part=>part.startsWith('.')||pathKey(part)==='node_modules')||(!readTemplate&&pathKey(value.split('/')[0])==='_templates')) fail('vault_path_invalid');
    let absolute=rootPath;
    for(const part of value.split('/')){
      absolute=join(absolute,part);
      const item=await fs.lstat(absolute,undefined,signal);
      if(item?.type==='symlink') fail('vault_path_invalid');
    }
    const root=await fs.resolve(rootPath,{cwd:workspace.path,signal});
    const result=await fs.resolve(absolute,{cwd:workspace.path,signal});
    if(!fs.contains(root,result)) fail('vault_path_invalid');
    return result;
  }

  async function raw(path,maximum=MAX_FILE_BYTES,options) {
    const t=await target(path,options),before=await fs.stat(t,signal);
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
    // Templates are reference material, but remain excluded from scans and writes.
    const data=await raw(value,MAX_TEXT_BYTES,{readTemplate:true});
    if(expectedRevision!==undefined&&expectedRevision!==data.revision) fail('vault_reference_stale');
    return {...parseMarkdownDocument(value,Buffer.from(data.bytes).toString('utf8'),data.revision),workspaceId:workspace.id,ref:sourceRef(workspace.id,value,data.revision)};
  }
  async function readCode(path,expectedRevision) {
    const value=safeRelativePath(path);
    if(!isCodePath(value)) fail('vault_code_required');
    const data=await raw(value,MAX_TEXT_BYTES);
    if(expectedRevision!==undefined&&expectedRevision!==data.revision) fail('vault_reference_stale');
    const content=Buffer.from(data.bytes).toString('utf8');
    if(Buffer.from(content,'utf8').compare(Buffer.from(data.bytes))!==0) fail('vault_code_encoding_invalid');
    return {path:value,title:basename(value),kind:'code',content,revision:data.revision,workspaceId:workspace.id,ref:sourceRef(workspace.id,value,data.revision)};
  }
  async function readJson(path,expectedRevision) {
    const value=safeRelativePath(path);
    if(!value.toLowerCase().endsWith('.json')) fail('vault_json_required');
    const data=await raw(value,MAX_TEXT_BYTES),content=Buffer.from(data.bytes).toString('utf8');
    if(expectedRevision!==undefined&&expectedRevision!==data.revision) fail('vault_reference_stale');
    try { JSON.parse(content); } catch { fail('vault_json_invalid'); }
    return {path:value,title:basename(value),content,revision:data.revision,workspaceId:workspace.id,ref:sourceRef(workspace.id,value,data.revision)};
  }

  async function readAsset(path,expectedRevision) {
    const media=mediaForPath(path);
    const data=media.kind==='pdf'?await pdfSource(path):await raw(path);
    if(expectedRevision!==undefined&&expectedRevision!==data.revision) fail('vault_reference_stale');
    return {path,title:basename(path),kind:'asset',assetKind:media.kind,mime:media.mime,revision:data.revision,...(data.pdfSource?{pdfSource:data.pdfSource}:{bytes:data.bytes}),workspaceId:workspace.id,ref:sourceRef(workspace.id,path,data.revision)};
  }

  async function pdfSource(path) {
    const t=await target(path),before=await fs.stat(t,signal);
    if(!before) fail('vault_file_not_found');
    if(before.type!=='file') fail('vault_file_required');
    if(!Number.isSafeInteger(before.size)||before.size<0) fail('vault_pdf_size_unavailable');
    if(before.size>PDF_FILE_MAX_BYTES) fail('vault_pdf_too_large');
    if(typeof before.version!=='string'||!before.version) fail('vault_pdf_version_unavailable');
    if(typeof fs.readByteRange!=='function') fail('vault_pdf_range_unavailable');
    let cache=pdfRevisions.get(fsIdentity);if(!cache){cache=new Map();pdfRevisions.set(fsIdentity,cache);}
    const key=t.targetKey??t,hit=cache.get(key);
    let revision=before.version!==undefined&&hit?.version===before.version&&hit.size===before.size?hit.revision:undefined;
    const readWindow=async(offset,length,requestedSignal=signal)=>{
      checkAbort();requestedSignal?.throwIfAborted();
      const bytes=await fs.readByteRange(t,{offset,length},requestedSignal);
      if(!(bytes instanceof Uint8Array)||bytes.length!==length) fail('vault_revision_conflict');
      return bytes;
    };
    const unchanged=async(observe=false)=>{
      const after=await fs.stat(t,signal);
      if(!after||after.type!=='file'||after.size!==before.size||after.version!==before.version) fail('vault_revision_conflict');
      if(observe)ctx.emit?.('fs/observed',t,{kind:'present',version:after.version},exec);
    };
    if(revision===undefined){
      checkAbort();
      revision=await waitForPdfHash(pdfHashJob(fs,fsIdentity,key,t,before,cache),signal);
    }
    await unchanged(true);
    const recent=cache.get(key);
    if(recent?.version===before.version&&recent.size===before.size){cache.delete(key);cache.set(key,recent);}
    return {revision,pdfSource:{length:before.size,readRange:async(begin,end,requestedSignal)=>{
      if(!Number.isSafeInteger(begin)||!Number.isSafeInteger(end)||begin<0||end<begin||end>before.size) fail('pdf_range_invalid');
      // A corrupt cross-reference table can ask pdf.js to recover the entire
      // file. Reject that allocation rather than assembling 512 MiB at once.
      if(end-begin>PDF_RANGE_MAX_BYTES) fail('pdf_range_too_large');
      const combined=signal&&requestedSignal?AbortSignal.any([signal,requestedSignal]):requestedSignal??signal;
      await unchanged();
      const result=new Uint8Array(end-begin);
      for(let offset=begin;offset<end;offset+=PDF_READ_CHUNK_BYTES)result.set(await readWindow(offset,Math.min(PDF_READ_CHUNK_BYTES,end-offset),combined),offset-begin);
      await unchanged();return result;
    }}};
  }

  async function cachedRead(path,t,info) {
    const key=t?.targetKey??t,hit=scanCache.get(key);
    if(hit&&info.version!==undefined&&hit.version===info.version&&hit.workspaceId===workspace.id){
      ctx.emit?.('fs/observed',t,{kind:'present',version:info.version},exec);
      return hit.document;
    }
    const document=deepFreeze(await read(path));
    if(info.version!==undefined){
      scanCache.delete(key);scanCache.set(key,{version:info.version,workspaceId:workspace.id,document});
      if(scanCache.size>SCAN_CACHE_LIMIT)scanCache.delete(scanCache.keys().next().value);
    }
    return document;
  }

  async function scan({includeContent=true,limit=1000}={}) {
    checkAbort();
    const rootInfo=await fs.lstat(rootPath,undefined,signal);
    if(!rootInfo) return {documents:[],files:[],errors:[],truncated:false,workspaceId:workspace.id};
    if(rootInfo.type!=='directory') fail('vault_path_invalid');
    const root=await fs.resolve(rootPath,{cwd:workspace.path,signal});
    const documents=[],files=[],errors=[],versions=[];let truncated=false;
    async function walk(directory,prefix='') {
      for(const entry of await fs.listDir(directory,signal)) {
        checkAbort();
        if(files.length>=limit){truncated=true;return;}
        if(entry.name.startsWith('.')||pathKey(entry.name)==='_templates'||isToolCacheDirectory(entry.name)) continue;
        const path=prefix?`${prefix}/${entry.name}`:entry.name;
        try{
          const t=await target(path),info=await fs.stat(t,signal);
          if(info?.type==='directory'){await walk(t,path);continue;}
          if(info?.type!=='file') continue;
          versions.push([path,info.version??null,info.size??null]);
          const row={path,title:entry.name,kind:path.toLowerCase().endsWith('.md')?'page':'asset',size:info.size??null};
          files.push(row);
          if(includeContent&&row.kind==='page') documents.push(await cachedRead(path,t,info));
        }catch(error){if(error.name==='AbortError') throw error;errors.push({path,code:error.message});}
      }
    }
    await walk(root);
    // Native versions include inode/size/mtime/ctime, so a same-size external
    // edit, addition or deletion also invalidates read-only projections.
    const sourceRevision=versions.every(row=>typeof row[1]==='string')?projectionRevision([workspace.id,versions.sort((a,b)=>a[0].localeCompare(b[0])),documents.map(doc=>[doc.path,doc.revision]),errors,truncated]):null;
    return {documents,files,errors,truncated,workspaceId:workspace.id,sourceRevision};
  }

  async function saveText(path,content,expectedRevision,validate,readBack=read,onCommitted) {
    if(!writeApproved) fail('vault_write_approval_required');
    const bound=boundWrite?.workspaceId===workspace.id&&boundWrite?.path===path;
    if(!editorWorkspace&&!bound&&workspace.path!==vaultScopes(ctx,exec,'current')[0].path) fail('vault_write_scope_invalid');
    if(typeof content!=='string'||Buffer.byteLength(content)>MAX_TEXT_BYTES) fail('vault_content_invalid');
    safeRelativePath(path);validate(path,content);
    const t=await target(path),info=await fs.stat(t,signal);
    let expected={kind:'createIfAbsent'};
    if(info){
      if(expectedRevision===null||expectedRevision===undefined) fail('vault_revision_conflict');
      const current=await raw(path,MAX_TEXT_BYTES);
      if(current.revision!==expectedRevision) fail('vault_revision_conflict');
      expected={kind:'replaceIfVersion',version:current.nativeVersion};
    }else if(expectedRevision!==null) fail('vault_revision_conflict');
    else portablePath(path);
    const policy=editorWorkspace||bound?{mode:'workspace-write',workspaceRoot:workspace.path}:ctx.get?.('sandboxPolicy')?.resolve({session:exec.agent.session,mode:'workspace-write'})??{mode:'workspace-write',workspaceRoot:workspace.path};
    try{
      const result=await fs.writeText(t,content,expected,signal,policy);
      // Internal multi-file operations need the receipt even if observation/read-back fails.
      onCommitted?.({path,revision:revisionFor(content)});
      ctx.emit?.('fs/observed',t,{kind:'present',version:result.version},exec);
    }catch(error){if(['FS_STALE_VERSION','FS_NOT_OBSERVED'].includes(error.code)) fail('vault_revision_conflict');throw error;}
    return readBack(path);
  }
  async function save(path,content,expectedRevision,onCommitted) {
    return saveText(path,content,expectedRevision,(targetPath,value)=>parseMarkdownDocument(targetPath,value),read,onCommitted);
  }
  async function saveCode(path,content,expectedRevision,onCommitted) {
    return saveText(path,content,expectedRevision,(targetPath,value)=>{
      const normalized=safeRelativePath(targetPath);
      if(!isCodePath(normalized)) fail('vault_code_required');
      if(pathKey(normalized.split('/')[0])==='lesson-board') fail('board_path_reserved');
      if(pathKey(normalized.split('/')[0])===pathKey('技能')) fail('skill_path_reserved');
    },readCode,onCommitted);
  }
  async function saveJson(path,content,expectedRevision,onCommitted) {
    return saveText(path,content,expectedRevision,(targetPath,value)=>{
      const normalized=safeRelativePath(targetPath);
      if(!normalized.toLowerCase().endsWith('.json')) fail('vault_json_required');
      try { JSON.parse(value); } catch { fail('vault_json_invalid'); }
    },readJson,onCommitted);
  }
  return {workspace,rootPath,signal,read,readCode,readJson,readAsset,scan,save,saveCode,saveJson};
}

/** Authenticated editor actions carry their workspace from the Host, not from
 * model arguments. They share the exact writer and native CAS with agent IO. */
export function createEditorVaultIO(ctx,workspacePath,signal=new AbortController().signal) {
  const workspace=ctx.get?.('workspaceRegistry')?.list().find(row=>resolve(row.path)===resolve(workspacePath))??{id:resolve(workspacePath),path:resolve(workspacePath),title:basename(workspacePath)};
  return createAgentVaultIO(ctx,{signal},{editorWorkspace:workspace,writeApproved:true});
}
