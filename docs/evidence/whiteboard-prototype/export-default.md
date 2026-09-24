# 中点弦与点差法

<!-- wb:problem:question -->
## 从中点，找到斜率

椭圆 $x²/4 + y²/3 = 1$ 上，弦 AB 的中点是 $M(1, ½)$。求直线 AB 的斜率。

来源：[中点弦的斜率](#source-c-midchord)

**先想一想：** 已知的是两个端点各自的坐标，还是它们之间的关系？

<!-- wb:picture:diagram -->
## 把条件放回图中

<figure class="wb-figure"><svg viewBox="0 0 320 235" role="img" aria-label="椭圆 x²/4+y²/3=1 与过 M(1,½) 的弦 AB"><path d="M25 126H296M153 219V20" fill="none" stroke="currentColor" opacity=".25"/><text x="290" y="142" fill="currentColor" font-size="11">x</text><text x="161" y="24" fill="currentColor" font-size="11">y</text><ellipse cx="153" cy="126" rx="104" ry="90" fill="none" stroke="currentColor" opacity=".5" stroke-width="1.5"/><path d="M162.66 36.49 239.34 151.51" stroke="currentColor" stroke-width="2" fill="none"/><path d="M205 126V100M153 100H205" stroke="currentColor" stroke-dasharray="3 4" opacity=".3" fill="none"/><g fill="currentColor"><circle cx="162.66" cy="36.49" r="3"/><circle cx="239.34" cy="151.51" r="3"/><circle cx="205" cy="100" r="4"/><text x="171" y="36" font-size="12">A</text><text x="249" y="156" font-size="12">B</text><text x="215" y="95" font-size="12">M(1, ½)</text><text x="138" y="143" font-size="11">O</text></g></svg><figcaption>同一条弦：几何条件与代数关系</figcaption></figure>

M 是弦的中点；我们需要的是弦的方向。

[圆锥曲线 · 点差法](#source-k-conic)

<!-- wb:structure:model -->
## 共同建立的联系

**两点在同一曲线上 → 两式相减 → 和与差**

$x₁ + x₂ = 2x₀$，$y₁ + y₂ = 2y₀$：和，连接中点。

$(y₁ − y₂)/(x₁ − x₂) = k$：差的比，连接斜率（先检查分母）。

从“求出两个端点”转向“保留我们需要的关系”。

对照：[中点弦问题](#source-t-chord) · [二次式相减会暴露线性关系](#source-i-diff)

<!-- wb:inquiry:inquiry -->
## 如果中点落在 x 轴上呢？

仍是这条椭圆，改成 $M(1, 0)$。你觉得“差的比”还能直接计算吗？

可以先选一个判断，再说说理由；暂时不确定也没关系。


## 资料出处

<a id="source-c-midchord"></a>

- 中点弦的斜率（知识卡片）

<a id="source-k-conic"></a>

- 圆锥曲线 · 点差法（页面）

<a id="source-t-chord"></a>

- 中点弦问题（教学专题）

<a id="source-i-diff"></a>

- 二次式相减会暴露线性关系（锦囊）

---
Notara 交互原型 · 合成课堂示例
