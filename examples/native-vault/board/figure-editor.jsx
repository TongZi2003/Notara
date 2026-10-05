import React,{useMemo} from 'react';
import {boardComponents} from '../board-components.js';
import {createBoardVisuals} from '../board-visual-client.js';
import {readFigureFunction,replaceFigureFunction,updateFigureParameter,updateFigurePoint} from './figure-editing.js';

const visuals=createBoardVisuals(React);
export const DEFAULT_FIGURE='```figure\naxes x -5..5 y -5..5\nparam a = 1 in -3..3\nfunction f(x) = a*x^2\n```';
export function FigureEditor({body,onChange,onError,onDiscuss}){
 const component=useMemo(()=>boardComponents(body).find(c=>c.type==='figure'),[body]);
 const spec=component?.spec,sourceExpression=readFigureFunction(body)?.expression??'';
 function expression(value){
  try{onChange(replaceFigureFunction(body,value));}catch(error){onError?.(error.message);}
 }
 return <div className="nb-function-editor" onPointerDown={e=>e.stopPropagation()}>
  <label>函数<input aria-label="函数表达式" value={sourceExpression} onChange={e=>expression(e.target.value)} placeholder="例如 a*x^2"/></label>
  {component&&!component.error&&!spec?.ask?<visuals.FigureView component={component} navigationActive prefix="" onDiscuss={onDiscuss} snapshotKey={'container-figure-'+component.fingerprint} onValueChange={(name,value)=>onChange(updateFigureParameter(body,name,value))} onPointChange={(name,point)=>onChange(updateFigurePoint(body,name,point))}/>:<p role="status">{component?.error?.message??'函数定义暂不可绘制，请检查表达式。'}</p>}
  <details><summary>函数、参数与坐标范围</summary><textarea aria-label="函数图定义" value={body} onChange={e=>onChange(e.target.value)} spellCheck={false}/></details>
 </div>;
}
