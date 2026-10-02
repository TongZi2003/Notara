// Only this disposable helper changes its own original TokenDefaultDacl.
// The Vitest/DSH parent token and user data are never touched.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import koffi from 'koffi';
import { AclSandbox, workspaceWriteSid, tempWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl';

const kernel=koffi.load('kernel32.dll'),advapi=koffi.load('advapi32.dll');
const api={
  current:kernel.func('void * __stdcall GetCurrentProcess()'),
  error:kernel.func('uint32_t __stdcall GetLastError()'),
  close:kernel.func('int __stdcall CloseHandle(void *)'),
  free:kernel.func('void * __stdcall LocalFree(void *)'),
  token:advapi.func('int __stdcall OpenProcessToken(void *,uint32_t,_Out_ void **)'),
  info:advapi.func('int __stdcall GetTokenInformation(void *,uint32_t,void *,uint32_t,_Out_ uint32_t *)'),
  set:advapi.func('int __stdcall SetTokenInformation(void *,uint32_t,void *,uint32_t)'),
  sddl:advapi.func('int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(const char16_t *,uint32_t,_Out_ void **,_Out_ uint32_t *)'),
  dacl:advapi.func('int __stdcall GetSecurityDescriptorDacl(void *,_Out_ int *,_Out_ void **,_Out_ int *)'),
};
const check=(ok,name)=>{if(!ok)throw new Error(`${name}: Win32 ${api.error()}`);};
function tokenInfo(token,kind){const size=[0];api.info(token,kind,null,0,size);assert.ok(size[0]);const value=Buffer.alloc(size[0]);check(api.info(token,kind,value,value.length,size),'GetTokenInformation');return value;}
function setDefault(token,acl){const value=Buffer.alloc(8);value.writeBigUInt64LE(koffi.address(acl));check(api.set(token,6,value,value.length),'SetTokenInformation(DefaultDacl)');}
function adminDefault(token){
  const descriptor=[null],size=[0];
  check(api.sddl('D:(A;;FA;;;SY)(A;;FA;;;BA)',1,descriptor,size),'Synthetic admin default DACL');
  try{const present=[0],acl=[null],defaulted=[0];check(api.dacl(descriptor[0],present,acl,defaulted),'GetSecurityDescriptorDacl');assert.equal(present[0],1);assert.ok(acl[0]);setDefault(token,acl[0]);}finally{api.free(descriptor[0]);}
}
async function run(sandbox,command,args,cwd){
  const child=sandbox.spawn({command,args,cwd}),timer=setTimeout(()=>{try{process.kill(child.pid);}catch{}},15000);
  try{const result=await child.wait();return{exitCode:result.exitCode,stdout:result.stdout.toString(),stderr:result.stderr.toString()};}finally{clearTimeout(timer);}
}
const quote=value=>`'${value.replaceAll('\\','/').replaceAll("'","'\\''")}'`;
const ambient=await realpath(tmpdir()),base=await realpath(await mkdtemp(join(ambient,'notara-admin-pipe-test-')));
const original=[null];check(api.token(api.current(),0x88,original),'Open isolated helper token');
const originalDefault=tokenInfo(original[0],6);
const restore=()=>setDefault(original[0],koffi.decode(originalDefault,0,'void *'));
const cases=[];
try{
  for(const mode of ['workspace-write','read-only']){
    const root=join(base,mode),workspace=join(root,'workspace'),temp=join(root,'private-temp'),peerTemp=join(root,'peer-temp'),outside=join(root,'outside');
    await mkdir(root);for(const path of [workspace,temp,peerTemp,outside])await mkdir(path);
    await writeFile(join(outside,'sentinel.txt'),'untouched');
    Object.assign(process.env,{TEMP:temp,TMP:temp,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',BB_OVERRIDE_APPLETS:''});
    const expected={workspaceSid:workspaceWriteSid(workspace),tempSid:tempWriteSid(temp),label:mode};
    const sandbox=new AclSandbox(mode==='read-only'?{mode,writableDirs:[],tempDir:null}:{mode,writableDirs:[workspace],tempDir:temp,writeSid:expected.workspaceSid,tempWriteSid:expected.tempSid});
    // A second sandbox grants a different private temp capability in the same
    // workspace. Its Low label alone must not authorize the first sandbox.
    const peer=new AclSandbox({mode:'workspace-write',writableDirs:[workspace],tempDir:peerTemp,writeSid:expected.workspaceSid,tempWriteSid:tempWriteSid(peerTemp)});
    try{
      adminDefault(original[0]);try{await peer.init();}finally{restore();}
      adminDefault(original[0]);try{await sandbox.init();}finally{restore();}
      const diagnostic=await run(sandbox,process.execPath,[fileURLToPath(new URL('./windows-pipe-diagnostics.mjs',import.meta.url)),'--native-child',JSON.stringify(expected)],workspace);
      assert.equal(diagnostic.exitCode,0,diagnostic.stderr);
      const native=JSON.parse(diagnostic.stdout.trim());
      assert.equal(native.token.restricted,true);assert.equal(native.token.integrity,'low');
      assert.equal(native.token.groups.find(row=>row.principal==='administrators').attributes,'0x10');
      assert.equal(native.token.restrictingSids.some(row=>row.principal==='current-user'),false);
      assert.equal(native.token.restrictingSids.some(row=>row.principal==='temp-write'),mode==='workspace-write');
      for(const principal of ['current-user','system','administrators'])assert.ok(native.token.defaultDacl.some(row=>row.type===0&&row.principal===principal));
      assert.ok(native.token.defaultDacl.some(row=>row.type===0&&row.principal===(mode==='workspace-write'?'temp-write':'everyone')));
      for(const pipe of native.pipes){assert.equal(pipe.ok,true,JSON.stringify(pipe));assert.equal(pipe.roundTrip,true,JSON.stringify(pipe));}
      const scripts=[
        ['pipeline',"printf 'pipe-ok\\n' | cat",true,'pipe-ok'],
        ['heredoc',"cat <<'EOF'\nheredoc-ok\nEOF\n",true,'heredoc-ok'],
        ['substitution','value=$(printf substitution-ok); printf "%s\\n" "$value"',true,'substitution-ok'],
        ['workspace-write','printf allowed > inside.txt',mode==='workspace-write',''],
        ['private-temp-write',`printf allowed > ${quote(join(temp,'inside.txt'))}`,mode==='workspace-write',''],
        ['peer-temp-write',`printf forbidden > ${quote(join(peerTemp,'forbidden.txt'))}`,false,''],
        ['outside-write',`printf forbidden > ${quote(join(outside,'forbidden.txt'))}`,false,''],
        ['outside-delete',`rm ${quote(join(outside,'sentinel.txt'))}`,false,''],
      ];
      const rows=[];
      for(const [name,source,success,text]of scripts){
        const script=join(root,`${name}.sh`);await writeFile(script,source,'utf8');
        const result=await run(sandbox,process.argv[2],['ash',script.replaceAll('\\','/')],workspace);
        assert.equal(result.exitCode===0,success,`${mode}/${name}: ${result.stderr}`);
        if(text)assert.ok(result.stdout.includes(text),`${mode}/${name}: ${result.stderr}`);
        rows.push({name,exitCode:result.exitCode});
      }
      assert.equal(await readFile(join(outside,'sentinel.txt'),'utf8'),'untouched');
      await assert.rejects(readFile(join(outside,'forbidden.txt')),/ENOENT/);await assert.rejects(readFile(join(peerTemp,'forbidden.txt')),/ENOENT/);
      if(mode==='read-only')await assert.rejects(readFile(join(workspace,'inside.txt')),/ENOENT/);
      cases.push({mode,token:native.token,pipes:native.pipes,rows});
    }finally{sandbox.dispose();peer.dispose();}
  }
  console.log(JSON.stringify({originalTokenMutationScope:'disposable helper only',cases,allAssertionsPassed:true}));
}finally{
  restore();api.close(original[0]);
  if(dirname(base)!==ambient||!base.startsWith(join(ambient,'notara-admin-pipe-test-')))throw new Error('Unexpected fixture cleanup target');
  await rm(base,{recursive:true,force:true});
}
