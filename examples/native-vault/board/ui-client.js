import {loadLazyModule} from '../lazy-assets.js';
export const DEFAULT_FIGURE='```figure\naxes x -5..5 y -5..5\nparam a = 1 in -3..3\nfunction f(x) = a*x^2\n```';
export const isDrawing=block=>['drawing','mindmap'].includes(block.contentType);

// Reuse DSH's exact React and native readers. Editors load only on the board.
export function createFreeBoardUI(React,readers){
 globalThis.__NOTARA_BOARD_REACT__=React;
 globalThis.__NOTARA_BOARD_READERS__=readers;
 const h=React.createElement;
 return Object.fromEntries(['VaultFileContainer','DrawingPreview','FreeBlockEditor','ContributionOriginal'].map(name=>{
  const Editor=React.lazy(()=>loadLazyModule('board-editors.mjs').then(module=>({default:module[name]})));
  return [name,props=>h(React.Suspense,{fallback:h('p',{role:'status'},'正在打开白板编辑器…')},h(Editor,props))];
 }));
}
