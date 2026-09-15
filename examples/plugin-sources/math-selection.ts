export type SelectionPoint = {x:number;y:number};
export type SelectionBox = {left:number;top:number;right:number;bottom:number};
export function selectionBox(start:SelectionPoint,end:SelectionPoint):SelectionBox {
  return {left:Math.min(start.x,end.x),top:Math.min(start.y,end.y),right:Math.max(start.x,end.x),bottom:Math.max(start.y,end.y)};
}
export function containsSelection(box:SelectionBox,bounds:SelectionBox,point=false):boolean {
  const {left,right,top,bottom}=bounds;
  if(![left,right,top,bottom].every(Number.isFinite))return false;
  if(point){const x=(left+right)/2,y=(top+bottom)/2;return x>=box.left&&x<=box.right&&y>=box.top&&y<=box.bottom;}
  return left>=box.left&&right<=box.right&&top>=box.top&&bottom<=box.bottom;
}
