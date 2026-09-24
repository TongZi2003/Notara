const current=new Map();
export const getBoardStream=sessionId=>current.get(sessionId)??null;
export function publishBoardStream(sessionId,value){
  const detail={sessionId,...value};current.set(sessionId,detail);
  window.dispatchEvent(new CustomEvent('notara-board-stream',{detail}));
}
export function subscribeBoardStream(sessionId,receive){
  const listener=event=>{if(event.detail.sessionId===sessionId)receive(event.detail);};
  window.addEventListener('notara-board-stream',listener);
  const cached=getBoardStream(sessionId);if(cached)receive(cached);
  return()=>window.removeEventListener('notara-board-stream',listener);
}
/** Decode only complete JSON string characters, even while a tool argument is unfinished. */
export function partialBoardArgs(raw='') {
  const values={};let i=0,depth=0;
  function string(){let token='"';i++;while(i<raw.length){const c=raw[i++];if(c==='"'){try{return {value:JSON.parse(token+'"'),closed:true};}catch{return {value:'',closed:false};}}
    if(c==='\\'){const escape=raw[i];if(escape===undefined)break;if(escape==='u'){if(!/^[0-9a-f]{4}$/i.test(raw.slice(i+1,i+5)))break;token+='\\'+raw.slice(i,i+5);i+=5;}else{token+='\\'+escape;i++;}}else token+=c;
  }try{return {value:JSON.parse(token+'"'),closed:false};}catch{return {value:'',closed:false};}}
  while(i<raw.length){const c=raw[i];if(c==='{'){depth++;i++;}else if(c==='}'){depth--;i++;}else if(c==='"'){const key=string();while(/\s/.test(raw[i]??'')&&i<raw.length)i++;if(depth===1&&key.closed&&raw[i]===':'){i++;while(/\s/.test(raw[i]??'')&&i<raw.length)i++;if(raw[i]==='"'){const value=string();if(['title','body','kind'].includes(key.value)&&(value.closed||key.value==='body'))values[key.value]=value.value;}}}else i++;}
  return values;
}
export function createBoardEventTracker(){
  let events=new Map(),parts=new Map(),revision=-1;
  function accept(entry){const event=entry.event,d=event.data;
    if(event.type==='assistant/live-chunk'){
      const c=d.chunk,key=d.attemptId+':'+c.index;
      if(c.type==='tool-call-delta'){const p=parts.get(key)??{callId:'',name:'',argsRaw:''};p.callId=p.callId||c.id;p.name=c.name??p.name;p.argsRaw+=c.argumentsDelta;parts.set(key,p);if(p.name==='write_lesson_board')events.set(p.callId,{callId:p.callId,status:'streaming',...partialBoardArgs(p.argsRaw)});}
    }else if(event.type==='assistant/message'){
      for(const block of d.message?.content??[])if(block.type==='tool-call'&&block.name==='write_lesson_board')events.set(block.id,{callId:block.id,status:d.interrupted?'error':'pending',...partialBoardArgs(block.arguments)});
    }else if(event.type==='tool/call'&&d.name==='write_lesson_board')events.set(d.callId,{callId:d.callId,status:'pending',...partialBoardArgs(d.arguments)});
    else if(event.type==='tool/result'){const id=d.message?.source?.callId,previous=events.get(id);if(previous)events.set(id,{...previous,status:d.message?.content?.[0]?.isError?'error':'completed'});}
    else if(event.type==='turn/end')for(const [id,value] of events)if(['streaming','pending'].includes(value.status))events.set(id,{...value,status:'error'});
  }
  return window=>{if(window.revision===revision)return events;const append=revision>=0&&window.revision===revision+1&&window.change?.kind==='append';if(!append){events=new Map();parts=new Map();}for(const entry of append?window.change.entries:window.entries)accept(entry);revision=window.revision;return events;};
}
export function createBoardStream(React) {
  return function BoardStream({sessionId,ctx}) {
    const binding=React.useSyncExternalStore(fn=>ctx.sessions.list.subscribe(fn),()=>ctx.sessions.binding(sessionId));
    const source=binding?.eventSource;
    const tracker=React.useMemo(()=>createBoardEventTracker(),[sessionId]);
    const serialized=React.useSyncExternalStore(fn=>source?.subscribe(fn)??(()=>{}),()=>source?JSON.stringify([...tracker(source.getSnapshot())]):'[]');
    const seen=React.useRef(new Map());
    React.useEffect(()=>{seen.current=new Map(JSON.parse(serialized).filter(([,value])=>['completed','error'].includes(value.status)));return()=>{current.delete(sessionId);};},[sessionId]);
    React.useEffect(()=>{
      const events=new Map(JSON.parse(serialized)),emit=value=>publishBoardStream(sessionId,value);
      for(const [id,value] of events){const previous=seen.current.get(id);if(JSON.stringify(previous)!==JSON.stringify(value))emit(value);}
      // Cancellation/failed JSON has no landed tool result; remove that ephemeral preview too.
      for(const [id,value] of seen.current)if(!events.has(id)&&['streaming','pending'].includes(value.status))emit({...value,status:'error'});
      seen.current=events;
    },[sessionId,serialized]);
    return null;
  };
}
