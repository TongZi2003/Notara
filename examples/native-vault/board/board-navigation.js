// Renderer-only navigation preference. Device ownership is explicit: wheel
// magnitudes and frequencies never identify a mouse or a trackpad.
export const BOARD_NAVIGATION_KEY='notara-board-navigation';
export function readNavigationPreference(storage){
 try{return (storage??globalThis.localStorage)?.getItem(BOARD_NAVIGATION_KEY)==='trackpad'?'trackpad':'mouse';}catch{return 'mouse';}
}
export function navigationPreferenceFor(element){
 return element?.closest('.nb-board')?.dataset.navigation??readNavigationPreference();
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
 if(preference==='trackpad'&&!event.ctrlKey&&!event.metaKey)return {...camera,x:camera.x-delta.x,y:camera.y-delta.y};
 return zoomAt(camera,camera.z*Math.exp(-delta.y*.002),point,min,max);
}
// Native listeners are deliberately non-passive. Document scrolling is the
// browser's default; modified wheel must never become browser page zoom.
export function bindWheelBoundary(element){
 const wheel=event=>{if(event.ctrlKey||event.metaKey)event.preventDefault();event.stopPropagation();};
 element.addEventListener('wheel',wheel,{passive:false});
 return ()=>element.removeEventListener('wheel',wheel);
}
