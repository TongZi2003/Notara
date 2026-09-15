import { expect, test } from 'vitest';
import { MathSceneSchema } from '../../packages/contracts/src/math-scene.ts';
import { applyMathEdits } from '../../packages/contracts/src/math-workbench.ts';
test('a batch can introduce dependent constructions in any order without losing student observations',()=>{
  const base=MathSceneSchema.parse({kind:'math',title:'探索',observation:'我的问题',objects:[{kind:'point',name:'A',x:0,y:0}]});
  const next=applyMathEdits(base,[{action:'put-object',object:{kind:'midpoint',name:'M',from:'A',to:'B',color:'accent',visible:true}},{action:'put-object',object:{kind:'point',name:'B',x:4,y:0,draggable:true,color:'accent',visible:true}}]);
  expect(next.observation).toBe('我的问题');expect(next.objects).toHaveLength(3);expect(base.objects).toHaveLength(1);
  expect(applyMathEdits(next,[{action:'remove-object',name:'A'}]).objects.map(o=>o.name)).toEqual(['B']);
  expect(next.objects).toHaveLength(3);
});
test('deleting a point removes its transitive dependents and preserves unrelated parents',()=>{
  const scene=MathSceneSchema.parse({kind:'math',title:'关联删除',objects:[{kind:'point3d',name:'A',x:0,y:0,z:0},{kind:'point3d',name:'B',x:2,y:0,z:0},{kind:'line3d',name:'AB',from:'A',to:'B',segment:true},{kind:'midpoint3d',name:'M',from:'A',to:'B'},{kind:'sphere3d',name:'sphere',center:'M',radius:'1'}]});
  expect(applyMathEdits(scene,[{action:'remove-object',name:'A'},{action:'remove-object',name:'AB'}]).objects.map(o=>o.name)).toEqual(['B']);
  expect(applyMathEdits(scene,[{action:'remove-object',name:'AB'}]).objects.map(o=>o.name)).toEqual(['A','B','M','sphere']);
  expect(scene.objects).toHaveLength(5);
  expect(()=>applyMathEdits(scene,[{action:'remove-object',name:'missing'}])).toThrow('object_missing');
});
test('changing a view preserves omitted view bounds and camera fields',()=>{
  const base=MathSceneSchema.parse({kind:'math',title:'空间',view:'3d',space:{bounds:[[-2,2],[-3,3],[-1,1]],azimuth:2.5,elevation:-.4}});
  const updated=applyMathEdits(base,[{action:'set-view',view:'2d'}]);expect(updated.space).toEqual(base.space);
  expect(applyMathEdits(base,[{action:'set-view',viewport:[-2,2,2,-2]}]).view).toBe('3d');
  const turn=applyMathEdits(base,[{action:'set-view',space:{azimuth:1.2}}]);expect(turn.space).toEqual({...base.space,azimuth:1.2});
});
