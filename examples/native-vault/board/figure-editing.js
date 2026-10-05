import {NAME_SOURCE} from '../math-expression.js';
const declaration=new RegExp(`^\\s*function\\s+(${NAME_SOURCE})\\(x\\)\\s*=\\s*(.*)$`,'m');
export function readFigureFunction(body){const found=body.match(declaration);return found?{name:found[1],expression:found[2]}:null;}
export function replaceFigureFunction(body,expression){const found=readFigureFunction(body);if(!found)throw Error('请先添加一个函数定义。');return body.replace(declaration,()=>`function ${found.name}(x) = ${expression}`);}
export function updateFigureParameter(body,name,value){if(!Number.isFinite(value))throw Error('参数必须是有限数值。');return body.split('\n').map(line=>{const found=line.match(new RegExp(`^\\s*param\\s+(${NAME_SOURCE})\\s*=\\s*.*?\\s+in\\s+(.*)$`));return found?.[1]===name?`param ${name} = ${value} in ${found[2]}`:line;}).join('\n');}
export function updateFigurePoint(body,name,point){if(!Number.isFinite(point.x)||!Number.isFinite(point.y))throw Error('点的坐标必须是有限数值。');return body.split('\n').map(line=>{const found=line.match(new RegExp(`^\\s*point\\s+(${NAME_SOURCE})\\s*=`));return found?.[1]===name?`point ${name} = (${point.x}, ${point.y}) drag`:line;}).join('\n');}
