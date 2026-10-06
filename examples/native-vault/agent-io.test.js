import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat,mkdtemp,mkdir,writeFile,readFile,symlink,rm,open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import { Session } from '@deepseek-ai/dsh-session';
import { readPdfPage } from './agent-media.js';
const module = await import('./agent-io.js').catch(()=>({}));
const exists=path=>lstat(path).then(()=>true,()=>false);

async function sparsePdf(path,padding,{image=false}={}){
  // In image mode the zero-filled gap is a required 6000x6000 grayscale
  // raster, rather than the unused padding in the ordinary large-file fixture.
  const content=image?'q 612 0 0 792 0 0 cm /Im1 Do Q':'BT /F1 12 Tf 72 700 Td (Large PDF native range proof) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    image?'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 6 0 R >> >> /Contents 4 0 R >>':'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const handle=await open(path,'w'),offsets=[0];let position=0;
  const write=async text=>{const buffer=Buffer.from(text,'latin1');await handle.write(buffer,0,buffer.length,position);position+=buffer.length;};
  try{
    await write('%PDF-1.4\n');
    for(const [index,body] of objects.entries()){offsets.push(position);await write(`${index+1} 0 obj\n${body}\nendobj\n`);}
    offsets.push(position);await write(`6 0 obj\n<< ${image?'/Type /XObject /Subtype /Image /Width 6000 /Height 6000 /ColorSpace /DeviceGray /BitsPerComponent 8 ':''}/Length ${padding} >>\nstream\n`);
    position+=padding;await handle.truncate(position);await write('\nendstream\nendobj\n');
    const xref=position;
    await write('xref\n0 7\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join(''));
    await write(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  }finally{await handle.close();}return position;
}

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

test('concurrent PDF hashes read once and cancellation remains private to each caller', { timeout: 5000 }, async t => {
  const { root, ctx, exec } = await setup(t);
  const path = join(root, 'vault/concurrent.pdf'), size = await sparsePdf(path, 3 * 1024 * 1024);
  const firstController = new AbortController(), secondController = new AbortController();
  const started = Promise.withResolvers(), joined = Promise.withResolvers(), gate = Promise.withResolvers();
  const nativeRange = ctx.fs.readByteRange.bind(ctx.fs);
  const subscribe = secondController.signal.addEventListener.bind(secondController.signal);
  secondController.signal.addEventListener = (...args) => { subscribe(...args); if (args[0] === 'abort') joined.resolve(); };
  let bytes = 0, observations = 0;
  const emit = ctx.emit.bind(ctx);
  ctx.emit = (name, ...args) => { if (name === 'fs/observed') observations++; return emit(name, ...args); };
  ctx.fs.readByteRange = async (target, range, signal) => { started.resolve(); await gate.promise; bytes += range.length; return nativeRange(target, range, signal); };
  const first = module.createAgentVaultIO(ctx, { ...exec, signal: firstController.signal }).readAsset('concurrent.pdf');
  const cancelled = assert.rejects(first, /first caller cancelled/);
  await started.promise;
  const second = module.createAgentVaultIO(ctx, { ...exec, signal: secondController.signal }).readAsset('concurrent.pdf');
  await joined.promise;
  firstController.abort(new Error('first caller cancelled'));
  await cancelled;
  gate.resolve();
  const asset = await second;
  assert.equal(bytes, size, 'the remaining caller completes the one shared hash, rather than reading a second copy');
  assert.equal(observations, 1, 'only the successful caller records its observation');
  assert.equal(asset.revision, createHash('sha256').update(await readFile(path)).digest('hex').slice(0, 24));
  const hot = await module.createAgentVaultIO(ctx, exec).readAsset('concurrent.pdf');
  assert.equal(hot.revision, asset.revision);
  assert.equal(bytes, size, 'a cancelled observer does not discard another caller\'s completed cache entry');
});

test('the bounded PDF hash cache retains recently read books when a new book arrives', async t => {
  const { root, ctx, exec } = await setup(t), io = module.createAgentVaultIO(ctx, exec);
  const nativeRange = ctx.fs.readByteRange.bind(ctx.fs);
  let reads = 0;
  ctx.fs.readByteRange = async (...args) => { reads++; return nativeRange(...args); };
  for (let index = 0; index < 65; index++) await writeFile(join(root, `vault/book-${index}.pdf`), `%PDF-1.4\ncache checksum fixture ${index}\n`);
  for (let index = 0; index < 64; index++) await io.readAsset(`book-${index}.pdf`);
  assert.equal(reads, 64);
  await io.readAsset('book-0.pdf'); assert.equal(reads, 64);
  await io.readAsset('book-64.pdf'); assert.equal(reads, 65);
  await io.readAsset('book-0.pdf'); assert.equal(reads, 65, 'the recent hit survives insertion of the 65th book');
  await io.readAsset('book-1.pdf'); assert.equal(reads, 66, 'an unused entry is evicted while the cache remains bounded');
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

test('PDFs above 50 MiB are hashed in bounded native ranges; warm reads, stale references and mutations stay truthful',async t=>{
  const {root,ctx,exec}=await setup(t),path=join(root,'vault','large.pdf'),size=await sparsePdf(path,51*1024*1024);
  const native=ctx.fs,readRange=native.readByteRange.bind(native),windows=[];
  native.readByteRange=async(target,range,signal)=>{windows.push(range);return readRange(target,range,signal);};
  native.readBytes=async()=>{throw new Error('a PDF must not allocate a full-file read');};
  const io=module.createAgentVaultIO(ctx,exec),first=await io.readAsset('large.pdf');
  const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
  assert.equal(first.revision,hash.digest('hex').slice(0,24));
  assert.equal(first.bytes,undefined);assert.equal(first.pdfSource.length,size);
  assert.equal(windows.reduce((sum,range)=>sum+range.length,0),size);
  assert.ok(windows.every(range=>range.length<=1024*1024));
  windows.length=0;
  const warm=await io.readAsset('large.pdf',first.revision);
  assert.equal(windows.length,0,'the same native version reuses only its content hash');
  assert.equal(Buffer.from(await warm.pdfSource.readRange(0,9)).toString(),'%PDF-1.4\n');
  assert.equal(windows.reduce((sum,range)=>sum+range.length,0),9);
  const rendered=await readPdfPage(warm.pdfSource);
  assert.match(rendered.text,/Large PDF native range proof/);assert.equal(rendered.pageCount,1);
  assert.ok(windows.reduce((sum,range)=>sum+range.length,0)<1024*1024,'warm native PDF render skips the 51MiB unused stream');
  await assert.rejects(warm.pdfSource.readRange(0,size),/pdf_range_too_large/);
  const changed=await open(path,'r+');try{await changed.write(Buffer.from('changed'));}finally{await changed.close();}
  await assert.rejects(first.pdfSource.readRange(0,15),/vault_revision_conflict/);
  await assert.rejects(io.readAsset('large.pdf',first.revision),/vault_reference_stale/);
  await assert.rejects(warm.pdfSource.readRange(-1,2),/pdf_range_invalid/);
});

test('a required PDF raster above 32 MiB reports its bounded range failure without hanging',{timeout:5000},async t=>{
  const {root,ctx,exec}=await setup(t),path=join(root,'vault','large-image.pdf');
  await sparsePdf(path,6000*6000,{image:true});
  const asset=await module.createAgentVaultIO(ctx,exec).readAsset('large-image.pdf');
  const requests=[];
  const source={length:asset.pdfSource.length,readRange:async(begin,end,signal)=>{
    requests.push(end-begin);
    return asset.pdfSource.readRange(begin,end,signal);
  }};
  await assert.rejects(readPdfPage(source,{signal:t.signal}),error=>error.message==='pdf_range_too_large');
  assert.ok(requests.some(length=>length>32*1024*1024),'the required image must exercise the large-range guard during page parsing');
  assert.ok(await exists(path),'a failed read must not remove or alter the source PDF');
  const after=await module.createAgentVaultIO(ctx,exec).readAsset('large-image.pdf');
  assert.equal(after.revision,asset.revision);
  await sparsePdf(join(root,'vault','after-failure.pdf'),0);
  const small=await module.createAgentVaultIO(ctx,exec).readAsset('after-failure.pdf');
  const recovered=await readPdfPage(small.pdfSource,{signal:t.signal});
  assert.match(recovered.text,/Large PDF native range proof/);
  assert.equal(recovered.image.mimeType,'image/png','one failed document must not break the next reader in the same process');
});

test('PDF size above 512 MiB is rejected before reading or rendering',async t=>{
  const {root,ctx,exec}=await setup(t);await writeFile(join(root,'vault','oversize.pdf'),'%PDF-test');
  const native=ctx.fs,stat=native.stat.bind(native);let reads=0;
  native.stat=async(...args)=>({...await stat(...args),size:512*1024*1024+1});
  native.readByteRange=async()=>{reads++;throw new Error('must reject before reading');};
  await assert.rejects(module.createAgentVaultIO(ctx,exec).readAsset('oversize.pdf'),/vault_pdf_too_large/);
  assert.equal(reads,0);
});

test('PDF byte ranges reject missing native versions, short reads and same-size mutations during hashing',async t=>{
  const {root,ctx,exec}=await setup(t),path=join(root,'vault','changing.pdf');await writeFile(path,Buffer.alloc(2*1024*1024,65));
  const native=ctx.fs,stat=native.stat.bind(native),readRange=native.readByteRange.bind(native);
  native.stat=async(...args)=>({...await stat(...args),version:undefined});
  await assert.rejects(module.createAgentVaultIO(ctx,exec).readAsset('changing.pdf'),/vault_pdf_version_unavailable/);
  native.stat=stat;native.readByteRange=async()=>new Uint8Array(0);
  await assert.rejects(module.createAgentVaultIO(ctx,exec).readAsset('changing.pdf'),/vault_revision_conflict/);
  let changed=false;native.readByteRange=async(...args)=>{
    const bytes=await readRange(...args);
    if(!changed){changed=true;await writeFile(path,Buffer.alloc(2*1024*1024,66));}return bytes;
  };
  await assert.rejects(module.createAgentVaultIO(ctx,exec).readAsset('changing.pdf'),/vault_revision_conflict/);
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
