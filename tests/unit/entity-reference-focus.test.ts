import { expect, test } from 'vitest';
import { focusEntityNode } from '../../packages/client/src/materials/entity-reference-focus.ts';
import type { MindNode } from '../../packages/client/src/materials/mindmap-model.ts';
const book = { key:'book',title:'书',kind:'book',hint:'',children:['section'] };
const section = { key:'section',title:'例2',kind:'section',hint:'',parent:'book',children:['card'] };
const card = { key:'card',title:'同名题',kind:'card',hint:'',parent:'section',children:[] };
const source = {materialId:'m',versionId:'v1',locator:{kind:'pdf' as const,page:2}};
const projection = { nodes:[],rows:new Map([['book',{source:{materialId:'m',versionId:'v1'}}]]),books:new Map([['card',{kind:'card',target:'card:a'}],['section',{kind:'section',path:'数学/例2',sources:[source]}]]) } as never;

test('a collapsed nested card resolves to the real leaf; its old revision never selects the current leaf', () => {
  const nodes:MindNode[]=[book,section,card];
  const entity = {reference:{kind:'card' as const,ref:'card:a',version:2},title:'同名题',sources:[source],chapter:'数学/例2',historical:false};
  expect(focusEntityNode(nodes,projection,new Map([['card:a',2]]),entity).key).toBe('card');
  const historical=focusEntityNode(nodes,projection,new Map([['card:a',3]]),{...entity,historical:true});
  expect(historical.key).not.toBe('card');
  expect(historical.nodes.find(n=>n.key===historical.key)?.parent).toBe('section');
});
test('different page anchors receive distinct focus nodes instead of both selecting the book', () => {
  const first=focusEntityNode([book,section,card],projection,new Map(),{reference:{kind:'source',source},title:'第2页',sources:[source],historical:false});
  const other={...source,locator:{kind:'pdf' as const,page:7}};
  const second=focusEntityNode([book,section,card],projection,new Map(),{reference:{kind:'source',source:other},title:'第7页',sources:[other],historical:false});
  expect(first.key).not.toBe('book'); expect(first.key).not.toBe(second.key);
});
