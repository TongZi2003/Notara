# 双主题验收

2026-09-14。隔离真实DSH进程、真实浏览器，脚本模型只提供示例内容。58354另做现场主题切换与首页目检。

| 检查 | 最终结果 |
|---|---|
| build / tests typecheck | PASS |
| appearance.test.ts 偏好迁移 | 2 PASS |
| two-themes.spec.ts | 3 PASS |
| notebook-theme.spec.ts | 2 PASS |
| notebook-baseline.spec.ts | 1 PASS |
| notebook-paper-confirmation.spec.ts | 1 PASS（定向修复后） |
| workspace-docking.spec.ts 的主题偏好/1117紧凑控件 | 2 PASS |

总计9个不同浏览器场景。`screens/`保存两套主题的主要页面、编辑器、阅读器、菜单、确认前后与窄屏；日志保留最初失败及后续结果。用例中JSON是隔离脚本模型输入，不是新增产品文案。

初次失败及修正原因见本轮开发交接；不能把多轮测试次数相加当作不同场景数。没有新增真实模型教学质量证据。
