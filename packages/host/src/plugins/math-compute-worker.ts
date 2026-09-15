import { parentPort, workerData } from 'node:worker_threads';
import { ComputeEngine, isNumber, isExpression, type Expression } from '@cortex-js/compute-engine';
import type { MathCompute,MathResult } from '@studyforge/contracts/math-workbench';
import { mathExpressionJSON } from '@studyforge/contracts/math-expression';
const {request,parameters}=workerData as {request:MathCompute;parameters:Record<string,number>};
const ce=new ComputeEngine();ce.iterationLimit=1024;ce.recursionLimit=96;ce.maxCollectionSize=2048;
const base={latex:'',json:'null',engine:'Cortex 0.128.9'};
let result:MathResult;
try {
  result=ce.withTimeLimit({ms:900,label:'notara-math'},()=>{
    for(const [name,value] of Object.entries(parameters))if(!(['solve','differentiate'].includes(request.operation)&&name===request.variable))ce.assign(name,value);
    const expression=/[\\{}]/.test(request.expression)?ce.parse(request.expression):ce.expr(mathExpressionJSON(request.expression));
    if(!expression.isValid)return {...base,status:'invalid' as const};
    let output:Expression;
    if(request.operation==='solve'){
      const roots:unknown=expression.solve(request.variable);
      if(!Array.isArray(roots)||!roots.length||!roots.every(isExpression))return {...base,status:'unresolved' as const};
      output=ce.expr(['List',...roots.map(root=>root.json)]);
    }else if(request.operation==='differentiate')output=ce.expr(['D',expression.json,request.variable]).evaluate();
    else output=request.operation==='simplify'?expression.simplify():request.operation==='numeric'?expression.N():expression.evaluate();
    const json=JSON.stringify(output.json),latex=output.latex;
    if(json.length>16000||latex.length>8000)return {...base,status:'unresolved' as const};
    const number=isNumber(output),numeric=isNumber(output)?Number(output.numericValue):undefined;
    const undefinedResult=/(?:"NaN"|"Undefined"|"ComplexInfinity"|"PositiveInfinity"|"NegativeInfinity"|"Infinity")/.test(json);
    const unresolved=request.operation==='numeric'&&!number||request.operation==='differentiate'&&json.includes('"D"');
    return {status:!output.isValid?'invalid':undefinedResult?'undefined':unresolved?'unresolved':'result',latex,json,...(numeric!==undefined&&Number.isFinite(numeric)?{numeric}:{}),engine:base.engine} as MathResult;
  });
}catch(error){result={...base,status:error instanceof Error&&error.name==='CancellationError'?'timeout':'invalid'};}
parentPort!.postMessage(result);
