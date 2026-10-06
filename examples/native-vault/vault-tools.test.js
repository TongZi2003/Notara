import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readFile,rm,writeFile,readdir,unlink } from 'node:fs/promises';
import { join,relative,isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import { Session } from '@deepseek-ai/dsh-session';
import { createUserMessage, offloadedImageText, projectOffloadedImages } from '@deepseek-ai/dsh-llm';
import { imageOffloadProjection } from '@deepseek-ai/dsh-compaction-image-offload/projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import { installAgentTools } from './agent-tools.js';
import { vaultToolMedia } from './vault-tools.js';
import { LocalAttachmentStore } from '@deepseek-ai/dsh-attachment-local';
import sharp from 'sharp';

test('historical images survive removal of derived request caches, while a missing durable object is reported explicitly',async t=>{
  const root=await mkdtemp(join(tmpdir(),'notara-history-image-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const store=new LocalAttachmentStore(new Context(),{dshHome:root});
  const data=await sharp({create:{width:240,height:160,channels:3,background:'#3478c8'}}).png().toBuffer();
  const attachment=await store.saveImage({data,mediaType:'image/png',name:'page.png'}),target={width:80,height:80,maxBytes:100000};
  const first=await store.readImageRequest(attachment,target),original=await readFile(store.imageHostPath(attachment));
  const cacheRelative=relative(root,store.cacheRoot);
  assert.ok(cacheRelative&&!cacheRelative.startsWith('..')&&!isAbsolute(cacheRelative),'all deletion stays in this test home');
  assert.ok((await readdir(store.cacheRoot)).includes('request-images'));
  await rm(store.cacheRoot,{recursive:true,force:true});
  const restarted=new LocalAttachmentStore(new Context(),{dshHome:root}),rebuilt=await restarted.readImageRequest(attachment,target);
  assert.equal(rebuilt.variantId,first.variantId);assert.deepEqual(rebuilt.data,first.data);
  assert.ok((await readdir(store.cacheRoot)).includes('request-images'));
  assert.deepEqual(await readFile(store.imageHostPath(attachment)),original);
  await unlink(restarted.imageHostPath(attachment));
  await assert.rejects(restarted.readImageRequest(attachment,target),error=>error.code==='ATTACHMENT_NOT_FOUND');
  const regenerated=await restarted.saveImage({data,mediaType:'image/png',name:'page.png'});
  assert.equal(regenerated.attachmentId,attachment.attachmentId,'rereading the same real page can recreate its content-addressed image');
});

test('offloading an old image changes its request occurrence, preserves stored history and leaves a reread image visible',async t=>{
  const root=await mkdtemp(join(tmpdir(),'notara-image-offload-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const store=new LocalAttachmentStore(new Context(),{dshHome:root});
  const data=await sharp({create:{width:32,height:24,channels:3,background:'#3478c8'}}).png().toBuffer();
  const attachment=await store.saveImage({data,mediaType:'image/png',name:'synthetic-page.png'});
  const session=Session.create('isolated-image-offload',[],undefined,0,[imageOffloadProjection]);
  session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'image',attachment}]}),{surfaceOp:'append'});
  const original=session.snapshotEvents(),oldEvent=original.find(event=>event.type==='user/message');
  session.append('image/offload',{targets:[{seq:oldEvent.seq,imageIndexes:[0]}]});
  assert.deepEqual(session.snapshotEvents().slice(0,original.length),original,'offload must not rewrite the stored image event');
  const oldRequest=projectOffloadedImages(session.deriveMessages(),offloadedImageText);
  assert.ok(oldRequest.flatMap(message=>message.content).every(block=>block.type!=='image'));
  assert.ok(oldRequest.flatMap(message=>message.content).some(block=>block.type==='text'&&block.text.includes(attachment.attachmentId)));
  assert.deepEqual(Buffer.from((await store.readImage(attachment)).data),data,'offloading the occurrence must not remove the durable image');

  session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'image',attachment}]}),{surfaceOp:'append'});
  const request=projectOffloadedImages(session.deriveMessages(),offloadedImageText);
  const images=request.flatMap(message=>message.content).filter(block=>block.type==='image');
  assert.equal(images.length,1);assert.equal(images[0].attachment.attachmentId,attachment.attachmentId);
  const seed=JSON.parse(JSON.stringify(session.snapshotEvents()));
  const restored=Session.create(session.id,seed,session.header,0,[imageOffloadProjection]);
  assert.deepEqual(projectOffloadedImages(restored.deriveMessages(),offloadedImageText),request,'cold replay must preserve the occurrence selection');
});

test('PDF results commit native attachments only for image-capable routes and keep text-only limitations explicit',async()=>{
  const exec={agent:{options:{provider:'fixture',model:'fixture'}},signal:new AbortController().signal};
  const image={path:'page.pdf',title:'Page',page:2,text:'text evidence',warnings:[],imageData:Buffer.from('synthetic image bytes').toString('base64'),imageMimeType:'image/png'};
  let modes=['text'],saved=0;
  const attachment={attachmentId:'fixture-image',mediaType:'image/png',bytes:21,width:1,height:1};
  const ctx={get:name=>name==='llm'?{resolveModelInfo:async()=>({inputModalities:modes})}:{saveImage:async({data})=>{saved++;assert.equal(data.toString(),'synthetic image bytes');return attachment;}}};
  const textOnly=await vaultToolMedia(ctx,exec,image);
  assert.equal(textOnly.imageAvailable,false);assert.equal(saved,0);
  assert.equal(textOnly.imageData,undefined);assert.equal(textOnly.text,'text evidence');
  assert.ok(textOnly.warnings.length>0);
  modes=['text','image'];
  const multimodal=await vaultToolMedia(ctx,exec,image);
  assert.deepEqual(multimodal.imageAttachment,attachment);assert.equal(saved,1);
  assert.equal(multimodal.imageData,undefined);assert.equal(multimodal.imageAvailable,true);
});

async function setup(t) {
  const root=await mkdtemp(join(tmpdir(),'notara-vault-tools-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'vault'),{recursive:true});
  await writeFile(join(root,'vault','one.md'),'# One\n\nneedle alpha\n');
  await writeFile(join(root,'vault','one.py'),'print("needle")\n');
  const ctx=new Context();
  ctx.reflect.provide('workspaceRegistry',{list:()=>[{id:'tool-workspace',path:root,title:'test'}]});
  new LocalFileSystem(ctx,{cwd:root,diffBasisMaxBytes:10*1024*1024});
  new SystemPrompt(ctx,{includeHarnessIdentity:true,includeRuntimeContext:true});
  new ToolRuntime(ctx,{mode:'native'});
  const get=ctx.get.bind(ctx);
  let sandboxMode='workspace-write';
  ctx.get=(name,...args)=>name==='sandboxPolicy'?{resolve:()=>({mode:sandboxMode})}:get(name,...args);
  installAgentTools(ctx,{isTeaching:agent=>agent?.session?.header?.agentPreset==='notara-teacher',executeTool:async()=>({})});
  const session=Session.create('teacher-session',[],{version:4,id:'teacher-session',createdAt:Date.now(),isSeeded:false,cwd:root});
  session.header={...session.header,origin:'user',agentPreset:'notara-teacher'};
  const agent={session};
  const run=(name,args,callId=name)=>ctx.tools.execute({name,arguments:args,callId,agent,signal:new AbortController().signal});
  return {root,ctx,run,setSandboxMode:value=>sandboxMode=value};
}

test('Vault tools return full read revisions, inclusive line ranges and ranked text matches',async t=>{
  const {run}=await setup(t);
  const read=await run('vault_read',{path:'one.md',startLine:2,endLine:3},'read-md');
  assert.equal(read.isError,false);
  const md=JSON.parse(read.content[0].text);
  assert.equal(md.content,'\nneedle alpha');
  assert.equal(md.revision.length,24);
  const code=await run('vault_read',{path:'one.py'},'read-code');
  assert.match(JSON.parse(code.content[0].text).content,/print\("needle"\)/);
  const found=await run('vault_search',{query:'needle',limit:10},'search');
  assert.equal(found.isError,false);
  const hits=JSON.parse(found.content[0].text).hits;
  assert.deepEqual(hits.map(hit=>hit.path),['one.md']);
  const badRange=await run('vault_read',{path:'one.md',startLine:3,endLine:2},'bad-range');
  assert.equal(badRange.isError,true);
  assert.match(badRange.content[0].text,/vault_line_range_invalid/);
});

test('vault_search reports an incomplete scan instead of claiming there were no matches',async t=>{
  const {root,run}=await setup(t);
  await writeFile(join(root,'vault','oversized.md'),'x'.repeat(2*1024*1024+1));
  const result=await run('vault_search',{query:'absent'},'incomplete-search');
  assert.equal(result.isError,true);
  assert.match(result.content[0].text,/vault_scan_incomplete/);
});

test('vault_search excludes reserved template aliases while keeping ordinary similarly named folders',async t=>{
  const {root,run}=await setup(t);
  for(const name of ['_Templates','_Ｔｅｍｐｌａｔｅｓ']) {
    await mkdir(join(root,'vault',name));
    await writeFile(join(root,'vault',name,'private.md'),'# Reserved\nneedle\n');
  }
  for(const name of ['Node_Modules','Ｎｏｄｅ＿Ｍｏｄｕｌｅｓ']) {
    await mkdir(join(root,'vault',name));
    await writeFile(join(root,'vault',name,'private.md'),'# Cache\nneedle\n');
  }
  await mkdir(join(root,'vault','_templates-notes'));
  await writeFile(join(root,'vault','_templates-notes','visible.md'),'# Visible\nneedle\n');
  const result=await run('vault_search',{query:'needle'},'template-alias-search');
  assert.equal(result.isError,false,result.content?.[0]?.text);
  assert.deepEqual(JSON.parse(result.content[0].text).hits.map(hit=>hit.path).sort(),['_templates-notes/visible.md','one.md']);
});

test('new classrooms read bundled templates without seeding; a custom Vault template takes priority',async t=>{
  const {root,run,setSandboxMode}=await setup(t);
  setSandboxMode('read-only');
  const first=await run('vault_read',{path:'_templates/learner-profile.md'});
  assert.equal(first.isError,false);
  const builtin=JSON.parse(first.content[0].text);
  assert.equal(builtin.templateSource,'bundled');assert.equal(builtin.ref,undefined);
  assert.match(builtin.revision,/^[a-f0-9]{24}$/);
  await assert.rejects(readFile(join(root,'vault','_templates','learner-profile.md')),{code:'ENOENT'});
  await mkdir(join(root,'vault','_templates'));
  await writeFile(join(root,'vault','_templates','learner-profile.md'),'# Custom template\n');
  const custom=JSON.parse((await run('vault_read',{path:'_templates/learner-profile.md'})).content[0].text);
  assert.equal(custom.content,'# Custom template\n');assert.notEqual(custom.revision,builtin.revision);
  assert.equal(custom.templateSource,undefined);assert.match(custom.ref,/^vault:/);
  assert.equal((await run('vault_read',{path:'_templates/../vault-tools.js'})).isError,true);
});

test('vault_save and write-batch use native AgentVaultIO CAS and command dispatch',async t=>{
  const {root,run}=await setup(t);
  const saved=await run('vault_save',{path:'code/task.py',content:'print("first")\n',expectedRevision:null},'save-code');
  assert.equal(saved.isError,false);
  const receipt=JSON.parse(saved.content[0].text);
  assert.equal(receipt.saved,true);
  const stale=await run('vault_save',{path:'code/task.py',content:'print("stale")\n',expectedRevision:'a'.repeat(24)},'save-stale');
  assert.equal(stale.isError,true);
  const batch=await run('vault_command',{command:'write-batch',input:{files:[{op:'create',path:'资料/new.md',content:'# New\n'}]}},'batch-create');
  assert.equal(batch.isError,false,batch.content?.[0]?.text);
  assert.equal(JSON.parse(batch.content[0].text).savedCount,1);
  assert.equal(await readFile(join(root,'vault','资料','new.md'),'utf8'),'# New\n');
  for(const path of ['lesson-board/direct.md','技能/direct.md','_templates/direct.md']) {
    const refused=await run('vault_save',{path,content:'# forbidden',expectedRevision:null},`reserved-${path}`);
    assert.equal(refused.isError,true,path);
  }
  const help=await run('vault_command',{command:'command-help',input:{command:'write-batch'}},'help-batch');
  assert.equal(help.isError,false);
  const helpData=JSON.parse(help.content[0].text);
  assert.ok(helpData.input);
  assert.equal(helpData.usage.tool,'vault_command');
  assert.equal(helpData.example.command,'write-batch');
  assert.doesNotMatch(JSON.stringify(helpData),/DSH_NOTARA_CLI|imagePath/);
  const pdfHelp=await run('vault_command',{command:'command-help',input:{command:'pdf-page'}},'help-pdf');
  assert.match(JSON.parse(pdfHelp.content[0].text).result,/image attachment/);
  assert.doesNotMatch(JSON.parse(pdfHelp.content[0].text).result,/imagePath/);
  const reserved=await run('vault_command',{command:'write-batch',input:{files:[{op:'create',path:'技能/direct.py',content:'pass'}]}},'reserved-skill');
  assert.equal(reserved.isError,true);
});

test('Vault write tools preserve read-only asks, native denials and subagent refusal',async t=>{
  const {ctx,run}=await setup(t);
  const unask=ctx.on('tools/pre-execute',()=>({kind:'ask',reason:'native approval'}));
  const asked=await run('vault_save',{path:'x.md',content:'# x',expectedRevision:null},'asked-save');
  assert.equal(asked.isError,true);
  unask();
  const deny=ctx.on('tools/pre-execute',()=>({kind:'deny',reason:'native denial'}));
  const denied=await run('vault_command',{command:'write-batch',input:{files:[{op:'create',path:'x.md',content:'# x'}]}},'denied-command');
  assert.equal(denied.isError,true);
  deny();
  const child={session:{id:'worker-session',header:{cwd:ctx.get('workspaceRegistry').list()[0].path,origin:'subagent',agentPreset:'notara-teacher'}}};
  const childResult=await ctx.tools.execute({name:'vault_read',arguments:{path:'one.md'},callId:'child-read',agent:child,signal:new AbortController().signal});
  assert.equal(childResult.isError,true);
});

test('an allowed-once native ask grants only the pending Vault write call',async t=>{
  const {ctx,root,run,setSandboxMode}=await setup(t);
  let approvals=0;
  ctx.reflect.provide('approval',{request:async()=>{approvals++;return 'allowed-once';}});
  const forceAsk=ctx.on('tools/pre-execute',(exec,next)=>exec.name==='vault_save'?{kind:'ask',reason:'test approval'}:next());
  const saved=await run('vault_save',{path:'approved.md',content:'# Approved\n',expectedRevision:null},'approved-once');
  forceAsk();
  assert.equal(approvals,1);
  assert.equal(saved.isError,false,saved.content?.[0]?.text);
  assert.equal(await readFile(join(root,'vault','approved.md'),'utf8'),'# Approved\n');
  setSandboxMode('read-only');
  ctx.get('approval').request=async()=>{approvals++;return 'rejected';};
  const denied=await run('vault_save',{path:'denied.md',content:'# Denied\n',expectedRevision:null},'no-reuse');
  assert.equal(denied.isError,true);
  assert.equal(approvals,2,'a separate read-only call must request its own permission');
  await assert.rejects(readFile(join(root,'vault','denied.md')),{code:'ENOENT'});
});
