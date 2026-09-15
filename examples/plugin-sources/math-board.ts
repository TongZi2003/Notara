import { compileMath } from '../../packages/contracts/src/math-expression.ts';
import { orderedMathObjects, mathDimension, type MathScene, type MathObject } from '../../packages/contracts/src/math-scene.ts';
import type { MathProjection } from '../../packages/contracts/src/math-workbench.ts';
import { containsSelection, type SelectionBox } from './math-selection.ts';
declare const JXG:any;
export const kindNames:Record<MathObject['kind'],string>={function:'函数',parametric:'参数曲线',implicit:'隐式曲线',point:'点',glider:'曲线上动点',line:'直线 / 线段',vector:'向量',circle:'圆',polygon:'多边形',tangent:'切线',midpoint:'中点',intersection:'交点',parallel:'平行线',perpendicular:'垂线',circumcircle:'三点圆',angle:'角',conic:'五点圆锥曲线',point3d:'空间点',midpoint3d:'空间中点',line3d:'空间直线 / 线段',vector3d:'空间向量',plane3d:'平面',polygon3d:'空间多边形',sphere3d:'球',function3d:'函数曲面',parametric3d:'空间参数曲线',surface3d:'参数曲面'};
type Hooks={select:(name:string,additive:boolean)=>void;point:(name:string,coordinates:number[])=>void;viewport:(box:number[])=>void;camera:(az:number,el:number)=>void};
export function createMathBoards(current:()=>MathScene,hooks:Hooks){
  const scene=current(),elements=new Map<string,any>(),failures:string[]=[];
  let muted=true;
  const colors={accent:'var(--notara-accent,#3468c0)',red:'#b35d58',green:'#4d8465',gray:'var(--notara-muted,#777)'};
  JXG.Options.jc.compile=false;
  const common={resize:{enabled:false},showCopyright:false,showNavigation:false,showInfobox:false,keepaspectratio:true,pan:{enabled:true},zoom:{enabled:true,wheel:true}};
  const axes={strokeColor:colors.gray,ticks:{strokeColor:colors.gray,label:{fontSize:11,strokeColor:colors.gray}}};
  const plane=JXG.JSXGraph.initBoard('math-board',{...common,boundingbox:scene.viewport,axis:true,grid:true,defaultAxes:{x:axes,y:axes}});
  const space=JXG.JSXGraph.initBoard('space-board',{...common,boundingbox:[-7,7,7,-7],axis:false,grid:false,pan:{enabled:false},zoom:{enabled:false}});
  const view=space.create('view3d',[[-5,-5],[10,10],scene.space.bounds],{projection:'parallel',axesPosition:'center',depthOrder:true,
    az:{slider:{visible:false}},el:{slider:{visible:false}},bank:{slider:{visible:false}},
    xPlaneRear:{fillOpacity:.02},yPlaneRear:{fillOpacity:.02},zPlaneRear:{fillOpacity:.02}});
  view.setView(scene.space.azimuth,scene.space.elevation);
  const scope=()=>Object.fromEntries(current().parameters.map(p=>[p.name,p.value]));
  const fn=(text:string,variables:string[])=>compileMath(text,[...scene.parameters.map(p=>p.name),...variables]);
  const get=(name:string):any=>{const el=elements.get(name);if(!el)throw new Error('dependency');return el;};
  const radius=(text:string)=>{const f=fn(text,[]);return ()=>{const value=f(scope());return value>0?value:NaN;};};
  for(const object of orderedMathObjects(scene.objects)){
    try {
      const attrs={fixed:true,name:object.label??object.name,visible:object.visible,strokeColor:colors[object.color],fillColor:colors[object.color],fillOpacity:0,strokeWidth:2,highlightStrokeWidth:2.5,highlightStrokeColor:colors[object.color],fontSize:12,withLabel:false,label:{parse:false,display:'internal',strokeColor:colors[object.color],fontSize:12,cssStyle:'font-family:var(--notara-font,system-ui);'}};
      let el:any;
      switch(object.kind){
        case 'function': {const f=fn(object.expression,['x']);el=plane.create('functiongraph',[(x:number)=>f({...scope(),x}),...(object.range??[])],{...attrs,doAdvancedPlot:true});break;}
        case 'parametric': {const x=fn(object.x,['t']),y=fn(object.y,['t']);el=plane.create('curve',[(t:number)=>x({...scope(),t}),(t:number)=>y({...scope(),t}),...object.range],attrs);break;}
        case 'implicit': {const f=fn(object.expression,['x','y']);el=plane.create('implicitcurve',[(x:number,y:number)=>f({...scope(),x,y})],{...attrs,resolution_outer:8,resolution_inner:8});break;}
        case 'point':el=plane.create('point',[object.x,object.y],{...attrs,fixed:!object.draggable,fillOpacity:1,size:3,withLabel:true});break;
        case 'glider':{const curve=get(object.curve);el=plane.create('glider',[object.x,curve.Y(object.x),curve],{...attrs,fixed:false,size:3,fillOpacity:1,withLabel:true});break;}
        case 'midpoint':el=plane.create('midpoint',[get(object.from),get(object.to)],{...attrs,size:3,fillOpacity:1,withLabel:true});break;
        case 'intersection':el=plane.create('intersection',[get(object.first),get(object.second),object.branch],{...attrs,size:3,fillOpacity:1,withLabel:true});break;
        case 'line':case 'vector':el=plane.create(object.kind==='vector'?'arrow':object.segment?'segment':'line',[get(object.from),get(object.to)],attrs);break;
        case 'parallel':case 'perpendicular':el=plane.create(object.kind,[get(object.line),get(object.point)],attrs);break;
        case 'circle':el=plane.create('circle',[get(object.center),radius(object.radius)],attrs);break;
        case 'circumcircle':el=plane.create('circumcircle',object.points.map(get),attrs);break;
        case 'polygon':el=plane.create('polygon',object.points.map(get),{...attrs,fillOpacity:.09,borders:{strokeColor:attrs.strokeColor,strokeWidth:2}});break;
        case 'angle':el=plane.create('angle',object.points.map(get),{...attrs,fillOpacity:.12,radius:.5});break;
        case 'conic':el=plane.create('conic',object.points.map(get),attrs);break;
        case 'tangent':el=plane.create('tangent',[get(object.point)],attrs);break;
        case 'point3d':el=view.create('point3d',[object.x,object.y,object.z],{...attrs,fixed:!object.draggable,size:3,fillOpacity:1,withLabel:true});break;
        case 'midpoint3d':{const a=get(object.from),b=get(object.to);el=view.create('point3d',[()=>[(a.X()+b.X())/2,(a.Y()+b.Y())/2,(a.Z()+b.Z())/2]],{...attrs,fillOpacity:1,size:3,withLabel:true});break;}
        case 'line3d':case 'vector3d':el=view.create('line3d',[get(object.from),get(object.to)],{...attrs,straightFirst:object.kind==='line3d'&&!object.segment,straightLast:object.kind==='line3d'&&!object.segment,point1:{visible:false},point2:{visible:false},lastArrow:object.kind==='vector3d'});break;
        case 'plane3d':el=view.create('plane3d',object.points.map(get),{...attrs,threePoints:true,fillOpacity:.12,mesh3d:{visible:false}});break;
        case 'polygon3d':el=view.create('polygon3d',[object.points.map(get)],{...attrs,fillOpacity:.15,borders:{strokeColor:attrs.strokeColor}});break;
        case 'sphere3d':el=view.create('sphere3d',[get(object.center),radius(object.radius)],{...attrs,fillOpacity:.06});break;
        case 'function3d':{const f=fn(object.expression,['x','y']);el=view.create('functiongraph3d',[(x:number,y:number)=>f({...scope(),x,y}),object.xRange,object.yRange],{...attrs,stepsU:24,stepsV:24,type:'wireframe',strokeWidth:.7,fillOpacity:0});break;}
        case 'parametric3d':{const fs=[object.x,object.y,object.z].map(text=>fn(text,['t']));el=view.create('curve3d',[(t:number)=>fs.map(f=>f({...scope(),t})),object.range],attrs);break;}
        case 'surface3d':{const fs=[object.x,object.y,object.z].map(text=>fn(text,['u','v']));el=view.create('parametricsurface3d',[(u:number,v:number)=>fs.map(f=>f({...scope(),u,v})),object.uRange,object.vRange],{...attrs,stepsU:24,stepsV:24,type:'wireframe',strokeWidth:.7,fillOpacity:0});break;}
      }
      elements.set(object.name,el);
      // JSXGraph's board-level "down" reaches every overlapping object. Use
      // the actual SVG target so a line ending at a point cannot steal selection.
      const hit=el.element2D??el;
      hit.rendNode?.setAttribute('data-math-object',object.name);
      hit.rendNode?.addEventListener('pointerdown',(event:PointerEvent)=>hooks.select(object.name,event.shiftKey||event.ctrlKey||event.metaKey));
      if(object.kind==='point'||object.kind==='glider'||object.kind==='point3d')hit.on?.('up',()=>{
        const coordinates=[el.X(),el.Y(),...(object.kind==='point3d'?[el.Z()]:[])].map(v=>Number(v.toFixed(6)));
        if(coordinates.every(Number.isFinite))hooks.point(object.name,coordinates);
      });
    }catch{failures.push(object.name);}
  }
  // Surface3D builds its mesh in update(), not in its constructor. Complete the
  // initial update before publishing observations or enabling interaction.
  plane.fullUpdate();space.fullUpdate();
  plane.on('boundingbox',()=>{if(!muted)hooks.viewport(plane.getBoundingBox());});
  space.on('up',()=>{if(!muted)hooks.camera(view.az_slide.Value(),view.el_slide.Value());});
  muted=false;
  const projection=(revision:number):MathProjection=>({revision,objects:current().objects.map(object=>{
    const el=elements.get(object.name),values:MathProjection['objects'][number]['values']={};let undefinedScalar=false;
    if(!el)return {name:object.name,state:'unsupported',values};
    let coordinates:number[]|undefined;
    if(['point','glider','midpoint','intersection','point3d','midpoint3d'].includes(object.kind))coordinates=[el.X(),el.Y(),...(mathDimension(object)===3?[el.Z()]:[])];
    const scalar=(key:keyof typeof values,read:()=>number,required=false):void=>{try{const v=read();if(Number.isFinite(v))values[key]=v;else if(required)undefinedScalar=true;}catch{if(required)undefinedScalar=true;}};
    if(['circle','circumcircle','sphere3d'].includes(object.kind))scalar('radius',()=>el.Radius(),true);
    if(object.kind==='polygon')scalar('area',()=>el.Area());
    if(object.kind==='angle')scalar('angle',()=>el.Value());
    if(['line','parallel','perpendicular','vector','tangent'].includes(object.kind))scalar('slope',()=>el.getSlope());
    if(object.kind==='line'&&object.segment||object.kind==='vector')scalar('length',()=>get(object.from).Dist(get(object.to)));
    if(object.kind==='line3d'&&object.segment||object.kind==='vector3d')scalar('length',()=>get(object.from).distance(get(object.to)));
    const defined=!undefinedScalar&&el.isReal!==false&&(!coordinates||coordinates.every(Number.isFinite));
    return {name:object.name,state:defined?'defined':'undefined',...(defined&&coordinates?{coordinates}:{}),values:defined?values:{}};
  })});
  const nodes=(el:any):SVGElement[]=>{const hit=el.element2D??el;return [hit.rendNode,...(hit.borders??[]).map((border:any)=>border.rendNode)].filter(Boolean);};
  const highlight=(names:ReadonlySet<string>):void=>{for(const [name,el] of elements)for(const node of nodes(el))node.classList.toggle('math-selected',names.has(name));};
  const selectWithin=(box:SelectionBox):string[]=>current().objects.filter(object=>{
    if(!object.visible||mathDimension(object)!==(current().view==='3d'?3:2))return false;
    const el=elements.get(object.name);if(!el||el.isReal===false)return false;
    const node=nodes(el)[0];if(!node||getComputedStyle(node).visibility==='hidden')return false;
    const bounds=node.getBoundingClientRect();if(!bounds.width&&!bounds.height)return false;
    return containsSelection(box,bounds,['point','glider','midpoint','intersection','point3d','midpoint3d'].includes(object.kind));
  }).map(object=>object.name);
  return {plane,space,view,elements,failures,projection,highlight,selectWithin,update:()=>{plane.update();space.update();},
    resize:(width:number,height:number)=>{muted=true;try{plane.resizeContainer(width,height,true,true);space.resizeContainer(width,height,true,true);}finally{muted=false;}},
    destroy:()=>{JXG.JSXGraph.freeBoard(plane);JXG.JSXGraph.freeBoard(space);}};
}
