/** Per-session editor drafts survive a page reload without becoming saved facts. */
export const DRAFT_STORAGE_NOTICE='浏览器未能保存草稿，当前输入仍在本页；刷新或关闭前请先保存或复制。';
export function createDraftStore(namespace,{delay=300,key:idKey}={}) {
  const memory=new Map(),pending=new Map(),suppressed=new Set(),listeners=new Set(),key=idKey??(id=>`notara:${namespace}:${id}`);
  function persist(id){
    clearTimeout(pending.get(id));pending.delete(id);
    if(!memory.has(id))return;
    try{if(!globalThis.localStorage)throw Error('storage unavailable');globalThis.localStorage.setItem(key(id),JSON.stringify(memory.get(id)));}
    catch{for(const listener of listeners)listener(id,DRAFT_STORAGE_NOTICE);}
  }
  function flush(){for(const id of [...pending.keys()])persist(id);}
  globalThis.addEventListener?.('pagehide',flush);
  globalThis.document?.addEventListener('visibilitychange',()=>{if(globalThis.document.visibilityState==='hidden')flush();});
  return {
    has(id){return this.get(id)!==undefined;},
    get(id){
      if(!id)return undefined;
      if(suppressed.has(id))return undefined;
      if(memory.has(id))return memory.get(id);
      try {const raw=globalThis.localStorage?.getItem(key(id));if(raw){const value=JSON.parse(raw);if(value&&typeof value==='object'){memory.set(id,value);return value;}}}catch{}
      return undefined;
    },
    set(id,value){if(!id)return;suppressed.delete(id);memory.set(id,value);if(pending.has(id))return;const timer=setTimeout(()=>persist(id),delay);timer.unref?.();pending.set(id,timer);},
    delete(id){
      clearTimeout(pending.get(id));pending.delete(id);memory.delete(id);
      try{globalThis.localStorage?.removeItem(key(id));suppressed.delete(id);return true;}
      catch{
        // A small tombstone also works when a storage adapter refuses removal.
        try{globalThis.localStorage.setItem(key(id),'null');suppressed.delete(id);return true;}catch{}
        suppressed.add(id);for(const listener of listeners)listener(id,DRAFT_STORAGE_NOTICE);return false;
      }
    },
    flush,
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  };
}
