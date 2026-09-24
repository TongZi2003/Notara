import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';

export const BOARD_KINDS = ['note','question','hint','reference','attempt'];
const fail = code => { throw new Error(code); };
const marker = /^<!-- notara-board (\{[^\n]*\}) -->\r?\n/gm;
const validObject = value => value && typeof value === 'object' && !Array.isArray(value);
const idPattern = /^[a-zA-Z0-9-]{1,80}$/;
export function validateBoardBody(body) {
  if(typeof body !== 'string'||body.length>50000||/<!--\s*\/?notara-board\b/.test(body))fail('board_content_invalid');
  return body;
}
export function validateLayout(patch) {
  for(const key of ['x','y','width']) if(patch[key]!==undefined&&(!Number.isFinite(patch[key])||Math.abs(patch[key])>50000||(key==='width'&&(patch[key]<180||patch[key]>1600))))fail('board_layout_invalid');
  return patch;
}
export function parseBoard(content,sessionId) {
  if(content===null)return {sessionId,blocks:[],sourceNotes:{}};
  const {frontmatter,body}=parseFrontmatter(content);
  if(frontmatter.type!=='lesson-board'||frontmatter.session!==sessionId)fail('board_binding_invalid');
  const blocks=[],seen=new Set(),matches=[...body.matchAll(marker)];
  if(body.slice(0,matches[0]?.index??body.length).trim())fail('board_format_invalid');
  for(let i=0;i<matches.length;i++) {
    const match=matches[i];let meta;
    try{meta=JSON.parse(match[1]);}catch{fail('board_format_invalid');}
    if(!validObject(meta)||!idPattern.test(meta.id)||seen.has(meta.id)||!BOARD_KINDS.includes(meta.kind))fail('board_format_invalid');
    validateLayout(meta);seen.add(meta.id);
    const text=body.slice(match.index+match[0].length,matches[i+1]?.index??body.length).trim();
    const heading=text.match(/^## ([^\n]+)\n?([\s\S]*)$/);
    if(!heading)fail('board_format_invalid');
    blocks.push({id:meta.id,kind:meta.kind,x:meta.x??60,y:meta.y??60,width:meta.width??340,title:heading[1].trim(),body:validateBoardBody(heading[2].trim())});
  }
  const sourceNotes=frontmatter.sourceNotes??{};
  if(!validObject(sourceNotes))fail('board_format_invalid');
  for(const note of Object.values(sourceNotes)){if(!validObject(note))fail('board_format_invalid');validateLayout(note);if(note.body!==undefined)validateBoardBody(note.body);}
  return {sessionId,blocks,sourceNotes};
}
export function renderBoard(board) {
  const header=serializeFrontmatter({type:'lesson-board',title:'课堂板书',session:board.sessionId,sourceNotes:board.sourceNotes});
  return header+'\n'+board.blocks.map(({id,kind,x,y,width,title,body})=>`<!-- notara-board ${JSON.stringify({id,kind,x,y,width})} -->\n## ${title}\n\n${body}\n`).join('\n');
}
export function upsertBoard(board,args,id) {
  if(!validObject(args)||Object.keys(args).some(key=>!['title','body','kind','placement'].includes(key)))fail('board_content_invalid');
  if(typeof args.title!=='string'||!args.title.trim()||args.title.length>160||/[\r\n]/.test(args.title))fail('board_content_invalid');
  validateBoardBody(args.body);
  if(args.kind!==undefined&&!BOARD_KINDS.includes(args.kind))fail('board_content_invalid');
  const title=args.title.trim(),matches=board.blocks.filter(block=>block.title===title);
  if(matches.length>1)fail('board_title_ambiguous');
  const existing=matches[0];
  if(existing){existing.body=args.body;existing.kind=args.kind??existing.kind;return existing;}
  let x=60+(board.blocks.length%3)*400,y=60;
  const height=block=>100+Math.ceil(block.body.length/22)*25;
  const column=board.blocks.filter(block=>Math.abs(block.x-x)<200);
  if(column.length)y=Math.max(...column.map(block=>block.y+height(block)))+50;
  if(args.placement){
    const p=args.placement;
    if(!validObject(p)||Object.keys(p).some(key=>!['relativeTo','position'].includes(key))||!['beside','below'].includes(p.position))fail('board_layout_invalid');
    const anchor=board.blocks.find(block=>block.title===p.relativeTo);
    if(!anchor)fail('board_anchor_missing');
    x=anchor.x+(p.position==='beside'?anchor.width+60:0);y=anchor.y+(p.position==='below'?height(anchor)+50:0);
    while(board.blocks.some(block=>Math.abs(block.x-x)<340&&y<block.y+height(block)+30&&y+150>block.y))y+=180;
  }
  const block={id,title,body:args.body,kind:args.kind??'note',x,y,width:340};board.blocks.push(block);return block;
}

/** Only explicit references in the committed board count as used material. */
export function boardReferences(text) {
  const clean=String(text).replace(/<!--[^]*?-->/g,'').replace(/```[^]*?```|~~~[^]*?~~~/g,'').replace(/`[^`\n]*`/g,'');
  const refs=[];
  for(const match of clean.matchAll(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|!?\[([^\]]*)\]\(([^\s)]+)\)/g)) {
    let path=(match[1]??match[4]).split('#')[0];
    try{path=decodeURIComponent(path);}catch{continue;}
    path=path.replace(/^\.\//,'').replace(/^vault\//,'');
    if(!path||path.startsWith('/')||/^[a-z]+:/i.test(path)||path.split('/').some(part=>part.startsWith('.')||!part))continue;
    refs.push({path,label:match[2]??match[3]??null});
  }
  return refs;
}
export function projectBoard(board,revision,files=[]) {
  const known=new Map(files.map(file=>[file.path,file])),sources=new Map();
  const resolve=path=>known.has(path)?path:known.has(path+'.md')?path+'.md':path;
  for(const block of board.blocks)for(const ref of boardReferences(block.body)) {
    const path=resolve(ref.path);let source=sources.get(path);
    if(!source){const file=known.get(path),index=sources.size,note=Object.hasOwn(board.sourceNotes,path)?board.sourceNotes[path]:{};
      source={path,title:file?.title??ref.label??path.split('/').pop(),body:note.body??'本课引用的资料',usedBy:[],x:note.x??60+(index%3)*400,y:note.y??60+Math.floor(index/3)*300,width:note.width??340,missing:!file};sources.set(path,source);}
    if(!source.usedBy.includes(block.id))source.usedBy.push(block.id);
  }
  const edges=[];
  for(const source of sources.values())if(!Object.hasOwn(board.sourceNotes,source.path)||board.sourceNotes[source.path].body===undefined)source.body='用于：'+source.usedBy.map(id=>board.blocks.find(b=>b.id===id)?.title).filter(Boolean).join('、');
  for(const source of sources.values())for(const ref of boardReferences(known.get(source.path)?.content??'')) {
    const to=resolve(ref.path);if(to!==source.path&&sources.has(to)&&!edges.some(edge=>edge.from===source.path&&edge.to===to))edges.push({from:source.path,to,label:'引用'});
  }
  return {revision,blocks:board.blocks,sources:[...sources.values()],edges};
}
