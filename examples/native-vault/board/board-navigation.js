// Renderer-only navigation preference. Device ownership is explicit: wheel
// magnitudes and frequencies never identify a mouse or a trackpad.
export const BOARD_NAVIGATION_KEY='notara-board-navigation';
export const BOARD_MOUSE_WHEEL_KEY='notara-board-mouse-wheel';
export function readNavigationPreference(storage){
 try{return (storage??globalThis.localStorage)?.getItem(BOARD_NAVIGATION_KEY)==='trackpad'?'trackpad':'mouse';}catch{return 'mouse';}
}
export function createNavigationPreference(storage,events=globalThis.window){
 let mouseWheel='zoom';try{if((storage??globalThis.localStorage)?.getItem(BOARD_MOUSE_WHEEL_KEY)==='scroll')mouseWheel='scroll';}catch{}
 let value={device:readNavigationPreference(storage),mouseWheel};
 const listeners=new Set(),publish=patch=>{const next={...value,...patch};if(next.device===value.device&&next.mouseWheel===value.mouseWheel)return;value=next;for(const listener of listeners)listener();};
 const write=(key,next)=>{try{(storage??globalThis.localStorage)?.setItem(key,next);}catch{/* Keep the choice for this page when storage is unavailable. */}};
 const onStorage=event=>{if(event.key===null)publish({device:'mouse',mouseWheel:'zoom'});else if(event.key===BOARD_NAVIGATION_KEY)publish({device:event.newValue==='trackpad'?'trackpad':'mouse'});else if(event.key===BOARD_MOUSE_WHEEL_KEY)publish({mouseWheel:event.newValue==='scroll'?'scroll':'zoom'});};
 return {
  getSnapshot:()=>value,
  subscribe(listener){if(!listeners.size)events?.addEventListener('storage',onStorage);listeners.add(listener);return()=>{listeners.delete(listener);if(!listeners.size)events?.removeEventListener('storage',onStorage);};},
  setDevice(device){if(device!=='mouse'&&device!=='trackpad')return;write(BOARD_NAVIGATION_KEY,device);publish({device});},
  setMouseWheel(mouseWheel){if(mouseWheel!=='zoom'&&mouseWheel!=='scroll')return;write(BOARD_MOUSE_WHEEL_KEY,mouseWheel);publish({mouseWheel});},
 };
}
export const boardNavigationPreference=createNavigationPreference();
export function navigationPreferenceFor(element){
 const board=element?.closest('.nb-board');
 return board?{device:board.dataset.navigation==='trackpad'?'trackpad':'mouse',mouseWheel:board.dataset.mouseWheel==='scroll'?'scroll':'zoom'}:boardNavigationPreference.getSnapshot();
}
export const isTextEntry=target=>!!target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]');
export const isInnerBoardEditor=target=>!!target?.closest?.('.nb-free-editor,[data-board-editing="true"],.nb-interactive.is-expanded');
export function panIntent(event,space){
 if(event.button!==0&&event.button!==1)return false;
 if(isInnerBoardEditor(event.target))return false;
 if(event.button===1)return true;
 if(isTextEntry(event.target))return false;
 if(space&&!isTextEntry(event.target))return true;
 return !event.target?.closest?.('.nb-block');
}
export function zoomAt(camera,z,point,min=.3,max=2){
 const next=Math.max(min,Math.min(max,z)),ratio=next/camera.z;
 return {z:next,x:point.x-(point.x-camera.x)*ratio,y:point.y-(point.y-camera.y)*ratio};
}
export function wheelDelta(event,pageHeight=800){
 const unit=event.deltaMode===1?16:event.deltaMode===2?pageHeight:1;
 return {x:(event.deltaX??0)*unit,y:(event.deltaY??0)*unit};
}
export function wheelCamera(camera,event,preference,point,pageHeight=800,min=.3,max=2){
 const delta=wheelDelta(event,pageHeight);
 const device=typeof preference==='string'?preference:preference?.device,mouseWheel=typeof preference==='string'?'zoom':preference?.mouseWheel;
 if((device==='trackpad'||device==='mouse'&&mouseWheel==='scroll')&&!event.ctrlKey&&!event.metaKey)return {...camera,x:camera.x-delta.x,y:camera.y-delta.y};
 return zoomAt(camera,camera.z*Math.exp(-delta.y*.002),point,min,max);
}
// Native listeners are deliberately non-passive. Document scrolling is the
// browser's default; modified wheel must never become browser page zoom.
export function bindWheelBoundary(element){
 const wheel=event=>{if(event.ctrlKey||event.metaKey)event.preventDefault();event.stopPropagation();};
 element.addEventListener('wheel',wheel,{passive:false});
 return ()=>element.removeEventListener('wheel',wheel);
}
