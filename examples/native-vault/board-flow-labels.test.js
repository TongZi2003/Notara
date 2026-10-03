import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlow, layoutFlow, renderFlowSvg } from './board-flow.js';

const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
function assertLabelsReadable(layout) {
  const labels = layout.edges.filter(edge => edge.label);
  for (const edge of labels) {
    assert.equal(edge.labelLines.join(''), edge.label.replace(/\n/g, ''), 'wrapping never deletes label characters');
    const box = edge.labelBox;
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= layout.width && box.y + box.h <= layout.height, 'the complete label is inside the SVG frame');
    for (const node of layout.nodes) assert.equal(intersects(box, node), false, `${edge.from}→${edge.to} label overlaps ${node.id}`);
    for (const other of labels) if (edge !== other) assert.equal(intersects(box, other.labelBox), false, 'labels occupy separate lanes');
  }
}

for (const direction of ['right', 'down']) test(`long Chinese labels own enough room in ${direction} flow diagrams`, () => {
  const short = layoutFlow(parseFlow(`direction ${direction}\nA[甲] -- 研磨 --> B[乙]`));
  const spec = parseFlow(`direction ${direction}\nA[甲] -- 使用预冷缓冲液研磨样本并离心过滤 --> B[乙]`);
  const layout = layoutFlow(spec);
  assertLabelsReadable(layout);
  assert.ok(layout.edges[0].labelLines.length > 1, 'long labels wrap instead of widening over the nodes');
  assert.ok(direction === 'right' ? layout.width > short.width : layout.height > short.height, 'the arrow gap follows the rendered label');
  assert.deepEqual(layoutFlow(spec), layout, 'layout stays deterministic');
});

test('branch labels with the same geometric midpoint are separated without moving nodes onto them', () => {
  for (const direction of ['right', 'down']) {
    const spec = parseFlow(`direction ${direction}\nA[起点] -- 经过第一次充分研磨过滤取上清液 --> B[中间一]\nA -- 经过第二次充分研磨过滤取上清液 --> C[中间二]\nB -- 左支路验证所得结果后再汇总 --> D[终点]\nC -- 右支路验证所得结果后再汇总 --> D`);
    assertLabelsReadable(layoutFlow(spec));
  }
});

test('skipped ranks, reverse relations and a self-loop keep full labels inside the exported frame', () => {
  for (const direction of ['right', 'down']) {
    const spec = parseFlow(`direction ${direction}\nA[甲] --> B[乙] --> C[丙]\nA -- 直接比较起点和终点并检查条件 --> C\nC -. 验证不通过时回到起点重新取样 .-> A\nB -- 未满足条件时重新检查当前步骤 --> B`);
    assertLabelsReadable(layoutFlow(spec));
  }
});

test('multi-line and mathematical text remain escaped plain SVG in page and export', () => {
  const spec = parseFlow('A[溶液] -- 加入 $NaCl$ 与 $\\nu=1$ --> B[产物]');
  spec.edges[0].label = '第一行\n$\\nu=1$ 与 x<y\n第二行';
  const layout = layoutFlow(spec);
  assertLabelsReadable(layout);
  const svg = renderFlowSvg(layout, { id: 'safe-export' });
  assert.equal((svg.match(/<tspan /g) ?? []).length, layout.edges[0].labelLines.length);
  assert.match(svg, /\$\\nu=1\$/);
  assert.match(svg, /x&lt;y/);
  assert.match(svg, /marker-end="url\(#safe-export-arrow\)"/);
  assert.doesNotMatch(svg, /foreignObject|<script/);
  assert.equal(spec.edges[0].label, '第一行\n$\\nu=1$ 与 x<y\n第二行', 'layout does not mutate source content');
});

test('the complete extraction process retains all node names and edge labels', () => {
  const spec = parseFlow('direction right\nA[取材与破碎细胞] -- 加入预冷缓冲液后充分研磨并过滤 --> B[溶解与去除杂质]\nB -- 去除蛋白质及残余杂质并离心取上清 --> C[析出粗提取物]\nC -- 加入预冷乙醇并静置后收集析出物 --> D[鉴定]\nD -- 与标准样品对照后确认鉴定结果 --> E[完成]');
  const layout = layoutFlow(spec);
  assertLabelsReadable(layout);
  const svg = renderFlowSvg(layout);
  for (const node of spec.nodes) assert.ok(svg.includes(node.text));
  assert.equal((svg.match(/<text class="nb-flow-label"/g) ?? []).length, spec.edges.length);
});

test('return labels stay outside wide normal labels in a narrow two-node chain', () => {
  for (const direction of ['right', 'down']) {
    const spec = parseFlow(`direction ${direction}\nA[甲] -- 使用预冷缓冲液研磨样本并离心过滤 --> B[乙]\nB -- 回来 --> A`);
    assertLabelsReadable(layoutFlow(spec));
    spec.edges.push({from:'A',to:'B',dashed:false,label:'第二次预冷研磨取样后过滤再离心'});
    spec.edges.push({from:'B',to:'A',dashed:true,label:'重新充分研磨并去除残余杂质'});
    spec.edges.push({from:'B',to:'B',dashed:false,label:'重新核对本步骤'});
    assertLabelsReadable(layoutFlow(spec));
  }
});

test('bounded seeded graphs keep finite coordinates and disjoint labels in both directions', () => {
  let seed = 487;
  const next = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let sample = 0; sample < 1500; sample++) {
    const count = 2 + next(9);
    const nodes = Array.from({length:count}, (_,index)=>({id:`N${index}`,text:'步骤'.repeat(1+next(5)),shape:['box','question','decision'][next(3)],blank:false}));
    const edges = Array.from({length:1+next(29)},()=>({from:`N${next(count)}`,to:`N${next(count)}`,dashed:!!next(2),...(next(4)?{label:'使用预冷缓冲液研磨过滤并充分离心'.slice(0,2+next(15))}:{})}));
    for (const direction of ['right','down']) {
      const layout=layoutFlow({direction,nodes,edges});
      assert.ok(Number.isFinite(layout.width) && Number.isFinite(layout.height) && layout.width > 0 && layout.height > 0, `${sample}/${direction}: finite positive frame`);
      for (const node of layout.nodes) for (const name of ['x','y','w','h']) assert.ok(Number.isFinite(node[name]), `${sample}/${direction}: finite ${name}`);
      for (const edge of layout.edges) {
        assert.ok(edge.labelAt.every(Number.isFinite));
        assert.doesNotMatch(edge.d,/NaN|Infinity/);
      }
      try { assertLabelsReadable(layout); }
      catch (error) { error.message = `seed487 sample${sample}/${direction}: ${error.message}`; throw error; }
    }
  }
});
