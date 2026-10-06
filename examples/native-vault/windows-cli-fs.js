import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep, toNamespacedPath } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { FsError } from '@deepseek-ai/dsh-fs';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';

// This provider is used only by the trusted Windows CLI broker. Untrusted shell
// processes retain their native restricted token. Directory handles close the
// junction race that a trusted-code-only canonical-path fence cannot close.
let native;
async function win32() {
  if(native)return native;
  const koffi=(await import('koffi')).default;
  const kernel=koffi.load('kernel32.dll'),advapi=koffi.load('advapi32.dll');
  const bind=(library,signature)=>library.func(signature);
  native={koffi,
    createFile:bind(kernel,'void * __stdcall CreateFileW(const char16_t *,uint32_t,uint32_t,const void *,uint32_t,uint32_t,void *)'),
    createDirectory:bind(kernel,'int __stdcall CreateDirectoryW(const char16_t *,const void *)'),
    close:bind(kernel,'int __stdcall CloseHandle(void *)'),
    info:bind(kernel,'int __stdcall GetFileInformationByHandle(void *,void *)'),
    finalPath:bind(kernel,'uint32_t __stdcall GetFinalPathNameByHandleW(void *,void *,uint32_t,uint32_t)'),
    error:bind(kernel,'uint32_t __stdcall GetLastError()'),
    currentProcess:bind(kernel,'void * __stdcall GetCurrentProcess()'),
    openToken:bind(advapi,'int __stdcall OpenProcessToken(void *,uint32_t,_Out_ void **)'),
    tokenInfo:bind(advapi,'int __stdcall GetTokenInformation(void *,uint32_t,void *,uint32_t,_Out_ uint32_t *)'),
    sidString:bind(advapi,'int __stdcall ConvertSidToStringSidW(void *,_Out_ void **)'),
    sddl:bind(advapi,'int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(const char16_t *,uint32_t,_Out_ void **,_Out_ uint32_t *)'),
    free:bind(kernel,'void * __stdcall LocalFree(void *)'),
    getSecurity:bind(advapi,'int __stdcall GetFileSecurityW(const char16_t *,uint32_t,void *,uint32_t,_Out_ uint32_t *)'),
    setSecurity:bind(advapi,'int __stdcall SetFileSecurityW(const char16_t *,uint32_t,const void *)'),
    getSacl:bind(advapi,'int __stdcall GetSecurityDescriptorSacl(const void *,_Out_ int *,_Out_ void **,_Out_ int *)'),
    getDacl:bind(advapi,'int __stdcall GetSecurityDescriptorDacl(const void *,_Out_ int *,_Out_ void **,_Out_ int *)'),
    setNamed:bind(advapi,'uint32_t __stdcall SetNamedSecurityInfoW(const char16_t *,uint32_t,uint32_t,void *,void *,void *,void *)'),
    setInfo:bind(advapi,'uint32_t __stdcall SetSecurityInfo(void *,uint32_t,uint32_t,void *,void *,void *,void *)'),
    replace:bind(kernel,'int __stdcall ReplaceFileW(const char16_t *,const char16_t *,const char16_t *,uint32_t,void *,void *)'),
  };
  return native;
}
function denied(message='Windows CLI path is outside the authorized workspace') {
  return new FsError(message,'FS_SANDBOX_DENIED');
}
function nativeError(api,operation,path,code=api.error()) {
  const error=new Error(`${operation} failed (Win32 ${code}): ${path}`);
  error.code=code===2||code===3?'ENOENT':code===5?'EACCES':'EIO';
  error.win32Code=code;
  return error;
}
function invalid(api,handle) {
  return !handle||api.koffi.address(handle)===0xffffffffffffffffn;
}
function samePath(left,right) {return resolve(left).toLowerCase()===resolve(right).toLowerCase();}
function inside(root,path) {
  const difference=relative(root,path);
  return difference===''||(!isAbsolute(difference)&&difference!=='..'&&!difference.startsWith(`..${sep}`));
}
function plainFinalPath(value) {
  if(value.startsWith('\\\\?\\UNC\\'))throw denied('Windows CLI broker requires a local workspace');
  return value.startsWith('\\\\?\\')?value.slice(4):value;
}
function handleInfo(api,handle,path) {
  const value=Buffer.alloc(52);
  if(!api.info(handle,value))throw nativeError(api,'GetFileInformationByHandle',path);
  const attributes=value.readUInt32LE(0);
  const name=Buffer.alloc(65536);
  const length=api.finalPath(handle,name,32768,0);
  if(!length||length>=32768)throw nativeError(api,'GetFinalPathNameByHandleW',path);
  return {directory:!!(attributes&0x10),reparse:!!(attributes&0x400),path:plainFinalPath(name.toString('utf16le',0,length*2))};
}
function security(api,path,information) {
  const needed=[0];
  api.getSecurity(toNamespacedPath(path),information,null,0,needed);
  if(!needed[0])throw nativeError(api,'GetFileSecurityW',path);
  const descriptor=Buffer.alloc(needed[0]);
  if(!api.getSecurity(toNamespacedPath(path),information,descriptor,descriptor.length,needed))throw nativeError(api,'GetFileSecurityW',path);
  return descriptor.subarray(0,needed[0]);
}
function copyDacl(api,source,destination) {
  // Exactly the locked native provider's protected-DACL copy, before contents.
  const descriptor=security(api,source,4);
  if(!api.setSecurity(toNamespacedPath(destination),0x80000004,descriptor))throw nativeError(api,'SetFileSecurityW',destination);
}
function labelFor(api,path) {return security(api,path,16);}
function restoreLabel(api,handle,descriptor,path) {
  const present=[0],sacl=[null],defaulted=[0];
  if(!api.getSacl(descriptor,present,sacl,defaulted))throw nativeError(api,'GetSecurityDescriptorSacl',path);
  // No explicit label means the ordinary implicit Medium label; staging is
  // already Medium. Explicit workspace labels are restored on this inode only.
  if(!present[0]||!sacl[0])return;
  const error=api.setInfo(handle,1,16,null,null,null,sacl[0]);
  if(error)throw nativeError(api,'SetSecurityInfo(LABEL)',path,error);
}
function inheritDacl(api,path) {
  const empty=descriptor(api,'D:');
  try {
    const present=[0],acl=[null],defaulted=[0];
    if(!api.getDacl(empty,present,acl,defaulted)||!present[0]||!acl[0])throw nativeError(api,'GetSecurityDescriptorDacl',path);
    const error=api.setNamed(toNamespacedPath(path),1,0x20000004,null,null,acl[0],null);
    if(error)throw nativeError(api,'SetNamedSecurityInfoW(inheritance)',path,error);
  }finally{api.free(empty);}
}
function metadataHandle(api,path) {
  // Security-only access does not conflict with ReplaceFileW's exclusive data
  // handle. Acquire WRITE_OWNER before copying a possibly narrow source DACL.
  const handle=api.createFile(toNamespacedPath(path),0x000a0000,7,null,3,0x00200000,null);
  if(invalid(api,handle))throw nativeError(api,'CreateFileW(metadata)',path);
  const info=handleInfo(api,handle,path);
  if(info.reparse||info.directory){api.close(handle);throw denied('Invalid Windows CLI staging file');}
  return handle;
}
function descriptor(api,sddl) {
  const result=[null],length=[0];
  if(!api.sddl(sddl,1,result,length))throw nativeError(api,'ConvertStringSecurityDescriptorToSecurityDescriptorW','');
  return result[0];
}
function attributes(api,sd) {
  const value=Buffer.alloc(24);
  value.writeUInt32LE(24,0);
  value.writeBigUInt64LE(api.koffi.address(sd),8);
  return value;
}
function currentSid(api) {
  const token=[null];
  if(!api.openToken(api.currentProcess(),8,token))throw nativeError(api,'OpenProcessToken','');
  try {
    const needed=[0];api.tokenInfo(token[0],1,null,0,needed);
    const user=Buffer.alloc(needed[0]);
    if(!needed[0]||!api.tokenInfo(token[0],1,user,user.length,needed))throw nativeError(api,'GetTokenInformation(TokenUser)','');
    const result=[null];
    if(!api.sidString(api.koffi.decode(user,0,'void *'),result))throw nativeError(api,'ConvertSidToStringSidW','');
    try{return api.koffi.decode(result[0],'char16_t',-1);}finally{api.free(result[0]);}
  }finally{api.close(token[0]);}
}

/** Execute one validated command using the locked native atomic writer, with
 * handles pinning its workspace namespace and Medium staging private to Host. */
export async function withWindowsCliFileSystem(workspaceRoot,signal,run) {
  if(process.platform!=='win32')throw new Error('Windows CLI filesystem is Windows-only');
  signal?.throwIfAborted();
  const suppliedRoot=resolve(workspaceRoot);
  const root=await realpath(workspaceRoot);
  if(!isAbsolute(root)||root.startsWith('\\\\'))throw denied('Windows CLI broker requires a local workspace');
  const api=await win32(),pins=new Map();
  let context,privateDacl,primaryFailure;
  const markers=[];
  const operationRoots=[];
  const check=()=>signal?.throwIfAborted();
  function checked(path) {
    check();
    let absolute=resolve(path);
    if(!samePath(suppliedRoot,root)&&inside(suppliedRoot,absolute))absolute=join(root,relative(suppliedRoot,absolute));
    if(!inside(root,absolute))throw denied();
    return absolute;
  }
  function pinDirectory(path) {
    path=checked(path);
    const key=path.toLowerCase();
    if(pins.has(key))return;
    const handle=api.createFile(toNamespacedPath(path),0x00100081,1,null,3,0x02200000,null);
    if(invalid(api,handle))throw nativeError(api,'CreateFileW(directory pin)',path);
    try {
      const info=handleInfo(api,handle,path);
      if(!info.directory||info.reparse||!samePath(info.path,path))throw denied('Windows CLI refuses reparse-point directories');
      // Publication needs directory write sharing. Keep this no-write pin until
      // a held, protected file makes the directory nonempty: Windows rejects
      // FSCTL_SET_REPARSE_POINT[_EX] on nonempty directories. The marker's
      // no-delete handle keeps that invariant; the directory remains no-delete.
      const marker=join(path,`.notara-cli-pin-${randomUUID()}.tmp`);
      const markerHandle=api.createFile(toNamespacedPath(marker),0x001b0089,3,attributes(api,privateDacl),1,0x00200002,null);
      if(invalid(api,markerHandle))throw nativeError(api,'CreateFileW(directory marker)',marker);
      markers.push({path:marker,handle:markerHandle});
      const medium=descriptor(api,'S:(ML;;NW;;;ME)');
      try{restoreLabel(api,markerHandle,medium,marker);}finally{api.free(medium);}
      const publicationPin=api.createFile(toNamespacedPath(path),0x00100081,3,null,3,0x02200000,null);
      if(invalid(api,publicationPin))throw nativeError(api,'CreateFileW(directory publication pin)',path);
      pins.set(key,publicationPin);
      api.close(handle);
    }catch(error){api.close(handle);throw error;}
  }
  async function parents(path,create=false) {
    path=checked(path);
    pinDirectory(root);
    if(samePath(path,root))return true;
    let current=root;
    for(const part of relative(root,dirname(path)).split(sep).filter(Boolean)) {
      current=join(current,part);
      try{pinDirectory(current);}catch(error){
        if(error.code!=='ENOENT')throw error;
        if(!create)return false;
        // Parent is already pinned. An attacker winning this name race is
        // detected by the no-follow handle before any contents are written.
        let created=false;
        try{await mkdir(current);created=true;}catch(failure){if(failure.code!=='EEXIST')throw failure;}
        if(created&&!api.setSecurity(toNamespacedPath(current),0x80000004,privateDacl))throw nativeError(api,'SetFileSecurityW(new directory owner)',current);
        pinDirectory(current);
        if(created) {
          const labelHandle=api.createFile(toNamespacedPath(current),0x000a0000,7,null,3,0x02200000,null);
          try {
            if(invalid(api,labelHandle))throw nativeError(api,'CreateFileW(new directory label)',current);
            inheritDacl(api,current);
            restoreLabel(api,labelHandle,labelFor(api,root),current);
          }finally{if(labelHandle&&!invalid(api,labelHandle))api.close(labelHandle);}
        }
      }
    }
    return true;
  }
  function pinLeaf(path,{optional=false}={}) {
    const handle=api.createFile(toNamespacedPath(path),0x00120089,1,null,3,0x02200000,null);
    if(invalid(api,handle)) {
      const error=nativeError(api,'CreateFileW(leaf pin)',path);
      if(optional&&error.code==='ENOENT')return null;
      throw error;
    }
    try {
      const info=handleInfo(api,handle,path);
      if(info.reparse||!samePath(info.path,path))throw denied('Windows CLI refuses reparse-point files');
      return {handle,directory:info.directory};
    }catch(error){api.close(handle);throw error;}
  }
  async function readPinned(path,operation,{optional=false}={}) {
    path=checked(path);
    if(!await parents(path))return operation();
    const leaf=pinLeaf(path,{optional});
    try{return await operation();}finally{if(leaf)api.close(leaf.handle);}
  }
  try {
    privateDacl=descriptor(api,`D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;${currentSid(api)})`);
    pinDirectory(root);
    context=new Context();
    const base=new LocalFileSystem(context,{cwd:root,diffBasisMaxBytes:10*1024*1024});
    const filesystem={
      processPath:target=>base.processPath(target),
      contains:(parent,child)=>base.contains(parent,child),
      async resolve(path,options) {
        const absolute=checked(resolve(options?.cwd??root,path));
        await parents(absolute);
        const target=await base.resolve(absolute,{...options,cwd:root});
        checked(base.processPath(target));
        return target;
      },
      async lstat(path,options,requestedSignal) {
        const absolute=checked(resolve(options?.cwd??root,path));
        await parents(absolute);
        return base.lstat(absolute,{cwd:root},requestedSignal??signal);
      },
      async stat(target,requestedSignal) {
        const path=checked(base.processPath(target));
        return readPinned(path,()=>base.stat(target,requestedSignal??signal),{optional:true});
      },
      async readText(target,requestedSignal) {
        return readPinned(base.processPath(target),()=>base.readText(target,requestedSignal??signal));
      },
      async readBytes(target,requestedSignal,maximum) {
        return readPinned(base.processPath(target),()=>base.readBytes(target,requestedSignal??signal,maximum));
      },
      async readByteRange(target,range,requestedSignal) {
        return readPinned(base.processPath(target),()=>base.readByteRange(target,range,requestedSignal??signal));
      },
      async listDir(target,requestedSignal) {
        return readPinned(base.processPath(target),()=>base.listDir(target,requestedSignal??signal));
      },
      async writeText(target,content,expected,requestedSignal,policy) {
        check();requestedSignal?.throwIfAborted();
        if(policy?.mode!=='workspace-write'||typeof policy.workspaceRoot!=='string'||(!samePath(policy.workspaceRoot,root)&&!samePath(policy.workspaceRoot,suppliedRoot)))throw denied('Windows CLI write requires its bound workspace policy');
        const path=checked(base.processPath(target));
        await parents(path,true);
        const leaf=pinLeaf(path,{optional:true});
        let leafHandle=leaf?.handle,publicationHandle,snapshotHandle,snapshot;
        const releaseLeaf=()=>{if(leafHandle){api.close(leafHandle);leafHandle=null;}};
        try {
        const operationRoot=join(dirname(path),`.notara-cli-op-${randomUUID()}`);
        if(!api.createDirectory(toNamespacedPath(operationRoot),attributes(api,privateDacl)))throw nativeError(api,'CreateDirectoryW(operation staging)',operationRoot);
        operationRoots.push(operationRoot);
        const operationHandle=api.createFile(toNamespacedPath(operationRoot),0x000a0000,7,null,3,0x02200000,null);
        const medium=descriptor(api,'S:(ML;OICI;NW;;;ME)');
        try {
          if(invalid(api,operationHandle))throw nativeError(api,'CreateFileW(operation staging label)',operationRoot);
          restoreLabel(api,operationHandle,medium,operationRoot);
        }finally{if(operationHandle&&!invalid(api,operationHandle))api.close(operationHandle);api.free(medium);}
        pinDirectory(operationRoot);
        inheritDacl(api,operationRoot);
        snapshot=join(operationRoot,`${randomUUID()}-${basename(path)}`);
          if(leaf?.directory)throw new FsError('cannot write a directory','FS_NOT_REGULAR_FILE');
          const existing=leaf?await base.stat(target,signal):undefined;
          if(expected?.kind==='createIfAbsent'&&existing)throw new FsError('file already exists','FS_NOT_OBSERVED');
          if(expected?.kind==='replaceIfVersion'&&(!existing||expected.version!==existing.version))throw new FsError('file changed since observation','FS_STALE_VERSION');
          if(!expected)throw denied('Windows CLI writes require a native observation guard');
          const label=labelFor(api,existing?path:dirname(path));
          if(existing) {
            const original=await base.readText(target,signal);
            snapshotHandle=await open(snapshot,'wx',0o600);
            copyDacl(api,path,snapshot);
            await snapshotHandle.writeFile(original,'utf8');await snapshotHandle.sync();
            await snapshotHandle.close();snapshotHandle=null;
          }
          const mutationContext=new Context();
          let outcome;
          try {
          const mutation=new LocalFileSystem(mutationContext,{cwd:operationRoot,diffBasisMaxBytes:10*1024*1024});
          mutation.internals={
            tempDirName:()=>`.${randomUUID()}.tmpdir`,
            copyFileDacl(source,destination) {
              // Acquire label rights on the Host-owned inode before applying
              // the source's narrower DACL. Medium staging excludes Low writers.
              if(!api.setSecurity(toNamespacedPath(destination),0x80000004,privateDacl))throw nativeError(api,'SetFileSecurityW(staging owner)',destination);
              publicationHandle=metadataHandle(api,destination);
              copyDacl(api,source,destination);
            },
            inspectTemp({tempPath}) {
              if(!publicationHandle) {
                if(!api.setSecurity(toNamespacedPath(tempPath),0x80000004,privateDacl))throw nativeError(api,'SetFileSecurityW(staging owner)',tempPath);
                publicationHandle=metadataHandle(api,tempPath);
                inheritDacl(api,tempPath);
              }
            },
            replaceFile(_source,replacement) {
              check();requestedSignal?.throwIfAborted();
              releaseLeaf();
              // ReplaceFileW opens the final replaced entry without following
              // reparse points, and retains its ordinary ACL/metadata merge.
              if(!api.replace(toNamespacedPath(path),toNamespacedPath(replacement),null,0,null,null)) {
                const error=nativeError(api,'ReplaceFileW',path);
                if(error.code==='ENOENT')throw new FsError('file vanished before publication','FS_STALE_VERSION');
                throw error;
              }
              restoreLabel(api,publicationHandle,label,path);
            },
            async linkFile(replacement) {
              check();requestedSignal?.throwIfAborted();
              await link(replacement,path);
              restoreLabel(api,publicationHandle,label,path);
            },
            inspectPublicationTarget:()=>lstat(path,{bigint:true}),
          };
          const source=await mutation.resolve(snapshot,{cwd:operationRoot,signal});
          const guarded=existing?{kind:'replaceIfVersion',version:(await mutation.stat(source,signal)).version}:{kind:'createIfAbsent'};
          outcome=await mutation.writeText(source,content,guarded,requestedSignal??signal);
          }finally{await mutationContext.fiber.dispose();}
          const published=await filesystem.stat(target,requestedSignal??signal);
          if(!published)throw new FsError('published file disappeared','FS_STALE_VERSION');
          return {...outcome,operation:existing?'update':'create',version:published.version};
        }finally {
          releaseLeaf();
          if(publicationHandle)api.close(publicationHandle);
          if(snapshotHandle)await snapshotHandle.close();
          if(snapshot)await rm(snapshot,{force:true});
        }
      },
    };
    return await run(filesystem);
  }catch(error){primaryFailure=error;throw error;
  }finally {
    const failures=[];
    if(context)try{await context.fiber.dispose();}catch(error){failures.push(error);}
    for(const marker of markers.reverse()) {
      try{if(!api.close(marker.handle))throw nativeError(api,'CloseHandle(directory marker)',marker.path);}catch(error){failures.push(error);}
      try{await rm(marker.path,{force:true});}catch(error){failures.push(error);}
    }
    for(const handle of [...pins.values()].reverse())try{if(!api.close(handle))throw nativeError(api,'CloseHandle(directory pin)',root);}catch(error){failures.push(error);}
    if(privateDacl)api.free(privateDacl);
    for(const directory of operationRoots.reverse())try{await rm(directory,{recursive:true,force:true});}catch(error){failures.push(error);}
    if(failures.length){if(primaryFailure)primaryFailure.cleanupErrors=failures;else throw new AggregateError(failures,'Windows CLI filesystem cleanup failed');}
  }
}
