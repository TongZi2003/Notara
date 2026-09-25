# 受控白板互动块

## 目标

在 Native Vault 课堂白板中接入第一版受控互动块。互动内容由老师工具登记，白板 Markdown 只保存引用；第一版 provider 为 `math/parabola`，不执行任意 HTML、脚本、iframe 或外部链接。

## 实际改动

- `examples/native-vault/interactive-data.js` 定义 `math/parabola` 场景合同，引用 revision 使用 Native Vault 的 24 位内容哈希格式，并拒绝未登记 provider、脚本、HTML 和越界参数。
- `examples/native-vault/agent-io.js` 增加严格的 `readJson` / `saveJson`，复用现有资料根、写权限、符号链接检查和 CAS；互动文档保存到 `lesson-interaction/<session hash>/<interaction id>.json`。
- `examples/native-vault/interactive-runtime.js` 在读取互动文档时重新生成并校验 `ref`，避免 Remote 投影收到空的 `interactive` 引用。
- `examples/native-vault/board-client.js` 和 `board-client.css` 渲染手绘风格的抛物线互动块；展开层使用独立点击层，收起时先冲刷尚未落盘的参数，避免调参后立即关闭丢失最后一次变化。
- `examples/native-vault/interactive-math-client.js` 支持调整开口参数、拖动顶点、记录观察、展开/收起和带入对话。
- Native Vault 版本提升为 `0.16.18`，互动运行时加入 package files，重新生成 `examples/native-vault/client.js`。

## 验证

- Focused Native Vault 单测：35/35 PASS。
- 真实浏览器 `tests/e2e/native-vault-minimal.spec.ts`：2/2 PASS，覆盖资料/图谱回归以及真实模型工具调用、一次审批、互动文档落盘、白板显示、展开、调参、收起和带入对话。
- `npm run build:native-vault`：PASS，client bundle `5710771` bytes。
- `npm run typecheck:tests`：PASS。
- `npm pack --dry-run ./examples/native-vault`：PASS，`@notara/vault-native@0.16.18`，互动三个运行时文件和构建产物均在包内。
- `git diff --check`：PASS。

## 未完成

- 本轮只实现 `math/parabola`，一般圆锥曲线和几何作图仍待后续 provider 扩展。
- 未运行真实外部模型教学质量验收；当前 E2E 使用隔离的 Vault 测试模型验证 Host、Remote、持久化和浏览器接线。
- 工作树中已有的现代主题、资料页、图谱、LaTeX 和其他用户修改保留，未在本轮清理。
