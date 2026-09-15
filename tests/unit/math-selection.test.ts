import {expect,test} from 'vitest';
import {selectionBox,containsSelection} from '../../examples/plugin-sources/math-selection.ts';
test('rectangle selection normalizes drag direction and selects contained objects, not crossing ones',()=>{
  const box=selectionBox({x:80,y:90},{x:10,y:20});
  expect(box).toEqual({left:10,top:20,right:80,bottom:90});
  expect(containsSelection(box,{left:30,right:50,top:40,bottom:60})).toBe(true);
  expect(containsSelection(box,{left:0,right:50,top:40,bottom:60})).toBe(false);
  expect(containsSelection(box,{left:28,right:32,top:38,bottom:42},true)).toBe(true);
  expect(containsSelection(box,{left:8,right:12,top:38,bottom:42},true)).toBe(true);
  expect(containsSelection(box,{left:8,right:12,top:38,bottom:42})).toBe(false);
  expect(containsSelection(box,{left:NaN,right:12,top:38,bottom:42})).toBe(false);
});
