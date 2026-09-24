/* A visual study with synthetic states. No production session, renderer or schema. */
(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const escape = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = {example:'history', stage:0, face:'board', choice:'', reference:'', messages:[], focus:false,follow:true,writing:false,paused:false,writingTarget:'',positions:{},camera:{x:28,y:28,z:1},streamVersion:0};
  state.sourceCamera={x:10,y:23,z:.7};
  function surface(){return state.face==='sources'?{viewport:$('#sources'),world:$('#source-sheet'),camera:state.sourceCamera}:{viewport:$('#board'),world:$('#sheet'),camera:state.camera};}
  const materialRoot = 'whiteboard-study-materials/';
  const materials = {
    money:{title:'交子与兑付',file:'交子与兑付.md',kind:'资料笔记',section:'mechanism',body:'交子可以作为讨论货币运输成本的入口，但纸张轻便并不足以解释凭证为什么能被接受。\n\n需要继续区分发行主体、兑现承诺、流通范围与信用约束。私人交子与官交子也不能合并成一个没有时间差异的过程。\n\n本课用途：将“重量”与“信用”区分开。'},
    transport:{title:'远距离供给的成本',file:'远距离供给的成本.md',kind:'问题笔记',section:'mechanism',body:'把粮食运到远方，需要运输、仓储、转运和组织成本。运粮的人畜也会消耗物资。\n\n讨论时分别追问：谁运输实物？谁付成本？谁承担损耗与不确定性？\n\n本课用途：提供比较问题，而不是把各时代制度归为同一种机制。'},
    salt:{title:'开中法与运输激励',file:'开中法与运输激励.md',kind:'比较材料',section:'mechanism',body:'在开中法的典型安排中，商人向指定地点输粮，按制度取得与盐经营有关的资格或凭证。\n\n这有助于讨论“国家组织运输”和“通过收益安排动员商人运输”的差异。实物运输仍然存在。\n\n本课用途：与交子比较成本和责任如何转移，不推断二者存在直接制度谱系。'},
    chord:{title:'椭圆中点弦问题',file:'椭圆中点弦问题.md',kind:'题目',section:'mechanism',body:'椭圆 x²/4 + y²/3 = 1。一条弦的中点为 M(1, 1/2)，求弦所在直线的斜率。\n\n先预测：是否一定要算出两个交点坐标？\n\n本课用途：从两个点共享的约束中寻找可消去的信息。'},
    difference:{title:'点差法与适用边界',file:'点差法与适用边界.md',kind:'方法笔记',section:'boundary',body:'设 A(x₁,y₁)、B(x₂,y₂) 在同一椭圆上。把两式相减、因式分解，得到坐标差与坐标和的关系。\n\n中点提供坐标和。斜率表达式要求 x₁ ≠ x₂；除以其他量时也要检查它非零。\n\n本课用途：检查竖直弦和弦的存在条件。'}
  };
  const commonMaterialNote = '设计演示用合成材料；不是史料摘录，也不是已核验教材。';
  const names = {history:'货币、运输与国家能力',math:'从中点条件到弦的方向',empty:'新课堂'};
  const glyphs = {
    coins:'<ellipse cx="23" cy="8" rx="14" ry="5"/><path d="M9 8v7c0 7 28 7 28 0V8M9 16v7c0 7 28 7 28 0v-7M9 24v7c0 7 28 7 28 0v-7"/><path d="M20 6h6v4h-6z"/>',
    paper:'<path class="soft-fill" d="M12 4h25v34H12z"/><path d="M12 4h25v34H12zM18 11h13M18 16h13M18 21h8"/><circle cx="29" cy="29" r="4"/>',
    trust:'<path class="soft-fill" d="M24 3 40 10v12c0 9-16 17-16 17S8 31 8 22V10Z"/><path d="M24 3 40 10v12c0 9-16 17-16 17S8 31 8 22V10ZM16 20l6 6 11-12"/>',
    grain:'<path d="M14 6h23l-4 8c11 17 13 25-7 25S7 31 18 14zM18 14h15M23 21v12M18 24l5 4M28 24l-5 4"/>',
    cart:'<path class="soft-fill" d="M8 15h29l-4 16H12z"/><path d="M8 15h29l-4 16H12zM37 15l3-9h7M14 15V7h16v8M21 7v8"/><circle cx="15" cy="36" r="3"/><circle cx="32" cy="36" r="3"/>',
    salt:'<path d="M10 37h31L29 12h-8zM17 25l6-5 6 4 4-3M7 37h37"/><path class="soft-fill" d="m17 29 8-5 9 8 2 4H14z"/>'
  };
  function sketch(kind){return `<svg class="sketch" viewBox="0 0 52 44" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" aria-hidden="true">${glyphs[kind]}</svg>`;}
  function sourceIds(){return state.example==='empty'?[]:state.example==='math'?['chord','difference']:state.stage===0?['money']:['money','transport','salt'];}
  function section(title,id,number,body){return `<section class="sheet-section" id="${id}" data-title="${title}"><div class="section-head"><span class="section-number">${number}</span><h2>${title}</h2><button class="ask" data-ask="${id}" aria-label="追问：${title}">围绕这里聊 ↗</button></div>${body}</section>`;}
  function sourceLinks(ids){return `<div class="source-links">${ids.map(id=>`<button class="source-link" data-source="${id}"><span>↗</span> ${materials[id].title}</button>`).join('')}</div>`;}
  function fold(title,body,type=''){return `<details class="fold" ${type?`data-scope="${type}"`:''}><summary>${title}</summary><div class="fold-body">${body}</div></details>`;}
  function node(icon,title,sub){return `<div class="mechanism-node">${sketch(icon)}<strong>${title}</strong><small>${sub}</small></div>`;}
  function historyBoard(){
    const extended = state.stage > 0;
    return `<header class="inquiry-head"><p class="eyebrow">${extended?'从交子延伸出来的问题':'从一个具体问题开始'}</p><h1>${extended?'价值如何抵达远方？':'铁钱太重，换成纸就够了吗？'}</h1><p class="lead">${extended?'把钱运过去，把粮运过去。相似的空间困难，不同的制度安排。':'从纸张的轻便，追问一张凭证为什么能被接受。'}</p></header>`+
    section(extended?'放在一起，比较机制':'先分清：轻便与可信','mechanism','01',`<figure class="mechanism" aria-label="${extended?'交子与开中法的机制比较':'交子的重量与信用问题'}"><div class="mechanism-row"><span class="lane-label">交易</span>${node('coins','搬运金属货币','重量与运输成本')}<span class="flow-arrow">→</span>${node('paper','使用流通凭证','节省搬运货币')}<span class="flow-arrow">→</span>${node('trust','接受兑付承诺','信用仍须有约束')}</div>${extended?`<div class="mechanism-row"><span class="lane-label">补给</span>${node('grain','边地需要粮食','实物必须抵达')}<span class="flow-arrow">→</span>${node('cart','动员商人输粮','改变运输的承担者')}<span class="flow-arrow">→</span>${node('salt','安排特许收益','以激励组织供给')}</div>`:''}</figure><p class="flow-summary">${extended?'比较的共同问题：谁运输，谁付成本，谁承担风险？':'重量解释了需求；兑付与接受范围，决定凭证能否流通。'}</p>${sourceLinks(sourceIds())}`)+
    section(state.stage===2?'把解释说得更准确':'目前建立的联系','model','02',`<div class="thought"><p>${state.stage===2?'转移成本与责任，<br>不等于让运输消失。':extended?'制度改变的，不只有工具，<br>还有成本由谁承担。':'纸张节省重量，<br>制度承担信用。'}</p><small>${state.stage===2?'修订后的表述 · 仍需要逐项核对具体制度':'共同整理 · 保留差异，继续检验'}</small></div>${state.stage===2?fold('查看这次认识的修订','<p class="revision-before">有了凭证，就不需要运输了。</p><p class="revision-after">凭证可以减少货币搬运；粮食供给仍依赖实物运输。开中改变了运输的组织与激励。</p><p class="revision-caption">演示中的早先想法 → 比较案例后收窄解释</p>','attempt'):fold('保留的疑问：两种制度能否直接类比？','<p>它们可以围绕空间成本比较，但服务对象、信用机制和制度背景各有不同。相似问题不等于同一种制度，也不能据此推出直接传承。</p>')}`)+
    section('接下来，追哪一条线？','inquiry','03',`<div class="question-inline"><span class="next-label">从你的选择继续</span><p>你更想拆开哪一个问题？</p><div class="choices"><button data-choice="credit">谁保证凭证兑现</button><button data-choice="logistics">粮食最后怎么抵达</button><button data-choice="unsure">还说不清，先看例子</button></div><div class="choice-feedback" id="choice-feedback" role="status"></div></div>`);
  }
  function ellipse(){return `<svg class="geometry" viewBox="0 0 310 230" role="img" aria-label="椭圆上一条斜向下的弦AB，其中点为M(1,二分之一)"><path class="axis" d="M15 122h280M150 215V12"/><ellipse class="curve" cx="150" cy="122" rx="116" ry="92"/><path class="axis" stroke-dasharray="3 4" d="M208 122V95.442H150"/><path class="chord" d="M160.643 30.388 255.357 160.497"/><circle class="dot" cx="160.643" cy="30.388" r="3"/><circle class="dot" cx="255.357" cy="160.497" r="3"/><circle class="dot" cx="208" cy="95.442" r="3.5"/><text x="174" y="25" font-size="13">A</text><text x="266" y="168" font-size="13">B</text><text x="217" y="87" font-size="12">M (1, ½)</text><text x="137" y="137" font-size="11">O</text><text x="293" y="137" font-size="12">x</text><text x="162" y="16" font-size="12">y</text></svg>`;}
  function mathBoard(){return `<header class="inquiry-head"><p class="eyebrow">不求交点，先找共同的约束</p><h1>相减，为什么就能找到方向？</h1><p class="lead">椭圆 <span class="math-inline">x²/4 + y²/3 = 1</span>，弦的中点为 <span class="math-inline">M(1, ½)</span>。从图像直觉走向代数关系。</p></header>`+
    section(state.stage===0?'先观察，再预测':'让图形与推导互相解释','mechanism','01',`<div class="math-layout">${ellipse()}<div class="math-steps">${state.stage===0?'<span class="step-label">先不算交点</span><p>两个端点，都在同一个椭圆上。</p><div class="formula">A, B ∈ E</div><p>中点已知，意味着哪两个量的和已知？</p>':'<span class="step-label">相减 · 把二次项分解为和与差</span><div class="formula">Δx · (x₁ + x₂)/4<br>+ Δy · (y₁ + y₂)/3 = 0</div><span class="step-label">中点 · 用已知的坐标和代入</span><div class="formula">Δx/2 + Δy/3 = 0</div><div class="answer"><span class="step-label">这里 Δx ≠ 0</span><div class="formula">k = Δy/Δx = −3/2</div></div>'}</div></div>${sourceLinks(['chord'])}`)+
    section(state.stage===2?'回头检查：除法藏着条件':'提炼可以带走的结构','boundary','02',`<div class="thought"><p>${state.stage===2?'求出方向，<br>还要检查弦是否存在。':'同一个约束，两个对象。<br>用“差”消去共同的部分。'}</p><small>${state.stage===2?'将公式的适用条件一起写在板上':'方法来自条件之间的配合，不只是一条口诀'}</small></div>${state.stage===2?`<div class="two-notes"><div><h3>中点在内部吗？</h3><p>本题 1/4 + 1/12 = 1/3 &lt; 1。中点位于椭圆内部。</p></div><div><h3>斜率一定存在吗？</h3><p>若换为 M(1, 0)，相减得到 Δx = 0，应讨论竖直弦。</p></div></div>${fold('查看这次认识的修订','<p class="revision-before">点差法一定能求出斜率。</p><p class="revision-after">它给出方向约束。遇到竖直弦时，应保留方程而不强行相除。</p>','attempt')}`:''}${fold('展开提示','<p>不要急着求每个点。先写出两个端点满足的方程，再观察相减后哪些部分消失了。</p>','reference')}${fold('展开参考推导','<p>(x₁² − x₂²)/4 + (y₁² − y₂²)/3 = 0。因式分解后，中点给出 x₁+x₂=2，y₁+y₂=1，因此 Δx/2+Δy/3=0。若 Δx=0，则 Δy=0，与端点不同矛盾，所以本题可除以 Δx，得到 k=−3/2。</p>','reference')}${sourceLinks(['difference'])}`)+
    section('换一个条件，再试一次','inquiry','03',`<div class="question-inline"><p>如果中点移到 M(1, 0)，你会先检查什么？</p><div class="choices"><button data-choice="vertical">弦是否竖直</button><button data-choice="divide">哪一步不能相除</button><button data-choice="unsure">先在图上看一看</button></div><div class="choice-feedback" id="choice-feedback" role="status"></div></div>`);
  }
  function emptyBoard(){return '<div class="board-start"><div class="empty-line"></div><h1>从一个问题开始。</h1><p>题目、图解与新的联系，会在讨论中逐渐留在这里。现在可以先说说你想弄明白什么。</p><button class="soft" data-chat>写下第一个问题 ↗</button></div>';}
  function messages(){
    if(state.example==='empty')return [{who:'teacher',text:'可以发来一道题、一份资料，或者一句还说不清的疑问。我们从那里开始。'}];
    if(state.example==='math')return [{who:'teacher',text:'中点给了坐标和。与其马上联立方程求两个交点，能不能先利用它们满足同一个椭圆方程？'},{who:'student',text:'把两个方程相减，平方差里就出现坐标和了。这样总能算出斜率吧？'},...(state.stage>0?[{who:'teacher',text:'这里真正起作用的是“同一个约束”和“已知坐标和”的配合。能否总求出斜率，还要检查相除的条件。',jump:'mechanism'}]:[]),...(state.stage===2?[{who:'teacher',text:'如果中点改成 M(1, 0)，我们得到的是竖直方向。板书里应把这个边界补上。',jump:'boundary'}]:[])];
    return [{who:'teacher',text:'交子减轻了货币搬运的负担。但一个陌生人，为什么愿意接受你手里的纸？'},{who:'student',text:'所以不只是轻，还要有人兑现。那是不是有了凭证，就不需要运输了？'},...(state.stage>0?[{who:'teacher',text:'值得把支付与供给并排拆开。交子涉及支付与信用；开中涉及输粮的组织与激励。粮食仍要有人送到。',jump:'mechanism'}]:[]),...(state.stage===2?[{who:'teacher',text:'因此，刚才“凭证让运输消失”的猜想需要收窄。我们把它改成：转移成本与责任，并保留前一种认识的来处。',jump:'model'}]:[])];
  }
  function renderMessages(){ $('#messages').innerHTML=[...messages(),...state.messages].map(m=>`<div class="message ${m.who==='student'?'student':''}"><div class="message-label">${m.who==='student'?'你':'老师 · 演示'}</div><p>${escape(m.text)}</p>${m.jump?`<button class="board-jump" data-jump="${m.jump}">↗ 看这处板书</button>`:''}${m.demo?'<p class="micro-note">已在当前页面记录；这份设计稿不会生成模型回答。</p>':''}</div>`).join(''); }
  function render(){
    $('#lesson-title').textContent=names[state.example];
    $('#sheet').innerHTML=(state.example==='history'?historyBoard():state.example==='math'?mathBoard():emptyBoard())+sideNotes();
    installCanvasBlocks();
    seedHighlights();
    $('#source-count').textContent=sourceIds().length;
    $('#working-label').textContent=state.example==='empty'?'等待第一个问题':state.stage===0?'从一个问题展开':state.stage===1?'正在建立联系':'已补充一处修订';
    $('#advance').disabled=state.stage===2||state.example==='empty';
    $('#advance').textContent=state.stage===2?'已到演示末轮':state.stage===0?'演示：接着板书 →':'演示：局部修订 →';
    $('#export-open').disabled=state.example==='empty';
    renderMessages();renderSources();setFace(state.face);applyChoice();applyCamera();drawCanvasLinks();
  }
  const basePositions={question:[52,95,340],mechanism:[52,265,340],model:[445,95,325],boundary:[445,95,325],inquiry:[838,95,325],connections:[445,430,325],evidence:[838,420,325]};
  function sideNotes(){
    if(state.example==='empty')return '';
    if(state.example==='math')return section('把条件连起来','connections','',`<div class="board-prose"><p><strong>两个端点：</strong>满足同一个椭圆方程。</p><p><strong>中点已知：</strong>给出坐标和。</p><p><strong>相减之后：</strong>把“和”与“差”联系起来。</p></div>`)+section('还要留意什么','evidence','',`<div class="board-prose"><p>得到一个式子后，先回头检查相除条件。</p><p><mark class="ink-mark highlight-orange">斜率不存在</mark>，并不等于直线不存在。</p><p>把特殊情况留在板上，和一般情况一起看。</p></div>`);
    return section('把比较落到具体问题','connections','',`<div class="board-prose"><p><strong>谁来运输？</strong>国家组织，还是商人承担。</p><p><strong>成本去哪了？</strong>被降低、转移，还是换了一种形式。</p><p><strong>谁承担风险？</strong>兑付、损耗与制度变化，要分别讨论。</p></div>`)+section('留住差异，再建立联系','evidence','',`<div class="board-prose"><p>交子与开中法，可以围绕空间成本展开比较。</p><p>但<mark class="ink-mark highlight-pink">相似的问题</mark>，不等于同一种制度。</p><p>还需要核对：时代、地区、发行与经营规则。</p></div>`);
  }
  function seedHighlights(){
    const phrases=[['金属货币','blue'],['流通凭证','green'],['谁承担风险','orange'],['制度承担信用','green'],['不等于让运输消失','pink'],['Δx ≠ 0','orange'],['−3/2','green'],['坐标和','blue'],['弦是否存在','pink']];
    const walker=document.createTreeWalker($('#sheet'),NodeFilter.SHOW_TEXT);const nodes=[];let node;
    while(node=walker.nextNode())if(!node.parentElement.closest('button,svg,details,mark'))nodes.push(node);
    for(const node of nodes){let parts=[node.textContent];for(const [phrase,color] of phrases){parts=parts.flatMap(part=>{if(typeof part!=='string')return [part];const split=part.split(phrase),out=[];split.forEach((text,i)=>{if(i){const mark=document.createElement('mark');mark.className='ink-mark highlight-'+color;if(phrase==='流通凭证')mark.classList.add('ink-circle');mark.textContent=phrase;out.push(mark);}if(text)out.push(text);});return out;});}if(parts.some(p=>typeof p!=='string'))node.replaceWith(...parts.map(p=>typeof p==='string'?document.createTextNode(p):p));}
  }
  const grip='<svg viewBox="0 0 12 18" fill="currentColor" aria-hidden="true"><circle cx="3" cy="4" r="1"/><circle cx="9" cy="4" r="1"/><circle cx="3" cy="9" r="1"/><circle cx="9" cy="9" r="1"/><circle cx="3" cy="14" r="1"/><circle cx="9" cy="14" r="1"/></svg>';
  function installCanvasBlocks(){
    const root=$('#sheet').firstElementChild;if(!root)return;root.id='question';root.dataset.title=state.example==='empty'?'第一个问题':'本课共同问题';
    [...$('#sheet').children].forEach((el,i)=>{
      el.classList.add('canvas-block');el.dataset.order=i;
      const title=el.dataset.title||'板书';
      const handle=document.createElement('button');handle.className='block-grip';handle.setAttribute('aria-label','拖动：'+title);handle.title='拖动调整位置；方向键微调';handle.innerHTML=grip;
      const head=$('.section-head',el);if(head){$('.section-number',head)?.remove();head.prepend(handle);}else el.prepend(handle);
      const base=basePositions[el.id]||[60,65,630];
      if(!state.positions[el.id])state.positions[el.id]={x:base[0],y:base[1]};
      const width=window.innerWidth<=720?Math.min(base[2],Math.max(210,$('#board').clientWidth-44)):base[2];
      el.style.width=width+'px';positionBlock(el);
      handle.addEventListener('pointerdown',e=>startBlockDrag(e,el));
      handle.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const p=state.positions[el.id],step=e.shiftKey?32:8;p.x+=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0;p.y+=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;positionBlock(el);setFollow(false);drawCanvasLinks();});
    });
    const edges=document.createElementNS('http://www.w3.org/2000/svg','svg');edges.classList.add('canvas-links');edges.setAttribute('aria-hidden','true');$('#sheet').prepend(edges);
  }
  function positionBlock(el){const p=state.positions[el.id];el.style.left=p.x+'px';el.style.top=p.y+'px';}
  function applyCamera(){for(const [viewport,world,c] of [[$('#board'),$('#sheet'),state.camera],[$('#sources'),$('#source-sheet'),state.sourceCamera]]){if(!world)continue;viewport.scrollTop=0;viewport.scrollLeft=0;world.style.transform=`translate(${c.x}px,${c.y}px) scale(${c.z})`;}$('#zoom-level').textContent=Math.round(surface().camera.z*100)+'%';}
  function setFollow(on){state.follow=on;$('#follow-writing').classList.toggle('active',on);$('#follow-writing').setAttribute('aria-pressed',String(on));$('#writing-location').hidden=on||!state.writing;}
  function focusBlock(id,animate=true){const el=document.getElementById(id);if(!el)return;const b=$('#board'),p=state.positions[id],z=window.innerWidth<=720?Math.min(1,(b.clientWidth-36)/el.offsetWidth):Math.min(1.05,(b.clientWidth-90)/el.offsetWidth,(b.clientHeight-105)/Math.min(el.offsetHeight,550));state.camera={z:Math.max(.45,z),x:0,y:0};state.camera.x=(b.clientWidth-el.offsetWidth*state.camera.z)/2-p.x*state.camera.z;state.camera.y=65-p.y*state.camera.z;if(animate)$('#sheet').classList.add('camera-moving');applyCamera();setTimeout(()=>$('#sheet').classList.remove('camera-moving'),330);}
  function fitCanvas(){const {viewport:b,world,camera}=surface(),blocks=$$('.canvas-block',world);if(!blocks.length)return;const left=Math.min(...blocks.map(e=>e.offsetLeft)),top=Math.min(...blocks.map(e=>e.offsetTop)),right=Math.max(...blocks.map(e=>e.offsetLeft+e.offsetWidth)),bottom=Math.max(...blocks.map(e=>e.offsetTop+e.offsetHeight));const z=Math.max(.18,Math.min(1,(b.clientWidth-70)/(right-left),(b.clientHeight-120)/(bottom-top)));Object.assign(camera,{z,x:(b.clientWidth-(right-left)*z)/2-left*z,y:75-top*z});applyCamera();}
  function zoomBy(factor){const {camera:c,viewport:b}=surface(),z=Math.max(.18,Math.min(1.8,c.z*factor)),x=b.clientWidth/2,y=b.clientHeight/2;c.x=x-(x-c.x)*z/c.z;c.y=y-(y-c.y)*z/c.z;c.z=z;setFollow(false);applyCamera();}
  function drawCanvasLinks(){const svg=$('.canvas-links');if(!svg)return;const pairs=state.example==='empty'?[]:[['question','mechanism','展开'],['mechanism',state.example==='math'?'boundary':'model',state.stage>0?'提炼联系':'继续追问'],[state.example==='math'?'boundary':'model','inquiry','待探究']];let minX=0,minY=0,maxX=1800,maxY=1600;const paths=[];for(const [a,b,label] of pairs){const x=document.getElementById(a),y=document.getElementById(b);if(!x||!y)continue;const right=y.offsetLeft>x.offsetLeft+x.offsetWidth-40;const sx=right?x.offsetLeft+x.offsetWidth:x.offsetLeft+x.offsetWidth/2,sy=right?x.offsetTop+Math.min(x.offsetHeight/2,110):x.offsetTop+x.offsetHeight,tx=right?y.offsetLeft:y.offsetLeft+y.offsetWidth/2,ty=right?y.offsetTop+Math.min(y.offsetHeight/2,110):y.offsetTop;minX=Math.min(minX,sx,tx)-1;minY=Math.min(minY,sy,ty)-1;maxX=Math.max(maxX,sx,tx)+1;maxY=Math.max(maxY,sy,ty)+1;paths.push(`<path d="M${sx},${sy} ${right?`C${sx+44},${sy} ${tx-44},${ty} ${tx},${ty}`:`C${sx},${sy+30} ${tx},${ty-30} ${tx},${ty}`}"/><text x="${(sx+tx)/2+7}" y="${(sy+ty)/2-7}">${label}</text>`);}svg.style.left=minX+'px';svg.style.top=minY+'px';svg.setAttribute('width',maxX-minX);svg.setAttribute('height',maxY-minY);svg.setAttribute('viewBox',`${minX} ${minY} ${maxX-minX} ${maxY-minY}`);svg.innerHTML=paths.join('');}
  function startBlockDrag(e,el){if(e.button!==0)return;e.preventDefault();e.stopPropagation();setFollow(false);const {world,camera}=surface();world.classList.remove('camera-moving');const handle=e.currentTarget,p={...state.positions[el.id]};handle.setPointerCapture(e.pointerId);el.classList.add('dragging');const move=ev=>{state.positions[el.id]={x:p.x+(ev.clientX-e.clientX)/camera.z,y:p.y+(ev.clientY-e.clientY)/camera.z,userMoved:true};positionBlock(el);drawCanvasLinks();drawEdges();};const end=()=>{el.classList.remove('dragging');handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);};handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);}
  async function streamBlock(id,version,previous){
    const el=document.getElementById(id);if(!el)return;
    state.writingTarget=id;el.classList.add('is-writing');el.style.minHeight=el.offsetHeight+'px';$('#working-label').textContent='正在板书 · '+el.dataset.title;
    if(state.follow&&state.face==='board')focusBlock(id);else $('#writing-location').hidden=false;
    const unchanged=new Map();if(previous){const oldWalker=document.createTreeWalker(previous,NodeFilter.SHOW_TEXT);let old;while(old=oldWalker.nextNode()){if(!old.parentElement.closest('button,svg,summary,details'))unchanged.set(old.textContent,(unchanged.get(old.textContent)||0)+1);}}
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const nodes=[];let n;while(n=walker.nextNode()){if(!n.textContent.trim()||n.parentElement.closest('button,svg,summary,details'))continue;const count=unchanged.get(n.textContent)||0;if(count){unchanged.set(n.textContent,count-1);continue;}nodes.push({node:n,text:n.textContent});}
    nodes.forEach(item=>item.node.textContent='');const caret=document.createElement('span');caret.className='stream-caret';caret.setAttribute('aria-hidden','true');
    for(const item of nodes){if(version!==state.streamVersion)return;item.node.after(caret);const chars=Array.from(item.text);for(let i=0;i<chars.length;i++){while(state.paused&&version===state.streamVersion)await new Promise(r=>setTimeout(r,60));if(version!==state.streamVersion)return;item.node.textContent+=chars[i];await new Promise(r=>setTimeout(r,42));}}
    caret.remove();el.classList.remove('is-writing');el.style.minHeight='';drawCanvasLinks();
  }
  async function advanceStreaming(){
    if(state.writing){state.paused=!state.paused;$('#advance').textContent=state.paused?'继续板书 →':'暂停板书';return;}
    if(state.stage>=2||state.example==='empty')return;
    state.stage++;const target=state.stage===1?'mechanism':state.example==='math'?'boundary':'model';
    const previous=new Map($$('.canvas-block',$('#sheet')).map(el=>[el.id,el.cloneNode(true)]));
    render();
    // Only the teacher's chosen region changes; all other blocks retain their DOM and position.
    for(const [id,old] of previous){if(id===target)continue;const el=document.getElementById(id);if(!el)continue;const savedContent=[...old.childNodes].filter(n=>!n.classList?.contains('block-grip'));const head=old.querySelector('.section-head');if(head)head.querySelector('.block-grip')?.remove();const currentHandle=el.querySelector('.block-grip');el.replaceChildren(...savedContent);const newHead=el.querySelector('.section-head');if(newHead)newHead.prepend(currentHandle);else el.prepend(currentHandle);}
    state.writing=true;state.paused=false;const version=++state.streamVersion;$('#advance').disabled=false;$('#advance').textContent='暂停板书';$('#export-open').disabled=true;$('#example').disabled=true;$('#restart').disabled=true;
    await streamBlock(target,version,previous.get(target));
    if(version!==state.streamVersion)return;state.writing=false;$('#advance').disabled=state.stage===2;$('#advance').textContent=state.stage===2?'已到演示末轮':'演示：局部修订 →';$('#export-open').disabled=false;$('#example').disabled=false;$('#restart').disabled=false;$('#working-label').textContent='本轮板书完成';$('#writing-location').hidden=true;renderMessages();drawCanvasLinks();
  }
  function renderSources(){
    const ids=sourceIds(),previous=$('#source-sheet'),same=previous?.dataset.example===state.example;
    const kept=new Map(same?$$('.source-card',previous).map(el=>[el.id,el]):[]);
    const colors=['blue','green','orange'];
    const uses={money:'从钱的重量，继续追问兑付与信用。',transport:'比较实物运输的成本、损耗与承担者。',salt:'讨论用特许收益组织运输的机制。',chord:'给出椭圆方程与中点条件。',difference:'从具体题目检验方法的适用边界。'};
    const card=(id,title,body,extra='')=>'<section class="canvas-block source-card '+extra+'" id="'+id+'" data-title="'+escape(title.replace(/<[^>]*>/g,''))+'"><div class="section-head"><h2>'+title+'</h2></div>'+body+'</section>';
    let content=card('source-intro','本课资料','<p class="source-hand-note">'+(ids.length?'用过哪些材料，怎样联系起来。':'还没有引用资料。先从一个问题开始。')+'</p><small class="source-kind">仅呈现本课引用 · '+ids.length+' 份</small>','source-intro');
    if(ids.length){
      content+=card('source-note','<mark class="ink-mark highlight-green">本课课堂笔记</mark>','<p class="source-hand-note">'+names[state.example]+'</p><button class="source-backlink" data-note>回到板书 ↗</button>','source-note');
      ids.forEach((id,i)=>{const m=materials[id];content+=card('source-'+id,'<mark class="ink-mark highlight-'+colors[i]+'">'+m.title+'</mark>','<small class="source-kind">'+m.kind+' · 演示材料</small><p class="source-hand-note">'+uses[id]+'</p><button class="source-backlink" data-source="'+id+'">打开资料 ↗</button>','source-material');});
    }
    if(ids.length>1){
      const math=state.example==='math';
      content+=card('source-relations',math?'让题目与方法互相检验':'围绕同一问题比较','<p class="source-hand-note">'+(math?'<mark class="ink-mark highlight-blue">中点弦问题</mark> ↔ <mark class="ink-mark highlight-orange">点差法的边界</mark>':'<mark class="ink-mark highlight-blue">交子与兑付</mark> ↔ <mark class="ink-mark highlight-orange">开中法与运输激励</mark>')+'</p><p class="source-hand-note">'+(math?'检查非竖直弦、不同端点与中点位置。':'谁运输，谁付成本，谁承担风险？<br><mark class="ink-mark highlight-pink">比较关系，不表示直接制度传承。</mark>')+'</p><button class="source-backlink" data-jump="'+(math?'boundary':'mechanism')+'">回到建立这次联系的板书 ↗</button>','source-relations');
    }
    const mount=document.createElement('div');mount.innerHTML='<article id="source-sheet" class="sheet canvas-world source-world" data-example="'+state.example+'"><svg class="source-lines" aria-hidden="true"></svg>'+content+'</article>';
    if(previous)previous.replaceWith(mount.firstElementChild);else $('#sources').prepend(mount.firstElementChild);
    const bases={'source-intro':[40,95,320],'source-note':[460,100,330],'source-relations':[380,670,560]};
    ids.forEach((id,i)=>bases['source-'+id]=[ids.length===1?460:ids.length===2?210+i*520:40+i*420,365,330]);
    $$('.source-card',$('#source-sheet')).forEach(fresh=>{
      const id=fresh.id;
      let el=fresh;
      if(kept.has(id)&&id!=='source-intro'){el=kept.get(id);fresh.replaceWith(el);}
      const base=bases[id];if(!state.positions[id]?.userMoved)state.positions[id]={x:base[0],y:base[1]};
      el.style.width=base[2]+'px';positionBlock(el);
      if(!$('.block-grip',el)){
        const handle=document.createElement('button');handle.className='block-grip';handle.innerHTML=grip;
        handle.setAttribute('aria-label','拖动资料：'+$('h2',el).textContent);handle.title='拖动调整位置；方向键微调';$('.section-head',el).prepend(handle);
        handle.addEventListener('pointerdown',e=>startBlockDrag(e,el));
        handle.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const p=state.positions[id],n=e.shiftKey?32:8;p.x+=e.key==='ArrowRight'?n:e.key==='ArrowLeft'?-n:0;p.y+=e.key==='ArrowDown'?n:e.key==='ArrowUp'?-n:0;p.userMoved=true;positionBlock(el);setFollow(false);drawEdges();});
      }
    });
    applyCamera();requestAnimationFrame(drawEdges);
  }
  function drawEdges(){
    const world=$('#source-sheet');if(!world)return;const svg=$('.source-lines',world),note=$('#source-note');if(!svg||!note)return;
    const cards=$$('.source-material',world),sx=note.offsetLeft+note.offsetWidth/2,sy=note.offsetTop+note.offsetHeight;
    const path=(d,extra='')=>'<path d="'+d+'" '+extra+'/>';
    let content='<defs><marker id="source-arrow" viewBox="0 0 12 12" refX="9" refY="6" markerWidth="8" markerHeight="8" orient="auto"><path d="M2 2 L9 6 L2 10" fill="none" stroke="#94aaa0" stroke-width="1.4"/></marker></defs>';
    cards.forEach(el=>{const x=el.offsetLeft+el.offsetWidth/2,y=el.offsetTop;
      content+=path('M'+sx+','+sy+' C'+sx+','+(sy+55)+' '+x+','+(y-55)+' '+x+','+y,'marker-end="url(#source-arrow)"');
      content+='<text x="'+(x+9)+'" y="'+(y-18)+'">本课引用</text>';
    });
    if(cards.length>1){
      const a=cards[0],b=cards[cards.length-1],x=a.offsetLeft+a.offsetWidth/2,tx=b.offsetLeft+b.offsetWidth/2,y=Math.max(a.offsetTop+a.offsetHeight,b.offsetTop+b.offsetHeight)+40;
      content+=path('M'+x+','+(a.offsetTop+a.offsetHeight)+' Q'+x+','+y+' '+(x+30)+','+y+' H'+(tx-30)+' Q'+tx+','+y+' '+tx+','+(b.offsetTop+b.offsetHeight),'class="source-comparison"');
      content+='<text x="'+((x+tx)/2)+'" y="'+(y+25)+'" text-anchor="middle">本课比较</text>';
    }
    svg.innerHTML=content;
  }
  function setFace(face){
    state.face=face;$('#classroom').dataset.face=face;
    $$('[data-face]', $('.face-tabs')).forEach(b=>{b.classList.toggle('active',b.dataset.face===face);b.setAttribute('aria-pressed',b.dataset.face===face);});
    $('#board').hidden=face==='sources';$('#sources').hidden=face!=='sources';
    const destination=face==='sources'?$('#sources'):$('#board');
    for(const node of [$('.canvas-tools'),$('#highlight-palette'),$('#writing-location')])destination.append(node);
    $('#follow-writing').hidden=face==='sources';
    $('#highlight-palette').hidden=true;$('#highlight-open').setAttribute('aria-expanded','false');
    applyCamera();
    if(face==='chat'&&window.innerWidth>720){state.focus=false;$('#classroom').classList.remove('focus');$('#focus').textContent='收起对话';$('#focus').setAttribute('aria-pressed','false');}
    requestAnimationFrame(drawEdges);
  }
  function jump(id){setFace('board');const el=document.getElementById(id);if(!el)return;setFollow(false);focusBlock(id);el.classList.remove('flash');requestAnimationFrame(()=>el.classList.add('flash'));}
  function showToast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>$('#toast').hidden=true,3500);}
  function setReference(title){state.reference=title;$('#reference-text').textContent=title;$('#reference').hidden=!title;if(window.innerWidth<=720)setFace('chat');else if(state.focus){state.focus=false;$('#classroom').classList.remove('focus');$('#focus').textContent='收起对话';$('#focus').setAttribute('aria-pressed','false');}$('#draft').focus();}
  function openSource(id){const m=materials[id];$('#source-content').innerHTML=`<header class="dialog-heading"><div><p class="eyebrow">${m.kind} · 本课引用</p><h2>${m.title}</h2></div><button class="icon-button" data-close aria-label="关闭资料">×</button></header><p class="source-meta">${commonMaterialNote}</p><div class="source-body">${escape(m.body)}</div><div class="source-actions"><button class="soft" data-locate="${m.section}">在板书中定位 ↗</button><a href="${materialRoot+encodeURIComponent(m.file)}" target="_blank" rel="noopener">打开示例 Markdown</a></div>`;$('#source-dialog').showModal();}
  const feedback={credit:'先追兑付：谁承诺、凭什么兑现、失约风险由谁承担。',logistics:'先追实物：粮食并未消失，继续拆运输者、路线与损耗。',unsure:'先用一个具体例子形成直觉，再判断问题卡在哪里。',vertical:'先观察竖直方向，再检查斜率是否有定义。',divide:'回到相除的那一步，逐项检查分母是否可能为零。'};
  function applyChoice(){const el=$('#choice-feedback');if(el)el.textContent=state.choice?feedback[state.choice]:'';$$('[data-choice]').forEach(b=>b.classList.toggle('selected',b.dataset.choice===state.choice));}
  function choose(key,label){state.choice=key;applyChoice();state.messages.push({who:'student',text:label},{who:'teacher',text:feedback[key]});renderMessages();$('#messages').scrollTop=$('#messages').scrollHeight;showToast('已改变接下来追问的方向');}
  function exportSheet(){
    const sheet=$('#sheet').cloneNode(true);
    sheet.className='sheet';sheet.removeAttribute('style');sheet.removeAttribute('id');
    $$('.canvas-links,.block-grip,.stream-caret',sheet).forEach(n=>n.remove());
    $$('.canvas-block',sheet).forEach(n=>{n.classList.remove('canvas-block','is-writing','dragging');n.removeAttribute('style');});
    if(!$('#include-attempts').checked)$$('[data-scope="attempt"]',sheet).forEach(n=>n.remove());
    if(!$('#include-reference').checked)$$('[data-scope="reference"]',sheet).forEach(n=>n.remove());
    $$('.ask,.choices,.choice-feedback,.page-end',sheet).forEach(n=>n.remove());
    $$('button[data-source]',sheet).forEach(b=>{const span=document.createElement('span');span.className='source-link';span.textContent=b.textContent;b.replaceWith(span);});
    $$('details',sheet).forEach(d=>d.removeAttribute('open'));
    const section=document.createElement('section');section.className='export-sources';section.innerHTML=`<h2>本课资料</h2><p>${commonMaterialNote} 本文件仅列出处与用途，不打包原资料。</p>${sourceIds().map(id=>`<p>${materials[id].title} — ${materials[id].kind}；来源文件：${materials[id].file}</p>`).join('')}`;sheet.append(section);return sheet;
  }
  function renderExport(){$('#export-preview').replaceChildren(exportSheet());}
  function markdownFor(root){
    function walk(n){if(n.nodeType===3)return n.textContent;if(n.nodeType!==1)return '';const tag=n.tagName.toLowerCase();if(tag==='mark'){const palette={blue:'#bddcf1',green:'#bfe4d3',orange:'#f4d1aa',pink:'#edbfd0'};const color=Object.keys(palette).find(c=>n.classList.contains('highlight-'+c))||'green';return `<mark style="background-color:${palette[color]}">${escape(n.textContent)}</mark>`;}if(tag==='svg')return `\n\n${n.outerHTML}\n\n`;const text=[...n.childNodes].map(walk).join('');if(/^h[1-6]$/.test(tag))return '\n\n'+'#'.repeat(+tag.slice(1))+' '+text.trim()+'\n\n';if(tag==='details')return `\n\n<details>\n${text.trim()}\n</details>\n\n`;if(tag==='summary')return `<summary>${text.trim()}</summary>\n\n`;if(tag==='br')return '\n';if(tag==='strong')return `**${text.trim()}**`;if(['p','div','section','header','figure'].includes(tag))return '\n\n'+text.trim()+'\n\n';return text;}
    return `<!-- Notara 白板交互设计稿；合成内容；非生产 Markdown 合同 -->\n\n${walk(root).replace(/\n{3,}/g,'\n\n').trim()}\n`;
  }
  async function download(format){
    const sheet=exportSheet();let body,type;
    if(format==='md'){body=markdownFor(sheet);type='text/markdown;charset=utf-8';}
    else{const css=await fetch('whiteboard-study.css').then(r=>{if(!r.ok)throw new Error('样式加载失败');return r.text();});body=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${names[state.example]} · 课堂笔记</title><style>${css}\nbody{padding:36px 20px}.sheet{padding:10px 20px;max-width:860px}.mechanism-row{grid-template-columns:30px 1fr 15px 1fr 15px 1fr}@media(max-width:600px){.math-layout{grid-template-columns:1fr}.sheet h1{font-size:24px}.mechanism-node strong{font-size:11px;white-space:normal}.sketch{width:35px;height:31px}.mechanism-node small{font-size:9px}.mechanism-row{gap:4px}.two-notes{gap:15px}} </style><body>${sheet.outerHTML}</body></html>`;type='text/html;charset=utf-8';}
    const url=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement('a');a.href=url;a.download=`Notara-${state.example}-课堂笔记.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);showToast('已生成所选范围的笔记文件');
  }
  document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.face)setFace(b.dataset.face);if(b.dataset.source)openSource(b.dataset.source);if(b.hasAttribute('data-note'))jump('mechanism');if(b.dataset.jump)jump(b.dataset.jump);if(b.dataset.ask){const section=document.getElementById(b.dataset.ask);setReference(section.dataset.title);}if(b.dataset.choice)choose(b.dataset.choice,b.textContent);if(b.hasAttribute('data-close'))b.closest('dialog').close();if(b.dataset.locate){b.closest('dialog').close();jump(b.dataset.locate);}if(b.hasAttribute('data-chat')){setFace('chat');$('#draft').focus();}});
  $('#example').addEventListener('change',()=>{state.example=$('#example').value;state.stage=0;state.positions={};state.messages=[];state.choice='';state.reference='';$('#reference').hidden=true;$('#draft').value='';setFace('board');render();initialCamera();});
  $('#restart').addEventListener('click',()=>{state.stage=0;state.positions={};state.choice='';state.messages=[];render();initialCamera();});
  $('#advance').addEventListener('click',advanceStreaming);
  $('#focus').addEventListener('click',()=>{state.focus=!state.focus;$('#classroom').classList.toggle('focus',state.focus);$('#focus').textContent=state.focus?'展开对话':'收起对话';$('#focus').setAttribute('aria-pressed',String(state.focus));});
  $('#reference-clear').addEventListener('click',()=>{state.reference='';$('#reference').hidden=true;});
  $('#composer').addEventListener('submit',e=>{e.preventDefault();const value=$('#draft').value.trim();if(!value)return;state.messages.push({who:'student',text:(state.reference?'〔'+state.reference+'〕\n':'')+value,demo:true});$('#draft').value='';state.reference='';$('#reference').hidden=true;renderMessages();$('#messages').scrollTop=$('#messages').scrollHeight;});
  $('#draft').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#composer').requestSubmit();}});
  $('#export-open').addEventListener('click',()=>{renderExport();$('#export-dialog').showModal();});
  ['#include-attempts','#include-reference'].forEach(s=>$(s).addEventListener('change',renderExport));
  ['md','html'].forEach(format=>$('#download-'+format).addEventListener('click',()=>download(format).catch(()=>showToast('导出失败，请重试'))));
  new ResizeObserver(drawEdges).observe($('.workspace'));
  $('#zoom-in').addEventListener('click',()=>zoomBy(1.2));$('#zoom-out').addEventListener('click',()=>zoomBy(1/1.2));$('#fit-canvas').addEventListener('click',()=>{setFollow(false);fitCanvas();});
  $('#follow-writing').addEventListener('click',()=>{setFollow(!state.follow);if(state.follow)focusBlock(state.writingTarget||'mechanism');});
  $('#writing-location').addEventListener('click',()=>{setFace('board');setFollow(true);focusBlock(state.writingTarget);});
  let highlightRange=null;
  document.addEventListener('selectionchange',()=>{const selection=getSelection();if(!selection?.rangeCount||selection.isCollapsed)return;const range=selection.getRangeAt(0),start=range.startContainer.parentElement?.closest('.canvas-block'),end=range.endContainer.parentElement?.closest('.canvas-block');if(start&&start===end&&!range.startContainer.parentElement?.closest('button,svg'))highlightRange=range.cloneRange();});
  $('#highlight-open').addEventListener('click',()=>{const hidden=!$('#highlight-palette').hidden;$('#highlight-palette').hidden=hidden;$('#highlight-open').setAttribute('aria-expanded',String(!hidden));});
  $('#highlight-palette').addEventListener('pointerdown',e=>e.preventDefault());
  $('#highlight-palette').addEventListener('click',e=>{
    const color=e.target.closest('[data-highlight]')?.dataset.highlight;if(!color)return;
    if(state.writing){showToast('等这一处写完后，再修改高亮');return;}
    if(!highlightRange||highlightRange.collapsed||!surface().world.contains(highlightRange.commonAncestorContainer)){showToast('先选中画布中的一段文字');return;}
    const range=highlightRange,parentMark=range.commonAncestorContainer.parentElement?.closest('mark');
    if(color==='clear'){
      const marks=$$('mark',surface().world).filter(mark=>range.intersectsNode(mark));marks.forEach(mark=>mark.replaceWith(...mark.childNodes));
    }else if(parentMark){parentMark.className='ink-mark highlight-'+color;}
    else{const fragment=range.extractContents();$$('mark',fragment).forEach(mark=>mark.replaceWith(...mark.childNodes));const mark=document.createElement('mark');mark.className='ink-mark highlight-'+color;mark.append(fragment);range.insertNode(mark);}
    getSelection()?.removeAllRanges();highlightRange=null;showToast(color==='clear'?'已清除选中内容的高亮':'已更新高亮颜色');
  });
  for(const viewport of [$('#board'),$('#sources')]){
    viewport.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button,a,textarea,.canvas-block,.highlight-palette,.canvas-tools'))return;e.preventDefault();setFollow(false);const {world,camera}=surface();world.classList.remove('camera-moving');const b=viewport,c={...camera};b.setPointerCapture(e.pointerId);b.classList.add('panning');const move=ev=>{camera.x=c.x+ev.clientX-e.clientX;camera.y=c.y+ev.clientY-e.clientY;applyCamera();};const end=()=>{b.classList.remove('panning');b.removeEventListener('pointermove',move);b.removeEventListener('pointerup',end);b.removeEventListener('pointercancel',end);};b.addEventListener('pointermove',move);b.addEventListener('pointerup',end);b.addEventListener('pointercancel',end);});
    viewport.addEventListener('wheel',e=>{if(e.target.closest('.canvas-tools,.highlight-palette'))return;e.preventDefault();setFollow(false);const {camera}=surface();if(e.ctrlKey||e.metaKey)zoomBy(Math.exp(-e.deltaY*.007));else{camera.x-=e.deltaX;camera.y-=e.deltaY;applyCamera();}},{passive:false});
  }
  $('#sheet').addEventListener('toggle',()=>drawCanvasLinks(),true);
  function initialCamera(){setFollow(true);const width=$('.workspace').clientWidth;state.sourceCamera={z:Math.min(.82,Math.max(.5,(width-60)/1250)),x:10,y:23};if(window.innerWidth<=720){state.sourceCamera=sourceIds().length?{z:.8,x:(width-330*.8)/2-460*.8,y:-10}:{z:.8,x:10,y:20};focusBlock('question',false);}else{state.camera={z:Math.min(.84,Math.max(.55,(width-60)/1160)),x:10,y:23};applyCamera();}}
  render();
  initialCamera();
})();
