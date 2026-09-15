import { MathSceneSchema, mathDimension, mathRemovalClosure, type MathObject } from '../../packages/contracts/src/math-scene.ts';
import { mergeMathScene } from '../../packages/contracts/src/math-merge.ts';
import type { MathProjection, MathCompute } from '../../packages/contracts/src/math-workbench.ts';
import type { PluginDocument, PluginLink } from '../../packages/contracts/src/plugin-learning.ts';
import { createMathBoards,kindNames } from './math-board.ts';
import { selectionBox, type SelectionPoint } from './math-selection.ts';
import { renderToString } from 'katex';
declare const Notara:{loadDocument():Promise<{revision:number;document:PluginDocument}>;saveDocument(revision:number,document:PluginDocument):Promise<{revision:number;document:PluginDocument}>;compose(text:string):Promise<unknown>;pickSource():Promise<PluginLink>;openSource(link:PluginLink):Promise<unknown>;saveNote(note:{title:string;body:string;documentRevision:number}):void;publishMath(projection:MathProjection):Promise<unknown>;calculateMath(revision:number,input:MathCompute):Promise<{status:string;latex:string;json:string;numeric?:number}>};
type Scene=Extract<PluginDocument,{kind:'math'}>;
const root=document.createElement('main');
root.innerHTML=`<header class="math-header"><button id="toggle-panel" aria-label="展开对象与计算" title="对象与计算">☰</button><strong>数学工作台</strong><nav aria-label="数学视图"><button id="view-2d" aria-pressed="true">二维</button><button id="view-3d" aria-pressed="false">三维</button></nav><div class="history"><button id="undo" aria-label="撤销" title="撤销">↶</button><button id="redo" aria-label="重做" title="重做">↷</button></div><button id="sync-now" title="刷新场景" aria-label="刷新数学场景">↻</button></header>
<section class="math-workspace"><aside id="side-panel"><div class="panel-tabs"><button id="tab-objects" aria-pressed="true">对象</button><button id="tab-compute" aria-pressed="false">计算</button><button id="close-panel" aria-label="收起对象与计算">×</button></div><section id="objects-panel"><div class="construction-bar"><select id="object-kind" aria-label="构造类型"></select><button id="new-object">＋ 构造</button></div><div id="objects" aria-label="图形对象"></div><div id="inspector"></div><section class="parameter-section"><div class="section-title"><span>参数</span><button id="new-parameter" aria-label="添加参数">＋</button></div><div id="parameters"></div><div id="parameter-editor"></div></section></section>
<section id="compute-panel" hidden><form id="compute-form"><label>公式<input id="compute-expression" aria-label="计算公式" placeholder="x^2-5x+6=0" required></label><div class="compute-options"><label>运算<select id="compute-operation" aria-label="运算"><option value="solve">求解</option><option value="simplify">化简</option><option value="differentiate">求导</option><option value="evaluate">精确求值</option><option value="numeric">数值近似</option></select></label><label>变量<input id="compute-variable" aria-label="计算变量" value="x" maxlength="24"></label></div><button id="calculate">计算</button></form><p class="hint">支持 LaTeX，自动代入场景参数。</p><div id="compute-result" role="status"></div><button id="keep-calculation" hidden>加入观察</button></section></aside>
<section class="graph-wrap"><div id="math-board" tabindex="0" aria-label="二维数学画布"></div><div id="space-board" tabindex="0" aria-label="三维数学画布"></div><div id="empty-canvas"><span>从一个构造开始</span><div><button id="example-function">函数与切线</button><button id="example-space">空间几何</button></div></div><div class="graph-tools"><button id="zoom-in" aria-label="放大图形">＋</button><button id="zoom-out" aria-label="缩小图形">−</button><button id="home" aria-label="恢复视区">⌂</button></div><span id="space-hint" class="canvas-hint" hidden>拖动空白处旋转 · 拖点移动 · Shift 调整高度</span></section></section>
<section class="math-bottom"><details id="notes"><summary>观察与资料 <span id="observation-count"></span></summary><textarea id="observation" aria-label="观察与问题" rows="2" placeholder="记录观察、猜想或问题"></textarea><div id="sources"></div><button id="pick-source">关联资料</button></details><footer><span id="sync" role="status">正在读取…</span><button id="save-scene">保存</button><button id="save-note">存为笔记</button><button id="discuss">带入对话 ↗</button></footer><p id="error" role="alert"></p><div id="conflict-actions" hidden><button id="keep-local">保留我的改动</button><button id="use-remote">采用课堂版本</button></div></section>`;
document.body.append(root);
const $=<T extends HTMLElement=HTMLElement>(id:string):T=>document.getElementById(id) as T;
let scene:Scene,base:Scene,revision=0,dirty=false,saving=false,generation=0,conflicted=false,selected='',fieldEditing=false,formDraft=false;
let boards:ReturnType<typeof createMathBoards>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
let remotePending:{document:Scene;revision:number}|undefined;
const past:Scene[]=[],future:Scene[]=[];
const selectedNames=new Set<string>();
let boxMode=false,dragSelection:{start:SelectionPoint;pointerId:number;previous:Set<string>;additive:boolean}|undefined;
let observationStarted=false;
const graph=root.querySelector<HTMLElement>('.graph-wrap')!;
graph.tabIndex=-1;
const boxToggle=document.createElement('button');boxToggle.id='box-select';boxToggle.type='button';boxToggle.setAttribute('aria-label','框选对象');boxToggle.title='框选对象 · Shift 追加选择';boxToggle.setAttribute('aria-pressed','false');
boxToggle.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3"/></svg>';
root.querySelector('.graph-tools')!.prepend(boxToggle);
const selectionRect=document.createElement('div');selectionRect.className='selection-rect';selectionRect.hidden=true;
const selectionBar=document.createElement('div');selectionBar.className='selection-bar';selectionBar.hidden=true;selectionBar.setAttribute('aria-label','所选对象');
selectionBar.innerHTML='<span id="selection-count" role="status"></span><button id="delete-selection" type="button">删除</button><button id="clear-selection" type="button" aria-label="清除选择">×</button>';
const selectionHint=document.createElement('span');selectionHint.className='selection-hint';selectionHint.textContent='拖出矩形框选 · Shift 追加';selectionHint.hidden=true;
graph.append(selectionRect,selectionBar,selectionHint);
const message=(text:string)=>{$('sync').textContent=text;};
const error=(text:string)=>{$('error').textContent=text;};
const valid=(doc:Scene)=>MathSceneSchema.safeParse(Object.fromEntries(Object.entries(doc).filter(([key])=>key!=='links')));
const round=(n:number)=>Number(n.toPrecision(7));
const pushHistory=()=>{past.push(structuredClone(scene));if(past.length>40)past.shift();future.length=0;};
const historyButtons=()=>{$<HTMLButtonElement>('undo').disabled=!past.length||saving||conflicted;$<HTMLButtonElement>('redo').disabled=!future.length||saving||conflicted;};
const nextName=(prefix:string)=>{let n=1;const names=new Set([...scene.objects,...scene.parameters].map(o=>o.name));while(names.has(prefix+n))n++;return prefix+n;};
async function publish():Promise<void>{if(!boards||dirty||saving||conflicted)return;try{await Notara.publishMath(boards.projection(revision));}catch{/* A concurrent edit invalidates this projection; poll loads its revision. */}}
function changed():void{dirty=true;generation++;message('同步中…');clearTimeout(timer);timer=setTimeout(()=>{void save();},450);historyButtons();}
async function save():Promise<boolean>{
  if(!scene||conflicted)return false;if(saving)return false;if(!dirty)return true;
  saving=true;historyButtons();const copy=structuredClone(scene),at=generation;
  try{const reply=await Notara.saveDocument(revision,copy);revision=reply.revision;base=structuredClone(reply.document as Scene);dirty=generation!==at;message(dirty?'同步中…':'已同步');error('');if(dirty)timer=setTimeout(()=>{void save();},100);return !dirty;}
  catch{try{const fresh=await Notara.loadDocument();if(fresh.document.kind==='math'&&fresh.revision!==revision){const merged=mergeMathScene(base,scene,fresh.document);if(!merged.conflicts.length&&valid(merged.document).success){scene=merged.document;base=structuredClone(fresh.document);revision=fresh.revision;render();timer=setTimeout(()=>{void save();},100);}else{remotePending={document:fresh.document,revision:fresh.revision};conflicted=true;$('conflict-actions').hidden=false;error('课堂与当前页面修改了同一处。请选择保留当前改动或采用课堂版本。');}}else error('暂时未能同步，改动仍保留。点击保存重试。');}catch{error('连接暂时不可用，改动仍保留。');}message('尚未同步');return false;}
  finally{saving=false;historyButtons();if(!dirty)void publish();}
}
function mutate(edit:(draft:Scene)=>void):boolean{if(!scene||conflicted)return false;const draft=structuredClone(scene);edit(draft);const result=valid(draft);if(!result.success){error(result.error.issues.map(i=>i.message).join('；'));return false;}if(JSON.stringify(draft)===JSON.stringify(scene))return true;pushHistory();scene={...draft,...result.data};error('');changed();render();return true;}
function button(text:string,action:()=>void):HTMLButtonElement{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=action;return b;}
function syncSelection():void{
  for(const name of selectedNames)if(!scene.objects.some(o=>o.name===name&&mathDimension(o)===(scene.view==='3d'?3:2)))selectedNames.delete(name);
  selected=selectedNames.size===1?[...selectedNames][0]! : '';
  boards?.highlight(selectedNames);
  $('objects').querySelectorAll<HTMLButtonElement>('.object-row').forEach(row=>row.setAttribute('aria-pressed',String(selectedNames.has(row.dataset.name!))));
  selectionBar.hidden=!selectedNames.size;
  const closure=mathRemovalClosure(scene.objects,selectedNames),related=closure.size-selectedNames.size;
  $('selection-count').textContent='已选 '+selectedNames.size+' 项';
  $('delete-selection').textContent=related?'删除（含 '+related+' 项关联）':'删除';
  $('delete-selection').title='删除 '+[...closure].join('、')+'；可撤销';
}
function selectObject(name:string,additive=false):void{
  if(!additive)selectedNames.clear();
  if(additive&&selectedNames.has(name))selectedNames.delete(name);else selectedNames.add(name);
  syncSelection();renderInspector();
}
function deleteObjects(names:Iterable<string>):void{
  const removal=mathRemovalClosure(scene.objects,names);
  if(removal.size)mutate(d=>{d.objects=d.objects.filter(o=>!removal.has(o.name));});
}
function clearSelection():void{selectedNames.clear();syncSelection();renderInspector();}
function selectionMode(enabled:boolean):void{
  boxMode=enabled;graph.classList.toggle('box-selecting',enabled);boxToggle.setAttribute('aria-pressed',String(enabled));selectionHint.hidden=!enabled;
  $('space-hint').hidden=enabled||scene?.view!=='3d';
}
boxToggle.onclick=()=>{selectionMode(!boxMode);graph.focus({preventScroll:true});};
$('delete-selection').onclick=()=>deleteObjects(selectedNames);
$('clear-selection').onclick=()=>clearSelection();
graph.addEventListener('pointerdown',event=>{
  if(!boxMode||!scene||event.button!==0||(event.target as Element).closest('button,.selection-bar'))return;
  event.preventDefault();event.stopPropagation();
  dragSelection={start:{x:event.clientX,y:event.clientY},pointerId:event.pointerId,previous:new Set(selectedNames),additive:event.shiftKey||event.ctrlKey||event.metaKey};
  graph.setPointerCapture(event.pointerId);graph.focus({preventScroll:true});selectionRect.hidden=false;
  Object.assign(selectionRect.style,{left:event.clientX-graph.getBoundingClientRect().left+'px',top:event.clientY-graph.getBoundingClientRect().top+'px',width:'0px',height:'0px'});
},true);
graph.addEventListener('pointermove',event=>{
  if(!dragSelection||event.pointerId!==dragSelection.pointerId)return;
  event.preventDefault();event.stopPropagation();
  const rect=graph.getBoundingClientRect(),box=selectionBox(dragSelection.start,{x:Math.max(rect.left,Math.min(rect.right,event.clientX)),y:Math.max(rect.top,Math.min(rect.bottom,event.clientY))});
  Object.assign(selectionRect.style,{left:box.left-rect.left+'px',top:box.top-rect.top+'px',width:box.right-box.left+'px',height:box.bottom-box.top+'px'});
  selectedNames.clear();if(dragSelection.additive)for(const name of dragSelection.previous)selectedNames.add(name);
  for(const name of boards?.selectWithin(box)??[])selectedNames.add(name);
  syncSelection();
},true);
function endSelection(event?:PointerEvent,cancel=false):void{
  if(!dragSelection||event&&event.pointerId!==dragSelection.pointerId)return;
  event?.preventDefault();event?.stopPropagation();
  const drag=dragSelection;dragSelection=undefined;
  if(cancel){selectedNames.clear();for(const name of drag.previous)selectedNames.add(name);}
  if(graph.hasPointerCapture(drag.pointerId))graph.releasePointerCapture(drag.pointerId);
  selectionRect.hidden=true;syncSelection();renderInspector();
}
graph.addEventListener('pointerup',event=>endSelection(event),true);
graph.addEventListener('pointercancel',event=>endSelection(event,true),true);
graph.addEventListener('lostpointercapture',event=>endSelection(event,true));
document.addEventListener('keydown',event=>{
  if(!scene||(event.target as Element).closest('input,textarea,select,[contenteditable="true"]'))return;
  if(event.key==='Escape'){endSelection(undefined,true);clearSelection();selectionMode(false);}
  else if((event.key==='Delete'||event.key==='Backspace')&&selectedNames.size){event.preventDefault();deleteObjects(selectedNames);}
});
function viewUI():void{root.dataset.view=scene.view;for(const value of ['2d','3d'])$('view-'+value).setAttribute('aria-pressed',String(scene.view===value));$('space-hint').hidden=boxMode||scene.view!=='3d';$('empty-canvas').hidden=scene.objects.some(o=>mathDimension(o)===(scene.view==='3d'?3:2));}
function render():void{
  if(!scene)return;observationStarted=false;boards?.destroy();
  boards=createMathBoards(()=>scene,{select:(name,additive)=>{selectObject(name,additive);},point:(name,coordinates)=>{
    const object=scene.objects.find(o=>o.name===name);if(!object||!['point','point3d','glider'].includes(object.kind))return;
    const before=JSON.stringify(object),draft=structuredClone(object) as any;draft.x=coordinates[0];if(object.kind!=='glider')draft.y=coordinates[1];if(object.kind==='point3d')draft.z=coordinates[2];
    if(JSON.stringify(draft)!==before){pushHistory();Object.assign(object,draft);changed();renderObjects();renderInspector();}
  },viewport:box=>{if(box.length===4&&box.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6)){scene.viewport=box as Scene['viewport'];changed();}},camera:(az,el)=>{if(Math.abs(az-scene.space.azimuth)>.0001||Math.abs(el-scene.space.elevation)>.0001){scene.space.azimuth=az;scene.space.elevation=el;changed();}}});
  if(boards.failures.length)error('以下对象暂时无法绘制：'+boards.failures.join('、'));
  viewUI();renderObjects();syncSelection();renderInspector();renderParameters();historyButtons();
  $<HTMLTextAreaElement>('observation').value=scene.observation;$('observation-count').textContent=scene.observation?'· 已记录':'';
  $('sources').replaceChildren(...scene.links.map(link=>button('↗ '+link.title,()=>{void Notara.openSource(link).catch(()=>error('资料暂时无法打开'));})));
  void publish();
}
function renderObjects():void{
  const list=$('objects');list.replaceChildren();
  for(const dimension of [2,3] as const){const objects=scene.objects.filter(o=>mathDimension(o)===dimension);if(!objects.length)continue;
    const heading=document.createElement('div');heading.className='object-group';heading.textContent=dimension===2?'平面':'空间';list.append(heading);
    for(const object of objects){const row=button('',()=>{});row.onclick=event=>{if(scene.view!==(dimension===2?'2d':'3d')){scene.view=dimension===2?'2d':'3d';selectedNames.clear();viewUI();changed();}selectObject(object.name,event.shiftKey||event.ctrlKey||event.metaKey);};row.className='object-row';row.dataset.name=object.name;row.setAttribute('aria-pressed',String(selectedNames.has(object.name)));
      const name=document.createElement('span');name.className='object-name';name.textContent=object.name;
      const description=document.createElement('span');description.textContent=('expression' in object?object.expression:object.label??kindNames[object.kind]);description.className='object-description';
      const marker=document.createElement('span');marker.textContent=object.visible?'●':'○';marker.className='object-marker';marker.dataset.color=object.color;row.append(marker,name,description);list.append(row);
    }
  }
  if(!scene.objects.length){const text=document.createElement('p');text.className='hint';text.textContent='暂无构造';list.append(text);}
}
type Fields=Record<string,string|number|boolean|string[]|number[]>;
const templates:Record<MathObject['kind'],Fields>={function:{expression:'x^2'},parametric:{x:'cos(t)',y:'sin(t)',range:[0,6.283185]},implicit:{expression:'x^2+y^2-4'},point:{x:0,y:0,draggable:true},glider:{curve:'',x:1},line:{from:'',to:'',segment:true},vector:{from:'',to:''},circle:{center:'',radius:'2'},polygon:{points:[]},tangent:{point:''},midpoint:{from:'',to:''},intersection:{first:'',second:'',branch:0},parallel:{line:'',point:''},perpendicular:{line:'',point:''},circumcircle:{points:[]},angle:{points:[]},conic:{points:[]},point3d:{x:0,y:0,z:0,draggable:true},midpoint3d:{from:'',to:''},line3d:{from:'',to:'',segment:true},vector3d:{from:'',to:''},plane3d:{points:[]},polygon3d:{points:[]},sphere3d:{center:'',radius:'2'},function3d:{expression:'sin(x)*cos(y)',xRange:[-3,3],yRange:[-3,3]},parametric3d:{x:'cos(t)',y:'sin(t)',z:'t/4',range:[0,12.56637]},surface3d:{x:'cos(u)*sin(v)',y:'sin(u)*sin(v)',z:'cos(v)',uRange:[0,6.283185],vRange:[0,3.1415926]}};
const labels:Record<string,string>={name:'对象名',label:'显示名称',expression:'表达式',x:'x 坐标 / 表达式',y:'y 坐标 / 表达式',z:'z 坐标 / 表达式',range:'参数区间',xRange:'x 区间',yRange:'y 区间',uRange:'u 区间',vRange:'v 区间',from:'起点',to:'终点',center:'中心',radius:'半径',points:'顶点（逗号分隔）',point:'经过点',curve:'函数',line:'参照直线',first:'第一个对象',second:'第二个对象',branch:'交点编号（0 / 1）',draggable:'允许拖动',segment:'限定为线段',visible:'显示',color:'颜色'};
function candidates(kind:MathObject['kind'],key:string):MathObject[]{
  const objects=scene.objects.filter(o=>mathDimension(o)===(kind.endsWith('3d')?3:2));
  if(['from','to','center','point'].includes(key))return objects.filter(o=>['point','glider','midpoint','intersection','point3d','midpoint3d'].includes(o.kind));
  if(key==='curve')return objects.filter(o=>o.kind==='function');
  if(key==='line')return objects.filter(o=>['line','parallel','perpendicular','tangent','vector'].includes(o.kind));
  return objects.filter(o=>['line','parallel','perpendicular','tangent','vector','circle','circumcircle'].includes(o.kind));
}
function renderInspector(creating?:MathObject['kind']):void{
  formDraft=false;
  const panel=$('inspector');panel.replaceChildren();
  if(!creating&&selectedNames.size>1){const label=document.createElement('p');label.className='hint';label.textContent='已选 '+selectedNames.size+' 个对象';panel.append(label,button($('delete-selection').textContent!,()=>deleteObjects(selectedNames)));return;}
  const existing=scene.objects.find(o=>o.name===selected);if(!creating&&!existing)return;
  const object=(creating?{kind:creating,name:nextName(creating.endsWith('3d')?'S':creating==='function'?'f':'G'),...templates[creating],color:'accent',visible:true}:structuredClone(existing)) as MathObject;
  const title=document.createElement('div');title.className='section-title';title.textContent=(creating?'构造':'属性')+' · '+kindNames[object.kind];panel.append(title);
  const snapshot=boards?.projection(revision).objects.find(o=>o.name===object.name);
  if(!creating&&snapshot){const readout=document.createElement('p');readout.className='readout';readout.textContent=snapshot.state!=='defined'?'当前构造未定义':[(snapshot.coordinates?'('+snapshot.coordinates.map(round).join(', ')+')':''),...Object.entries(snapshot.values).map(([key,value])=>({length:'长度',area:'面积',radius:'半径',slope:'斜率',angle:'弧度',volume:'体积'}[key as 'length'])+' '+round(value!))].filter(Boolean).join(' · ');panel.append(readout);}
  const form=document.createElement('form');form.className='property-form';const readers=new Map<string,()=>unknown>();
  for(const [key,value] of Object.entries(object)){if(key==='kind')continue;
    const wrap=document.createElement('label');wrap.textContent=labels[key]??key;
    let input:HTMLInputElement|HTMLSelectElement;
    if(['from','to','center','point','curve','line','first','second','color'].includes(key)){
      const select=document.createElement('select'),choices=key==='color'?[['accent','主题色'],['red','红'],['green','绿'],['gray','灰']]:[['','选择对象'],...candidates(object.kind,key).filter(o=>o.name!==object.name).map(o=>[o.name,o.name+' · '+kindNames[o.kind]])];
      for(const [id,text] of choices){const option=document.createElement('option');option.value=id!;option.textContent=text!;select.append(option);}select.value=String(value);input=select;readers.set(key,()=>select.value);
    }else{const field=document.createElement('input');field.type=typeof value==='boolean'?'checkbox':typeof value==='number'?'number':'text';if(field.type==='number')field.step='any';if(typeof value==='boolean')field.checked=value;else field.value=Array.isArray(value)?value.join(', '):String(value);if(key==='name'&&!creating)field.disabled=true;
      readers.set(key,()=>typeof value==='boolean'?field.checked:typeof value==='number'?Number(field.value):Array.isArray(value)?field.value.split(/[,，]/).map(v=>v.trim()).filter(Boolean).map(v=>key==='points'?v:Number(v)):field.value.trim());input=field;
    }
    input.setAttribute('aria-label',labels[key]??key);input.onfocus=()=>{fieldEditing=true;};input.onblur=()=>{fieldEditing=false;};input.oninput=()=>{formDraft=true;};wrap.append(input);form.append(wrap);
  }
  const actions=document.createElement('div');actions.className='property-actions';const submit=document.createElement('button');submit.textContent=creating?'添加':'应用修改';submit.type='button';actions.append(submit);
  if(!creating){const related=mathRemovalClosure(scene.objects,[object.name]).size-1;actions.append(button(related?'删除（含 '+related+' 项关联）':'删除',()=>deleteObjects([object.name])));}else actions.append(button('取消',()=>renderInspector()));form.append(actions);
  submit.onclick=()=>{fieldEditing=false;const updated={kind:object.kind,...Object.fromEntries([...readers].map(([key,read])=>[key,read()]))} as MathObject;const ok=mutate(d=>{if(creating){d.objects.push(updated);d.view=mathDimension(updated)===3?'3d':'2d';}else d.objects[d.objects.findIndex(o=>o.name===object.name)]=updated;});if(ok){selectObject(updated.name);}};form.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();submit.click();}};form.onsubmit=event=>event.preventDefault();panel.append(form);
}
function renderParameters():void{
  $('parameters').replaceChildren(...scene.parameters.map(parameter=>{const wrap=document.createElement('div');wrap.className='parameter';const title=button(parameter.name,()=>parameterEditor(parameter.name));title.title='编辑参数';const value=document.createElement('output');value.textContent=String(parameter.value);const slider=document.createElement('input');slider.type='range';slider.min=String(parameter.min);slider.max=String(parameter.max);slider.step=String(parameter.step);slider.value=String(parameter.value);slider.setAttribute('aria-label','参数 '+parameter.name);
    let started=false;slider.oninput=()=>{if(!started){pushHistory();started=true;}parameter.value=Number(slider.value);value.textContent=slider.value;boards?.update();changed();};slider.onchange=()=>{started=false;renderInspector();};wrap.append(title,slider,value);return wrap;}));
}
function parameterEditor(name?:string):void{
  const original=scene.parameters.find(p=>p.name===name),p=original??{name:nextName('a'),value:1,min:-5,max:5,step:.1};const form=document.createElement('form');form.className='property-form';const fields=new Map<string,HTMLInputElement>();
  for(const [key,label] of Object.entries({name:'参数名',value:'值',min:'下限',max:'上限',step:'步长'})){const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement('input');input.setAttribute('aria-label',label);input.type=key==='name'?'text':'number';input.step='any';input.value=String(p[key as keyof typeof p]);input.disabled=key==='name'&&!!original;wrap.append(input);form.append(wrap);fields.set(key,input);}
  const submit=document.createElement('button');submit.textContent='保存参数';submit.type='button';form.append(submit);submit.onclick=()=>{const parameter=Object.fromEntries([...fields].map(([key,input])=>[key,key==='name'?input.value:Number(input.value)])) as typeof p;if(mutate(d=>{const i=d.parameters.findIndex(p=>p.name===name);if(i<0)d.parameters.push(parameter);else d.parameters[i]=parameter;}))$('parameter-editor').replaceChildren();};form.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();submit.click();}};form.onsubmit=event=>event.preventDefault();$('parameter-editor').replaceChildren(form);
}
function showTab(tab:'objects'|'compute'):void{$('objects-panel').hidden=tab!=='objects';$('compute-panel').hidden=tab!=='compute';for(const t of ['objects','compute'])$('tab-'+t).setAttribute('aria-pressed',String(t===tab));root.dataset.panel='open';}
async function load(force=false):Promise<void>{try{const reply=await Notara.loadDocument();if(reply.document.kind!=='math')throw new Error('wrong_document');if(saving||fieldEditing||formDraft||dragSelection)return;
  if(dirty){if(force){remotePending={document:reply.document,revision:reply.revision};conflicted=true;$('conflict-actions').hidden=false;error('当前仍有未同步改动。请选择保留当前改动或采用课堂版本。');}return;}
  if(!scene||reply.revision!==revision||force){if(scene&&reply.revision!==revision)pushHistory();scene=reply.document;base=structuredClone(scene);revision=reply.revision;dirty=false;conflicted=false;error('');render();message('已同步');}
}catch{error('暂时无法读取场景，请点击刷新重试。');}}
$('keep-local').onclick=()=>{if(!remotePending)return;const merged=mergeMathScene(base,scene,remotePending.document);if(!valid(merged.document).success){error('合并后的对象关系不完整，请修正或采用课堂版本。');return;}scene=merged.document;base=structuredClone(remotePending.document);revision=remotePending.revision;remotePending=undefined;conflicted=false;$('conflict-actions').hidden=true;render();changed();};
$('use-remote').onclick=()=>{if(!remotePending)return;pushHistory();scene=remotePending.document;base=structuredClone(scene);revision=remotePending.revision;remotePending=undefined;dirty=false;conflicted=false;$('conflict-actions').hidden=true;error('');render();message('已采用课堂版本');};
for(const direction of ['undo','redo'])$(direction).onclick=()=>{const source=direction==='undo'?past:future,dest=direction==='undo'?future:past;if(saving||conflicted||!source.length)return;dest.push(structuredClone(scene));scene=source.pop()!;changed();render();};
for(const view of ['2d','3d'] as const)$('view-'+view).onclick=()=>{if(!scene)return;endSelection(undefined,true);clearSelection();scene.view=view;viewUI();changed();};
for(const tab of ['objects','compute'] as const)$('tab-'+tab).onclick=()=>showTab(tab);
$('toggle-panel').onclick=()=>{root.dataset.panel=root.dataset.panel==='open'?'closed':'open';};$('close-panel').onclick=()=>{root.dataset.panel='closed';};
for(const [kind,title] of Object.entries(kindNames)){const option=document.createElement('option');option.value=kind;option.textContent=title;$('object-kind').append(option);}
$('new-object').onclick=()=>{showTab('objects');renderInspector($<HTMLSelectElement>('object-kind').value as MathObject['kind']);};$('new-parameter').onclick=()=>parameterEditor();
$('observation').onfocus=()=>{fieldEditing=true;};$('observation').onblur=()=>{fieldEditing=false;observationStarted=false;};$('observation').oninput=()=>{const value=$<HTMLTextAreaElement>('observation').value;if(value===scene.observation)return;if(!observationStarted){pushHistory();observationStarted=true;}scene.observation=value;changed();};
$('sync-now').onclick=()=>{void load(true);};$('save-scene').onclick=()=>{void save();};
$('zoom-in').onclick=()=>{if(scene.view==='2d')boards?.plane.zoomIn();else mutate(d=>{d.space.bounds=d.space.bounds.map(([a,b])=>[(a+b)/2+(a-b)*.4,(a+b)/2+(b-a)*.4]) as Scene['space']['bounds'];});};
$('zoom-out').onclick=()=>{if(scene.view==='2d')boards?.plane.zoomOut();else mutate(d=>{d.space.bounds=d.space.bounds.map(([a,b])=>[(a+b)/2+(a-b)*.625,(a+b)/2+(b-a)*.625]) as Scene['space']['bounds'];});};
$('home').onclick=()=>mutate(d=>{if(d.view==='2d')d.viewport=[-5,5,5,-5];else d.space={bounds:[[-5,5],[-5,5],[-5,5]],azimuth:.8,elevation:.35};});
$('pick-source').onclick=()=>{void Notara.pickSource().then(link=>mutate(d=>{if(!d.links.some(old=>JSON.stringify(old)===JSON.stringify(link)))d.links.push(link);})).catch(()=>error('未添加资料'));};
let calculationText='';
$<HTMLButtonElement>('calculate').type='button';
$('calculate').onclick=()=>{void(async()=>{if(!await save())return;const at=revision,input:MathCompute={operation:$<HTMLSelectElement>('compute-operation').value as MathCompute['operation'],expression:$<HTMLInputElement>('compute-expression').value,variable:$<HTMLInputElement>('compute-variable').value};$<HTMLButtonElement>('calculate').disabled=true;$('compute-result').textContent='计算中…';$('keep-calculation').hidden=true;
  try{const result=await Notara.calculateMath(at,input);if(revision!==at||dirty){$('compute-result').textContent='场景参数已改变，请重新计算。';return;}if(result.status==='result'){$('compute-result').innerHTML=renderToString(result.latex,{output:'mathml',throwOnError:false,trust:false});calculationText=input.expression+' → '+result.latex;$('keep-calculation').hidden=false;}else $('compute-result').textContent=({unresolved:'引擎尚未得到可确认的结果。',undefined:'这个表达式当前没有有限数值。',invalid:'请检查公式语法与变量。',timeout:'计算耗时过长，请简化公式。'} as Record<string,string>)[result.status]??'计算未完成。';}catch{$('compute-result').textContent='暂时无法计算，请保存后重试。';}finally{$<HTMLButtonElement>('calculate').disabled=false;}})();};
$('keep-calculation').onclick=()=>{mutate(d=>{d.observation+=(d.observation?'\n':'')+calculationText;});$<HTMLDetailsElement>('notes').open=true;};
$('compute-form').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();$('calculate').click();}};$('compute-form').onsubmit=event=>event.preventDefault();
$('discuss').onclick=()=>{void(async()=>{if(!await save())return;await publish();await Notara.compose('请结合这个数学场景和我的观察继续讨论。用 read_math_scene 读取场景与测量，必要时增量修改同一份构造。');message('已带入，检查后发送');})().catch(()=>error('暂时无法带入对话，请重试'));};
$('save-note').onclick=()=>{void(async()=>{if(!await save())return;const projection=boards?.projection(revision),details=scene.objects.map(o=>{const p=projection?.objects.find(p=>p.name===o.name);return o.name+' · '+kindNames[o.kind]+('expression' in o?'：'+o.expression:'')+(p?.coordinates?' ('+p.coordinates.map(round).join(', ')+')':'');}).join('\n');Notara.saveNote({title:scene.title,documentRevision:revision,body:'## 构造\n\n'+details+'\n\n## 参数\n\n'+(scene.parameters.map(p=>p.name+' = '+p.value).join('，')||'无')+'\n\n## 观察与问题\n\n'+(scene.observation.trim()||'保存本次构造，尚未记录观察结论。')});})().catch(()=>error('暂时无法准备笔记'));};
$('example-function').onclick=()=>mutate(d=>{const a=nextName('a'),f=nextName('f'),p=nextName('P'),t=nextName('T');d.parameters.push({name:a,value:1,min:-3,max:3,step:.1});d.objects.push(...MathSceneSchema.parse({kind:'math',title:'示例',parameters:d.parameters,objects:[{kind:'function',name:f,expression:a+'*x^2'},{kind:'glider',name:p,curve:f,x:1},{kind:'tangent',name:t,point:p,color:'red'}]}).objects);d.view='2d';});
$('example-space').onclick=()=>mutate(d=>{const a=nextName('A'),b=nextName('B'),c=nextName('C'),p=nextName('P'),base=nextName('base');const objects=[{kind:'point3d',name:a,x:0,y:0,z:0},{kind:'point3d',name:b,x:4,y:0,z:0},{kind:'point3d',name:c,x:0,y:3,z:0},{kind:'point3d',name:p,x:0,y:0,z:4},{kind:'polygon3d',name:base,points:[a,b,c]},...[a,b,c].map((from,i)=>({kind:'line3d',name:nextName('edge'+i),from,to:p,segment:true,color:'red'}))];d.objects.push(...MathSceneSchema.parse({kind:'math',title:'示例',objects}).objects);d.view='3d';});
new ResizeObserver(()=>{const wrap=$('math-board').parentElement!;boards?.resize(wrap.clientWidth,wrap.clientHeight);}).observe($('math-board').parentElement!);
setInterval(()=>{if(!saving&&!document.hidden)void load();},1500);setInterval(()=>{if(!document.hidden)void publish();},5000);void load();
