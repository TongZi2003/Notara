import { compileMath } from '../../packages/contracts/src/math-expression.ts';
import { MathSceneSchema, type MathObject } from '../../packages/contracts/src/math-scene.ts';
import { mergeMathScene } from '../../packages/contracts/src/math-merge.ts';
import type { PluginDocument, PluginLink } from '../../packages/contracts/src/plugin-learning.ts';

declare const JXG: any;
declare const Notara: {
  loadDocument():Promise<{revision:number;document:PluginDocument}>;
  saveDocument(revision:number,document:PluginDocument):Promise<{revision:number;document:PluginDocument}>;
  compose(text:string):Promise<unknown>; pickSource():Promise<PluginLink>; openSource(link:PluginLink):Promise<unknown>;
  saveNote(note:{title:string;body:string;documentRevision:number}):void;
};
type Scene = Extract<PluginDocument,{kind:'math'}>;
const root = document.createElement('main');
root.innerHTML = `<header><strong>数学工作台</strong><span id="sync" role="status">正在读取…</span><button id="sync-now" title="读取课堂中的最新场景" aria-label="刷新数学场景">↻</button></header>
<section class="graph-wrap"><div id="math-board" tabindex="0" aria-label="数学绘图画布"></div><div class="graph-tools"><button id="zoom-in" aria-label="放大图形">＋</button><button id="zoom-out" aria-label="缩小图形">−</button><button id="home" aria-label="恢复视区">⌂</button></div></section>
<section class="controls"><form id="add-function"><input id="expression" aria-label="新函数表达式" placeholder="y = sin(x)，输入后添加"><button>添加函数</button></form><div id="objects" aria-label="图形对象"></div><div id="inspector"></div><div id="parameters"></div>
<details><summary>添加对象与参数</summary><div class="additions"><button id="add-point">添加点</button><input id="parameter-name" aria-label="新参数名称" placeholder="参数名，如 a"><button id="add-parameter">添加参数</button></div></details>
<details><summary>资料来源</summary><div id="sources"></div><button id="pick-source">关联资料</button></details>
<label class="observation-label" for="observation">观察与问题</label><textarea id="observation" rows="2" placeholder="记下图形变化、猜想或还没解决的问题"></textarea>
<footer><button id="discuss">带入对话</button><button id="save-note">沉淀为笔记</button><button id="save-scene">保存场景</button></footer><p id="error" role="alert"></p><div id="conflict-actions" hidden><button id="keep-local">保留我的改动</button><button id="use-remote">采用课堂版本</button></div></section>`;
document.body.append(root);
const $ = <T extends HTMLElement=HTMLElement>(id:string):T => document.getElementById(id) as T;
let scene:Scene, base:Scene, revision=0, dirty=false, saving=false, generation=0, conflicted=false, board:any, selected='', muted=false, fieldEditing=false, invalidDraft=false;
let remotePending:{document:Scene;revision:number}|undefined;
let timer:ReturnType<typeof setTimeout>|undefined;
const message = (text:string) => { $('sync').textContent=text; };
const error = (text:string) => { $('error').textContent=text; };
const valid = (doc:Scene) => MathSceneSchema.safeParse(Object.fromEntries(Object.entries(doc).filter(([key])=>key!=='links')));
const scope = () => Object.fromEntries(scene.parameters.map(p=>[p.name,p.value]));
const formula = (text:string,variables:string[]) => compileMath(text,[...scene.parameters.map(p=>p.name),...variables]);
const colors = {accent:'var(--notara-accent,#3468c0)',red:'#b35d58',green:'#4d8465',gray:'var(--notara-muted,#777)'};
const conflictName=(path:string):string=>{const parts=path.split('.');const names:Record<string,string>={title:'标题',observation:'观察与问题',viewport:'视区',expression:'表达式',value:'值',min:'下限',max:'上限',step:'步长',x:'横坐标',y:'纵坐标',label:'名称',visible:'显示状态',color:'颜色',range:'区间',links:'资料来源',radius:'半径',from:'起点',to:'终点',points:'顶点'};return parts[0]==='objects'||parts[0]==='parameters'?(parts[1]??'对象')+' 的'+(names[parts[2]??'']??'设置'):(names[path]??'图形设置');};
const kindNames:Record<MathObject['kind'],string>={function:'函数',parametric:'参数曲线',implicit:'隐式曲线',point:'点',glider:'曲线上动点',line:'直线',vector:'向量',circle:'圆',polygon:'多边形',tangent:'切线'};
const nextName = (prefix:string):string => {let index=1;const names=new Set([...scene.objects,...scene.parameters].map(o=>o.name));while(names.has(prefix+index))index++;return prefix+index;};
function changed():void {dirty=true;generation++;message('修改待同步');clearTimeout(timer);timer=setTimeout(()=>{void save();},650);}
async function save():Promise<boolean> {
  if(!scene||conflicted||invalidDraft)return false;
  if(saving)return false;
  if(!dirty)return true;
  saving=true;const copy=structuredClone(scene),at=generation;
  try {
    const reply=await Notara.saveDocument(revision,copy);revision=reply.revision;base=structuredClone(reply.document as Scene);dirty=generation!==at;message(dirty?'仍有修改待同步':'已同步到课堂');error('');if(dirty)timer=setTimeout(()=>{void save();},200);return !dirty;
  } catch {
    try {
      const fresh=await Notara.loadDocument();
      if(fresh.document.kind==='math' && fresh.revision!==revision){
        const merged=mergeMathScene(base,scene,fresh.document);
        if(!merged.conflicts.length && valid(merged.document).success){scene=merged.document;base=structuredClone(fresh.document);revision=fresh.revision;render();timer=setTimeout(()=>{void save();},200);message('正在合并课堂修改');}
        else{remotePending={document:fresh.document,revision:fresh.revision};conflicted=true;error('双方修改了同一处：'+(merged.conflicts.map(conflictName).join('、')||'对象关系')+'。保留我的改动会替换这些位置的课堂修改；其他修改会合并。');$('conflict-actions').hidden=false;}
      }else error('暂时未能同步，改动仍保留。可点击保存场景重试。');
    }catch{error('连接暂时不可用，改动仍保留。恢复后点击保存场景。');}
    message('同步未完成');return false;
  }
  finally {saving=false;}
}
function mutate(edit:(draft:Scene)=>void):void {
  const draft=structuredClone(scene);edit(draft);const result=valid(draft);
  if(!result.success){invalidDraft=true;error(result.error.issues.map(issue=>issue.message).join('；'));return;}
  scene=draft;invalidDraft=false;error('');changed();render();
}
function button(text:string,action:()=>void):HTMLButtonElement {const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=action;return b;}
function control(label:string,value:string,onChange:(value:string)=>void,type='text'):HTMLLabelElement {
  const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement('input');input.type=type;input.value=value;input.setAttribute('aria-label',label);let applied=value;const commit=()=>{if(input.value!==applied){applied=input.value;fieldEditing=false;onChange(input.value);}};input.onfocus=()=>{fieldEditing=true;};input.onchange=commit;input.onblur=()=>{fieldEditing=false;commit();};wrap.append(input);return wrap;
}
function render():void {
  if(!scene)return;
  muted=true;
  try {
    if(board)JXG.JSXGraph.freeBoard(board);
    JXG.Options.jc.compile=false;
    board=JXG.JSXGraph.initBoard('math-board',{boundingbox:scene.viewport,axis:true,grid:true,resize:{enabled:false},keepaspectratio:true,showCopyright:false,showNavigation:false,showInfobox:false,pan:{enabled:true},zoom:{enabled:true,wheel:true},defaultAxes:{x:{strokeColor:colors.gray,ticks:{strokeColor:colors.gray,label:{fontSize:11,strokeColor:colors.gray}}},y:{strokeColor:colors.gray,ticks:{strokeColor:colors.gray,label:{fontSize:11,strokeColor:colors.gray}}}}});
    if(board.options.jc.compile !== false)throw new Error('math_interpreter_required');
    const elements=new Map<string,any>();
    const add=(object:MathObject):void=>{
      const attrs={fixed:object.kind!=='point'&&object.kind!=='glider',name:object.label??object.name,visible:object.visible,strokeColor:colors[object.color],fillColor:colors[object.color],fillOpacity:0,strokeWidth:2,highlightStrokeWidth:2.5,highlightStrokeColor:colors[object.color],fontSize:12,label:{parse:false,display:'internal',strokeColor:colors[object.color],fontSize:12,cssStyle:'font-family:var(--notara-font,system-ui);'}};
      let element:any;
      if(object.kind==='function') {const f=formula(object.expression,['x']);element=board.create('functiongraph',[((x:number)=>f({...scope(),x})),...(object.range??[])],{...attrs,doAdvancedPlot:true});}
      else if(object.kind==='parametric'){const fx=formula(object.x,['t']),fy=formula(object.y,['t']);element=board.create('curve',[(t:number)=>fx({...scope(),t}),(t:number)=>fy({...scope(),t}),...object.range],attrs);}
      else if(object.kind==='implicit'){const f=formula(object.expression,['x','y']);element=board.create('implicitcurve',[(x:number,y:number)=>f({...scope(),x,y})],{...attrs,resolution_outer:8,resolution_inner:8});}
      else if(object.kind==='point')element=board.create('point',[object.x,object.y],{...attrs,size:3,fillOpacity:1,fixed:!object.draggable});
      else if(object.kind==='glider'){const curve=elements.get(object.curve);element=board.create('glider',[object.x,curve.Y(object.x),curve],{...attrs,size:3,fillOpacity:1});}
      else if(object.kind==='line'||object.kind==='vector')element=board.create(object.kind==='vector'?'arrow':object.segment?'segment':'line',[elements.get(object.from),elements.get(object.to)],attrs);
      else if(object.kind==='circle'){const radius=formula(object.radius,[]);element=board.create('circle',[elements.get(object.center),()=>{const value=radius(scope());return value>=0?value:NaN;}],{...attrs,fillOpacity:0});}
      else if(object.kind==='polygon')element=board.create('polygon',object.points.map(name=>elements.get(name)),{...attrs,fillOpacity:.08,borders:{strokeColor:attrs.strokeColor}});
      else element=board.create('tangent',[elements.get(object.point)],attrs);
      elements.set(object.name,element);
      element.on('down',()=>{selected=object.name;renderInspector();});
      if(object.kind==='point'||object.kind==='glider')element.on('up',()=>{
        const current=scene.objects.find(o=>o.name===object.name);if(!current||(current.kind!=='point'&&current.kind!=='glider'))return;
        const x=Number(element.X().toFixed(6)),y=Number(element.Y().toFixed(6));if(!Number.isFinite(x)||!Number.isFinite(y))return;
        const different=current.x!==x||(current.kind==='point'&&current.y!==y);
        if(current.kind==='point'){current.x=x;current.y=y;}else if(current.kind==='glider')current.x=x;
        if(different){changed();renderInspector();}
      });
    };
    for(const kinds of [['function','parametric','implicit','point'],['glider'],['line','vector','circle','polygon','tangent']])for(const object of scene.objects)if(kinds.includes(object.kind))add(object);
    board.on('boundingbox',()=>{if(muted)return;clearTimeout(timer);timer=setTimeout(()=>{if(!muted){const box=board.getBoundingBox();if(box.every((v:number)=>Number.isFinite(v)&&Math.abs(v)<=1e6)){scene.viewport=box;changed();}}},300);});
    $('objects').replaceChildren(...scene.objects.map(object=>{const b=button((object.visible?'':'○ ')+object.name+' · '+kindNames[object.kind],()=>{selected=object.name;renderInspector();});b.setAttribute('aria-pressed',String(selected===object.name));return b;}));
    $('parameters').replaceChildren(...scene.parameters.map(parameter=>{
      const wrap=document.createElement('label');wrap.className='parameter';const name=document.createElement('span');name.textContent=parameter.name;const number=document.createElement('output');number.textContent=String(parameter.value);
      const input=document.createElement('input');input.type='range';input.min=String(parameter.min);input.max=String(parameter.max);input.step=String(parameter.step);input.value=String(parameter.value);input.setAttribute('aria-label','参数 '+parameter.name);
      input.oninput=()=>{parameter.value=Number(input.value);number.textContent=input.value;board.update();changed();};wrap.append(name,input,number);return wrap;
    }));
    $<HTMLTextAreaElement>('observation').value=scene.observation;
    $('sources').replaceChildren(...scene.links.map(link=>button('↗ '+link.title,()=>{void Notara.openSource(link).catch(()=>error('资料暂时无法打开'));})));
    renderInspector();
  }catch(e){error('图形暂时无法绘制，请核对表达式与对象关系。');message('绘图未完成');}
  finally{muted=false;}
}
function renderInspector():void {
  $('objects').querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(scene.objects[i]?.name===selected)));
  const panel=$('inspector'),object=scene.objects.find(o=>o.name===selected);panel.replaceChildren();if(!object)return;
  panel.append(control('名称',object.label??object.name,label=>mutate(d=>{d.objects.find(o=>o.name===object.name)!.label=label;})));
  if(object.kind==='function'||object.kind==='implicit')panel.append(control('表达式',object.expression,expression=>mutate(d=>{const target=d.objects.find(o=>o.name===object.name)!;if(target.kind==='function'||target.kind==='implicit')target.expression=expression;})));
  if(object.kind==='point'||object.kind==='glider')for(const axis of object.kind==='point'?['x','y'] as const:['x'] as const)panel.append(control(axis+' 坐标',String(object[axis as keyof typeof object]),value=>{const number=Number(value);if(!Number.isFinite(number))return;mutate(d=>{const target=d.objects.find(o=>o.name===object.name)!;if(target.kind==='point'){target[axis]=number;}else if(target.kind==='glider')target.x=number;});},'number'));
  panel.append(button(object.visible?'隐藏':'显示',()=>mutate(d=>{const target=d.objects.find(o=>o.name===object.name)!;target.visible=!target.visible;})),button('移除',()=>mutate(d=>{d.objects=d.objects.filter(o=>o.name!==object.name);})));
}
async function load(force=false):Promise<void>{
  try {
    const reply=await Notara.loadDocument();if(reply.document.kind!=='math')throw new Error('wrong_document');
    if(saving||fieldEditing)return;
    if(dirty){if(force){remotePending={document:reply.document,revision:reply.revision};conflicted=true;$('conflict-actions').hidden=false;error('当前还有未同步修改。选择保留你的改动，或采用课堂版本。');}return;}
    if(!scene||reply.revision!==revision||force){scene=reply.document;base=structuredClone(scene);revision=reply.revision;dirty=false;conflicted=false;invalidDraft=false;error('');render();message('已同步到课堂');}
  }catch{error('暂时无法读取数学场景，请点击刷新重试。');}
}
$('keep-local').onclick=()=>{
  if(!remotePending)return;
  const merged=mergeMathScene(base,scene,remotePending.document);const check=valid(merged.document);
  if(!check.success){error('合并后对象关系不完整，请修正对象后重试，或采用课堂版本。');return;}
  scene=merged.document;base=structuredClone(remotePending.document);revision=remotePending.revision;remotePending=undefined;conflicted=false;$('conflict-actions').hidden=true;render();changed();
};
$('use-remote').onclick=()=>{
  if(!remotePending)return;
  scene=remotePending.document;base=structuredClone(scene);revision=remotePending.revision;remotePending=undefined;dirty=false;conflicted=false;invalidDraft=false;$('conflict-actions').hidden=true;error('');render();message('已采用课堂版本');
};
$('add-function').onsubmit=event=>{event.preventDefault();const input=$<HTMLInputElement>('expression'),expression=input.value.trim();if(!expression)return;const name=nextName('f');mutate(d=>d.objects.push({kind:'function',name,expression,color:'accent',visible:true}));if(scene.objects.some(o=>o.name===name)){selected=name;input.value='';renderInspector();}};
$('add-point').onclick=()=>{const name=nextName('P');mutate(d=>d.objects.push({kind:'point',name,x:0,y:0,draggable:true,color:'accent',visible:true}));selected=name;renderInspector();};
$('add-parameter').onclick=()=>{const input=$<HTMLInputElement>('parameter-name'),name=input.value.trim();if(!/^[A-Za-z][A-Za-z0-9_]{0,23}$/.test(name)){error('请填写字母开头的参数名');return;}mutate(d=>d.parameters.push({name,value:1,min:-5,max:5,step:.1}));input.value='';};
$('observation').oninput=()=>{scene.observation=$<HTMLTextAreaElement>('observation').value;changed();};
$('sync-now').onclick=()=>{void load(true);};$('save-scene').onclick=()=>{void save();};
$('zoom-in').onclick=()=>board?.zoomIn();$('zoom-out').onclick=()=>board?.zoomOut();$('home').onclick=()=>{mutate(d=>{d.viewport=[-5,5,5,-5];});};
$('pick-source').onclick=()=>{void Notara.pickSource().then(link=>mutate(d=>{if(!d.links.some(old=>JSON.stringify(old)===JSON.stringify(link)))d.links.push(link);})).catch(()=>error('未添加资料'));};
$('discuss').onclick=()=>{void (async()=>{if(!await save())return;await Notara.compose('请结合这个数学场景和我的观察继续讨论。先读取当前场景；需要调整时保留其他对象，修改同一份工作台。');message('已带入对话，检查后发送');})().catch(()=>error('暂时无法带入对话，请重试'));};
$('save-note').onclick=()=>{void (async()=>{if(!await save())return;const details=scene.objects.map(o=>o.name+'：'+(o.kind==='function'? 'y='+o.expression:o.kind==='implicit'?o.expression+'=0':o.kind==='parametric'?`(${o.x}, ${o.y})，t∈[${o.range}]`:o.kind==='point'?`(${o.x}, ${o.y})`:kindNames[o.kind])).join('\n');Notara.saveNote({title:scene.title,documentRevision:revision,body:'场景版本：'+revision+'\n\n## 场景\n\n'+details+'\n\n'+(scene.parameters.length?'## 参数\n\n'+scene.parameters.map(p=>`${p.name} = ${p.value}`).join('，')+'\n\n':'')+'## 观察与问题\n\n'+(scene.observation.trim()||'本次保存数学场景，尚未记录观察结论。')});})().catch(()=>error('暂时无法准备笔记'));};
new ResizeObserver(()=>{if(board){muted=true;try{const wrap=$('math-board').parentElement!;board.resizeContainer(wrap.clientWidth,wrap.clientHeight,true,true);}finally{muted=false;}}}).observe($('math-board').parentElement!);
setInterval(()=>{if(!saving&&!document.hidden)void load();},2000);
void load();
