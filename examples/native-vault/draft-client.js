/** Per-session editor drafts survive a page reload without becoming saved facts. */
export function createDraftStore(namespace) {
  const memory=new Map(),key=id=>`notara:${namespace}:${id}`;
  return {
    has(id){return this.get(id)!==undefined;},
    get(id){
      if(!id)return undefined;
      if(memory.has(id))return memory.get(id);
      try {const raw=globalThis.localStorage?.getItem(key(id));if(raw){const value=JSON.parse(raw);if(value&&typeof value==='object'){memory.set(id,value);return value;}}}catch{}
      return undefined;
    },
    set(id,value){if(!id)return;memory.set(id,value);try{globalThis.localStorage?.setItem(key(id),JSON.stringify(value));}catch{}},
    delete(id){memory.delete(id);try{globalThis.localStorage?.removeItem(key(id));}catch{}},
  };
}
