import {randomUUID} from 'node:crypto';
const fail=()=>{throw Error('board_patch_scope_invalid');};

// An edit scope becomes active only when the Host receipt arrives in a real
// student message. Opening an editor or abandoning a draft never binds a turn.
export function createBoardReferences({read,bind,now=Date.now}){
 const pending=new Map(),active=new Map();
 async function issue({sessionId,blockId,elementIds,expectedRevision}){
  if(typeof sessionId!=='string'||typeof blockId!=='string'||!Array.isArray(elementIds)||elementIds.length>500||new Set(elementIds).size!==elementIds.length)fail();
  const value=await read({sessionId,blockId});
  if(value.revision!==expectedRevision)throw Error('board_conflict');
  const known=new Set([...(value.content?.elements??[]).map(e=>e.id),...(value.content?.mindmap?.links??[]).map(e=>e.id).filter(Boolean)]);
  if(elementIds.some(id=>typeof id!=='string'||!known.has(id)))fail();
  const token=randomUUID(),reference={blockId,elementIds:[...elementIds]};
  pending.set(token,{sessionId,reference,revision:value.revision,at:now()});
  for(const [key,row] of pending)if(row.at<now()-600_000)pending.delete(key);
  while(pending.size>200)pending.delete(pending.keys().next().value);
  return {token,reference,revision:value.revision};
 }
 async function prepare(session){
  const message=session.snapshotEvents().filter(event=>event.type==='user/message'&&event.data?.source?.kind==='user').at(-1)?.data;
  const prior=active.get(session.id);
  if(message?.id&&prior?.messageId===message.id)return prior.references;
  const text=(message?.content??[]).filter(block=>block.type==='text').map(block=>block.text).join('\n'),refs=[],tokens=[...new Set([...text.matchAll(/〔白板选区:([a-f0-9-]{36})〕/g)].map(match=>match[1]))];
  let expectedRevision;
  for(const token of tokens){
   const row=pending.get(token);
   if(!row||row.sessionId!==session.id||row.at<now()-600_000)throw Error('board_reference_expired');
   if(expectedRevision!==undefined&&row.revision!==expectedRevision)throw Error('board_conflict');
   expectedRevision=row.revision;
   const priorRef=refs.find(ref=>ref.blockId===row.reference.blockId);
   if(!priorRef)refs.push(structuredClone(row.reference));
   else priorRef.elementIds=priorRef.elementIds.length&&row.reference.elementIds.length?[...new Set([...priorRef.elementIds,...row.reference.elementIds])]:[];
   if(refs.length>100||refs.some(ref=>ref.elementIds.length>500))fail();
  }
  // Never evict an active scope while its teacher turn may still be running.
  if(refs.length&&!prior?.references.length&&[...active.values()].filter(row=>row.references.length).length>=100)throw Error('board_patch_scope_capacity');
  if(refs.length||prior?.references.length)await bind(refs,{sessionId:session.id,...(refs.length?{expectedRevision}:{})});
  for(const token of tokens)pending.delete(token);
  active.set(session.id,{messageId:message?.id,references:refs});
  while(active.size>100){const inactive=[...active].find(([,row])=>!row.references.length);if(!inactive)break;active.delete(inactive[0]);}
  return refs;
 }
 return {issue,prepare};
}
