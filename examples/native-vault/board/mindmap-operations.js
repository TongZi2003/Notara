export const emptyMindmap=()=>({nodes:[],links:[],notes:[]});
export function branchIds(map,id) {
 const ids=[id],seen=new Set(ids);
 for(let i=0;i<ids.length;i++)for(const node of map.nodes)if(node?.parentId===ids[i]&&!seen.has(node.elementId)){seen.add(node.elementId);ids.push(node.elementId);}
 return ids;
}
export function changeParent(map,id,parentId) {
 if(!map.nodes.some(n=>n.elementId===id)||parentId!==null&&!map.nodes.some(n=>n.elementId===parentId))throw Error('请先选择导图节点。');
 if(branchIds(map,id).includes(parentId))throw Error('不能挂到自己的分支下，这会成环。');
 return {...map,nodes:map.nodes.map(n=>n.elementId===id?{...n,parentId}:n)};
}
export function reconcileMindmap(map,elements) {
 const ids=new Set(elements.filter(e=>!e.isDeleted).map(e=>e.id)),nodes=map.nodes.filter(n=>ids.has(n.elementId)),nodeIds=new Set(nodes.map(n=>n.elementId));
 return {...(map.version?{version:map.version}:{}),nodes:nodes.map(n=>{const parentId=nodeIds.has(n.parentId)?n.parentId:null,next={...n,parentId};if(parentId===null||!ids.has(n.parentEdgeId))delete next.parentEdgeId;return next;}),links:map.links.filter(l=>nodeIds.has(l.from)&&nodeIds.has(l.to)),notes:(map.notes??[]).filter(n=>nodeIds.has(n.elementId))};
}
// Only the requested subtree and its bound labels move. Other branches stay put.
export function layoutBranch(elements,map,id) {
 const byId=new Map(elements.map(e=>[e.id,e])),root=byId.get(id),positions=new Map();
 if(!root||root.locked)return elements;
 let row=0;
 const visited=new Set();
 const visit=(nodeId,depth)=>{if(visited.has(nodeId))return;visited.add(nodeId);const element=byId.get(nodeId);if(!element)return;if(element.locked){row+=branchIds(map,nodeId).length;return;}positions.set(nodeId,{x:root.x+depth*240,y:root.y+row++*100});for(const n of map.nodes)if(n?.parentId===nodeId)visit(n.elementId,depth+1);};
 visit(id,0);
 return elements.map(e=>{
  const target=positions.get(e.id);if(target)return {...e,...target};
  const bound=positions.get(e.containerId),container=byId.get(e.containerId);if(bound&&container)return {...e,x:e.x+bound.x-container.x,y:e.y+bound.y-container.y};
  return e;
 });
}
