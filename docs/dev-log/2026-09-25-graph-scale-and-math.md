# 大图渐进展开与公式渲染

## 目标

处理大型 Vault 导入后图谱卡顿、标签筛选列表失控，以及 Markdown 公式在链接文本和化学方程式中的渲染缺口。

## 实际改动

- `graph.js / collapseVaultGraph`：按 `split` 层级投影可见图；大图默认显示根节点，点击有子节点的节点逐层展开。图谱工具栏提供“展开全部”和“按层级展开”，引用边只保留当前可见两端。
- `canvas-client.js / Board`：小图继续使用动态力布局；大图的折叠投影保持动态布局，完整图显式打开时允许强制完整力布局；未进入逐级展开的超大图仍有静态布局兜底。节点的右键与 Control+点击都在节点指针事件和 `contextmenu` 两层接入并去重。
- `views-client.js / CardsView、GraphView`：标签默认限制在约两行，可搜索、在面板内滚动、通过原生纵向 resize 手柄拖大，或显式扩大面板；图谱标签组的成员预览限制为40项。图谱轮询由2.5秒放宽为10秒，并使用轻量签名避免重复深序列化。
- `math-latex.js / mathLabelParts`：统一拆分 `$…$`、`$$…$$`、多行显示公式和转义美元；接入 KaTeX `mhchem`，支持 `\ce{...}` 化学方程式。
- `live-preview.js / MarkdownLinkWidget、WikiLinkWidget`：链接标签内的公式也走同一 KaTeX 渲染路径；卡片摘要同步支持两种美元公式。

## 验证

- 相关 Node 测试：60/60 PASS。
- `npm run build:native-vault`：PASS。
- `tests/e2e/native-vault-minimal.spec.ts`：1/1 PASS。
- `tests/e2e/native-vault-views.spec.ts`：未通过；现有脚本仍按旧的课堂分页流程进入，当前 Vault 导航已先落在资料库，需另行迁移该旧回归流程。

## 未完成

- “展开全部”在极端规模下仍可能触发完整力布局；需要后续用真实超大 Vault 测量并决定是否换成分层/空间索引布局。
