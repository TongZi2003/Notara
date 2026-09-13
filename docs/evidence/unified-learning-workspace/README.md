# 统一学习工作区验收

环境：`codex/dsh-native-migration`，基于2700091；Node24.13.0、DSH0.1.5-rc.2、锁文件未变。测试各自使用 `startIsolated({testModel:true})` 的临时学习空间。以下计数按不同用例，不重复累加复跑。

| 层 | 结果 | 证据 |
|---|---|---|
| 正式构建、测试类型 | PASS | `workspace-delivery-build.log`、`workspace-delivery-types.log` |
| rc.2补丁重复应用 | PASS | `workspace-delivery-seams.log`；同一会话内还连续运行过两次 |
| 既有同源合同 | PASS，84项 | `workspace-delivery-contracts.log` |
| 布局与资料deck纯逻辑 | PASS，8项 | `workspace-finish-unit.log` |
| 跨层集成 | PASS，24项/10文件 | `unified-workspace-integration.log` |
| 原生草稿、布局、主题、恢复 | PASS，3个不同场景 | `workspace-finish-initial-ui.log`中3个workspace-docking场景；含实际指针拖动和插件卸载回退 |
| 共建、HTML安装、Skill与图来源 | PASS，6个不同场景 | `workspace-paths-ui.log` |
| 首页原生输入与技能/附件 | PASS，1个场景 | `workspace-core-ui.log`中的conversation-home |
| 原站页面1440/390宽度 | PASS，1个场景 | `workspace-notebook-final-ui.log`；`notebook-ui/`截图 |
| 最终思维图与失败提示 | PASS，2项；共13个不同UI场景 | `workspace-reply-final-ui.log`；图场景为复跑，错误提示为新增场景 |
| 实际58354 | PASS | 全套包与实际clientPath已核对；内置浏览器看见三视图、柔和纸张、原课堂和原讲义；`preview-modules.json` |
| 真实模型教学质量 | 未运行 | 夹具证据不等同真实模型效果；未配置或读取真实凭据 |

集成覆盖：科目继承/固定版本、原生Skill装配、同文件fs共建与过期写保护、原文版本和补充关系、安装原子性/停用、实际会话事件/fork去重、渐进工具与证据边界。

UI覆盖：拖标题四向分栏、任意两视图及三列/上下组合、键盘分隔线、关闭恢复、原生输入DOM身份/草稿/附件保持、窄屏切换与返回宽屏、布局刷新恢复；思维图编辑与引用、来源→独立资料面板、两图分别1.25/1.5缩放保持；经典/柔和与暖/白纸色分别持久；资料编辑后选新版本、语义查找暂存Skill和来源；创作者回到教师草稿、HTML实际点击和安装后加号可选。

保留初次失败：`workspace-core-ui.log`记录详情挡缩放；`workspace-finish-initial-ui.log`记录旧测试错误地要求原生根仍为直接子元素。前者修布局，后者改为新的真实面板定位，随后定向通过。初次失败不被当成最终PASS，也不删掉失败记录。

运行命令（cwd为dsh，先设置锁定Node的PATH）：

```sh
npm run build
npm run typecheck:tests
node scripts/patch-sdk.ts
npm run check:contracts
npm run test:unit -- tests/unit/workspace-layout.test.ts tests/unit/lesson-deck.test.ts
npm run test:integration -- tests/integration/artifact-install.test.ts tests/integration/library-coauthoring.test.ts tests/integration/classroom-trace.test.ts tests/integration/creation-workspace.test.ts tests/integration/subject-teaching.test.ts tests/integration/task-skills.test.ts tests/integration/teaching-current.test.ts tests/integration/tool-disclosure.test.ts tests/integration/material-version.test.ts tests/integration/native-input-evidence.test.ts
npm run test:e2e -- tests/e2e/workspace-docking.spec.ts tests/e2e/classroom-trace.spec.ts tests/e2e/library-management.spec.ts tests/e2e/creator-workspace.spec.ts tests/e2e/skill-draft.spec.ts tests/e2e/artifact-preview.spec.ts tests/e2e/notebook-pages.spec.ts tests/e2e/conversation-home.spec.ts
```

实际运行按日志分组，最后一行是相同用例的复验入口，并非声称执行过这一整条组合命令。

## 全站控件追加验收

`workspace-controls-ui.log` 五项最终PASS（含全站1440/390、三视图、主题、卸载回退、窄栏科目菜单）。之后补齐辅助文字/焦点色和原生模型菜单内部断言，`workspace-controls-final-ui.log`中的全站页面PASS，模型菜单初次少走一级被选择器拒绝；修测试导航后 `workspace-controls-final-ui2.log` PASS。13个不同UI场景的最终状态全部通过。

`workspace-branch-family.log`：真实fork家族排除无关课堂，定向集成PASS。最新构建/类型为 `workspace-controls-final-build.log`、`workspace-controls-final-types.log`，PASS。已在实际学情页读到新建/筛选控件统一system-ui、13px、8px圆角，模块与界面均为最新快照。
