import { expect,test } from 'vitest';
import { computeMath } from '../../packages/host/src/plugins/math-compute.ts';
test('Cortex evaluates scene parameters, differentiates and solves without sharing assignments',async()=>{
  expect(await computeMath({operation:'numeric',expression:'a^2+1',variable:'x'},{a:3})).toMatchObject({status:'result',numeric:10});
  expect(await computeMath({operation:'numeric',expression:'a^2+1',variable:'x'},{})).toMatchObject({status:'unresolved'});
  const roots=await computeMath({operation:'solve',expression:'x^2-5x+6=0',variable:'x'},{});
  expect(roots.status).toBe('result');expect(JSON.parse(roots.json).slice(1).sort()).toEqual([2,3]);
  const d=await computeMath({operation:'differentiate',expression:'x^3',variable:'x'},{});
  expect(d.status).toBe('result');expect(d.json).toContain('Power');expect(d.json).not.toContain('"D"');
  expect(await computeMath({operation:'numeric',expression:'0/0',variable:'x'},{})).toMatchObject({status:'undefined'});
},15000);
test('graph syntax and LaTeX have the same mathematical meaning',async()=>{
  for(const [expression,value] of [['sqrt(4)',2],['\\sqrt{4}',2],['ln(e)',1],['abs(-2)',2],['floor(2.5)',2],['pow(3,2)',9]] as const)expect(await computeMath({operation:'numeric',expression,variable:'x'},{})).toMatchObject({status:'result',numeric:value});
},15000);
test('finite complex results are distinct from undefined real arithmetic',async()=>{
  const result=await computeMath({operation:'evaluate',expression:'sqrt(-1)',variable:'x'},{});
  expect(result.status).toBe('result');expect(result.numeric).toBeUndefined();expect(()=>JSON.parse(result.json)).not.toThrow();
  expect(await computeMath({operation:'numeric',expression:'1/0',variable:'x'},{})).toMatchObject({status:'undefined'});
},10000);
