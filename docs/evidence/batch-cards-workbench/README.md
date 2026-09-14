# 批量确认与工作台层级验证

2026-09-14，基于 `6fa7e9e` 后的本次改动。隔离DSH真实进程与文件存储、脚本模型；没有冒充真实模型教学质量证据。

| 检查 | 结果 |
|---|---|
| build / typecheck:tests | PASS |
| 84同源schema | PASS |
| mindmap-projection / lesson-deck / book-task | 19 PASS |
| card-batch-confirmation / native-confirmation / confirmation-v2 / tool-schema-projection / classroom-trace | 16 PASS |
| card-batch-confirmation.spec / workbench-hierarchy.spec | 2 PASS |
| 58354现场：一书一树、收起无顶层题卡、各页引用独立 | PASS |
| 真实模型自动选择批量参数 | 未运行 |

`batch-checklist.png`、`batch-mobile.png` 为清单及窄屏；`collapsed-chapter.png` 为父章收起时卡片隐藏。测试输入里的 `[tool]` JSON 是隔离脚本模型夹具，不是产品生成的学生话术。

日志含初次失败与最终通过。初次失败定位到夹具字段/断言及既有恢复边界错误；实际修复说明在本轮dev-log。没有修改依赖、学习数据或原生session生命周期。
