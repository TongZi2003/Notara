# 工具渐进披露 · 2026-09-13

| 检查 | 结果 | 证据 |
|---|---|---|
| 正式构建/测试类型 | PASS | `logs/tool-disclosure-build-final.log`、`tool-disclosure-types-final.log` |
| 单元 | 12 PASS | `logs/tool-disclosure-unit-final.log` |
| 8初始接口→加载路线后10接口→重启保留→新课重置 | PASS | `logs/tool-disclosure-integration-final.log` |
| 显式加载全部49个课堂可用接口，逐个检查schema | PASS | 同上；含诊断专用register_cards，write/edit不在课堂目录 |
| 确认回执、教法切换、专用角色、后台管理 | 17个不同集成场景最终PASS | `tool-disclosure-integration-final.log`中16 PASS/1 FAIL；该失败及完整5委派场景在`tool-disclosure-background-final.log`恢复PASS，不累加重复用例 |
| 浏览器 | 4 PASS | `logs/tool-disclosure-ui.log`；隔离截图`screenshots/tool-details-mobile.png` |
| 自然语言实模排课 | BLOCKED | `logs/tool-disclosure-live.log`：标准隔离实模环境缺DEEPSEEK_API_KEY，未发模型请求 |
| 64004插件/模块更新 | PASS | `logs/tool-disclosure-deploy.log`、`tool-disclosure-refresh.log` |

失败轨迹保留：

- `tool-disclosure-types.log`：测试对事件JSON使用过强类型断言；改成经过可选字段检查的surface列表后通过。
- `tool-disclosure-background.log`：课程列表中未找到后台child。
- `tool-disclosure-background-retry.log`：沿真实工具回执确认是`delegation_background_unavailable`，根因是`schemas(parent.ctx)`漏掉agent-local回话工具。
- `tool-disclosure-integration-final.log`：修为`schemas(parent)`后，后台启动和追问已成功；最后的失败是脚本模型未识别agent来源消息中的测试指令。
- `tool-disclosure-background-final.log`：修正测试消息识别，5个委派场景全部PASS，包括追问、停止和子任务加载老师工具被拒。

schema JSON体积为初始7,437 bytes、显式加载全量76,868 bytes、路线读取/提案加载后16,437 bytes。此数字不包含目录、教法、会话历史，也不是token或选用准确率指标。全套自动化使用空白隔离runtime及testModel；截图仅含fixture，实际课堂没有收到测试消息。

本轮运行日志只规范末尾空白，原始文件保留在忽略的`.runtime/`。实现边界见[运行机制](../../runtime/tool-disclosure.md)；全部功能见[Skill/Tool清单](../../runtime/skills-and-tools.md)。
