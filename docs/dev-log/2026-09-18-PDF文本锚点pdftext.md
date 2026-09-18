# PDF 文本锚点（kind:'pdftext'）与派生物件写回

## 目标

让 AI 在有文字层的 PDF 上也能字节级精确摘录（此前只能页级指路+人拖框），并让搜索命中返回真实文本锚点；顺带把学生要留存的整理物（导读/简报/错题集）写回为可版本化资料。

## 实际改动

### 合同

- `packages/contracts/src/materials.ts` `PdftextLocatorSchema`：`{kind:'pdftext', page, start?, end?}`，`start`/`end` 为页文本层 UTF-16 偏移（换行连接，与 read_material 返回同一字符串），必须同给或同不给；不给时由 `SourceAnchor.quote` 在页内唯一定位。

### 域

- `read-material.ts` `readMaterial`：PDF 分支接受 `pdftext`——只取 `getTextContent` 不渲染光栅；无文字层抛 `source_text_layer_missing`，越界页 `source_page_out_of_range`，kind 不符 `locator_format_mismatch`，显式 span 越界 `source_offset_out_of_range`；无 span 返回整页文本。
- `read-material.ts` `resolveAnchor`：span-less pdftext 由 quote 解析——零次 `source_quote_mismatch`、多次 `source_quote_ambiguous`、无 quote `source_locator_incomplete`；span+quote 要求逐字相等；返回规范化为具体 span 的锚点。
- `card-service.ts` `assertSources`：改为返回规范化 `SourceAnchor[]`——落库锚点携带 reader 解析出的规范 locator（quote-only pdftext 落成具体 start/end，quote 字段保留展示）；`check`/`prepare` 均替换为规范化源，读面（remote `studyforgeMaterials/read` 的 `MaterialContext` 无 quote 字段）无需改动。
- `learning-search.ts` `pdfText`：页文本改为 `'\n'` 拼接（与 read-material 同一字符串，且消除跨 item 假命中）；`refine` 将 `{kind:'pdf',page}` 段命中窄化为 `{kind:'pdftext',page,start,end}` 字节级锚点；`fieldOfSegment` 认 pdftext。

### 客户端

- `SourceCapture.tsx`：标注层过滤认 `pdftext`——无矩形可画，渲染为「指路」角标（卡身带精确摘录）；locator 揭示分支对 `pdftext` 早退（页已翻开，无框可画）。
- `MaterialPreview.tsx`：`revealPage` 认 `pdftext.page`。
- `SourcePane`/`CardDetail`/`MaterialOutline`/`MaterialsPage`/`lesson-materials-mindmap`/`courses/format`/`tool-copy`/`skeleton-service`/`lesson-resource-projection`/`output-projection`：补 `pdftext` 的 label/key/排序分支。

### 提示词与工具描述

- `guided-learning.md`：PDF 摘录规则——有文字层先 `read_material` 读页文本再 `{kind:'pdftext',page}`+quote 精确摘录；扫描件退回页级指路；永不猜 rect。派生物件写回规则——学生要留存的导读/简报/错题集用 `create(method=material)` 写 Markdown 资料，references 挂真实固定版本。
- `propose_card`/`read_material` 工具描述同步 pdftext 语义。

## 验证

- `npm run typecheck`、`tsx scripts/build.ts`：PASS
- `tests/integration/pdftext-anchor.test.ts`：3/3（显式 span+Unicode、quote 唯一定位、歧义/不匹配/缺 quote/无文字层/格式错/页越界/既有 pdf 锚点兼容）
- `tests/integration/search-sources.test.ts`：6/6（PDF 命中断言更新为 `pdftext` 字节级锚点）
- 回归：`card-content-v2` 12/12、`card-batch-confirmation` 2/2、`card-change-scope` 7/7、`book-breakdown-quotes` 1/1、`chapter-deriver` 11/11、`global-learning-search` 4/4、`material-read-region`/`material-native`/`native-source-context`/`search-sources` 25/25、`atlas` 13/13
- `tests/e2e/pdf-annotations.spec.ts`：1/1——文字层 PDF 上 rpc 预置 `pdftext` 卡（显式 span 与 quote-only 两种，后者断言落库为 `{start:0,end:17}`）、`studyforgeMaterials/read` 返回 `'alpha'`、第 1/2 页各显「指路」角标、控制台零错误；连续两轮通过
- `tests/e2e/source-only-study.spec.ts`：1/1
- live：未运行

## 排障记录

- e2e 曾一次出现 guides:0：探针证实 canvas 几何戳记完好、SourceCapture 挂载正常；下一轮同码复跑通过，判定为隔离实例时序抖动而非逻辑缺陷。过滤与依赖经逐一核实无误（标注层 effect 依赖 `[cards, version, data]` 本就覆盖卡清单到达）。
- remote `studyforgeMaterials/read` 的 `source` 是 `MaterialContext`（无 quote）：SourceExcerpt 保持剥 quote 传参；quote-only 锚点的可读性由写入时规范化解决，不改 remote schema。

## 未完成项与下一入口

- 学生侧 PDF 文本层选层（拖选文字直接产 `pdftext` 锚点）：需要 PdfViewer 挂 textLayer 渲染，本轮只做锚点与 AI 通路。
- `source-relations.ts` 未加 `pdftext/pdftext` 区间运算：当前 `unrefinedRanges` 的 whole 只会是 pdf 页级，无调用方，需要时再加。
- PTC 多角色教学回合：仍待 delegate/agent 编排面调研后定设计。
- 全文检索前端入口：`find` 已能返回 `pdftext` 命中锚点，UI 侧结果→原文跳转沿用既有 source 导航，未单独做界面。
