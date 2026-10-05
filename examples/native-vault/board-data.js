import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { validateInteractiveRef } from './interactive-data.js';
import { BOARD_COMPONENTS, answersFor, boardAnswerSummary, boardComponents, splitBoardBody, validateBoardComponents, validateStoredAnswers } from './board-components.js';
import { BOARD_RESIZE_LIMITS,BOARD_SIZES } from './board-layout.js';
import { validateBoardUrl } from './board-scene.js';
import { validateBoardSourceRef } from './board-mindmap.js';

/** Host-bound lesson boards live here; only write_lesson_board writes them. */
export const BOARD_DIRECTORY='lesson-board';
export const BOARD_KINDS = ['note','question','hint','reference','attempt'];
const fail = code => { throw new Error(code); };
const marker = /^<!-- notara-board (\{[^\n]*\}) -->\r?\n/gm;
const validObject = value => value && typeof value === 'object' && !Array.isArray(value);
const idPattern = /^[a-zA-Z0-9-]{1,80}$/;
const sectionPattern = /^s-[a-f0-9]{8}$/;
export const BOARD_CONTENT_TYPES=['text','drawing','mindmap','source','link','figure'];
const CONTENT_KEYS=['contentType','contentRef','sourceRef','url'];
const META_KEYS = ['id','kind','section','size','place','x','y','width','height','interactive','answers',...CONTENT_KEYS];
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const singleLine = (value,max) => typeof value==='string'&&value.trim()&&value.length<=max&&!/[\r\n]/.test(value);
/** A dedicated figure card is one safe, non-answerable figure component. */
export function validateBoardBody(body,contentType) {
  if(typeof body !== 'string'||body.length>50000||/<!--\s*\/?notara-board\b/.test(body))fail('board_content_invalid');
  if(contentType==='figure'){
    const {segments}=splitBoardBody(body),components=validateBoardComponents(body);
    if(segments.some(segment=>segment.kind==='markdown'&&segment.text.trim())||components.length!==1||components[0].type!=='figure'||components[0].spec.ask)fail('board_figure_invalid');
  }
  return body;
}
export function validateLayout(patch) {
  for(const key of ['x','y','width','height']) if(patch[key]!==undefined&&(!Number.isFinite(patch[key])||Math.abs(patch[key])>50000||(key==='width'&&(patch[key]<180||patch[key]>BOARD_RESIZE_LIMITS.maxWidth))||(key==='height'&&(patch[key]<BOARD_RESIZE_LIMITS.minHeight||patch[key]>BOARD_RESIZE_LIMITS.maxHeight))))fail('board_layout_invalid');
  return patch;
}
function validateSections(value) {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>60)fail('board_format_invalid');
  const seen=new Set();
  for(const section of value){if(!validObject(section)||Object.keys(section).some(key=>!['id','title'].includes(key))||!sectionPattern.test(section.id)||seen.has(section.id)||!singleLine(section.title,80))fail('board_format_invalid');seen.add(section.id);}
  return value.map(({id,title})=>({id,title}));
}
function validatePlace(value) {
  if(value===undefined)return undefined;
  if(!validObject(value)||Object.keys(value).some(key=>!['relativeTo','position'].includes(key))||!idPattern.test(value.relativeTo)||!['beside','below'].includes(value.position))fail('board_format_invalid');
  return {relativeTo:value.relativeTo,position:value.position};
}
function contentMetadata(meta){
  const out={};
  if(meta.contentType!==undefined){if(!BOARD_CONTENT_TYPES.includes(meta.contentType))fail('board_format_invalid');out.contentType=meta.contentType;}
  if(meta.contentRef!==undefined){if(!['drawing','mindmap'].includes(meta.contentType)||!hash(meta.contentRef))fail('board_content_ref_invalid');out.contentRef=meta.contentRef;}
  if(['drawing','mindmap'].includes(meta.contentType)&&meta.contentRef===undefined)fail('board_content_ref_missing');
  if(meta.sourceRef!==undefined){if(meta.contentType!=='source')fail('board_source_ref_invalid');try{out.sourceRef=validateBoardSourceRef(meta.sourceRef);}catch{fail('board_source_ref_invalid');}}
  if(meta.contentType==='source'&&meta.sourceRef===undefined)fail('board_source_ref_missing');
  if(meta.url!==undefined){if(meta.contentType!=='link')fail('board_url_invalid');try{out.url=validateBoardUrl(meta.url);}catch{fail('board_url_invalid');}}
  if(meta.contentType==='link'&&meta.url===undefined)fail('board_url_missing');
  return out;
}
function boardVersion(board){
  if(board.version!==undefined&&![1,2].includes(board.version))fail('board_version_unsupported');
  if(board.formatVersion!==undefined&&![1,2].includes(board.formatVersion))fail('board_version_unsupported');
  return board.version===2||board.formatVersion===2||['manualEdges','groups','historyRefs'].some(key=>board[key]!==undefined)||board.blocks.some(block=>CONTENT_KEYS.some(key=>block[key]!==undefined))?2:board.formatVersion??board.version;
}
function canvasMetadata(board,blocks){
  const out={},ids=new Set(blocks.map(block=>block.id)),objects=new Set(ids);
  if(board.manualEdges!==undefined){
    if(!Array.isArray(board.manualEdges)||board.manualEdges.length>2000)fail('board_edges_invalid');
    out.manualEdges=board.manualEdges.map(edge=>{
      if(!validObject(edge)||Object.keys(edge).some(key=>!['id','from','to','label','direction'].includes(key))||typeof edge.id!=='string'||!idPattern.test(edge.id)||objects.has(edge.id)||!ids.has(edge.from)||!ids.has(edge.to)||edge.from===edge.to||typeof edge.label!=='string'||edge.label.length>500||/[\u0000-\u001f]/.test(edge.label)||!['forward','both','none'].includes(edge.direction))fail('board_edges_invalid');
      objects.add(edge.id);return {id:edge.id,from:edge.from,to:edge.to,label:edge.label,direction:edge.direction};
    });
  }
  if(board.groups!==undefined){
    if(!Array.isArray(board.groups)||board.groups.length>500)fail('board_groups_invalid');
    out.groups=board.groups.map(group=>{
      if(!validObject(group)||Object.keys(group).some(key=>!['id','title','members'].includes(key))||typeof group.id!=='string'||!idPattern.test(group.id)||objects.has(group.id)||!singleLine(group.title,160)||!Array.isArray(group.members)||!group.members.length||group.members.length>500||new Set(group.members).size!==group.members.length||group.members.some(member=>!ids.has(member)))fail('board_groups_invalid');
      objects.add(group.id);return {id:group.id,title:group.title,members:[...group.members]};
    });
  }
  if(board.historyRefs!==undefined){if(!Array.isArray(board.historyRefs)||board.historyRefs.length>2000||!board.historyRefs.every(hash))fail('board_history_invalid');out.historyRefs=[...board.historyRefs];}
  return out;
}
/**
 * A block without x/y flows in its section; x/y mean the student pinned it
 * (and every block of a board written before sections existed is pinned where
 * it was). Answers live in the marker, never in the teacher's body.
 */
export function parseBoard(content,sessionId) {
  if(content===null)return {sessionId,sections:[],blocks:[],sourceNotes:{}};
  const {frontmatter,body}=parseFrontmatter(content);
  if(frontmatter.type!=='lesson-board'||frontmatter.session!==sessionId)fail('board_binding_invalid');
  if(frontmatter.formatVersion!==undefined&&![1,2].includes(frontmatter.formatVersion))fail('board_version_unsupported');
  if(frontmatter.formatVersion!==2&&['manualEdges','groups','historyRefs'].some(key=>frontmatter[key]!==undefined))fail('board_version_invalid');
  const sections=validateSections(frontmatter.sections),known=new Set(sections.map(section=>section.id));
  const blocks=[],seen=new Set(),matches=[...body.matchAll(marker)];
  if(body.slice(0,matches[0]?.index??body.length).trim())fail('board_format_invalid');
  for(let i=0;i<matches.length;i++) {
    const match=matches[i];let meta;
    try{meta=JSON.parse(match[1]);}catch{fail('board_format_invalid');}
    if(!validObject(meta)||Object.keys(meta).some(key=>!META_KEYS.includes(key))||!idPattern.test(meta.id)||seen.has(meta.id)||!BOARD_KINDS.includes(meta.kind))fail('board_format_invalid');
    if(frontmatter.formatVersion!==2&&CONTENT_KEYS.some(key=>meta[key]!==undefined))fail('board_version_invalid');
    if(meta.section!==undefined&&!known.has(meta.section))fail('board_format_invalid');
    if(meta.size!==undefined&&!BOARD_SIZES.includes(meta.size))fail('board_format_invalid');
    if((meta.x===undefined)!==(meta.y===undefined)||(meta.x===undefined&&meta.section===undefined))fail('board_format_invalid');
    validateLayout(meta);seen.add(meta.id);
    const interactive=meta.interactive===undefined?undefined:validateInteractiveRef(meta.interactive);
    const place=validatePlace(meta.place),answers=validateStoredAnswers(meta.answers);
    const metadata=contentMetadata(meta);
    const text=body.slice(match.index+match[0].length,matches[i+1]?.index??body.length).trim();
    const heading=text.match(/^## ([^\n]+)\n?([\s\S]*)$/);
    if(!heading)fail('board_format_invalid');
    blocks.push({id:meta.id,kind:meta.kind,...(meta.section?{section:meta.section}:{}),size:meta.size??'narrow',...(place?{place}:{}),...(meta.x!==undefined?{x:meta.x,y:meta.y}:{}),...(meta.width!==undefined?{width:meta.width}:{}),...(meta.height!==undefined?{height:meta.height}:{}),title:heading[1].trim(),body:validateBoardBody(heading[2].trim(),meta.contentType),...(interactive?{interactive}: {}),...(answers?.length?{answers}:{}),...metadata});
  }
  const sourceNotes=frontmatter.sourceNotes??{};
  if(!validObject(sourceNotes))fail('board_format_invalid');
  for(const note of Object.values(sourceNotes)){if(!validObject(note))fail('board_format_invalid');validateLayout(note);if(note.body!==undefined)validateBoardBody(note.body);}
  const extra=canvasMetadata(frontmatter,blocks),hasV2=frontmatter.formatVersion===2||blocks.some(block=>CONTENT_KEYS.some(key=>block[key]!==undefined));
  return {sessionId,...(hasV2?{formatVersion:2}:{}),sections,blocks,sourceNotes,...extra};
}
export function renderBoard(board) {
  const version=boardVersion(board),canvas=canvasMetadata(board,board.blocks);
  const header=serializeFrontmatter({type:'lesson-board',title:'课堂板书',session:board.sessionId,...(version===undefined?{}:{formatVersion:version}),...(board.sections?.length?{sections:board.sections}:{}),sourceNotes:board.sourceNotes,...canvas});
  return header+'\n'+board.blocks.map(block=>{
    validateLayout(block);
    const {id,kind,section,size,place,x,y,width,height,title,body,interactive,answers}=block;
    return `<!-- notara-board ${JSON.stringify({id,kind,...(section?{section}:{}),...(size&&size!=='narrow'?{size}:{}),...(place?{place}:{}),...(Number.isFinite(x)&&Number.isFinite(y)?{x,y}:{}),...(width!==undefined?{width}:{}),...(height!==undefined?{height}:{}),...(interactive?{interactive}: {}),...(answers?.length?{answers}:{}),...contentMetadata(block)})} -->\n## ${title}\n\n${validateBoardBody(body,block.contentType)}\n`;
  }).join('\n');
}
/**
 * The teacher's write: the same title replaces that block's body (its answers,
 * pin and identity stay), a new title adds a block. `section` names the board
 * section by title — a new title opens a new section; omitted, a new block
 * joins the section written last. `placement` only relates blocks of the same
 * section. Every component in the body must parse, with a located error.
 */
export function upsertBoard(board,args,id,newSectionId=()=>'s-'+Math.random().toString(16).slice(2,10).padEnd(8,'0')) {
  if(!validObject(args)||Object.keys(args).some(key=>!['title','body','kind','section','size','placement'].includes(key)))fail('board_content_invalid');
  if(!singleLine(args.title,160))fail('board_content_invalid');
  validateBoardBody(args.body);
  if(args.kind!==undefined&&!BOARD_KINDS.includes(args.kind))fail('board_content_invalid');
  if(args.size!==undefined&&!BOARD_SIZES.includes(args.size))fail('board_content_invalid');
  if(args.section!==undefined&&!singleLine(args.section,80))fail('board_section_invalid');
  validateBoardComponents(args.body);
  board.sections??=[];
  const title=args.title.trim(),matches=board.blocks.filter(block=>block.title===title);
  if(matches.length>1)fail('board_title_ambiguous');
  const existing=matches[0];
  const sectionFor=name=>{const wanted=name.trim();let section=board.sections.find(item=>item.title===wanted);if(!section){section={id:newSectionId(),title:wanted};board.sections.push(section);}return section.id;};
  let section=args.section!==undefined?sectionFor(args.section):existing?.section;
  if(!section&&!existing){const last=[...board.blocks].reverse().find(block=>block.section);section=last?.section??sectionFor('板书');}
  let place;
  if(args.placement){
    const p=args.placement;
    if(!validObject(p)||Object.keys(p).some(key=>!['relativeTo','position'].includes(key))||!['beside','below'].includes(p.position))fail('board_layout_invalid');
    const anchor=board.blocks.find(block=>block.title===p.relativeTo);
    if(!anchor||anchor===existing)fail('board_anchor_missing');
    if(anchor.section!==section)fail('board_anchor_section');
    place={relativeTo:anchor.id,position:p.position};
  }
  if(existing){
    existing.body=args.body;existing.kind=args.kind??existing.kind;existing.size=args.size??existing.size??'narrow';
    if(place)existing.place=place;
    // Moving a block to another section returns it to that section's flow.
    if(section&&section!==existing.section){existing.section=section;delete existing.x;delete existing.y;if(!place)delete existing.place;}
    return existing;
  }
  const block={id,section,kind:args.kind??'note',size:args.size??'narrow',...(place?{place}:{}),title,body:args.body};
  board.blocks.push(block);return block;
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
      source={path,title:file?.title??ref.label??path.split('/').pop(),body:note.body??'本课引用的资料',usedBy:[],x:note.x??60+(index%3)*400,y:note.y??60+Math.floor(index/3)*300,width:note.width??340,...(Number.isFinite(note.height)?{height:note.height}:{}),missing:!file};sources.set(path,source);}
    if(!source.usedBy.includes(block.id))source.usedBy.push(block.id);
  }
  const edges=[];
  for(const source of sources.values())if(!Object.hasOwn(board.sourceNotes,source.path)||board.sourceNotes[source.path].body===undefined)source.body='用于：'+source.usedBy.map(id=>board.blocks.find(b=>b.id===id)?.title).filter(Boolean).join('、');
  for(const source of sources.values())for(const ref of boardReferences(known.get(source.path)?.content??'')) {
    const to=resolve(ref.path);if(to!==source.path&&sources.has(to)&&!edges.some(edge=>edge.from===source.path&&edge.to===to))edges.push({from:source.path,to,label:'引用'});
  }
  const version=boardVersion(board);
  return {revision,sections:board.sections??[],blocks:board.blocks,sources:[...sources.values()],edges,...(version===undefined?{}:{formatVersion:version}),...canvasMetadata(board,board.blocks)};
}

const SIZE_NAMES={wide:'宽',full:'整行'};
const clock=at=>{const date=new Date(at);return Number.isNaN(date.getTime())?'':date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});};
export const BOARD_OVERVIEW_LIMIT=3000;
/**
 * The teacher's per-turn view of the board: sections, then each block's title,
 * kind and size, then every question on it with whether and how the student
 * answered. The full answers already arrived as the student's messages.
 */
export function boardOverview(board) {
  if(!board.blocks.length)return '当前白板还是空的。';
  const details=board.blocks.map((block,index)=>{
    const extra=[block.kind,SIZE_NAMES[block.size]].filter(Boolean).join('，');
    const parts=boardComponents(block.body).map(component=>{
      const name=`${component.type}#${component.index+1}`;
      if(component.error||!component.answerable)return {text:name,answered:false,at:0};
      const {current,stale}=answersFor(component,block.answers);
      const latest=current.at(-1);
      const state=latest?`已作答 ${current.length} 次，最近 ${clock(latest.at)}：${boardAnswerSummary(component,latest.v)}`:'未作答';
      return {text:`${name}（${BOARD_COMPONENTS[component.type].title}）${state}${stale.length?`；另有 ${stale.length} 次题目修改前的作答`:''}`,answered:!!latest,at:latest?Date.parse(latest.at):0};
    });
    return {block,index,parts,extra,title:`${block.title}（${extra}）`};
  });
  const line=detail=>`  - ${detail.title}${detail.parts.length?'：'+detail.parts.map(part=>part.text).join('；'):''}`;
  const known=new Set(board.sections.map(section=>section.id)),rows=[];
  const legacy=details.filter(detail=>!known.has(detail.block.section));
  if(legacy.length)rows.push('- 旧板书（未分板块）',...legacy.map(line));
  for(const section of board.sections){const blocks=details.filter(detail=>detail.block.section===section.id);if(blocks.length)rows.push(`- 板块「${section.title}」`,...blocks.map(line));}
  const full=rows.join('\n');
  if(Array.from(full).length<=BOARD_OVERVIEW_LIMIT)return full;

  // Bound only the new runtime snapshot. Do not rewrite old messages or the board.
  // Each question is a separate candidate so a large old block's latest answer
  // cannot disappear merely because its complete line exceeds the budget.
  const sections=new Map(board.sections.map(section=>[section.id,section.title]));
  const candidates=details.flatMap(detail=>{
    // Read-side legacy/manual titles can exceed the Host's write-side limit.
    const chars=Array.from(detail.block.title);
    const label=chars.length>160?chars.slice(0,160).join('')+'…（标题截短，需读取原文定位）':detail.block.title;
    const title=`- ${sections.has(detail.block.section)?`板块「${sections.get(detail.block.section)}」`:'旧板书'} / ${label}（${detail.extra}）`;
    return detail.parts.length?detail.parts.map((part,index)=>({...part,text:title+'：'+part.text,block:detail.index,component:index}))
      :[{text:title,answered:false,at:0,block:detail.index,component:null}];
  });
  candidates.sort((a,b)=>Number(b.answered)-Number(a.answered)||b.at-a.at||b.block-a.block||(a.component??0)-(b.component??0));
  const totalComponents=details.reduce((count,detail)=>count+detail.parts.length,0);
  const footer=(blocks,components)=>`白板概览已省略 ${blocks} 个块、${components} 个组件；优先列最近有效作答，再列较后的板书。完整内容仍在白板文件，需要时读取。`;
  const budget=BOARD_OVERVIEW_LIMIT-Array.from(footer(board.blocks.length,totalComponents)).length-1;
  const selected=[],blocks=new Set();let used=0,components=0;
  for(const candidate of candidates){
    const cost=Array.from(candidate.text).length+(selected.length?1:0);
    if(used+cost>budget)continue;
    selected.push(candidate.text);used+=cost;blocks.add(candidate.block);
    if(candidate.component!==null)components++;
  }
  return [...selected,footer(board.blocks.length-blocks.size,totalComponents-components)].join('\n');
}
