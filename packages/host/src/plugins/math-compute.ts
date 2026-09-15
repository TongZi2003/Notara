import { Worker } from 'node:worker_threads';
import { MathComputeSchema, type MathCompute, type MathResult } from '@studyforge/contracts/math-workbench';
let active=0;
/** Hard isolation supplements Cortex's cooperative deadline; no classroom event loop is blocked. */
export async function computeMath(input:MathCompute,parameters:Record<string,number>):Promise<MathResult> {
  const request=MathComputeSchema.parse(input);
  if(active>=2)return {status:'busy',latex:'',json:'null',engine:'Cortex 0.128.9'};
  active++;
  try {
    return await new Promise<MathResult>((resolve,reject)=>{
      const worker=new Worker(new URL(import.meta.url.endsWith('.ts')?'./math-compute-worker.ts':'./math-compute-worker.js',import.meta.url),{workerData:{request,parameters},resourceLimits:{maxOldGenerationSizeMb:192}});
      let settled=false;
      const finish=(result?:MathResult,error?:Error):void=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve(result!);};
      const timer=setTimeout(()=>finish({status:'timeout',latex:'',json:'null',engine:'Cortex 0.128.9'}),4000);
      worker.once('message',(result:MathResult)=>finish(result));worker.once('error',error=>finish(undefined,error));
      worker.once('exit',()=>{if(!settled)finish(undefined,new Error('math_compute_interrupted'));});
    });
  }finally{active--;}
}
