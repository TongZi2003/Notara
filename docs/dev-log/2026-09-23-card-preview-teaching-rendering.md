# 卡片列表公式与教法页深色主题

## 版本与范围

用户提供学弟截图：卡片列表直接显示 `$...$`、`$$...$$`，教法编辑区和选中项在深色模式下浅底浅字。通过“普通卡／知识”“按标题找”“诊断与路线引导”等实际文案，定位到保留的 DSH/StudyForge 工作台，不是独立 Native Vault 视图。

工作树：`/Users/yangrundong/.codex/worktrees/notara-vault-clean/DSH`，分支 `codex/notara-vault-clean`，修改基于 `77ffe9b`。三个修改的产品文件在该 HEAD 与本机 main 上相同。截图本身不能确定学弟安装的具体提交或发行包。

没有改 `/Users/yangrundong/DSH` main checkout，没有更新现有服务或学弟安装，没有推送、提交或修改原有 persona、Native Vault 版本与宣发稿。只读子代理的线路返回502，未提供调查或改动结果；本轮定位、实现与核验由主 Agent 完成。

## 根因与修改

- `packages/client/src/cards/CardBrowser.tsx` / `CardRow`：原来用 `clip(front, 180)` 直接输出文本。改为完整题面先经既有 `MarkdownBody` / 原生 MarkdownText（KaTeX）渲染，再由 CSS 限制预览高度，避免截断 LaTeX 定界符与表达式。原始卡片内容不变。
- `packages/client/src/shell/linear-tree.css` / 卡片预览：容纳块级公式、限制长公式横向溢出；预览和标题按钮分开，避免将 Markdown 的链接、代码按钮嵌进按钮。预览为 inert，标题按钮的点击区域覆盖题面摘要，“开始学”仍为独立操作。
- `packages/client/src/teaching/teaching.css`：编辑器、内置原文、选中项、说明文字与边框改用现有 `--nb-*` 主题变量。原来正文颜色跟随深色主题，背景却固定为浅纸色；修复前实际文字对比度约1.14:1。

## 验证

使用 Node v24.13.0。所有浏览器运行通过 `scripts/dev-isolated.ts` 的 `startIsolated`，每例使用临时 `studyforge-dsh-*` 数据根与随机端口，结束后停止并清理；只使用合成题卡和教法草稿，不调用真实模型或修改真实学习数据。

- 修复前复现：新增浏览器用例确认卡片预览 `.katex` 数量为0；教法现代深色模式对比度为1.14:1。最初长公式测试材料只有154字符，先修正材料长度，再得到预期的产品失败，不把测试前提错误算产品复现。
- PASS：`npm run build`（基线）；修改后 `npm run build -- --client-only`。
- PASS：`npm run typecheck:tests`。
- PASS：`npm run test:e2e -- tests/e2e/card-preview-teaching-rendering.spec.ts tests/e2e/teaching-page.spec.ts`，3/3，43.3秒。覆盖行内与块级公式、超过180字符的完整表达式、390px窄屏、浏览前后卡片内容一致、两套主题各自的明暗模式、正文和选中项对比度至少4.5:1、切换配色保留草稿、保存教法、对照原文和恢复默认。捕获的浏览器异常/console error为空。
- PASS：主 Agent 查看公式预览、现代深色与手帐浅色截图。
- 真实学生电脑、真实模型教学与发布安装：未运行，不属于此次隔离 UI 验证。

## 证据与下一入口

截图位于 `docs/evidence/card-preview-teaching-rendering/`：`before-teaching-dark.png`、`card-preview-math.png`、`teaching-modern-dark.png`、`teaching-modern-light.png`、`teaching-notebook-dark.png`、`teaching-notebook-light.png`。

本次修复针对学弟截图中的旧工作台；要让其实际生效，需要明确学弟的安装来源后更新对应版本。独立 Native Vault 当前页面不是这两张截图中的页面，不能用本次旧工作台验收代替其验收。
