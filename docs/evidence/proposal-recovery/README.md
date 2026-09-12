# 提案冲突与对话布局验证（2026-09-12）

| 范围 | 结果 | 命令/日志（相对 R/dsh） |
|---|---|---|
| 旧目录基线与错误分类 | 修复前2 FAIL | `.runtime/skeleton-stale-red.log`；最初夹具错误另见 `skeleton-stale-before.log` |
| 目录、确认、幂等与恢复 | 18 PASS | `npm run test:integration -- tests/integration/skeleton-confirmation-stale.test.ts tests/integration/plan-target-skeleton.test.ts tests/integration/confirmation-v2.test.ts tests/integration/native-confirmation.test.ts`；`.runtime/skeleton-fix-integration.log` |
| 既有确认编辑、拒绝 | 2 PASS | `confirmation-editor.spec.ts`；`.runtime/skeleton-fix-ui.log`，同次目录恢复用例失败另保留 |
| 最终目录恢复与跨轮内联 | 2 PASS | `npm run test:e2e -- tests/e2e/inline-proposals.spec.ts tests/e2e/skeleton-conflict-recovery.spec.ts --output=.runtime/proposals-final-ui`；`.runtime/proposals-final-ui.log` |
| 最终构建、类型 | PASS | `npm run build`、`npm run typecheck:tests`；`.runtime/inline-proposals-native-build.log`、`.runtime/proposals-final-types.log` |
| 真实试用恢复与布局 | 见 `trial-update.json` | `.runtime/skeleton-fix-deploy.log`、`.runtime/proposals-inline-deploy.log`及可见浏览器 |
| 真实模型自动重读重提 | 未运行 | 不代发学生消息，不重复确认目录 |

浏览器最终验证包括：提案位于对应回复、独立于折叠的工具过程、普通消息滚动、已保存折叠、桌面/390px可切轨迹、刷新不串到别轮。目录恢复必须先展示合并预览，再经确认保存；重新检查自身不写目录。

失败日志保留在 `.runtime/inline-proposals-{red,debug,native}.log` 及 `.runtime/skeleton-recheck-debug.log`。它们分别记录缺少内联入口、原生子槽不能重复声明、窄屏阅读浮层遮挡，以及目录预览服务缺少显式注入。最后两张截图来自隔离测试，只有测试题卡。
