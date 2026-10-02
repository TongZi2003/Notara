import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readFile,readdir,rm,symlink,writeFile } from 'node:fs/promises';
import { join,toNamespacedPath } from 'node:path';
import { tmpdir } from 'node:os';
import { AclSandbox,workspaceWriteSid,tempWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl';
import { withWindowsCliFileSystem } from './windows-cli-fs.js';
const windows={skip:process.platform!=='win32'};
async function fixture(t,{sandboxed=false}={}) {
  const base=await mkdtemp(join(tmpdir(),'notara-cli-fs-test-')),root=join(base,'workspace'),temp=join(base,'temp');
  await mkdir(root);await mkdir(temp);await mkdir(join(root,'知识'));
  await writeFile(join(root,'知识','向量.md'),'# 向量\n原文。\n');
  let sandbox;
  if(sandboxed){sandbox=new AclSandbox({writableDirs:[root],tempDir:temp,writeSid:workspaceWriteSid(root),tempWriteSid:tempWriteSid(temp),mode:'workspace-write'});await sandbox.init();}
  t.after(async()=>{sandbox?.dispose();await rm(base,{recursive:true,force:true});});
  return{base,root,sandbox,policy:{mode:'workspace-write',workspaceRoot:root}};
}
async function dacl(path) {
  const koffi=(await import('koffi')).default,api=koffi.load('advapi32.dll');
  const get=api.func('int __stdcall GetFileSecurityW(const char16_t *,uint32_t,void *,uint32_t,_Out_ uint32_t *)');
  const needed=[0];get(toNamespacedPath(path),4,null,0,needed);assert.ok(needed[0]);
  const result=Buffer.alloc(needed[0]);assert.equal(get(toNamespacedPath(path),4,result,result.length,needed),1);
  return result.subarray(0,needed[0]);
}
test('Windows broker native edits retain DACLs and published files remain writable by the original Low token',windows,async t=>{
  const {root,sandbox,policy}=await fixture(t,{sandboxed:true});
  const path=join(root,'知识','向量.md'),before=await dacl(path);
  await withWindowsCliFileSystem(root,new AbortController().signal,async fs=>{
    const target=await fs.resolve(path,{cwd:root}),observed=await fs.stat(target);
    const edit=await fs.writeText(target,'# 向量\n修订。\n',{kind:'replaceIfVersion',version:observed.version},undefined,policy);
    assert.equal(edit.operation,'update');assert.equal(edit.before,'# 向量\n原文。\n');
    const next=await fs.resolve(join(root,'新课','例.md'),{cwd:root});
    assert.equal((await fs.writeText(next,'# 例\n',{kind:'createIfAbsent'},undefined,policy)).operation,'create');
  });
  assert.deepEqual(await dacl(path),before);
  const child=sandbox.spawn({command:process.execPath,args:['--input-type=module','-e',"import{appendFile}from'node:fs/promises';await appendFile('知识/向量.md','Low edit\\n');await appendFile('新课/例.md','Low create\\n');console.log('low-write-ok');"],cwd:root});
  const outcome=await child.wait();
  assert.equal(outcome.exitCode,0,outcome.stderr.toString());assert.match(outcome.stdout.toString(),/low-write-ok/);
  assert.match(await readFile(path,'utf8'),/Low edit/);
  assert.deepEqual((await readdir(root)).sort(),['新课','知识'].sort());
});
test('Windows broker rejects root changes and stale native versions before publication',windows,async t=>{
  const {base,root,policy}=await fixture(t);
  const outside=join(base,'outside.md');await writeFile(outside,'OUTSIDE');
  await withWindowsCliFileSystem(root,new AbortController().signal,async fs=>{
    await assert.rejects(fs.resolve(outside,{cwd:root}),error=>error.code==='FS_SANDBOX_DENIED');
    const target=await fs.resolve(join(root,'知识','向量.md'),{cwd:root});
    await assert.rejects(fs.writeText(target,'BAD',{kind:'replaceIfVersion',version:'stale'},undefined,policy),error=>error.code==='FS_STALE_VERSION');
    await assert.rejects(fs.writeText(target,'BAD',{kind:'createIfAbsent'},undefined,{mode:'read-only',workspaceRoot:root}),error=>error.code==='FS_SANDBOX_DENIED');
  });
  assert.equal(await readFile(outside,'utf8'),'OUTSIDE');assert.equal(await readFile(join(root,'知识','向量.md'),'utf8'),'# 向量\n原文。\n');
  assert.deepEqual(await readdir(root),['知识']);
});
test('Windows broker cancellation revokes pending publication and releases every owned guard',windows,async t=>{
  const {root,policy}=await fixture(t),controller=new AbortController();
  await assert.rejects(withWindowsCliFileSystem(root,controller.signal,async fs=>{
    const target=await fs.resolve(join(root,'知识','向量.md'),{cwd:root}),observed=await fs.stat(target);
    const pending=fs.writeText(target,'BAD',{kind:'replaceIfVersion',version:observed.version},undefined,policy);
    controller.abort();await pending;
  }),error=>error.name==='AbortError'||error.code==='FS_ABORTED');
  assert.equal(await readFile(join(root,'知识','向量.md'),'utf8'),'# 向量\n原文。\n');
  assert.deepEqual(await readdir(root),['知识']);
});
test('Windows broker rejects an existing junction to an outside directory',windows,async t=>{
  const {base,root}=await fixture(t),outside=join(base,'outside');
  await mkdir(outside);await writeFile(join(outside,'sentinel.md'),'OUTSIDE');
  await symlink(outside,join(root,'bridge'),'junction');
  await withWindowsCliFileSystem(root,new AbortController().signal,async fs=>{
    await assert.rejects(fs.resolve(join(root,'bridge','sentinel.md'),{cwd:root}),error=>error.code==='FS_SANDBOX_DENIED');
  });
  assert.equal(await readFile(join(outside,'sentinel.md'),'utf8'),'OUTSIDE');
});
test('Windows broker guards deny real Low-token staging tamper, marker removal and parent-directory replacement',windows,async t=>{
  const {base,root,sandbox,policy}=await fixture(t,{sandboxed:true}),outside=join(base,'outside');
  await mkdir(outside);await writeFile(join(outside,'sentinel.md'),'OUTSIDE');
  await withWindowsCliFileSystem(root,new AbortController().signal,async fs=>{
    const target=await fs.resolve(join(root,'知识','向量.md'),{cwd:root}),observed=await fs.stat(target);
    await fs.writeText(target,'# 向量\n安全修订。\n',{kind:'replaceIfVersion',version:observed.version},undefined,policy);
    const marker=(await readdir(root)).find(name=>name.startsWith('.notara-cli-pin-'));
    const stage=(await readdir(join(root,'知识'))).find(name=>name.startsWith('.notara-cli-op-'));
    assert.ok(marker);assert.ok(stage);
    const payload=JSON.stringify({marker,stage});
    const script="import{unlink,rename,writeFile}from'node:fs/promises';const paths="+payload+";const result={};for(const[name,operation]of[['markerRemove',()=>unlink(paths.marker)],['markerMove',()=>rename(paths.marker,'stolen.tmp')],['directoryMove',()=>rename('知识','moved')],['stageWrite',()=>writeFile('知识/'+paths.stage+'/tamper.md','BAD')]]){try{await operation();result[name]={denied:false};}catch(error){result[name]={denied:true,code:error.code};}}console.log(JSON.stringify(result));";
    const child=sandbox.spawn({command:process.execPath,args:['--input-type=module','-e',script],cwd:root}),outcome=await child.wait();
    assert.equal(outcome.exitCode,0,outcome.stderr.toString());
    const attacks=JSON.parse(outcome.stdout.toString().trim());
    for(const[name,result]of Object.entries(attacks))assert.equal(result.denied,true,name);
  });
  assert.equal(await readFile(join(outside,'sentinel.md'),'utf8'),'OUTSIDE');
  assert.equal(await readFile(join(root,'知识','向量.md'),'utf8'),'# 向量\n安全修订。\n');
  assert.deepEqual(await readdir(root),['知识']);
});
