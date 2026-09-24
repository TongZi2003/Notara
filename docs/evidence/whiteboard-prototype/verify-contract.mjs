// Deterministic renderer/content checks, separate from browser interaction evidence.
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ui=new URL('../../ui/',import.meta.url);
const html=readFileSync(new URL('notara-frontend-prototype.html',ui),'utf8');
const source=readFileSync(new URL('notara-whiteboard.js',ui),'utf8');
const ctx=vm.createContext({
  URLSearchParams,location:{search:'',hash:'#/lesson/l1'},console,
  document:{addEventListener(){}},window:{addEventListener(){}},
  localStorage:{getItem(){return null;},setItem(){}},
  matchMedia(){return {matches:false,addEventListener(){}};},
});
// Expose only content functions inside this isolated test VM; no production hook.
vm.runInContext(source.replace('return {html,install,source,capture,restore,',
  'return {test:{blocks,state,exportData,updateBlock,marker,content,refs},html,install,source,capture,restore,'),ctx);
const inline=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(x=>x[1]).filter(x=>x.trim()).join('\n');
vm.runInContext(inline.replace(/WB.install\(A\);\s*parseHash\(\); render\(\);/,'S.route={name:"lesson",id:"l1"};'),ctx);
const run=s=>vm.runInContext(s,ctx), checks=[];
const check=(name,fn)=>{fn();checks.push({name,ok:true});};
check('All seed blocks parse including final block',()=>assert.equal(run('WB.test.blocks(WB.test.state().md).length'),7));
check('Only real referenced material nodes',()=>assert.equal(run('WB.test.refs(WB.test.state().md).map(r=>r.id).sort().join(",")'),'c-midchord,i-diff,k-conic,t-chord'));
const clean=run('WB.test.exportData(false,false)');
check('Default export physically excludes student and answer blocks',()=>{
  for(const str of [clean.md,clean.html])for(const term of ['我的思路变化','回看推导','需要时看一个提示','k = −3/2']) assert.ok(!str.includes(term),term);
});
check('Independent HTML preserves drawing and native fold with no external dependency',()=>{
  assert.ok(clean.html.includes('<svg'));assert.ok(clean.html.includes('<details'));
  assert.ok(!/<script|<link|src=["']https?:/i.test(clean.html));
  assert.ok(clean.html.includes('id="source-c-midchord"'));
});
check('Portable Markdown has local source links and embedded diagram',()=>{
  assert.ok(!clean.md.includes('diagram:ellipse'));assert.ok(!clean.md.includes('(notara:'));
  assert.ok(clean.md.includes('<svg'));assert.ok(clean.md.includes('](#source-c-midchord)'));
});
const full=run('WB.test.exportData(true,true)');
check('Explicit opt-in adds student attempt and reference',()=>{
  for(const str of [full.md,full.html])for(const term of ['我的思路变化','回看推导','k = −3/2']) assert.ok(str.includes(term),term);
});
check('Literal dollar replacement updates one block without duplicating old text',()=>{
  run('WB.test.updateBlock("attempt","literal $& and $1","updated")');
  assert.equal(run('WB.test.blocks(WB.test.state().md).find(b=>b.id==="attempt").body'),'literal $& and $1');
  assert.equal(run('WB.test.blocks(WB.test.state().md).length'),7);
});
check('User note HTML is escaped in projection',()=>{
  const value=run('WB.test.content("<img src=x onerror=alert(1)>")');
  assert.ok(!value.includes('<img'));assert.ok(value.includes('&lt;img'));
});
for(const [name,data] of [['export-default.html',clean.html],['export-full.html',full.html],['export-default.md',clean.md]])
  writeFileSync(new URL(name,import.meta.url),data);
writeFileSync(new URL('contract-checks.json',import.meta.url),JSON.stringify({scope:'deterministic content renderer, not browser or real-model proof',node:process.version,checks,passed:checks.length},null,2)+'\n');
console.log(JSON.stringify({passed:checks.length,total:checks.length,evidence:fileURLToPath(new URL('.',import.meta.url))}));
