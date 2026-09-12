# 提案保存后续话回归证据（2026-09-12）

| 检查 | 结果 | 命令 / 原始日志（R/dsh，相对路径） |
|---|---|---|
| 修复前复现 | FAIL：回执请求 tools 为空 | `.runtime/receipt-tools-before.log` |
| 正式构建 | PASS | `npm run build`；`.runtime/receipt-tools-build.log` |
| 测试类型检查 | PASS | `npm run typecheck:tests`；`.runtime/receipt-tools-types.log` |
| 原生确认、帮手隔离、动态教学 | 首次7 PASS/1 FAIL | `npm run test:integration -- tests/integration/native-confirmation.test.ts tests/integration/native-delegation.test.ts tests/integration/teaching-current.test.ts`；`.runtime/receipt-tools-integration.log` |
| 保存后实际读取结果 | 修正测试嵌套解析后1 PASS/2未选，8个不同集成测试最终通过 | `npm run test:integration -- tests/integration/teaching-current.test.ts -t 'saved-result followup'`；`.runtime/receipt-tools-readback.log` |
| 确认编辑、拒绝、保存一次及状态文案 | 2 PASS | `npm run test:e2e -- tests/e2e/confirmation-editor.spec.ts --output=.runtime/receipt-confirmation-ui`；`.runtime/receipt-confirmation-ui.log` |
| 64004真实页面只读复核 | PASS：已连接、提案记录、已保存第1版目录、4节可展开 | `trial-update.json`；下述运行态记录 |
| 修复后真实模型续话 | 未运行 | 不代发用户消息，不重复保存，不修改原始对话 |

首轮集成失败：测试只提取顶层 text，漏掉原生 ToolResultBlock.content；改为按 read_lesson 的 toolCallId 关联结果，并断言同一 sessionId 和 lessonMaterials，定向恢复通过。没有通过删掉行为断言消除失败。

试用实际目录为“题型一：和差公式、题型二：二倍角及降幂公式、课堂总结、练习”；提案已全部保存。浏览器仍停留原课程对话，保留了之前的异常正文。

首次模块刷新 `.runtime/receipt-deploy.log` 超时，原因是临时插件未用原生 insert 语法；修正后 `.runtime/receipt-deploy-recovery.log` 返回真实模块路径和三个ACTIVE入口。临时插件已移除，无新增认证例外，未读 provider 密钥、未重启服务或删除课堂目录。

`proposal-confirmed.png` 来自隔离浏览器测试，仅含测试题卡。
