import React from 'react';
const readers=()=>{
 const value=globalThis.__NOTARA_BOARD_READERS__;
 if(!value)throw Error('白板阅读器尚未就绪。');
 return value;
};
export function CodeMirrorMarkdown(props){return React.createElement(readers().CodeMirrorMarkdown,props);}
export function CodeEditor(props){return React.createElement(readers().CodeEditor,props);}
export async function renderPdfPreview(asset,locator,canvas,signal){
 const pdfjs=await readers().loadPdf();
 if(signal.aborted)return;
 const bytes=Uint8Array.from(atob(asset.dataUrl.split(',')[1]),char=>char.charCodeAt(0));
 const task=pdfjs.getDocument(readers().pdfDocumentOptions(bytes));
 let render;
 const abort=()=>{render?.cancel();void task.destroy();};
 signal.addEventListener('abort',abort,{once:true});
 try{
  const document=await task.promise,page=await document.getPage(Math.max(1,Math.min(document.numPages,locator?.page??1)));
  if(signal.aborted)return;
  const natural=page.getViewport({scale:1}),width=canvas.parentElement?.clientWidth??600;
  const viewport=page.getViewport({scale:Math.min(2,Math.max(.25,width/natural.width))});
  canvas.width=viewport.width;canvas.height=viewport.height;
  render=page.render({canvasContext:canvas.getContext('2d'),viewport});
  await render.promise;
 }finally{signal.removeEventListener('abort',abort);await task.destroy();}
}
