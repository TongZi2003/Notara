import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,lstat,open,link,rm,readFile,realpath} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';

const HASH=/^[a-f0-9]{64}$/;
const fail=code=>{throw Error(code);};
export const boardObjectHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Host-only immutable objects. A board Markdown reference is the commit point.
 * Hidden paths cannot be reached through ordinary Vault/Agent filesystem APIs. */
export function createBoardObjectStore(materialRoot) {
 const root=resolve(materialRoot);
 async function directory(sessionId,create=false) {
  if(typeof sessionId!=='string'||!sessionId||sessionId.length>300)fail('board_binding_invalid');
  const namespace=createHash('sha256').update(sessionId).digest('hex').slice(0,32);
  let path=root;
  for(const part of ['.notara-boards',namespace]) {
   path=join(path,part);
   if(create)await mkdir(path,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
   const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())fail('vault_path_invalid');
  }
  const canonical=await realpath(root),resolved=await realpath(path),rel=relative(canonical,resolved);
  if(rel.startsWith('..')||rel.startsWith('/'))fail('vault_path_invalid');
  return path;
 }
 async function read(sessionId,ref) {
  if(!HASH.test(ref))fail('board_content_invalid');
  let path;try{path=join(await directory(sessionId),ref+'.json');}catch(e){if(e.code==='ENOENT')fail('board_content_missing');throw e;}
  let handle;try{
   const info=await lstat(path);if(info.isSymbolicLink()||!info.isFile())fail('vault_path_invalid');if(info.size>12*1024*1024)fail('board_content_too_large');
   handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
   const content=await handle.readFile('utf8'),value=JSON.parse(content);if(boardObjectHash(value)!==ref)fail('board_content_corrupt');return value;
  }catch(e){if(e.code==='ENOENT')fail('board_content_missing');throw e;}finally{await handle?.close();}
 }
 async function write(sessionId,value) {
  const content=JSON.stringify(value);if(Buffer.byteLength(content)>12*1024*1024)fail('board_content_too_large');
  const ref=boardObjectHash(value),dir=await directory(sessionId,true),target=join(dir,ref+'.json'),temp=join(dir,randomUUID()+'.tmp');
  let handle;
  try {handle=await open(temp,'wx',0o600);await handle.writeFile(content);await handle.sync();await handle.close();handle=null;
   await link(temp,target).catch(e=>{if(e.code!=='EEXIST')throw e;});await read(sessionId,ref);return ref;
  }finally{await handle?.close();await rm(temp,{force:true});}
 }
 return {read,write,async copy(from,to,ref){const value=await read(from,ref);return write(to,value);}};
}
