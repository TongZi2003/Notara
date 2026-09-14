import {expect,test} from 'vitest';
import {PluginDocumentSchema} from '../../packages/contracts/src/plugin-learning.ts';
import {catalog} from '../../examples/plugin-sources/catalog.ts';
import {triangle,onCircle,angle} from '../../examples/plugin-sources/geometry-model.ts';
import {advance} from '../../examples/plugin-sources/simulation-model.ts';
test('all document seeds satisfy their real contracts and reject inconsistent references',()=>{
 for(const item of catalog)if('seed'in item)expect(PluginDocumentSchema.safeParse(item.seed).success,item.name).toBe(true);
 const clinic=catalog.find(item=>item.name==='error-clinic')!;
 expect(PluginDocumentSchema.safeParse({...clinic.seed,errorIndex:99}).success).toBe(false);
 const sim=catalog.find(item=>item.name==='scenario-simulator')!;
 expect(PluginDocumentSchema.safeParse({...sim.seed,choices:[{title:'坏规则',description:'',effects:[1]}]}).success).toBe(false);
});
test('triangle measures and same-arc circle angles respect geometry and degenerate cases',()=>{
 const t=triangle([{x:0,y:0},{x:3,y:0},{x:0,y:4}]);expect(t.area).toBe(6);expect(t.angles.reduce((a,b)=>a+b,0)).toBeCloseTo(180);expect(t.angles[0]).toBeCloseTo(90);
 const a=onCircle({x:400,y:180}),b=onCircle({x:240,y:0}),c=onCircle({x:200,y:300}),d=onCircle({x:100,y:180});expect(angle(a,c,b)).toBeCloseTo(angle(a,d,b));expect(triangle([{x:0,y:0},{x:1,y:1},{x:2,y:2}]).area).toBe(0);
});
test('simulation applies published deltas, bounds resources and preserves violated constraints',()=>{
 const result=advance([10,80],[-20,40],[{minimum:5,maximum:100},{minimum:0,maximum:100}]);expect(result).toEqual({values:[0,100],viable:false,clipped:true});
});
