/* Synthetic prototype only. Markdown is the sole writable board content.
   No model, microphone, Vault write, review outcome, or session fork is created. */
'use strict';
const WB = (() => {
  const states = new Map();
  const key = 'notara.prototype.whiteboard.v1.';
  const marker = (id, kind, title, body) => '<!-- wb:' + id + ':' + kind + ' -->\n## ' + title + '\n\n' + body + '\n\n';
  const example = () => '# 中点弦与点差法\n\n' +
    marker('problem', 'question', '从中点，找到斜率', '椭圆 $x²/4 + y²/3 = 1$ 上，弦 AB 的中点是 $M(1, ½)$。求直线 AB 的斜率。\n\n来源：[中点弦的斜率](notara:c-midchord)\n\n**先想一想：** 已知的是两个端点各自的坐标，还是它们之间的关系？') +
    marker('picture', 'diagram', '把条件放回图中', '![椭圆与中点弦](diagram:ellipse)\n\nM 是弦的中点；我们需要的是弦的方向。\n\n[圆锥曲线 · 点差法](notara:k-conic#点差法)') +
    marker('structure', 'model', '共同建立的联系', '**两点在同一曲线上 → 两式相减 → 和与差**\n\n$x₁ + x₂ = 2x₀$，$y₁ + y₂ = 2y₀$：和，连接中点。\n\n$(y₁ − y₂)/(x₁ − x₂) = k$：差的比，连接斜率（先检查分母）。\n\n从“求出两个端点”转向“保留我们需要的关系”。\n\n对照：[中点弦问题](notara:t-chord) · [二次式相减会暴露线性关系](notara:i-diff)') +
    marker('attempt', 'student', '我的思路变化', '### 最初的尝试\n设直线方程联立，展开后算得很乱。\n\n### 得到提示以后\n老师提出“两式相减”后，我自己接上了 $x₁ + x₂ = 2$、$y₁ + y₂ = 1$。\n\n### 当前还要检验\n这一次求出 $k = −3/2$，并不能说明换题后也能主动想到相减。') +
    marker('hint', 'hint', '需要时看一个提示', '先不求端点。把两点坐标分别代入同一个方程，再观察 $x₁² − x₂²$。') +
    marker('reference', 'reference', '回看推导', '两式相减并因式分解：\n\n$(x₁+x₂)(x₁−x₂)/4 + (y₁+y₂)(y₁−y₂)/3 = 0$。\n\n代入中点关系：\n\n$(x₁−x₂)/2 + (y₁−y₂)/3 = 0$。\n\n本题中弦不能竖直，否则端点的 y 坐标互为相反数，中点纵坐标为 0，与 ½ 矛盾。因此可除以 $x₁−x₂$，得到 $k = −3/2$。') +
    marker('inquiry', 'inquiry', '如果中点落在 x 轴上呢？', '仍是这条椭圆，改成 $M(1, 0)$。你觉得“差的比”还能直接计算吗？\n\n可以先选一个判断，再说说理由；暂时不确定也没关系。');
  function current() { return lesson(S.route.id); }
  function state(L = current()) {
    if (!states.has(L.id)) {
      let md = L.id === 'l1' ? example() : '# ' + L.title + '\n\n';
      let restored = false;
      if (L.seed) try { const saved = localStorage.getItem(key + L.id); if (saved && saved.length < 200000 && saved.startsWith('# ')) { md = saved; restored = true; } } catch {}
      states.set(L.id, { md, face:'board', chat:false, selected:null, folds:{}, saved:restored ? '已恢复本机笔记' : '示例课堂笔记', exportURLs:[] });
    }
    return states.get(L.id);
  }
  function blocks(md) {
    return [...md.matchAll(/^<!-- wb:([\w-]+):([\w-]+) -->\n## ([^\n]+)\n([\s\S]*?)(?=^<!-- wb:|$(?![\s\S]))/gm)]
      .map(m => ({ id:m[1], kind:m[2], title:m[3], body:m[4].trim(), raw:m[0] }));
  }
  function refs(md) {
    const all = [...md.matchAll(/\[([^\]]+)\]\(notara:([\w-]+)(?:#([^)]*))?\)/g)].map(m => ({ id:m[2], where:m[3] || '', label:m[1] }));
    return all.filter((r,i) => file(r.id) && all.findIndex(x => x.id === r.id) === i);
  }
  function persist(L = current()) {
    const s = state(L);
    s.saved = '已保留在本页';
    if (L.seed) try { localStorage.setItem(key + L.id, s.md); s.saved = '已保存到此浏览器'; } catch { s.saved = '本机保存失败，请导出备份'; }
  }
  function updateBlock(id, body, title) {
    const s = state(), b = blocks(s.md).find(x => x.id === id);
    if (!b) return;
    s.md = s.md.replace(b.raw, () => marker(b.id, b.kind, title || b.title, body));
    persist();
  }
  function append(kind, title, body) {
    const s = state(), id = 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,6);
    s.md += marker(id, kind, title, body);
    persist(); s.face = 'board'; s.chat = false; render(); jump(id);
  }
  function inline(text, exporting = false) {
    return esc(text)
      .replace(/\[([^\]]+)\]\(notara:([\w-]+)(?:#([^)]*))?\)/g, (_, label, id, where) => exporting
        ? '<a class="wb-source-link" href="#source-' + id + '">' + label + '</a>'
        : '<button class="wb-source-link" ' + act('wb-source', id, 'data-where="' + esc(where || '') + '"') + '>' + label + '</button>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\$([^$\n]+)\$/g, '<code>$1</code>');
  }
  function ellipse() {
    return '<figure class="wb-figure"><svg viewBox="0 0 320 235" role="img" aria-label="椭圆 x²/4+y²/3=1 与过 M(1,½) 的弦 AB">' +
      '<path d="M25 126H296M153 219V20" fill="none" stroke="currentColor" opacity=".25"/><text x="290" y="142" fill="currentColor" font-size="11">x</text><text x="161" y="24" fill="currentColor" font-size="11">y</text>' +
      '<ellipse cx="153" cy="126" rx="104" ry="90" fill="none" stroke="currentColor" opacity=".5" stroke-width="1.5"/>' +
      '<path d="M162.66 36.49 239.34 151.51" stroke="currentColor" stroke-width="2" fill="none"/>' +
      '<path d="M205 126V100M153 100H205" stroke="currentColor" stroke-dasharray="3 4" opacity=".3" fill="none"/>' +
      '<g fill="currentColor"><circle cx="162.66" cy="36.49" r="3"/><circle cx="239.34" cy="151.51" r="3"/><circle cx="205" cy="100" r="4"/>' +
      '<text x="171" y="36" font-size="12">A</text><text x="249" y="156" font-size="12">B</text><text x="215" y="95" font-size="12">M(1, ½)</text><text x="138" y="143" font-size="11">O</text></g></svg>' +
      '<figcaption>同一条弦：几何条件与代数关系</figcaption></figure>';
  }
  function content(md, exporting = false) {
    return md.split(/\n\s*\n/).map(part => {
      if (part.trim() === '![椭圆与中点弦](diagram:ellipse)') return ellipse();
      if (part.startsWith('### ')) return '<h4>' + inline(part.slice(4), exporting) + '</h4>';
      if (part.startsWith('> ')) return '<blockquote>' + inline(part.replace(/^> ?/gm,''), exporting).replace(/\n/g,'<br>') + '</blockquote>';
      if (part.startsWith('- ')) return '<ul>' + part.split('\n').map(x => '<li>' + inline(x.replace(/^- /,''), exporting) + '</li>').join('') + '</ul>';
      return '<p>' + inline(part, exporting).replace(/\n/g,'<br>') + '</p>';
    }).join('');
  }
  function blockHTML(b, index, exporting = false) {
    const fold = ['question','student','hint','reference'].includes(b.kind);
    const open = !exporting && (state().folds[b.id] ?? b.kind === 'question');
    const body = content(b.body, exporting);
    const labels = {question:'题面与条件',student:'展开我的尝试',hint:'展开提示',reference:'展开参考解释'};
    const controls = exporting ? '' : '<div class="wb-block-actions"><button ' + act('wb-ask',b.id) + '>追问</button>' +
      (['note','student'].includes(b.kind) ? '<button ' + act('wb-edit',b.id) + '>编辑</button>' : '') + '</div>';
    let extra = '';
    if (b.kind === 'inquiry' && !exporting) extra = '<div class="wb-choice" aria-label="选择接下来讨论的方向">' +
      ['仍然可以直接求比值','先检查分母是否为零','我还不确定','我有别的想法'].map((x,i) => '<button ' + act('wb-choice',String(i)) + '>' + x + '</button>').join('') + '</div>';
    return '<section class="wb-block" data-kind="' + b.kind + '" id="wb-' + b.id + '" tabindex="-1"><div class="wb-block-head"><span class="wb-num">' +
      String(index+1).padStart(2,'0') + '</span><h3>' + esc(b.title) + '</h3>' + controls + '</div>' +
      (fold ? '<details class="wb-fold" data-wb-fold="' + b.id + '"' + (open ? ' open' : '') + '><summary>' + labels[b.kind] + '</summary><div class="wb-content">' + body + '</div></details>'
        : '<div class="wb-content">' + body + '</div>') + extra + '</section>';
  }
  function graphHTML(L) {
    const s = state(L), list = refs(s.md), selected = list.find(x => x.id === s.selected) || list[0];
    if (!list.length) return '<div class="wb-empty"><h3>这节课还没有引用资料</h3><p>从对话或笔记引用资料后，关联会出现在这里。</p><button class="btn" ' + act('wb-face','board') + '>回到板书</button></div>';
    const edges = [];
    for (const r of list) {
      const f = file(r.id);
      if (f.source && list.some(x=>x.id===f.source.file)) edges.push({a:f.source.file,b:f.id,label:'摘自 · ' + f.source.where});
      if (f.parent && list.some(x=>x.id===f.parent)) edges.push({a:f.id,b:f.parent,label:'归入专题'});
      for (const target of f.links || []) if (list.some(x=>x.id===target)) edges.push({a:f.id,b:target,label:'案例联系'});
    }
    const nodes = list.map((r,i)=>({...r,x:i%2 ? 460 : 140,y:140+Math.floor(i/2)*120}));
    const node = id=>nodes.find(x=>x.id===id);
    const height = 230+Math.floor((nodes.length-1)/2)*120;
    let svg = '<svg class="wb-map" viewBox="0 0 600 ' + height + '" aria-label="本课资料关系图"><g>';
    for (const n of nodes) svg += '<path d="M300 54 Q300 ' + (n.y-40) + ' ' + n.x + ' ' + n.y + '" stroke-dasharray="4 5"/>';
    for (const edge of edges) { const a=node(edge.a), b=node(edge.b); svg += '<path d="M' + a.x + ' ' + a.y + ' L' + b.x + ' ' + b.y + '"/>'; }
    svg += '<rect x="225" y="22" width="150" height="46" rx="14" fill="var(--soft)"/><text x="300" y="50" text-anchor="middle" font-size="13">本课课堂笔记</text>';
    for (const n of nodes) svg += '<g class="wb-node" role="button" tabindex="0" aria-label="' + esc(file(n.id).title) + '" aria-pressed="' + (selected.id===n.id) + '" ' + act('wb-select',n.id) + '><rect x="' + (n.x-117) + '" y="' + (n.y-32) + '" width="234" height="66" rx="15"/><text x="' + n.x + '" y="' + (n.y-7) + '" text-anchor="middle" font-size="10" opacity=".65">' + TYPE_LABEL[file(n.id).type] + '</text><text x="' + n.x + '" y="' + (n.y+15) + '" text-anchor="middle" font-size="12">' + esc(file(n.id).title) + '</text></g>';
    svg += '</g></svg>';
    const f = file(selected.id), used = blocks(s.md).filter(b => refs(b.body).some(x => x.id===f.id));
    return '<div class="wb-intro"><div class="wb-eyebrow">KNOWLEDGE VIEW · 本课资料</div><h2>这一课，用到了什么</h2><p>' + list.length + ' 份资料，与同一份课堂笔记相连。虚线表示本课引用，实线表示资料间已有的联系。</p></div>' + svg +
      '<div class="wb-source-list">' + list.map(r=>'<button aria-pressed="' + (r.id===selected.id) + '" ' + act('wb-select',r.id) + '>' + esc(file(r.id).title) + '</button>').join('') + '</div>' +
      '<div class="wb-relations">' + edges.map(e=>'<span>' + esc(file(e.a).title) + ' → ' + esc(file(e.b).title) + ' · ' + esc(e.label) + '</span>').join('') + '</div>' +
      '<section class="wb-source-detail"><span class="hint">' + TYPE_LABEL[f.type] + (selected.where ? ' · '+esc(selected.where) : '') + '</span><h3>' + esc(f.title) + '</h3><p>' + esc(f.excerpt || '') + '</p><div class="wb-choice"><button ' + act('wb-source',f.id,'data-where="' + esc(selected.where) + '"') + '>打开资料' + icon('right',12) + '</button>' +
      used.map(b=>'<button ' + act('wb-jump',b.id) + '>定位板书 · '+esc(b.title)+'</button>').join('') + '</div></section>';
  }
  function html(L) {
    const s = state(L), list = blocks(s.md);
    const title = (s.md.match(/^# (.+)$/m) || [null,L.title])[1];
    const board = '<div class="wb-intro"><div class="wb-eyebrow">CLASS NOTES · 课堂板书</div><h2>' + esc(title) + '</h2><p>' + (L.id==='l1' ? '从一条弦的方向，发现“和”与“差”之间的联系。' : '把问题、尝试和逐渐形成的联系留在这里。') + '</p></div>' +
      (list.length ? '<div class="wb-grid">' + list.map((b,i)=>blockHTML(b,i)).join('') + '</div>' : '<div class="wb-empty"><h3>白板从你的问题开始</h3><p>对话里的内容可以加入板书，<br>也可以先记下一个想法。</p><button class="btn" ' + act('wb-note') + '>记录想法</button></div>');
    const messages = L.messages.map((m,i) => ['user','ai'].includes(m.role) ? msgHTML(m,L) + '<button class="wb-pin" ' + act('wb-pin',String(i)) + '>＋ 加入板书</button>' : '').join('');
    return '<div class="wb-shell"' + (s.chat?' data-chat-open':'') + '><section class="wb-workspace"><div class="wb-toolbar"><div class="seg small" role="tablist" aria-label="白板两面">' +
      [['board','板书'],['sources','知识视图']].map(([k,label])=>'<button role="tab" aria-selected="' + (s.face===k) + '" ' + act('wb-face',k) + '>' + label + '</button>').join('') + '</div>' +
      '<button class="btn sm" ' + act('wb-note') + ' aria-label="记录想法">' + icon('plus',14) + '<span class="wb-btn-label">记录想法</span></button><button class="btn sm" ' + act('wb-export') + '>' + icon('upload',14) + '导出</button><button class="btn sm wb-mobile-toggle" ' + act('wb-chat') + '>对话</button></div>' +
      '<div class="wb-scroll" id="wb-scroll" data-face="' + s.face + '" data-lesson="' + L.id + '">' + (s.face==='sources' ? graphHTML(L) : board) + '</div><footer class="wb-status"><span>' + esc(s.saved) + ' · 机制占位</span><button ' + act('wb-md') + '>查看课堂笔记 ↗</button></footer></section>' +
      '<aside class="wb-chat" aria-label="白板旁的对话"><div class="wb-chat-head"><b>课堂对话</b><span>围绕板书继续聊</span><button class="btn sm wb-chat-close" ' + act('wb-chat-close') + '>回到白板</button></div>' +
      '<div class="chat-scroll" id="chat-scroll"><div class="chat-col">' + (messages || '<p class="hint">从一个具体问题开始。</p>') + (L.typing ? '<p role="status" class="hint">正在回复…</p>':'') + '</div></div><div class="composer-wrap">' + composerHTML(L,false) + '</div></aside></div>';
  }
  function jump(id) {
    state().face='board'; state().chat=false; render();
    requestAnimationFrame(()=>{ const el=document.getElementById('wb-'+id); el?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}); el?.focus({preventScroll:true}); });
  }
  function source(id, where='') {
    const f = file(id); if (!f) return;
    openDialog('<h2>' + esc(f.title) + '</h2><p class="desc">' + esc(where || (f.source ? '摘自 '+file(f.source.file)?.title+' · '+f.source.where : TYPE_LABEL[f.type])) + '</p><div class="wb-dialog-content">' + (f.type==='pdf'?pdfHTML(f):docHTML(f,true)) + '</div><div class="dialog-foot"><button class="btn" ' + act('close') + '>回到白板</button><button class="btn" ' + act('wb-ref',id) + '>引用并追问</button></div>');
    if (where) requestAnimationFrame(()=>{ const h=[...document.querySelectorAll('.wb-dialog-content h2,.wb-dialog-content h3')].find(x=>x.textContent.trim()===where); h?.scrollIntoView({block:'start'}); });
  }
  function noteDialog(id) {
    const b = blocks(state().md).find(x=>x.id===id);
    openDialog('<h2>' + (b?'修改这条板书':'记录一个想法') + '</h2><div class="field"><label for="wb-note-title">标题</label><input id="wb-note-title" maxlength="80" value="' + esc(b?.title || '') + '" placeholder="例如：分母为零时怎么办？"></div><div class="field"><label for="wb-note-body">内容</label><textarea id="wb-note-body" rows="7" placeholder="记录推理、疑问或需要修正的地方…">' + esc(b?.body || '') + '</textarea></div><div class="dialog-foot"><button class="btn ghost" ' + act('close') + '>取消</button><button class="btn" ' + act('wb-note-save',id || '') + '>保存到板书</button></div>');
  }
  function quote(text) { return String(text).replace(/\r/g,'').split('\n').map(x=>'> '+x).join('\n'); }
  function ask(id) {
    const b=blocks(state().md).find(x=>x.id===id); if (!b) return;
    const draft=S.drafts[current().id]||'';
    S.drafts[current().id]=(draft.trim()?draft+'\n':'')+'关于「'+b.title+'」：';
    state().chat=true; render(); document.getElementById('draft-'+current().id)?.focus();
  }
  function choose(value) {
    if (value==='3') { ask('inquiry'); return; }
    const options=['仍然可以直接求比值','先检查分母是否为零','我还不确定'];
    const responses=[
      '我们先检查能不能做除法。把 y₁+y₂=0 代入相减后的式子，剩下的项告诉你什么？',
      '先检查分母很关键。取 M(1,0)，试着从相减式推出 x₁−x₂=0，再画图解释这意味着什么。',
      '先只看一个小判断：一条竖直的弦有没有斜率？你可以画图，或者从“横向变化为零”来想。'
    ];
    const L=current();
    L.messages.push({role:'user',text:'关于“中点落在 x 轴上”：'+options[Number(value)]},{role:'ai',html:'<p>'+esc(responses[Number(value)])+'</p>'});
    updateBlock('inquiry','仍是这条椭圆，改成 $M(1, 0)$。\n\n检查“差的比”之前，先验证分母能否为零。','继续检查：什么时候可以除？');
    const prior=blocks(state().md).find(b=>b.id==='choice-response');
    const reasoning='### 我现在的判断\n'+options[Number(value)]+'\n\n### 下一步检验\n'+responses[Number(value)];
    if(prior) updateBlock(prior.id,reasoning); else { state().md+=marker('choice-response','student','这次判断与下一步',reasoning);persist(); }
    state().chat=true; S.scrollChat=true; render();
  }
  function exportData(includeStudent, includeReference) {
    const L=current(), s=state(L), all=blocks(s.md);
    const list=all.filter(b=>(includeStudent || b.kind!=='student') && (includeReference || !['reference','hint'].includes(b.kind)));
    const title=(s.md.match(/^# (.+)$/m)||[null,L.title])[1];
    const raw='# '+title+'\n\n'+list.map(b=>marker(b.id,b.kind,b.title,b.body)).join('');
    const sources=refs(raw);
    const sourceMD=sources.map(r=>'<a id="source-'+r.id+'"></a>\n\n- '+file(r.id).title+(r.where?' · '+r.where:'')+'（'+TYPE_LABEL[file(r.id).type]+'）').join('\n\n');
    const portable=raw.replace(/\]\(notara:([\w-]+)(?:#[^)]*)?\)/g,'](#source-$1)').replace('![椭圆与中点弦](diagram:ellipse)',ellipse());
    const md=portable+'\n## 资料出处\n\n'+sourceMD+'\n\n---\nNotara 交互原型 · 合成课堂示例\n';
    const css='*{box-sizing:border-box}body{margin:0;background:#fff;color:#252a31;font:15px/1.8 "Helvetica Neue","PingFang SC",sans-serif}main{max-width:920px;margin:50px auto;padding:0 24px}h1{font-size:30px;font-weight:600}h3{font-size:18px;margin:0}h4{font-size:14px}header p,footer,.wb-num,figcaption{color:#737b86;font-size:12px}.wb-block{margin:28px 0;break-inside:avoid}.wb-block-head{display:flex;gap:12px;align-items:center;margin-bottom:12px}.wb-content p{margin:10px 0}.wb-content code{font:18px Georgia,serif}.wb-content blockquote{border-left:2px solid #ddd;padding-left:16px}.wb-fold{border:1px solid #e8ecf0;border-radius:16px;padding:14px 18px}.wb-fold summary{cursor:pointer}.wb-content{overflow-wrap:anywhere}.wb-figure{margin:0;border:1px solid #e8ecf0;border-radius:18px;padding:16px}.wb-figure svg{display:block;width:100%;max-height:250px}figcaption{text-align:center}a{color:#59626e}footer{border-top:1px solid #eee;margin-top:40px;padding-top:20px}[data-kind=model]{background:#f4f5f6;padding:20px;border-radius:18px}';
    const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+' · 课堂笔记</title><style>'+css+'</style><main><header><p>NOTARA · 课堂笔记</p><h1>'+esc(title)+'</h1><p>合成课堂示例 · '+(includeStudent?'包含学生尝试':'不含学生尝试')+' · '+(includeReference?'包含提示与参考解释':'不含提示与参考解释')+'</p></header>'+list.map((b,i)=>blockHTML(b,i,true)).join('')+'<footer><h3>资料出处</h3><ul>'+sources.map(r=>'<li id="source-'+r.id+'">'+esc(file(r.id).title)+(r.where?' · '+esc(r.where):'')+' · '+TYPE_LABEL[file(r.id).type]+'</li>').join('')+'</ul><p>由课堂 Markdown 笔记生成。此文件可独立阅读，保留折叠与图示；不包含原资料全文，也不提供 AI 对话。</p></footer></main></html>';
    return {md,html,title};
  }
  function exportDialog() {
    openDialog('<h2>导出课堂笔记</h2><p class="desc">生成可独立阅读的网页，或保留 Markdown 笔记。仅下载文件，不会公开发布。</p><div class="wb-export-options"><label><input id="wb-include-student" type="checkbox">包含我的尝试与对话摘录</label><label><input id="wb-include-reference" type="checkbox">包含提示与参考解释</label></div><p class="hint">两种格式使用相同范围；不包含原始对话和资料全文。你自己写入普通板书的内容也会导出。</p><div class="dialog-foot"><button class="btn ghost" ' + act('close') + '>取消</button><button class="btn" ' + act('wb-export-build') + '>生成导出文件</button></div>');
  }
  function buildExport() {
    const s=state(), result=exportData($('#wb-include-student').checked,$('#wb-include-reference').checked);
    s.exportURLs.forEach(url=>URL.revokeObjectURL(url));
    s.exportURLs=[URL.createObjectURL(new Blob([result.md],{type:'text/markdown;charset=utf-8'})),URL.createObjectURL(new Blob([result.html],{type:'text/html;charset=utf-8'}))];
    const name=result.title.replace(/[\\/:*?"<>|]/g,'-');
    openDialog('<h2>课堂笔记已生成</h2><p class="desc">检查内容范围后下载。HTML 保留图示与折叠，可直接交给别人阅读。</p><pre class="wb-preview">'+esc(result.md)+'</pre><div class="dialog-foot"><button class="btn ghost" '+act('wb-export')+'>调整范围</button><a class="btn" href="'+s.exportURLs[0]+'" download="'+esc(name)+'.md">下载 Markdown</a><a class="btn" href="'+s.exportURLs[1]+'" download="'+esc(name)+'.html">下载 HTML</a></div>');
  }
  function install(A) {
    Object.assign(A,{
      'wb-face':face=>{state().face=face;render();},
      'wb-chat':()=>{state().chat=true;S.scrollChat=true;render();},
      'wb-chat-close':()=>{state().chat=false;render();},
      'wb-note':()=>noteDialog(),
      'wb-edit':id=>noteDialog(id),
      'wb-note-save':id=>{
        const title=$('#wb-note-title').value.trim().replace(/\n/g,' '), body=$('#wb-note-body').value.trim();
        if(!title || !body) return toast('请填写标题和内容。');
        if(/^<!-- wb:/m.test(body)) return toast('请填写笔记正文，不要粘贴分块标记。');
        if(id){updateBlock(id,body,title);closeLayer();jump(id);}else{closeLayer();append('note',title,body);}
      },
      'wb-select':id=>{state().selected=id;render();},
      'wb-source':(id,el)=>source(id,el?.dataset.where || ''),
      'wb-jump':id=>jump(id),
      'wb-ask':id=>ask(id),
      'wb-choice':value=>choose(value),
      'wb-ref':id=>{closeLayer();addRef(current().id,id);state().chat=true;render();document.getElementById('draft-'+current().id)?.focus();},
      'wb-pin':index=>{
        const m=current().messages[Number(index)];if(!m)return;
        const el=document.createElement('div');el.innerHTML=m.html || '';
        const citations=(m.refs||[]).filter(r=>file(r.file)).map(r=>'['+file(r.file).title+'](notara:'+r.file+')').join(' · ');
        append('student',m.role==='user'?'我的课堂表达':'对话摘录 · 老师',quote(m.text || el.textContent)+(citations?'\n\n引用：'+citations:''));
      },
      'wb-md':()=>openDialog('<h2>课堂笔记</h2><p class="desc">板书与知识视图来自这份笔记。修改板书后，这里会同步更新。</p><pre class="wb-preview">'+esc(state().md)+'</pre><div class="dialog-foot"><button class="btn" '+act('close')+'>关闭</button></div>'),
      'wb-export':()=>exportDialog(),
      'wb-export-build':()=>buildExport()
    });
    document.addEventListener('toggle',e=>{if(e.target.dataset?.wbFold && S.route.name==='lesson')state().folds[e.target.dataset.wbFold]=e.target.open;},true);
  }
  function capture() {
    const el=document.getElementById('wb-scroll');if(!el)return;
    const s=states.get(el.dataset.lesson);if(s){s.scroll=s.scroll||{};s.scroll[el.dataset.face]=el.scrollTop;}
  }
  function restore() {
    const el=document.getElementById('wb-scroll');if(!el)return;
    el.scrollTop=states.get(el.dataset.lesson)?.scroll?.[el.dataset.face]||0;
  }
  return {html,install,source,capture,restore,sources:()=>{state().face='sources';render();}};
})();
