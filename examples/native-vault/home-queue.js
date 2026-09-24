/** Read-only home projection of real review cards and unscheduled main-line lessons. */
export function homeQueue(queue,routes){
  const result=[],seen=new Set(),titles=new Map((routes?.routes??[]).map(route=>[route.path,route.title]));
  for(const card of queue?.hits??[]){
    const key='review:'+card.path;if(seen.has(key))continue;seen.add(key);
    result.push({key,kind:'review',title:card.title,path:card.path,subtitle:'待复习'+(card.state?.next_review?' · '+card.state.next_review:''),action:'复习'});
  }
  // The server's filtered total includes pages we did not fetch. Never count
  // only the visible hits when summarising a larger due queue.
  const dueCount=queue?.total??result.length;
  if(dueCount>5){
    result.splice(0,result.length,{key:'review:due',kind:'review-group',count:dueCount,title:dueCount+' 张卡片待复习',subtitle:'回顾已学内容',action:'复习'});
  }
  for(const node of routes?.nodes??[]){
    // Conditional practice is not an obligation until the teacher selects it.
    if(node.scheduledOn||node.sessionId||node.summary||(node.pathway&&node.pathway!=='main'))continue;
    const key='schedule:'+node.routePath+':'+node.id;if(seen.has(key))continue;seen.add(key);
    result.push({key,kind:'schedule',title:node.title,path:node.routePath,nodeId:node.id,revision:node.routeRevision,subtitle:'待安排'+(titles.get(node.routePath)?' · '+titles.get(node.routePath):''),action:'安排'});
  }
  // Keep the earliest due cards and route order, while letting both kinds
  // surface in the compact reminder instead of burying scheduling at the end.
  const reviews=result.filter(item=>item.kind==='review'||item.kind==='review-group'),lessons=result.filter(item=>item.kind==='schedule'),interleaved=[];
  for(let index=0;index<Math.max(reviews.length,lessons.length);index++){
    if(reviews[index])interleaved.push(reviews[index]);
    if(lessons[index])interleaved.push(lessons[index]);
  }
  return interleaved;
}
