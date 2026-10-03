import { renderMath } from './math-latex.js';
import { mathSceneSummary } from './interactive-data.js';
import { BOARD_COMPONENTS, answersFor, readComponent, splitBoardBody } from './board-components.js';
import { readingOrder } from './board-layout.js';
import { FLOW_CSS, layoutFlow, renderFlowSvg } from './board-flow.js';
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
  return segments.map(segment=>segment.kind==='markdown'?renderBoardMarkdown(segment.text,{exporting:true,assetUrls:options.assetUrls??{}}):componentHtml(block,readComponent(segment),withAnswers,options)).join('');
}
function exportBody(block,withAnswers) {
  const {segments}=splitBoardBody(block.body);
  const body=segments.map(segment=>segment.kind==='markdown'?segment.text.trim():componentMarkdown(readComponent(segment),block.answers,withAnswers)).filter(Boolean).join('\n\n');
  return body+(block.interactiveScene?`\n\n> 互动数学图：${mathSceneSummary(block.interactiveScene)}${block.interactiveScene.observation?`\n> 观察：${block.interactiveScene.observation}`:''}`:'');
}
/**
 * The notes to take away: sections in writing order, their blocks under them.
 * Kinds left unticked are physically absent; the student's answers come along
 * only with 个人尝试 ticked.
 */
export function exportBoard(board,options={}) {
  const blocks=board.blocks.filter(b=>!['hint','reference','attempt'].includes(b.kind)||options[b.kind]===true);
  const groups=readingOrder(board.sections??[],blocks),withAnswers=options.attempt===true;
  const markdown='# 课堂笔记\n\n'+groups.map(group=>(group.title?`## ${group.title}\n\n`:'')+group.blocks.map(b=>`${group.title?'###':'##'} ${b.title}\n\n${exportBody(b,withAnswers)}`).join('\n\n')).join('\n\n')+'\n';
  const section=(b,level)=>{const heading=level==='h3'?'h3':'h2';return `<section>${['note','question'].includes(b.kind)?`<${heading}>${renderBoardInline(b.title)}</${heading}>`:`<details><summary>${renderBoardInline(b.title)}</summary>`}${exportHtmlBody(b,withAnswers,options)}${b.interactiveScene?renderInteractiveSnapshot(b.interactiveScene):''}${['note','question'].includes(b.kind)?'':'</details>'}</section>`;};
  const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>课堂笔记</title><style>'+'body{max-width:820px;margin:60px auto;padding:0 24px;color:#30343b;background:white;font:18px/1.85 "Kaiti SC",STKaiti,serif}h1,h2{line-height:1.4}section{margin:2.5em 0}mark{color:inherit;background:#dcebfa}mark[data-color=green]{background:#d9eee1}mark[data-color=orange]{background:#fae3c9}mark[data-color=pink]{background:#f6dce5}pre{white-space:pre-wrap}img{max-width:100%}a{color:#426f93}.nb-interactive-snapshot{margin:1.2em 0;padding:1em;border:1px solid #dce5ec;border-radius:12px;background:#f8fbfd}.nb-interactive-snapshot figcaption{font-size:.82em;color:#55718f}.nb-interactive-snapshot-chart{position:relative;height:120px;margin:.7em 0;background:linear-gradient(#dfe8f0 1px,transparent 1px),linear-gradient(90deg,#dfe8f0 1px,transparent 1px);background-size:24px 24px;overflow:hidden}.nb-interactive-snapshot-curve{position:absolute;left:18%;right:18%;top:20%;height:70%;border-top:3px solid #5d82ae;border-radius:50% 50% 0 0;transform:rotate(0deg);clip-path:polygon(0 70%,10% 45%,20% 25%,30% 10%,40% 2%,50% 0,60% 2%,70% 10%,80% 25%,90% 45%,100% 70%,100% 76%,90% 51%,80% 31%,70% 16%,60% 8%,50% 6%,40% 8%,30% 16%,20% 31%,10% 51%,0 76%)}'+'h3{line-height:1.4}blockquote{margin:.6em 0;padding-left:1em;border-left:3px solid #cfdbe5;color:#52606d}.nb-export-figure{margin:1em 0}.nb-export-figure svg{max-width:100%;height:auto}.nb-export-figure figcaption{font-size:.8em;color:#5d6b79}'+FLOW_CSS+(options.mathCss??'')+'</style><body><h1>课堂笔记</h1>'+groups.map(group=>(group.title?`<h2>${renderBoardInline(group.title)}</h2>`:'')+group.blocks.map(b=>section(b,group.title?'h3':'h2')).join('')).join('')+'</body></html>';
  return {markdown,html};
}
