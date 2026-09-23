import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,symlink,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import { Session } from '@deepseek-ai/dsh-session';
const module = await import('./agent-io.js').catch(()=>({}));

async function setup(t) {
  assert.equal(typeof module.createAgentVaultIO,'function');
  const root=await mkdtemp(join(tmpdir(),'notara-agent-io-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'vault'),{recursive:true});
  const ctx=new Context();
  ctx.reflect.provide('workspaceRegistry',{list:()=>[{id:'io-workspace',path:root,title:'测试'}]});
  new LocalFileSystem(ctx,{cwd:root,diffBasisMaxBytes:10*1024*1024});
  const session=Session.create('io-session',[],{version:3,id:'io-session',createdAt:Date.now(),isSeeded:false,cwd:root});
  return {root,ctx,exec:{agent:{session},signal:new AbortController().signal}};
}

test('authorized reads use native filesystem and preserve the Vault content revision',async t=>{
  const {root,ctx,exec}=await setup(t);
  await writeFile(join(root,'vault/a.md'),'# A\nhello');
  const io=module.createAgentVaultIO(ctx,exec);
  const doc=await io.read('a.md');
  assert.equal(doc.content,'# A\nhello');
  assert.equal(doc.revision.length,24);
  const scan=await io.scan();
  assert.equal(scan.documents.length,1);
  assert.equal(scan.documents[0].path,'a.md');
});

test('model IO requires an approved writer and compare-and-swap preserves external edits',async t=>{
  const {root,ctx,exec}=await setup(t);
  const reader=module.createAgentVaultIO(ctx,exec);
  await assert.rejects(reader.save('a.md','# A',null),/approval_required/);
  const writer=module.createAgentVaultIO(ctx,exec,{writeApproved:true});
  const created=await writer.save('a.md','# A',null);
  await writeFile(join(root,'vault/a.md'),'# human edit');
  await assert.rejects(writer.save('a.md','# stale overwrite',created.revision),/revision_conflict/);
  assert.equal(await readFile(join(root,'vault/a.md'),'utf8'),'# human edit');
});

test('paths and symlinks cannot escape the selected Vault',async t=>{
  const {root,ctx,exec}=await setup(t);
  await writeFile(join(root,'private.md'),'private');
  await symlink(join(root,'private.md'),join(root,'vault/link.md'));
  const io=module.createAgentVaultIO(ctx,exec,{writeApproved:true});
  await assert.rejects(io.read('../private.md'),/path_invalid/);
  await assert.rejects(io.read('link.md'),/path_invalid/);
  await assert.rejects(io.save('link.md','bad',null),/path_invalid/);
  assert.equal((await io.scan()).documents.length,0);
});

test('an unregistered session workspace cannot silently create a separate Vault',async t=>{
  const {ctx,exec}=await setup(t);
  ctx.workspaceRegistry.list=()=>[];
  assert.throws(()=>module.createAgentVaultIO(ctx,exec,{writeApproved:true}),/vault_scope_unavailable/);
});
