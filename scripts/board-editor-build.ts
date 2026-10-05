import {readFile} from 'node:fs/promises';
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
export const excalidrawLocalAssets:Plugin={name:'notara-excalidraw-local-fonts',setup(builder){
 builder.onLoad({filter:/[/\\]@excalidraw[/\\]excalidraw[/\\]dist[/\\]prod[/\\]chunk-[^/\\]+\.js$/},async({path})=>{
  const source=await readFile(path,'utf8'),start=source.indexOf(',"ASSETS_FALLBACK_URL",`https://esm.sh/');
  if(start<0)return null;
  const ending='/dist/prod/`)',end=source.indexOf(ending,start);
  if(end<0||source.indexOf(',"ASSETS_FALLBACK_URL",`https://esm.sh/',start+1)>=0)throw Error('Excalidraw 0.18.1 font fallback contract changed');
  return {contents:source.slice(0,start)+',"ASSETS_FALLBACK_URL",new URL("/notara/vault/lazy/excalidraw/",location.origin).href)'+source.slice(end+ending.length),loader:'js'};
 });
}};
