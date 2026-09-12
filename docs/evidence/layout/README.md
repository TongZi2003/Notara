# 布局与贴纸主题证据 · 2026-09-12

实际产物：`packages/client` 的五导航、课程路线画布、书籍/课堂共用脑图、本课设置弹窗，以及黄色/白色主题。事实源仍是原生 Session 和现有领域写者。

| 检查 | 结果 | 命令 / 证据 |
|---|---|---|
| 正式编译与客户端构建 | PASS | `npm run build`；`logs/layout-closeout-build.log`（最后学习集CSS修复后） |
| 测试类型检查 | PASS | `npm run typecheck:tests`；`logs/layout-final-inline-types.log` |
| 同源工具合同 | 84 PASS | `npm run check:contracts`；`logs/layout-final-inline-contracts.log` |
| 脑图、卡版本、跨课请求 | 10 PASS | `test:unit -- tests/unit/mindmap-projection.test.ts tests/unit/lesson-card-version-projection.test.ts tests/unit/lesson-pane-request.test.ts` |
| 路线绑定、工作区隔离、混合资料 | 26 PASS | `test:integration -- tests/integration/mixed-route.test.ts tests/integration/native-route-binding.test.ts tests/integration/mixed-deck.test.ts` |
| 核心实际浏览器 | 13 PASS | `test:e2e -- tests/e2e/book-workspace.spec.ts tests/e2e/lesson-materials-mindmap.spec.ts tests/e2e/card-fixed-version.spec.ts tests/e2e/current-classroom.spec.ts tests/e2e/source-roundtrip.spec.ts tests/e2e/layout-roadmap.spec.ts`；`logs/layout-final-inline-ui.log` |
| 页面、主题、教学预设与确认回归 | 10 个不同场景最终 PASS | `test:e2e -- tests/e2e/notebook-pages.spec.ts tests/e2e/notebook-theme.spec.ts tests/e2e/teaching-presets.spec.ts tests/e2e/confirmation-editor.spec.ts tests/e2e/coauthor-organization.spec.ts`：9通过/1学习集窄屏溢出；修复后定向重跑 `notebook-pages.spec.ts` 1通过，覆盖七页1440/390px。日志 `layout-adapted-final.log`、`layout-pages-recovery.log` |
| 真实模型教学 / P7 五专项 | 未运行 | 本轮浏览器使用隔离 runtime 与测试模型，不支持教学效果结论 |
| 64004 插件快照更新 | PASS | 原进程存活、两个入口路径切换、client 哈希相同、原数据目录保留；`trial-update.json` |
| 64004 登录后可见刷新 | 后续修复 PASS | 通过原生登录入口进入内置浏览器；修正实际模块表仍引用旧文件的问题，课程页实际显示3节原课、贴纸节点、路线操作和已连接。见 `../../../../docs/dev-log/2026-09-12-DSH-trial-auth-client-refresh.md` |

截图在 `screenshots/`，来自真实浏览器中的实际页面，不是示意图。

核心13场景与补充10场景共23个不同浏览器场景有最终PASS。初次失败保存在 `logs/layout-inline-ui.log` 和 `logs/layout-sticker-ui.log`；最终通过日志对应修复后的状态。失败包括旧导航/导入后未点开、固定卡与当前卡节点选择歧义、折叠树错误期待孙节点、手机自动资料栏覆盖导航。最后学习集窄屏缺少响应式列布局，已按实际截图修复。日志仅规范末尾空白，原始输出保留在忽略的 `.runtime/`。源码修复与测试适配的说明见 `../../../../docs/dev-log/2026-09-12-DSH-layout-implementation.md`。

当前范围不承诺所有旧页面逐像素一致；本轮补齐的是用户确认的布局、实际接线、节点贴纸与主题切换。工具 schema 可用性改造沿用前一轮 `../tool-usability/README.md`，本轮未改变确认权限。
