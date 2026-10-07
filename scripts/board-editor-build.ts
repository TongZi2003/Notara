import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Plugin} from 'esbuild';
export const boardReact:Plugin={name:'notara-board-react',setup(builder){
 builder.onResolve({filter:/^react$/},()=>({path:'react',namespace:'notara-react'}));
 builder.onLoad({filter:/.*/,namespace:'notara-react'},()=>({loader:'js',contents:`
 const React=globalThis.__NOTARA_BOARD_REACT__;
 if(!React)throw Error('Notara board React is not initialized');
 export default React;
 export const {Children,Component,PureComponent,Fragment,Profiler,StrictMode,Suspense,cloneElement,createContext,createElement,createFactory,createRef,forwardRef,isValidElement,lazy,memo,startTransition,useCallback,useContext,useDebugValue,useDeferredValue,useEffect,useId,useImperativeHandle,useInsertionEffect,useLayoutEffect,useMemo,useReducer,useRef,useState,useSyncExternalStore,useTransition,version,__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED}=React;
 `}));
}};
/** Only the build input is adapted, never the installed package. */
const fallbackAnchor=',"ASSETS_FALLBACK_URL",`https://esm.sh/';
const fallbackEnding='/dist/prod/`)';
const excalidrawProd=resolve(fileURLToPath(new URL('../node_modules/@excalidraw/excalidraw/dist/prod/',import.meta.url)));
export function rewriteExcalidrawFontFallback(source:string):string|null{
 const start=source.indexOf(fallbackAnchor);
 if(start<0)return null;
 const end=source.indexOf(fallbackEnding,start);
 if(end<0||source.indexOf(fallbackAnchor,start+1)>=0)throw Error('Excalidraw 0.18.1 font fallback contract changed');
 return source.slice(0,start)+',"ASSETS_FALLBACK_URL",new URL("/notara/vault/lazy/excalidraw/",location.origin).href)'+source.slice(end+fallbackEnding.length);
}
export function validateExcalidrawFontFallbackSources(sources:readonly string[]):void{
 const matches=sources.filter(source=>source.includes(fallbackAnchor));
 for(const source of matches)rewriteExcalidrawFontFallback(source);
 if(matches.length!==1)throw Error(`Excalidraw 0.18.1 font fallback contract changed: expected one anchored chunk, found ${matches.length}`);
}
export const excalidrawLocalAssets:Plugin={name:'notara-excalidraw-local-fonts',setup(builder){
 builder.onStart(async()=>{
  const chunks=(await readdir(excalidrawProd,{withFileTypes:true})).filter(entry=>entry.isFile()&&/^chunk-[^/\\]+\.js$/.test(entry.name));
  const sources:string[]=[];
  for(const chunk of chunks){
   const source=await readFile(resolve(excalidrawProd,chunk.name),'utf8');
   sources.push(source);
  }
  validateExcalidrawFontFallbackSources(sources);
 });
 builder.onLoad({filter:/[/\\]@excalidraw[/\\]excalidraw[/\\]dist[/\\]prod[/\\]chunk-[^/\\]+\.js$/},async({path})=>{
  const source=await readFile(path,'utf8'),contents=rewriteExcalidrawFontFallback(source);
  if(contents===null)return null;
  return {contents,loader:'js'};
 });
}};
