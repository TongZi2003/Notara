# Native Vault 现代主题接入与逐页对照

日期：2026-09-24。工作树：`/Users/yangrundong/DSH-frontend-design`，分支 `codex/notara-modern-ui`，基线 `5a5886f`。插件版本 0.14.9 → 0.15.0；未提交、未合并、未更新真实用户实例。原有未跟踪的设计稿、原型与证据均保留。主仓和 vault-clean 工作树未改动。

## 本轮范围

按用户确认的白色背景、浅灰控件、清晰字体和圆角尺度，将原型接入 `examples/native-vault`，没有改到旧 `packages/client` 界面。正式白板、语音与教学路径生成仍在本轮边界之外。样例中的白板固定排版不能作为生产设计。

## 页面与代码锚点

| 页面 | 实际接入与细节 | 锚点 |
| --- | --- | --- |
| 全局 | 主题 token、白灰表面、圆角、系统字体、原生深浅色偏好、卸载清理 | `modern-theme.js / installModernTheme`；`modern-theme.css` |
| 今日 | 开课输入、到期卡片、当天课程、继续学习、路线、小结，均读真实投影；读取失败与空态明确 | `shell-client.js / Today` |
| 开课 | 继承当前原生课堂所属 workspace，新建或复用真正 blank 的原生课堂；保护已有文字/附件/引用草稿，原生输入机负责发送 | `launch-client.js / launchVaultLesson`；`shell-client.js / createVaultNavigation` |
| 资料库·文件 | 文件/卡片/图谱收进同一导航；全局打开文件树，带入课堂后收起；阅读器和编辑器保持原实现 | `assets-client.js / App`；`workspace-client.js / Workspace` |
| 资料库·卡片 | 类型、标签、来源、复习状态筛选；按真实父专题分组；KaTeX 摘录、可读引用名称、真实到期/待评估状态；复习筛选使用现有队列并读取全部分页 | `views-client.js / CardsView` |
| 资料库·图谱 | 复用文件拆分/引用关系及真实详情、居中和筛选，应用统一主题 | `views-client.js / GraphView` |
| 计划·路线 | 默认阶段课程列表，保留图谱；条件补练/拓展可展开，同一节点详情保留排课与开课操作 | `routes-client.js / routeLanes, listLayout, detailPane` |
| 计划·日历 | 单独页签，扩大月历区域、调整日期格和当天安排比例 | `calendar-client.js / CalendarView`；`modern-theme.css` |
| 计划·复习 | 单独页签，调整队列/详情宽度，沿用三态能力评估及真实保存回执 | `calendar-client.js / CalendarView` |
| 课堂/教室 | 原生对话、教学设置、教室、总结入口与伴随资料面板；全局切页不复制输入框，草稿与引用保留 | `workspace-client.js / createVaultWorkspace` |
| 调试 | 默认隐藏系统/上下文行与轨迹；显式开启可恢复原生投影，关闭活动轨迹时返回对话 | `shell-client.js / installStudentProjection`；`workspace-client.js / Workspace` |

`client-source.ts` 负责接线；`client.js` 是重新构建的分发产物。`scripts/patch-conversation-views.ts` 只给原生发送按钮的前景色增加变量接缝，保证浅灰背景上箭头可读。

原生保留项：文件属性仍在 Markdown 阅读器顶部折叠展示，没有另建第二份属性编辑器；课堂头部、模型/权限控制和工具展开沿用原生能力；全局资料带入当前课堂，没有加入原型里的目标课堂选择弹窗。原型中的新增评估回执专用消息卡未实现，评估状态在复习页按真实回执展示。以上不应被描述成原型所有行为已经逐一重写。

## 发现并修复的问题

- 首页在原生课堂切换时组件重挂载，曾中断第二次开课：把交接控制器和草稿放入稳定导航 store；离开今日时仍取消。
- 多 workspace 场景曾始终提示选择学习空间：现在由当前 session 在已登记 `WorkspaceView.sessionIds` 中反查，不猜测最近目录。
- 路线在 900px 容器下把路线列表、课程主区、详情一起纵排，主区高度变为 0：将主区与详情包进独立布局，实测恢复为约 452px。
- 在活动轨迹页关闭调试导致空白：关闭时将活动视图切回原生对话。
- 卡片筛选结果仍显示全库锦囊数、摘录露出 wikilink 语法：计数与摘录展示已修正。

## 验证

| 层级 | 结果 | 证据 |
| --- | --- | --- |
| 构建 | PASS | Node v24.13.0，`npm run build:native-vault`，最终 client 5,523,347 bytes |
| 类型检查 | PASS | `npm run typecheck`；此前先运行 `npm run generate:remotes` 生成项目所需声明 |
| 单元/接缝 | PASS，50/50 | `node --test examples/native-vault/{shell-client,launch-client,client-bindings,remote-client,canvas-client,lesson-data,review-data}.test.js` |
| 桌面真实浏览器，测试模型 | PASS | 使用 CUA 驱动真实插件；今日、卡片筛选、路线主区与详情、日历空态、复习保存、文件引用、教室、设置、深色模式与连续开课。分两次不可变插件快照记录，见下文 |
| 最终构建定向回归 | PASS，11 项 | 最终实例重新验证文件树/伴随切换、卡片数学与计数、开课/独立第二课/旧草稿、路线详情、关闭调试；`browser-checks-final.json`，本次捕获控制台 warn/error 为 0 |
| 390×844 | PASS，仅响应式呈现 | 真实 iframe viewport 的加载完成截图；此前 iframe 点击定位工具不稳定，未报告手机交互通过 |
| 真实模型/教学质量、真实学生体验 | 未运行 | 使用 synthetic echo adapter，不支持教学质量结论 |
| Windows、完整原生回归套件 | 未运行 | 本轮为 macOS 局部 UI 与交接验证 |

构建、类型、测试日志与截图：[`../evidence/native-modern-ui/`](../evidence/native-modern-ui/)。浏览器检查是本次 CUA 实际操作的记录，不是新增了一个终端自动化 E2E 套件。最初一次计数定位用了错误的空白匹配，已改为 DOM 数值断言；该失败保留于中间记录，不能算产品回归。

## 隔离实例与证据归属

- 最终预览：`http://127.0.0.1:54093/`，父进程 35176。
- 最终数据根：`/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-YveuA7`。
- 启动入口 `scripts/dev-isolated.ts / startVaultIsolated({testModel:true})`；样例由 `scripts/fixtures/vault-modern-samples.mjs` 写入，此脚本校验 OS 临时目录和隔离根前缀，拒绝写入真实 Vault。
- `browser-checks-final.json`、`*-final.png` 对应最终 54093 实例。其他页面截图及 `browser-checks-64181.json` 对应本轮先前的 64181 快照，最后三项小修前取得；其中复习表单真实保存与深色模式已验证，但不混称最终构建全量复测。
- 旧的本任务临时实例已停止；长期共享服务未操作。独立 node_modules 由 lockfile 安装，不借用或改写其他工作树依赖。
- 认证入口仅存 `.runtime/modern-preview.json`，不写进证据和公开文档。

## 下一入口

白板需要和用户讨论后再设计生产实现：课堂状态 Markdown 如何分块、如何组织空间、知识面如何列出本课实际使用资料及关系，以及引用定位与导出的范围。原生 session 继续拥有课堂生命周期，不另造聊天分支树或第二套会话。
