import { renderMath } from './math-latex.js';
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const HIGHLIGHTS=['blue','green','orange','pink'];
const safePath=path=>path&&!/^(?:[a-z]+:|\/)/i.test(path)&&!path.split('/').some(p=>p==='..'||p.startsWith('.'));
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
export function renderBoardMarkdown(source,{exporting=false,assetUrls={}}={}) {
  function inline(text){
    const pattern=/<mark data-color="(blue|green|orange|pink)">([^]*?)<\/mark>|!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|`([^`\n]+)`|\$\$([^]*?)\$\$|\$([^$\n]+)\$/g;
    let out='',end=0;for(const m of text.matchAll(pattern)){out+=escapeHtml(text.slice(end,m.index));end=m.index+m[0].length;
      if(m[1])out+=`<mark data-color="${m[1]}">${inline(m[2])}</mark>`;
      else if(m[3]||m[5]){const path=m[3]??m[5],label=m[4]??m[6]??path.split('/').pop().replace(/\.md$/,'');const asset=assetUrls[path];out+=m[3]&&/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,/.test(asset??'')?`<img class="nb-image" src="${escapeHtml(asset)}" alt="${escapeHtml(label)}">`:!exporting&&safePath(path)?`<button class="nb-source-link" data-source="${escapeHtml(path)}">${escapeHtml(label)}</button>`:`<span>${escapeHtml(label)}</span>`;}
      else if(m[7])out+=/^https?:\/\//i.test(m[8])?`<a href="${escapeHtml(m[8])}" target="_blank" rel="noopener noreferrer">${escapeHtml(m[7])}</a>`:(!exporting&&safePath(m[8])?`<button class="nb-source-link" data-source="${escapeHtml(m[8])}">${escapeHtml(m[7])}</button>`:escapeHtml(m[7]));
      else if(m[9])out+=`<strong>${escapeHtml(m[9])}</strong>`;
      else if(m[10])out+=`<code>${escapeHtml(m[10])}</code>`;
      else out+=renderMath(m[11]??m[12],!!m[11])??escapeHtml(m[0]);
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
      const cells=value=>value.trim().replace(/^\||\|$/g,'').split('|').map(cell=>inline(cell.trim()));
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
export function highlightBoardText(body,selected,color) {
  if(color!==null&&!HIGHLIGHTS.includes(color))throw new Error('请选择一种高亮颜色。');
  if(!selected)return body;
  // Whole existing marks are edited in place. Other selections must identify a unique source range.
  const marked=new RegExp('<mark data-color="(?:blue|green|orange|pink)">'+selected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'</mark>','g');
  const matches=[...body.matchAll(marked)];
  const replacement=color?`<mark data-color="${color}">${selected}</mark>`:selected;
  if(matches.length===1)return body.slice(0,matches[0].index)+replacement+body.slice(matches[0].index+matches[0][0].length);
  const at=body.indexOf(selected);
  if(at<0||body.indexOf(selected,at+selected.length)!==-1||/[<>]/.test(selected))throw new Error('请只选择一处完整的普通文字，再添加高亮。');
  // Do not nest a new mark inside an existing annotation or break a Markdown link.
  const before=body.slice(0,at);if(before.lastIndexOf('<mark')>before.lastIndexOf('</mark>'))throw new Error('请选中这段高亮的完整文字后修改颜色。');
  return body.slice(0,at)+replacement+body.slice(at+selected.length);
}
export function exportBoard(board,options={}) {
  const blocks=board.blocks.filter(b=>!['hint','reference','attempt'].includes(b.kind)||options[b.kind]===true);
  const markdown='# 课堂笔记\n\n'+blocks.map(b=>`## ${b.title}\n\n${b.body}`).join('\n\n')+'\n';
  const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>课堂笔记</title><style>body{max-width:820px;margin:60px auto;padding:0 24px;color:#30343b;background:white;font:18px/1.85 "Kaiti SC",STKaiti,serif}h1,h2{line-height:1.4}section{margin:2.5em 0}mark{color:inherit;background:#dcebfa}mark[data-color=green]{background:#d9eee1}mark[data-color=orange]{background:#fae3c9}mark[data-color=pink]{background:#f6dce5}pre{white-space:pre-wrap}img{max-width:100%}a{color:#426f93}'+(options.mathCss??'')+'</style><body><h1>课堂笔记</h1>'+blocks.map(b=>`<section>${b.kind==='note'?`<h2>${escapeHtml(b.title)}</h2>`:`<details><summary>${escapeHtml(b.title)}</summary>`}${renderBoardMarkdown(b.body,{exporting:true,assetUrls:options.assetUrls??{}})}${b.kind==='note'?'':'</details>'}</section>`).join('')+'</body></html>';
  return {markdown,html};
}
