import { renderMath } from './math-latex.js';
import { mathSceneSummary } from './interactive-data.js';
import { BOARD_COMPONENTS, answersFor, readComponent, splitBoardBody } from './board-components.js';
import { readingOrder } from './board-layout.js';
import { FLOW_CSS, layoutFlow, renderFlowSvg } from './board-flow.js';
import { validateBoardScene, validateBoardUrl } from './board-scene.js';
import { validateBoardSourceRef } from './board-mindmap.js';
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const HIGHLIGHTS=['blue','green','orange','pink'];
const safePath=path=>path&&!/^(?:[a-z]+:|\/)/i.test(path)&&!path.split('/').some(p=>p==='..'||p.startsWith('.'));
/** Hold punctuation to the formula before it, and only to its last piece.
 * Each KaTeX piece (.base) is an atomic inline, and whether a line may break
 * after one follows its parent's white-space, not a joiner character. So the
 * last piece moves into its own nowrap .katex beside the punctuation, and the
 * rest of the formula can still break between its terms. */
function keepWithPunctuation(math,punct){
  const open='<span class="katex-html" aria-hidden="true">',close='</span></span>',piece='<span class="base">';
  const first=math.indexOf(piece),at=math.lastIndexOf(piece);
  // One piece has nowhere to break, and an unexpected shape is not cut: hold it whole.
  if(!math.startsWith('<span class="katex">')||!math.endsWith(close)||math.indexOf(open)<0||first<math.indexOf(open)||at===first)return `<span class="nb-keep">${math}${punct}</span>`;
  return `${math.slice(0,at)}${close}<span class="nb-keep"><span class="katex">${open}${math.slice(at,-close.length)}${close}${punct}</span>`;
}

/** Small safe Markdown surface; raw HTML is text except the explicit highlight syntax. */
export function boardImageTargets(source) {
  return [...new Set([...String(source).matchAll(/!\[\[([^\]|#]+)(?:[^\]]*)\]\]|!\[[^\]]*\]\(([^\s)]+)\)/g)].map(m=>m[1]??m[2]).filter(path=>safePath(path)&&/\.(?:png|jpe?g|gif|webp|svg)$/i.test(path)))];
}
export function stableBoardPreview(body='') {
  let value=body;const mark=value.lastIndexOf('<mark');if(mark>value.lastIndexOf('</mark>'))value=value.slice(0,mark);
  const wiki=value.lastIndexOf('[[');if(wiki>value.lastIndexOf(']]'))value=value.slice(0,wiki);
  const display=[...value.matchAll(/\$\$/g)];if(display.length%2)value=value.slice(0,display.at(-1).index);
  const inline=[...value.replace(/\$\$[^]*?\$\$/g,match=>' '.repeat(match.length)).matchAll(/(?<!\\)\$/g)];if(inline.length%2)value=value.slice(0,inline.at(-1).index);
  return value;
}
/** Source ranges that must stay intact when selecting text or splitting cells. */
function protectedBoardSourceRanges(source) {
  const pattern = /(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[^\n]*(?=\n|$)|$)|`+[^`\n]*`+|!?\[\[[^\]\n]+\]\]|!?\[[^\]\n]*\]\([^\n]*?\)|(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|(?<!\\)\$[^$\n]+(?<!\\)\$|<[^>\n]*>/g;
  return [...String(source).matchAll(pattern)].map(match => ({ start: match.index, end: match.index + match[0].length }));
}
const overlapsRange = (start, end, ranges) => ranges.some(range => start < range.end && end > range.start);

/** Pipes inside formulas, code, references and annotations are not table separators. */
export function splitBoardTableCells(source) {
  const row = String(source).trim(), ranges = protectedBoardSourceRanges(row);
  for (const match of row.matchAll(/<mark data-color="(?:blue|green|orange|pink)">[\s\S]*?<\/mark>/g)) ranges.push({ start: match.index, end: match.index + match[0].length });
  ranges.sort((left, right) => left.start - right.start || right.end - left.end);
  const cells = []; let cell = '', index = 0, rangeIndex = 0;
  while (index < row.length) {
    while (rangeIndex < ranges.length && ranges[rangeIndex].end <= index) rangeIndex++;
    const range = ranges[rangeIndex];
    if (range && range.start <= index) { cell += row.slice(index, range.end); index = range.end; continue; }
    if (row[index] === '\\' && row[index + 1] === '|') { cell += '|'; index += 2; continue; }
    if (row[index] === '\\' && row[index + 1] === '\\') { cell += '\\\\'; index += 2; continue; }
    if (row[index] === '|') { cells.push(cell.trim()); cell = ''; }
    else cell += row[index];
    index++;
  }
  cells.push(cell.trim());
  if (cells.length > 1 && cells[0] === '') cells.shift();
  if (cells.length > 1 && cells.at(-1) === '') cells.pop();
  return cells;
}

/** Reject the entire DOM Range if any formula, link or code is part of it. */
export function boardSelectionText(root, selection) {
  if (!root || !selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  for (const node of root.querySelectorAll('.katex,code,pre,a,[data-source],.nb-source-link,img,svg,input,textarea')) {
    if (range.intersectsNode(node)) return null;
  }
  return selection.toString();
}

export function renderBoardMarkdown(source,{exporting=false,assetUrls={}}={}) {
  function inline(text){
    const pattern=/<mark data-color="(blue|green|orange|pink)">([^]*?)<\/mark>|!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|`([^`\n]+)`|\$\$([^]*?)\$\$|\$([^$\n]+)\$/g;
    let out='',end=0;for(const m of text.matchAll(pattern)){out+=escapeHtml(text.slice(end,m.index));end=m.index+m[0].length;
      if(m[1])out+=`<mark data-color="${m[1]}">${inline(m[2])}</mark>`;
      else if(m[3]||m[5]){const path=m[3]??m[5],label=m[4]??m[6]??path.split('/').pop().replace(/\.md$/,'');const asset=assetUrls[path];out+=m[3]&&/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,/.test(asset??'')?`<img class="nb-image" src="${escapeHtml(asset)}" alt="${escapeHtml(label)}">`:!exporting&&safePath(path)?`<button class="nb-source-link" data-source="${escapeHtml(path)}">${escapeHtml(label)}</button>`:`<span>${escapeHtml(label)}</span>`;}
      else if(m[7])out+=/^https?:\/\//i.test(m[8])?`<a href="${escapeHtml(m[8])}" target="_blank" rel="noopener noreferrer">${escapeHtml(m[7])}</a>`:(!exporting&&safePath(m[8])?`<button class="nb-source-link" data-source="${escapeHtml(m[8])}">${escapeHtml(m[7])}</button>`:escapeHtml(m[7]));
      // Bold holds inline syntax too (formulas, code, highlights), like a highlight does.
      else if(m[9])out+=`<strong>${inline(m[9])}</strong>`;
      else if(m[10])out+=`<code>${escapeHtml(m[10])}</code>`;
      else{
        const math=renderMath(m[11]??m[12],!!m[11])??escapeHtml(m[0]);
        // Punctuation right after an inline formula stays on the formula's line.
        const punct=m[12]!==undefined&&text.slice(end).match(/^[，。、；：！？）》」』】”’…]+/)?.[0];
        if(punct){out+=keepWithPunctuation(math,escapeHtml(punct));end+=punct.length;}else out+=math;
      }
    }return out+escapeHtml(text.slice(end));
  }
  let inCode=false,code=[],out=[],list=false,inMath=false,math=[];
  const lines=String(source??'').replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g,'![[$2|$1]]').split('\n');
  for(let index=0;index<lines.length;index++){
    const line=lines[index];
    if(line.trim()==='$$'){if(inMath){out.push(renderMath(math.join('\n'),true)??escapeHtml(math.join('\n')));math=[];}inMath=!inMath;continue;}if(inMath){math.push(line);continue;}
    if(/^\s*```/.test(line)){if(inCode){out.push('<pre>'+escapeHtml(code.join('\n'))+'</pre>');code=[];}inCode=!inCode;continue;}
    if(inCode){code.push(line);continue;}
    if(line.includes('|')&&/^\s*\|?\s*:?-{3,}/.test(lines[index+1]??'')){
      if(list){out.push('</ul>');list=false;}
      const cells=value=>splitBoardTableCells(value).map(inline);
      out.push('<table><thead><tr>'+cells(line).map(cell=>'<th>'+cell+'</th>').join('')+'</tr></thead><tbody>');index++;
      while(lines[index+1]?.includes('|')){index++;out.push('<tr>'+cells(lines[index]).map(cell=>'<td>'+cell+'</td>').join('')+'</tr>');}out.push('</tbody></table>');continue;
    }
    if(/^\s*[-*] /.test(line)){if(!list){out.push('<ul>');list=true;}out.push('<li>'+inline(line.replace(/^\s*[-*] /,''))+'</li>');continue;}
    if(list){out.push('</ul>');list=false;}
    const heading=line.match(/^(#{1,6}) (.+)$/);if(heading)out.push('<h3>'+inline(heading[2])+'</h3>');
    else if(line.trim())out.push('<p>'+inline(line)+'</p>');
  }
  if(list)out.push('</ul>');if(code.length)out.push('<pre>'+escapeHtml(code.join('\n'))+'</pre>');if(math.length)out.push('<pre>'+escapeHtml(math.join('\n'))+'</pre>');return out.join('');
}
/** One line of board Markdown as inline HTML (stems, options, items). */
export function renderBoardInline(text) {
  const html=renderBoardMarkdown(String(text??''));
  const single=html.match(/^<p>([\s\S]*)<\/p>$/);
  return single&&!single[1].includes('<p>')?single[1]:html;
}
export function highlightBoardText(body,selected,color) {
  if(color!==null&&!HIGHLIGHTS.includes(color))throw new Error('请选择一种高亮颜色。');
  if(!selected)return body;
  const message='请只选择一处完整的普通文字，再添加高亮。';
  if(/[<>]/.test(selected))throw new Error(message);
  const protectedRanges=protectedBoardSourceRanges(body),marks=[],candidates=[];
  for(const match of body.matchAll(/<mark data-color="(?:blue|green|orange|pink)">([\s\S]*?)<\/mark>/g)) {
    const start=match.index,end=start+match[0].length,innerStart=start+match[0].indexOf('>')+1;
    marks.push({start,end});
    if(match[1]===selected&&!overlapsRange(innerStart,innerStart+selected.length,protectedRanges))candidates.push({start,end,marked:true});
  }
  for(let start=body.indexOf(selected);start>=0;start=body.indexOf(selected,start+1)) {
    const end=start+selected.length;
    if(!overlapsRange(start,end,protectedRanges)&&!overlapsRange(start,end,marks))candidates.push({start,end,marked:false});
  }
  if(candidates.length!==1)throw new Error(message);
  const {start,end}=candidates[0],replacement=color?`<mark data-color="${color}">${selected}</mark>`:selected;
  return body.slice(0,start)+replacement+body.slice(end);
}
export function renderInteractiveSnapshot(scene) {
  if(!scene||scene.kind!=='math'||scene.preset!=='parabola')return '';
  const equation=escapeHtml(mathSceneSummary(scene)),observation=scene.observation?`<p>${escapeHtml(scene.observation)}</p>`:'';
  return `<figure class="nb-interactive-snapshot"><figcaption>互动数学图 · ${equation}</figcaption><div class="nb-interactive-snapshot-chart" aria-label="${equation}"><span class="nb-interactive-snapshot-curve"></span></div>${observation}</figure>`;
}
const svgDataURL=svg=>{
  const bytes=new TextEncoder().encode(svg);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
  return 'data:image/svg+xml;base64,'+btoa(binary);
};
/** Static SVG from the validated drawing vocabulary; no raw SVG or HTML is accepted. */
export function renderBoardScene(input){
  const scene=validateBoardScene(input),elements=scene.elements.filter(e=>!e.isDeleted),byId=new Map(elements.map(e=>[e.id,e]));
  const bounds=elements.flatMap(e=>{
    const points=e.points?.map(p=>[e.x+p[0],e.y+p[1]])??[[e.x,e.y],[e.x+e.width,e.y],[e.x,e.y+e.height],[e.x+e.width,e.y+e.height]];
    const angle=e.angle??0,cx=e.x+e.width/2,cy=e.y+e.height/2;
    return points.map(([x,y])=>[cx+(x-cx)*Math.cos(angle)-(y-cy)*Math.sin(angle),cy+(x-cx)*Math.sin(angle)+(y-cy)*Math.cos(angle)]);
  });
  const extent=bounds.reduce((b,[x,y])=>({minX:Math.min(b.minX,x),minY:Math.min(b.minY,y),maxX:Math.max(b.maxX,x),maxY:Math.max(b.maxY,y)}),{minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity});
  const x=(bounds.length?extent.minX:0)-24,y=(bounds.length?extent.minY:0)-24,w=Math.max(100,(bounds.length?extent.maxX:100)-x+24),h=Math.max(80,(bounds.length?extent.maxY:80)-y+24);
  const center=id=>{const e=byId.get(id);return [e.x+e.width/2,e.y+e.height/2];};
  const nodeElement=id=>scene.mindmap.nodes.find(n=>n.elementId===id)?.elementId;
  const relation=(from,to,label='')=>{const a=center(from),b=center(to),mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#94a3b8" stroke-width="1.5"/>${label?`<text x="${mx}" y="${my-5}" font-size="13" fill="#475569">${escapeHtml(label)}</text>`:''}`;};
  const semantic=scene.mindmap?[...scene.mindmap.nodes.filter(n=>n.parentId!==null).map(n=>relation(nodeElement(n.parentId),n.elementId)),...scene.mindmap.links.map(link=>relation(nodeElement(link.from),nodeElement(link.to),link.label))].join(''):'';
  const annotations=(scene.mindmap?.notes??[]).map(note=>{const e=byId.get(note.elementId);return `<text x="${e.x}" y="${e.y+e.height+16}" font-size="12" fill="#475569">${escapeHtml(note.text)}</text>`;}).join('');
  function head(points,kind,atStart,color){
    if(!kind||points.length<2)return '';
    const a=atStart?points[1]:points.at(-2),b=atStart?points[0]:points.at(-1),angle=Math.atan2(b[1]-a[1],b[0]-a[0]),ux=Math.cos(angle),uy=Math.sin(angle),p=[b[0]-12*ux+5*uy,b[1]-12*uy-5*ux],q=[b[0]-12*ux-5*uy,b[1]-12*uy+5*ux];
    if(kind==='bar')return `<line x1="${b[0]+6*uy}" y1="${b[1]-6*ux}" x2="${b[0]-6*uy}" y2="${b[1]+6*ux}"/>`;
    if(kind.startsWith('crowfoot')){
      const tail=[b[0]-12*ux,b[1]-12*uy],bar=(x,y)=>`<line x1="${x+6*uy}" y1="${y-6*ux}" x2="${x-6*uy}" y2="${y+6*ux}"/>`;
      if(kind==='crowfoot_one')return bar(...b);
      return [-6,0,6].map(offset=>`<line x1="${tail[0]}" y1="${tail[1]}" x2="${b[0]+offset*uy}" y2="${b[1]-offset*ux}"/>`).join('')+(kind==='crowfoot_one_or_many'?bar(...tail):'');
    }
    if(['dot','circle','circle_outline'].includes(kind))return `<circle cx="${b[0]}" cy="${b[1]}" r="5" fill="${kind.endsWith('_outline')?'none':escapeHtml(color)}"/>`;
    if(kind.startsWith('diamond')){const tail=[b[0]-20*ux,b[1]-20*uy];return `<polygon points="${[b,p,tail,q].map(point=>point.join(',')).join(' ')}" fill="${kind.endsWith('_outline')?'none':escapeHtml(color)}"/>`;}
    return `<${kind.startsWith('triangle')?'polygon':'polyline'} points="${[p,b,q].map(point=>point.join(',')).join(' ')}" fill="${kind==='triangle'?escapeHtml(color):'none'}"/>`;
  }
  const shapes=elements.map(e=>{
    const stroke=e.strokeColor??'#1e1e1e',fill=e.backgroundColor??'transparent',sw=e.strokeWidth??1;
    const style=`stroke="${escapeHtml(stroke)}" fill="${escapeHtml(fill)}" stroke-width="${sw}" opacity="${(e.opacity??100)/100}"${e.strokeStyle==='dashed'?' stroke-dasharray="8 5"':e.strokeStyle==='dotted'?' stroke-dasharray="2 4"':''}`;
    let body='';
    if(e.type==='rectangle')body=`<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="${e.roundness?Math.min(16,e.width/4,e.height/4):0}"/>`;
    else if(e.type==='diamond')body=`<polygon points="${[[e.x+e.width/2,e.y],[e.x+e.width,e.y+e.height/2],[e.x+e.width/2,e.y+e.height],[e.x,e.y+e.height/2]].map(point=>point.join(',')).join(' ')}"/>`;
    else if(e.type==='ellipse')body=`<ellipse cx="${e.x+e.width/2}" cy="${e.y+e.height/2}" rx="${e.width/2}" ry="${e.height/2}"/>`;
    else if(e.type==='text'){
      const size=e.fontSize??20,lines=e.text.split('\n'),tx=e.x+(e.textAlign==='center'?e.width/2:e.textAlign==='right'?e.width:0),anchor=e.textAlign==='center'?'middle':e.textAlign==='right'?'end':'start';
      const family={1:'Virgil',2:'Helvetica',3:'Cascadia',5:'Excalifont',6:'Nunito',7:'Lilita One',8:'Comic Shanns',9:'Liberation Sans'}[e.fontFamily]??'sans-serif';
      body=`<text x="${tx}" y="${e.y+size}" fill="${escapeHtml(stroke)}" stroke="none" font-family="${family}, sans-serif" font-size="${size}" text-anchor="${anchor}" xml:space="preserve">${lines.map((line,index)=>`<tspan x="${tx}" dy="${index?size*(e.lineHeight??1.25):0}">${escapeHtml(line)}</tspan>`).join('')}</text>`;
    }else if(['line','arrow','freedraw'].includes(e.type)){
      const points=e.points.map(point=>[e.x+point[0],e.y+point[1]]);
      body=`<polyline points="${points.map(point=>point.join(',')).join(' ')}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>${e.type==='arrow'?head(points,e.startArrowhead,true,stroke)+head(points,e.endArrowhead===undefined?'arrow':e.endArrowhead,false,stroke):''}`;
    }else if(e.type==='image'){
      const dataURL=scene.files[e.fileId].dataURL,flip=e.scale??[1,1];
      const image=e.crop?`<svg x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" viewBox="${e.crop.x} ${e.crop.y} ${e.crop.width} ${e.crop.height}" preserveAspectRatio="none"><image x="0" y="0" width="${e.crop.naturalWidth}" height="${e.crop.naturalHeight}" href="${escapeHtml(dataURL)}"/></svg>`:`<image x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" href="${escapeHtml(dataURL)}" preserveAspectRatio="none"/>`;
      body=`<g transform="translate(${e.x+e.width/2} ${e.y+e.height/2}) scale(${flip.join(' ')}) translate(${-e.x-e.width/2} ${-e.y-e.height/2})">${image}</g>`;
    }
    return `<g ${style} transform="rotate(${(e.angle??0)*180/Math.PI} ${e.x+e.width/2} ${e.y+e.height/2})">${body}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="白板预览"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${escapeHtml(scene.appState.viewBackgroundColor??'#fff')}"/>${semantic}${shapes}${annotations}</svg>`;
}
const markdownText=value=>String(value??'').replace(/[\\`*_[\]<>#|]/g,'\\$&').replace(/[\r\n]/g,' ');
function cardText(block){
  if(block.contentType==='link'&&block.url)return {label:block.title,url:validateBoardUrl(block.url)};
  if(block.contentType==='source'&&block.sourceRef){
    validateBoardSourceRef(block.sourceRef);const raw=block.sourceRef.slice(6).replace(/-/g,'+').replace(/_/g,'/'),ref=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw),char=>char.charCodeAt(0))));
    return {label:'资料引用：'+ref.path};
  }
  return null;
}
function contentExport(block,html=false,options={}){
  const scene=block.content??options.blockContents?.[block.id]??options.contents?.[block.id];
  if(['drawing','mindmap'].includes(block.contentType)){
    if(!scene)throw new Error('board_scene_content_missing');
    const svg=renderBoardScene(scene);return html?`<figure class="nb-export-figure">${svg}</figure>`:`![白板绘图](${svgDataURL(svg)})`;
  }
  const card=cardText(block);if(!card)return '';
  return html?(card.url?`<a href="${escapeHtml(card.url)}" rel="noopener noreferrer">${escapeHtml(card.label)}</a>`:`<p>${escapeHtml(card.label)}</p>`):(card.url?`[${markdownText(card.label)}](<${card.url}>)`:markdownText(card.label));
}
/** Keep relationship exports coherent with the subset of cards selected. */
function canvasExport(board,blocks,html=false,options={}){
  const visible=new Map(blocks.filter(block=>block.id).map(block=>[block.id,block])),edges=(board.manualEdges??[]).filter(edge=>visible.has(edge.from)&&visible.has(edge.to)),groups=(board.groups??[]).filter(group=>group.members.length&&group.members.every(id=>visible.has(id)));
  if(!edges.length&&!groups.length)return '';
  const edgeText=edge=>`${visible.get(edge.from).title} ${edge.direction==='both'?'↔':edge.direction==='forward'?'→':'—'} ${visible.get(edge.to).title}${edge.label?'：'+edge.label:''}`;
  const lines=[...groups.map(group=>`分组「${group.title}」：${group.members.map(id=>visible.get(id).title).join('、')}`),...edges.map(edgeText)];
  const positions=new Map(blocks.map((block,index)=>[block.id,{x:Number.isFinite(block.x)?block.x:(index%3)*280,y:Number.isFinite(block.y)?block.y:Math.floor(index/3)*200,width:240,height:160}]));
  const cards=blocks.filter(block=>block.id).map(block=>{const p=positions.get(block.id),scene=block.content??options.blockContents?.[block.id]??options.contents?.[block.id];return `<rect x="${p.x}" y="${p.y}" width="240" height="160" rx="8" fill="#fff" stroke="#94a3b8"/><text x="${p.x+12}" y="${p.y+24}" font-size="16">${escapeHtml(block.title)}</text>${['drawing','mindmap'].includes(block.contentType)&&scene?renderBoardScene(scene).replace('<svg ','<svg x="'+(p.x+12)+'" y="'+(p.y+36)+'" width="216" height="112" '):`<text x="${p.x+12}" y="${p.y+52}" font-size="12">${escapeHtml(cardText(block)?.label??block.contentType??'text')}</text>`}`;}).join('');
  const groupShapes=groups.map(group=>{const ps=group.members.map(id=>positions.get(id)),x=Math.min(...ps.map(p=>p.x))-14,y=Math.min(...ps.map(p=>p.y))-34,w=Math.max(...ps.map(p=>p.x+p.width))-x+14,h=Math.max(...ps.map(p=>p.y+p.height))-y+14;return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f1f5f9" stroke="#cbd5e1"/><text x="${x+8}" y="${y+20}" font-size="14">${escapeHtml(group.title)}</text>`;}).join('');
  const edgeShapes=edges.map(edge=>{const a=positions.get(edge.from),b=positions.get(edge.to),dx=b.x-a.x,dy=b.y-a.y,scale=Math.min(dx?120/Math.abs(dx):Infinity,dy?80/Math.abs(dy):Infinity),factor=Number.isFinite(scale)?Math.min(.45,scale):0,x1=a.x+120+factor*dx,y1=a.y+80+factor*dy,x2=b.x+120-factor*dx,y2=b.y+80-factor*dy,angle=Math.atan2(dy,dx),arrow=(x,y,rotation)=>{const ux=Math.cos(rotation),uy=Math.sin(rotation);return `<polyline points="${x-10*ux+4*uy},${y-10*uy-4*ux} ${x},${y} ${x-10*ux-4*uy},${y-10*uy+4*ux}" fill="none" stroke="#64748b"/>`;};return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#64748b"/>${edge.direction==='both'?arrow(x1,y1,angle+Math.PI):''}${edge.direction!=='none'?arrow(x2,y2,angle):''}${edge.label?`<text x="${(x1+x2)/2}" y="${(y1+y2)/2-6}" font-size="12" fill="#475569">${escapeHtml(edge.label)}</text>`:''}`;}).join('');
  const ps=[...positions.values()],minX=Math.min(...ps.map(p=>p.x))-30,minY=Math.min(...ps.map(p=>p.y))-50,w=Math.max(...ps.map(p=>p.x+240))-minX+30,h=Math.max(...ps.map(p=>p.y+160))-minY+30;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" role="img" aria-label="白板关系">${groupShapes}${cards}${edgeShapes}</svg>`;
  return html?`<section><h2>白板关系</h2>${svg}<ul>${lines.map(line=>'<li>'+escapeHtml(line)+'</li>').join('')}</ul></section>`:'## 白板关系\n\n'+`![白板关系](${svgDataURL(svg)})\n\n`+lines.map(line=>'- '+markdownText(line)).join('\n');
}
const letter=index=>String.fromCharCode(65+index);
/** A component as readable Markdown for the exported notes; answers only when included. */
export function componentMarkdown(component,answers,withAnswers) {
  if(component.error)return '```'+component.type+'\n'+component.source+'\n```';
  const {spec,type}=component,lines=[];
  if(type==='choice')lines.push(spec.stem,'',...spec.options.map((option,index)=>`- ${letter(index)}. ${option}`));
  else if(type==='blank')lines.push(...(spec.code?['```'+spec.code,...spec.lines.map(line=>line.replace(/\{\{[^{}\n]*\}\}/g,'____')),'```']:spec.lines.map(line=>line.replace(/\{\{([^{}\n]*)\}\}/g,(_,hint)=>hint.trim()?`____（${hint.trim()}）`:'____'))));
  else if(type==='frames')lines.push(...(spec.title?[`**${spec.title}**`,'']:[]),...spec.frames.flatMap((frame,index)=>[`**第${index+1}帧${frame.caption?` · ${frame.caption}`:''}**`,'',frame.body,'']));
  else if(type==='order')lines.push(spec.stem,'',...spec.items.map(item=>`- ${item}`),...(spec.groups?['',`分组：${spec.groups.join(' | ')}`]:[]));
  else lines.push('```'+type,component.source,'```');
  if(withAnswers&&component.answerable){const {current}=answersFor(component,answers);if(current.length)lines.push('',...current.map(entry=>`> 我的作答：${BOARD_COMPONENTS[type].text(spec,entry.v)}`));}
  return lines.join('\n');
}
/** A figure without a live snapshot is described in words, never left blank. */
function figureText(spec) {
  const parts=spec.objects.map(item=>item.kind==='function'?`函数 ${item.name}(x) = ${item.expr}`:item.kind==='curve'?`曲线 ${item.lhs} = ${item.rhs}`:item.kind==='parametric'?`参数曲线 x = ${item.x}, y = ${item.y}`:item.kind==='point'?`点 ${item.name}(${item.x}, ${item.y})`:item.kind==='text'?item.content:null).filter(Boolean);
  return '图：'+(parts.join('；')||'几何作图');
}
function componentHtml(block,component,withAnswers,options) {
  const answers=withAnswers&&component.answerable?answersFor(component,block.answers).current.map(entry=>`<blockquote>我的作答：${escapeHtml(BOARD_COMPONENTS[component.type].text(component.spec,entry.v))}</blockquote>`).join(''):'';
  if(!component.error&&component.type==='flow')return `<figure class="nb-export-figure">${renderFlowSvg(layoutFlow(component.spec),{id:`flow-${String(block.id).replace(/[^A-Za-z0-9-]/g,'-')}-${component.index}`})}</figure>${answers}`;
  if(!component.error&&component.type==='figure'){const svg=options.figureSvgs?.[`${block.id}:${component.index}`];const caption=[component.spec.ask?.prompt,svg?null:figureText(component.spec)].filter(Boolean).map(escapeHtml).join('<br>');return `<figure class="nb-export-figure">${svg??''}<figcaption>${caption}</figcaption></figure>${answers}`;}
  return renderBoardMarkdown(componentMarkdown(component,block.answers,withAnswers),{exporting:true,assetUrls:options.assetUrls??{}});
}
function exportHtmlBody(block,withAnswers,options) {
  const {segments}=splitBoardBody(block.body);
  return contentExport(block,true,options)+segments.map(segment=>segment.kind==='markdown'?renderBoardMarkdown(segment.text,{exporting:true,assetUrls:options.assetUrls??{}}):componentHtml(block,readComponent(segment),withAnswers,options)).join('');
}
function exportBody(block,withAnswers,options) {
  const {segments}=splitBoardBody(block.body);
  const body=segments.map(segment=>segment.kind==='markdown'?segment.text.trim():componentMarkdown(readComponent(segment),block.answers,withAnswers)).filter(Boolean).join('\n\n');
  const content=contentExport(block,false,options);
  return [content,body].filter(Boolean).join('\n\n')+(block.interactiveScene?`\n\n> 互动数学图：${mathSceneSummary(block.interactiveScene)}${block.interactiveScene.observation?`\n> 观察：${block.interactiveScene.observation}`:''}`:'');
}
/**
 * The notes to take away: sections in writing order, their blocks under them.
 * Kinds left unticked are physically absent; the student's answers come along
 * only with 个人尝试 ticked.
 */
export function exportBoard(board,options={}) {
  const blocks=board.blocks.filter(b=>!['hint','reference','attempt'].includes(b.kind)||options[b.kind]===true);
  const groups=readingOrder(board.sections??[],blocks),withAnswers=options.attempt===true;
  const relationMarkdown=canvasExport(board,blocks,false,options);
  const markdown='# 课堂笔记\n\n'+groups.map(group=>(group.title?`## ${group.title}\n\n`:'')+group.blocks.map(b=>`${group.title?'###':'##'} ${b.title}\n\n${exportBody(b,withAnswers,options)}`).join('\n\n')).join('\n\n')+(relationMarkdown?'\n\n'+relationMarkdown:'')+'\n';
  const section=(b,level)=>{const heading=level==='h3'?'h3':'h2';return `<section>${['note','question'].includes(b.kind)?`<${heading}>${renderBoardInline(b.title)}</${heading}>`:`<details><summary>${renderBoardInline(b.title)}</summary>`}${exportHtmlBody(b,withAnswers,options)}${b.interactiveScene?renderInteractiveSnapshot(b.interactiveScene):''}${['note','question'].includes(b.kind)?'':'</details>'}</section>`;};
  const relationHtml=canvasExport(board,blocks,true,options);
  const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>课堂笔记</title><style>'+'body{max-width:820px;margin:60px auto;padding:0 24px;color:#30343b;background:white;font:18px/1.85 "Kaiti SC",STKaiti,serif}h1,h2{line-height:1.4}section{margin:2.5em 0}mark{color:inherit;background:#dcebfa}mark[data-color=green]{background:#d9eee1}mark[data-color=orange]{background:#fae3c9}mark[data-color=pink]{background:#f6dce5}pre{white-space:pre-wrap}img{max-width:100%}a{color:#426f93}.nb-interactive-snapshot{margin:1.2em 0;padding:1em;border:1px solid #dce5ec;border-radius:12px;background:#f8fbfd}.nb-interactive-snapshot figcaption{font-size:.82em;color:#55718f}.nb-interactive-snapshot-chart{position:relative;height:120px;margin:.7em 0;background:linear-gradient(#dfe8f0 1px,transparent 1px),linear-gradient(90deg,#dfe8f0 1px,transparent 1px);background-size:24px 24px;overflow:hidden}.nb-interactive-snapshot-curve{position:absolute;left:18%;right:18%;top:20%;height:70%;border-top:3px solid #5d82ae;border-radius:50% 50% 0 0;transform:rotate(0deg);clip-path:polygon(0 70%,10% 45%,20% 25%,30% 10%,40% 2%,50% 0,60% 2%,70% 10%,80% 25%,90% 45%,100% 70%,100% 76%,90% 51%,80% 31%,70% 16%,60% 8%,50% 6%,40% 8%,30% 16%,20% 31%,10% 51%,0 76%)}'+'h3{line-height:1.4}blockquote{margin:.6em 0;padding-left:1em;border-left:3px solid #cfdbe5;color:#52606d}.nb-export-figure{margin:1em 0}.nb-export-figure svg{max-width:100%;height:auto}.nb-export-figure figcaption{font-size:.8em;color:#5d6b79}'+FLOW_CSS+(options.mathCss??'')+'</style><body><h1>课堂笔记</h1>'+groups.map(group=>(group.title?`<h2>${renderBoardInline(group.title)}</h2>`:'')+group.blocks.map(b=>section(b,group.title?'h3':'h2')).join('')).join('')+relationHtml+'</body></html>';
  return {markdown,html};
}
