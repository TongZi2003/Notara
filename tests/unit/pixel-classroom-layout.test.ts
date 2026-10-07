import {afterEach,expect,test,vi} from 'vitest';
// The browser project uses its own bundler resolution and typecheck settings.
const layoutModule=new URL('../../examples/pixel-classroom/src/classroom-layout.ts',import.meta.url).href;
const {createClassroomLayout,loadInitialClassroomLayout}=await import(layoutModule);
afterEach(()=>vi.unstubAllGlobals());
test('valid saved classroom layouts survive while malformed furniture or dimensions fall back',()=>{
  const initial=createClassroomLayout();
  const read=(value:unknown)=>{vi.stubGlobal('window',{localStorage:{getItem:()=>JSON.stringify(value)}});return loadInitialClassroomLayout();};
  expect(read(initial).source).toBe('stored');
  for(const furniture of [[null],[{}],[{uid:'test',type:'DESK_FRONT',col:-1,row:0}],[initial.furniture[0],initial.furniture[0]]])expect(read({...initial,furniture}).source).toBe('default');
  expect(read({...initial,cols:0,rows:0,tiles:[]}).source).toBe('default');
  expect(read({...initial,tiles:initial.tiles.map(()=>999)}).source).toBe('default');
});
