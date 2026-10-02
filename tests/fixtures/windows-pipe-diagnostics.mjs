// Ignored diagnostic. Does not change tokens, default DACLs, or sandbox policy.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import koffi from 'koffi';
import { AclSandbox, workspaceWriteSid, tempWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl';

const self=fileURLToPath(import.meta.url);
const hash=value=>createHash('sha256').update(value).digest('hex');
const kernel=koffi.load('kernel32.dll'),advapi=koffi.load('advapi32.dll');
const bind=(dll,signature)=>dll.func(signature);
const api={
  current:bind(kernel,'void * __stdcall GetCurrentProcess()'),
  error:bind(kernel,'uint32_t __stdcall GetLastError()'),
  clearError:bind(kernel,'void __stdcall SetLastError(uint32_t)'),
  close:bind(kernel,'int __stdcall CloseHandle(void *)'),
  free:bind(kernel,'void * __stdcall LocalFree(void *)'),
  token:bind(advapi,'int __stdcall OpenProcessToken(void *,uint32_t,_Out_ void **)'),
  tokenInfo:bind(advapi,'int __stdcall GetTokenInformation(void *,uint32_t,void *,uint32_t,_Out_ uint32_t *)'),
  restricted:bind(advapi,'int __stdcall IsTokenRestricted(void *)'),
  sidString:bind(advapi,'int __stdcall ConvertSidToStringSidW(const void *,_Out_ void **)'),
  ace:bind(advapi,'int __stdcall GetAce(const void *,uint32_t,_Out_ void **)'),
  pipe:bind(kernel,'int __stdcall CreatePipe(_Out_ void **,_Out_ void **,const void *,uint32_t)'),
  write:bind(kernel,'int __stdcall WriteFile(void *,const void *,uint32_t,_Out_ uint32_t *,void *)'),
  read:bind(kernel,'int __stdcall ReadFile(void *,void *,uint32_t,_Out_ uint32_t *,void *)'),
  std:bind(kernel,'void * __stdcall GetStdHandle(int32_t)'),
  type:bind(kernel,'uint32_t __stdcall GetFileType(void *)'),
};
function info(token,kind){
  const size=[0];api.tokenInfo(token,kind,null,0,size);
  if(!size[0])throw new Error(`TokenInfo(${kind}) size ${api.error()}`);
  const value=Buffer.alloc(size[0]);
  if(!api.tokenInfo(token,kind,value,value.length,size))throw new Error(`TokenInfo(${kind}) ${api.error()}`);
  return value;
}
function sid(ptr){
  const out=[null];
  if(!api.sidString(ptr,out))return `invalid-${api.error()}`;
  try{return koffi.decode(out[0],'char16_t',-1);}finally{api.free(out[0]);}
}
function describeToken(expected){
  const out=[null];if(!api.token(api.current(),8,out))throw new Error(`OpenToken ${api.error()}`);
  const token=out[0];
  try{
    const user=sid(koffi.decode(info(token,1),0,'void *'));
    const names=new Map([[user,'current-user'],['S-1-5-32-544','administrators'],['S-1-5-18','system'],['S-1-1-0','everyone'],['S-1-5-11','authenticated-users'],['S-1-5-4','interactive'],[expected.workspaceSid,'workspace-write'],[expected.tempSid,'temp-write']]);
    const principal=value=>names.get(value)??`sid-sha256:${hash(value).slice(0,16)}`;
    const groups=kind=>{
      const value=info(token,kind),count=value.readUInt32LE(0),rows=[];
      for(let i=0;i<count;i++)rows.push({principal:principal(sid(koffi.decode(value,8+i*16,'void *'))),attributes:`0x${value.readUInt32LE(16+i*16).toString(16)}`});
      return rows;
    };
    const acl=koffi.decode(info(token,6),0,'void *'),aces=[];
    if(acl){
      const header=Buffer.from(koffi.decode(acl,koffi.array('uint8_t',8)));
      for(let i=0;i<header.readUInt16LE(4);i++){
        const ace=[null];if(!api.ace(acl,i,ace))throw new Error(`GetAce ${api.error()}`);
        const head=Buffer.from(koffi.decode(ace[0],koffi.array('uint8_t',8))),size=head.readUInt16LE(2);
        const bytes=Buffer.from(koffi.decode(ace[0],koffi.array('uint8_t',size)));
        aces.push({type:head[0],flags:head[1],mask:`0x${head.readUInt32LE(4).toString(16)}`,principal:head[0]<=3?principal(sid(bytes.subarray(8))):'object-or-other-ace'});
      }
    }
    const integrity=sid(koffi.decode(info(token,25),0,'void *'));
    const il=new Map([['S-1-16-0','untrusted'],['S-1-16-4096','low'],['S-1-16-8192','medium'],['S-1-16-12288','high'],['S-1-16-16384','system']]);
    return {elevated:!!info(token,20).readUInt32LE(0),elevationType:info(token,18).readUInt32LE(0),restricted:!!api.restricted(token),integrity:il.get(integrity)??'other',groups:groups(2),restrictingSids:groups(11),defaultDaclNull:!acl,defaultDacl:aces};
  }finally{api.close(token);}
}
function nativePipes(){
  const results=[];
  for(const inherit of [false,true]){
    const attrs=inherit?Buffer.alloc(24):null;
    if(attrs){attrs.writeUInt32LE(24,0);attrs.writeUInt32LE(1,16);}
    const read=[null],write=[null];api.clearError(0);
    const ok=!!api.pipe(read,write,attrs,4096),win32=ok?0:api.error();
    const row={api:'CreatePipe',inherit,ok,win32};
    try{
      if(ok){const bytes=Buffer.from('pipe-ok'),written=[0],received=[0],target=Buffer.alloc(bytes.length);row.writeOk=!!api.write(write[0],bytes,bytes.length,written,null);row.readOk=!!api.read(read[0],target,target.length,received,null);row.roundTrip=received[0]===bytes.length&&target.equals(bytes);}
    }finally{if(read[0])api.close(read[0]);if(write[0])api.close(write[0]);}
    results.push(row);
  }
  for(const dll of ['msvcrt.dll','ucrtbase.dll']){
    const crt=koffi.load(dll),pipe=bind(crt,'int __cdecl _pipe(_Out_ int *,uint32_t,int)'),close=bind(crt,'int __cdecl _close(int)'),read=bind(crt,'int __cdecl _read(int,void *,uint32_t)'),write=bind(crt,'int __cdecl _write(int,const void *,uint32_t)'),errno=bind(crt,'int * __cdecl _errno()');
    let doserrno;try{doserrno=bind(crt,'uint32_t * __cdecl __doserrno()');}catch{}
    for(const noInherit of [false,true]){
      const fds=[-1,-1];koffi.encode(errno(),'int',0);api.clearError(0);
      const result=pipe(fds,4096,0x8000|(noInherit?0x80:0)),win32=api.error();
      const row={api:`${dll}!_pipe`,noInherit,ok:result===0,errno:koffi.decode(errno(),'int'),doserrno:doserrno?koffi.decode(doserrno(),'uint32_t'):null,win32};
      try{if(result===0){const bytes=Buffer.from('pipe-ok'),target=Buffer.alloc(bytes.length);row.writeCount=write(fds[1],bytes,bytes.length);row.readCount=read(fds[0],target,target.length);row.roundTrip=target.equals(bytes);}}finally{if(fds[0]>=0)close(fds[0]);if(fds[1]>=0)close(fds[1]);}
      results.push(row);
    }
  }
  return results;
}
if(process.argv[2]==='--native-child'){
  const expected=JSON.parse(process.argv[3]);
  console.log(JSON.stringify({case:expected.label,node:process.version,token:describeToken(expected),stdio:[-10,-11,-12].map(value=>({kind:value,type:api.type(api.std(value))})),pipes:nativePipes()}));
}else{
  if(process.platform!=='win32')throw new Error('Windows-only probe');
  const binary=await realpath(resolve(process.argv[2]??process.env.NOTARA_WINDOWS_POSIX??join(dirname(self),'busybox-w64u-FRP-6075-g169694ebd.exe')));
  const expectedHash='6e263d154d8548d1eb936f65d1d8312c80df31c45974e48d6335e4dcc0f4f34c';
  if(hash(await readFile(binary))!==expectedHash)throw new Error('Pinned binary hash mismatch');
  const ambientTemp=await realpath(tmpdir()),base=await realpath(await mkdtemp(join(ambientTemp,'notara-ci-pipe-')));
  const workspace=join(base,'workspace'),temp=join(base,'private-temp');await mkdir(workspace);await mkdir(temp);
  const expected={workspaceSid:workspaceWriteSid(workspace),tempSid:tempWriteSid(temp)};
  const oldTemp=process.env.TEMP,oldTmp=process.env.TMP,oldLang=process.env.LANG,oldLc=process.env.LC_ALL,oldBb=process.env.BB_OVERRIDE_APPLETS;
  Object.assign(process.env,{TEMP:temp,TMP:temp,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',BB_OVERRIDE_APPLETS:''});
  const clean=value=>value.replaceAll(base,'<fixture>').replaceAll(base.replaceAll('\\','/'),'<fixture>').replaceAll(binary,'<busybox>');
  const scripts=[['builtin','printf builtin-ok'],['pipeline',"printf 'pipe-ok\\n' | cat"],['heredoc',"cat <<'EOF'\nheredoc-ok\nEOF\n"],['substitution','value=$(printf substitution-ok); printf "%s\\n" "$value"']];
  const run=async(label,command,args,sandbox)=>{
    let child;
    if(sandbox){child=sandbox.spawn({command,args,cwd:workspace});}
    else{
      const process=spawn(command,args,{cwd:workspace,stdio:['ignore','pipe','pipe'],windowsHide:true}),stdout=[],stderr=[];
      process.stdout.on('data',value=>stdout.push(value));process.stderr.on('data',value=>stderr.push(value));
      child={pid:process.pid,wait:()=>new Promise((resolve,reject)=>{process.on('error',reject);process.on('close',exitCode=>resolve({exitCode,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr)}));})};
    }
    const timer=setTimeout(()=>{try{process.kill(child.pid);}catch{}},15000);
    try{const result=await child.wait();console.log(JSON.stringify({case:label,exitCode:result.exitCode,stdout:clean(result.stdout.toString()),stderr:clean(result.stderr.toString())}));}finally{clearTimeout(timer);}
  };
  try{
    for(const mode of ['host','read-only','workspace-write']){
      const sandbox=mode==='host'?null:new AclSandbox(mode==='read-only'?{mode,writableDirs:[],tempDir:null}:{mode,writableDirs:[workspace],tempDir:temp,writeSid:expected.workspaceSid,tempWriteSid:expected.tempSid});
      try{
        await sandbox?.init();
        await run(`${mode}/native`,process.execPath,[self,'--native-child',JSON.stringify({...expected,label:mode})],sandbox);
        for(const [name,source]of scripts){const path=join(base,`${mode}-${name}.sh`);await writeFile(path,source,'utf8');await run(`${mode}/busybox-${name}`,binary,['ash',path.replaceAll('\\','/')],sandbox);}
      }finally{sandbox?.dispose();}
    }
  }finally{
    for(const [key,value]of Object.entries({TEMP:oldTemp,TMP:oldTmp,LANG:oldLang,LC_ALL:oldLc,BB_OVERRIDE_APPLETS:oldBb})){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    if(dirname(base)!==ambientTemp||!base.startsWith(join(ambientTemp,'notara-ci-pipe-')))throw new Error('Unexpected fixture cleanup target');
    await rm(base,{recursive:true,force:true});
  }
}
