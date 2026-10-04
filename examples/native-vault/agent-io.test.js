import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat,mkdtemp,mkdir,writeFile,readFile,symlink,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import { Session } from '@deepseek-ai/dsh-session';
const module = await import('./agent-io.js').catch(()=>({}));
const exists=path=>lstat(path).then(()=>true,()=>false);

async function setup(t) {
  assert.equal(typeof module.createAgentVaultIO,'function');
  const root=await mkdtemp(join(tmpdir(),'notara-agent-io-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  // 旧布局：vault/ 里已有资料，工作区根另有 README.md 与第二个工作区目录。
  await mkdir(join(root,'vault','卡片'),{recursive:true});
  await writeFile(join(root,'vault','卡片','旧资料.md'),'# 旧资料\n');
  await writeFile(join(root,'README.md'),'# 工作区说明\n');
  await mkdir(join(root,'other'),{recursive:true});
  const ctx=new Context();
  ctx.reflect.provide('workspaceRegistry',{list:()=>[{id:'io-workspace',path:root,title:'测试'}]});
  new LocalFileSystem(ctx,{cwd:root,diffBasisMaxBytes:10*1024*1024});
  const session=Session.create('io-session',[],{version: 4,id:'io-session',createdAt:Date.now(),isSeeded:false,cwd:root});
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
  assert.deepEqual(scan.documents.map(item=>item.path).sort(),['a.md','卡片/旧资料.md']);
  assert.equal(io.rootPath,join(root,'vault'));
});

test('Markdown templates can be read as references but cannot be written or indexed',async t=>{
  const {root,ctx,exec}=await setup(t);
  await mkdir(join(root,'vault','_templates'),{recursive:true});
  await writeFile(join(root,'vault','_templates','learner-profile.md'),'# Profile template\n');
  const io=module.createAgentVaultIO(ctx,exec,{writeApproved:true});
  const template=await io.read('_templates/learner-profile.md');
  assert.equal(template.content,'# Profile template\n');
  await assert.rejects(io.save(template.path,'# overwritten',template.revision),/vault_path_invalid/);
  await assert.rejects(io.save('_templates/new.md','# new',null),/vault_path_invalid/);
  assert.equal((await io.scan()).files.some(file=>file.path.startsWith('_templates/')),false);
});

test('a selected Vault folder reads Markdown and media from its own root', async t => {
  const { root, ctx, exec } = await setup(t);
  // 用户选中的目录本身就是资料根：旧的空 vault/（含自动生成的 _templates）
  // 不能把资料根拉回子目录。
  await rm(join(root, 'vault'), { recursive: true, force: true });
  await mkdir(join(root, 'vault', '_templates'), { recursive: true });
  await writeFile(join(root, 'note.md'), '# 直接根\n');
  await writeFile(join(root, 'handout.pdf'), Buffer.from('%PDF-synthetic'));
  const io = module.createAgentVaultIO(ctx, exec);
  assert.equal(io.rootPath, root);
  assert.equal((await io.read('note.md')).title, '直接根');
  assert.equal((await io.readAsset('handout.pdf')).assetKind, 'pdf');
  assert.deepEqual((await io.scan()).files.map(file => file.path).sort(), ['README.md', 'handout.pdf', 'note.md']);
  assert.equal(await exists(join(root, 'vault', 'note.md')), false);
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

test('structured JSON IO uses the same workspace boundary and CAS revision', async t => {
  const { root, ctx, exec } = await setup(t);
  const writer = module.createAgentVaultIO(ctx, exec, { writeApproved: true });
  const created = await writer.saveJson('lesson-interaction/demo.json', '{"type":"lesson-interaction"}', null);
  assert.equal((await writer.readJson('lesson-interaction/demo.json')).content, '{"type":"lesson-interaction"}');
  await assert.rejects(writer.saveJson('lesson-interaction/demo.json', '{bad}', created.revision), /json_invalid/);
  await assert.rejects(writer.saveJson('lesson-interaction/demo.json', '{"type":"changed"}', 'a'.repeat(24)), /revision_conflict/);
  assert.equal(await readFile(join(root, 'vault/lesson-interaction/demo.json'), 'utf8'), '{"type":"lesson-interaction"}');
});

test('agent code files support full text reads and CAS saves without weakening Markdown validation', async t => {
  const { root, ctx, exec } = await setup(t);
  const source = 'print("before")\n';
  await writeFile(join(root, 'vault', '代码.py'), source);
  const reader = module.createAgentVaultIO(ctx, exec);
  const first = await reader.readCode('代码.py');
  assert.equal(first.kind, 'code');
  assert.equal(first.content, source);
  assert.equal(first.revision.length, 24);
  await assert.rejects(reader.saveCode('代码.py', 'print("no")\n', first.revision), /approval_required/);
  const writer = module.createAgentVaultIO(ctx, exec, { writeApproved: true });
  const committed = [];
  const saved = await writer.saveCode('代码.py', 'print("after")\n', first.revision, value => committed.push(value));
  assert.equal(saved.content, 'print("after")\n');
  assert.notEqual(saved.revision, first.revision);
  assert.deepEqual(committed, [{ path: '代码.py', revision: saved.revision }]);
  await assert.rejects(writer.saveCode('知识/x.md', '# Markdown', null), /code_required/);
  await assert.rejects(writer.save('代码.py', 'print("wrong route")\n', saved.revision), /markdown_required/);
  await assert.rejects(writer.saveCode('技能/lesson.py', 'pass\n', null), /skill_path_reserved/);
  await assert.rejects(writer.saveCode('lesson-board/board.py', 'pass\n', null), /board_path_reserved/);
});

test('relative paths and directory links cannot escape the selected Vault',async t=>{
  const {root,ctx,exec}=await setup(t);
  const outside=await mkdtemp(join(tmpdir(),'notara-agent-io-outside-'));
  t.after(()=>rm(outside,{recursive:true,force:true}));
  await writeFile(join(outside,'secret.md'),'secret');
  await symlink(outside,join(root,'vault/linked-directory'),process.platform==='win32'?'junction':'dir');
  const io=module.createAgentVaultIO(ctx,exec,{writeApproved:true});
  await assert.rejects(io.read('../private.md'),/path_invalid/);
  await assert.rejects(io.read('linked-directory/secret.md'),/path_invalid/);
  await assert.rejects(io.save('linked-directory/secret.md','bad',null),/path_invalid/);
  assert.equal(await readFile(join(outside,'secret.md'),'utf8'),'secret');
});

test('file symlinks cannot escape the selected Vault',async t=>{
  const {root,ctx,exec}=await setup(t);
  const outside=await mkdtemp(join(tmpdir(),'notara-agent-io-outside-'));
  t.after(()=>rm(outside,{recursive:true,force:true}));
  // 工作区根的资料在资料根之外；两种符号链接都必须被拒绝，而不是跟随读取。
  await writeFile(join(root,'private.md'),'private');
  await writeFile(join(outside,'secret.md'),'secret');
  try { await symlink(join(root,'private.md'),join(root,'vault/link.md')); }
  catch(error) { if(process.platform==='win32'&&error.code==='EPERM'){t.skip('Windows file symlink privilege is unavailable; directory junction escape is tested separately');return;}throw error; }
  await symlink(join(outside,'secret.md'),join(root,'vault/escape.md'));
  const io=module.createAgentVaultIO(ctx,exec,{writeApproved:true});
  assert.equal(io.rootPath,join(root,'vault'));
  await assert.rejects(io.read('../private.md'),/path_invalid/);
  await assert.rejects(io.read('link.md'),/path_invalid/);
  await assert.rejects(io.readAsset('escape.md'),/path_invalid/);
  await assert.rejects(io.save('link.md','bad',null),/path_invalid/);
  await assert.rejects(io.save('escape.md','bad',null),/path_invalid/);
  const scan=await io.scan();
  assert.deepEqual(scan.files.map(file=>file.path),['卡片/旧资料.md']);
  assert.deepEqual(scan.errors.map(row=>[row.path,row.code]),[['escape.md','vault_path_invalid'],['link.md','vault_path_invalid']]);
  assert.equal(await readFile(join(outside,'secret.md'),'utf8'),'secret');
});

test('an unregistered session workspace cannot silently create a separate Vault',async t=>{
  const {ctx,exec}=await setup(t);
  ctx.workspaceRegistry.list=()=>[];
  assert.throws(()=>module.createAgentVaultIO(ctx,exec,{writeApproved:true}),/vault_scope_unavailable/);
});

test('repeated scans reuse unchanged pages, still record each observation and see edits', async t => {
  const {root,ctx,exec}=await setup(t);
  await writeFile(join(root,'vault/a.md'),'# A\n\nalpha');
  const observed=[],emit=ctx.emit.bind(ctx);
  ctx.emit=(name,...rest)=>{if(name==='fs/observed')observed.push(rest[0]);return emit(name,...rest);};
  const io=module.createAgentVaultIO(ctx,exec);
  const first=await io.scan(),second=await io.scan();
  const pick=scan=>scan.documents.find(doc=>doc.path==='a.md');
  assert.equal(pick(second),pick(first),'an unchanged page is served from the cache');
  assert.equal(observed.filter(target=>String(target?.targetKey??target).replaceAll('\\','/').endsWith('/a.md')).length,2,'the cached page is still recorded as observed');
  await writeFile(join(root,'vault/a.md'),'# A\n\nALPHA');
  const third=await io.scan();
  assert.match(pick(third).content,/ALPHA/);
  assert.notEqual(pick(third).revision,pick(first).revision);
});
