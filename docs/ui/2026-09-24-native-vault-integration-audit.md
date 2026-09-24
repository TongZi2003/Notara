# 现代主题与新前端接入 Native Vault：源码核对

日期：2026-09-24。状态：只读源码探索与接入建议，未实施、未启动新实例、未验证新主题在真实插件中的行为。

## 结论与范围

用户确认当前原型的白底、浅灰按钮、字体与圆角方向可以作为主题基准；**板书排版仍只是机制占位，不能当作最终白板设计移植**。

可以先把主题接入 Native Vault，再整理导航与既有页面，最后单独接入白板。主题迁移不需要等待白板合同，也不需要另建聊天、学习记录或复习系统。

本轮核对的源码工作树是 `/Users/yangrundong/.codex/worktrees/notara-vault-clean/DSH`，`codex/notara-vault-clean@5a5886f`，插件 `@notara/vault-native@0.14.9`。原型工作树是 `/Users/yangrundong/DSH-frontend-design`，同一提交但另有未跟踪原型文件。`/Users/yangrundong/DSH` 的 main 仍在 `f84a29b`，不能把它当成本次移植基线。以上是源码状态，不等于用户长期运行实例已安装的快照版本。

两处工作树已有未跟踪文档均保留。本轮只新增/校正设计文档，不改源码、构建产物、依赖或真实学习数据。

## 1. 已核实的接入层

| 层 | 真实入口 | 接入判断 |
|---|---|---|
| 插件打包 | `examples/native-vault/client-source.ts` → `scripts/build-native-vault.ts` → `client.js` | 改源模块后重新打包；不把原型 HTML 当运行时页面加载，不手改 bundle |
| 主题 | DSH `ThemeRuntime.overrideTokens(source, tokens)` | 在 Native Vault 的插件生命周期中注册浅/深成对令牌并正确卸载；保留原生 light/dark/system 偏好 |
| 插件组件 | `ui-client.js` 的 `UI_CSS`、`client-source.ts` 的 `STYLE`，以及 views/routes/calendar/classroom 的局部 CSS | 已大量使用 `--dsw-*`；硬编码圆角、尺寸、阴影需要逐处收敛 |
| 课堂容器 | `client-source.ts` 注册 `conversation.workspace`；`workspace-client.js` 的 `createVaultWorkspace` | 可直接组合新布局；原生 `nativeConversationBody` 保留一个稳定的挂载位置 |
| 侧栏 | `scripts/patch-sidebar.ts` 已提供 `sidebar.content`，本地 rc.2 产物中也已存在 | 在 Native Vault 注册自己的侧栏；保留原生课堂列表、打开/新建、设置与工作区能力 |
| 页面导航 | 原生 `layout.selectPanel` / `main`，或现有 Workspace 内部视图 | 接口存在，但跨 main 面板是否卸载输入框不能假定；需要把草稿/输入引用/进行中课堂的恢复列入验收 |
| 数据 | `remote-client.js` 的 `createVaultClient` / `VAULT_REMOTE_METHODS` | 同一 RPC 合同和 Host 确定的工作区；不搬原型数组、模拟回复或 localStorage 事实 |

关键区别：Native Vault 启动器 `scripts/dev-native-vault.ts` 的 `seedVault` 只安装独立 `@notara/vault-native`（可选像素教室另计），没有加载旧 `@studyforge/dsh-client`。因此仅修改 `packages/client/src/theme/notebook.tsx` 不会改变 Native Vault。那里只能参考 API 的使用方式，不能连同旧 Host、页面与数据合同一起接回。

## 2. 先落地主题

原型令牌映射建议如下，确切覆盖范围以各控件真实消费为准：

| 原型视觉 | 浅色基准 | DSH 对应方向 |
|---|---|---|
| 主背景/侧栏/内容面 | `#ffffff` | `--dsw-alias-bg-base`、layer-1、sidebar-fill |
| 普通按钮/弱底色 | `#f4f5f6` | layer-2、普通控件底色 |
| 主按钮/选中 | `#f0f1f3` | button-info-fill、interactive-bg-active；文字同时改为深灰 |
| hover / press | `#eceef0` / `#e5e7ea` | interactive hover/active 与按钮 hover |
| 边界 | `#e8ecf0` / `#d8dee6` | border-l1 / border-l2 |
| 文本 | `#20252c` / `#525c69` / `#76808c` | label-primary / secondary / tertiary、caption |
| 强调与连线 | `#59626e` | state-business-primary、普通链接；保留错误/成功等语义差异 |
| 字体 | Helvetica Neue / Hiragino Sans GB / PingFang SC 等现有系统字体 | `--dsw-font-family`；正文 400、控件 500、标题 600 |
| 圆角 | 控件 14px、内容面 20px、输入 24px | 插件自有令牌 + 局部组件样式；不是把所有细小控件都强制同一半径 |

### 单改配色会漏掉的地方

- 原生输入框的发送键在 rc.2 `InputBar.module.css` 中使用变量背景，但前景写死 `color:#fff`。只把背景改浅灰会使图标对比不足。建议在现有、带摘要校验的 conversation 接缝里将该前景暴露成变量并保留原白色 fallback；不要用整站 button 覆盖，也不要复制原生输入框。
- `ui-client.js`、`views-client.js`、`classroom-client.js`、`client-source.ts` 的若干圆角是固定数字，token 覆盖不会改变它们。
- 图谱/路线画布的 `canvas-client.js` 已从主题变量取色。先验证主题变化能触发重绘，再决定是否需要改取色逻辑。
- HTML 资料通过 sandbox iframe 展示，其文档内部样式属于原资料；只统一查看器边框、工具栏与外部容器。PDF 页面的白纸也不应被当成 UI 底色强制覆盖。

首批建议文件（尚未创建/修改）：插件内新增主题令牌与样式模块，在 `client-source.ts` 接入；收敛 `ui-client.js` 与 `STYLE` 的控件尺度；必要时补 `scripts/patch-conversation-views.ts` 的发送键前景变量。升插件版本、运行 `build:native-vault`，在新隔离实例检查实际表现。

## 3. 原型页面与现有数据

| 页面 | 可直接复用 | 仍需补的前端组织 |
|---|---|---|
| 今日 | `reviewQueue`、`calendar`、`routes`、`lessonLog`、原生 `sessions.list` | 汇总卡片、加载/失败/空态、开课交接；没有现成 Today RPC，也暂不需要新建一个 |
| 资料库 | `list/read/save/readAsset`、`search/query`、`graph/links`、templates/trash 等 | 文件/卡片/图谱组合，复用现有编辑器、PDF 和来源引用 |
| 计划 | `routes/openRouteLesson/scheduleLesson`、`calendar`、review 系列、`dailyNote` | 将当前日历组件的复习 mode 组织为计划内页签；不改复习规则 |
| 课堂 | `nativeConversationBody`、`TeachingEntry`、`SummaryEntry`、`ClassroomView` | 精简页头和伴随面板，保留原生会话、模型输入、审批和工具生命周期 |
| 白板 | 现有 Markdown 读写/CAS、来源定位、资料图谱可作基础 | 课堂与笔记绑定、稳定块锚点、修订/更新通知、本课引用集合、投影及导出范围尚缺 |

`save_lesson_summary` / `lessonLog` 是已有的课堂小结能力，不等于随课堂持续更新的白板。`canvas-client.js` 是资料图谱画布，也不是现成课堂白板。

知识视图可以复用 graph 的资料与边，但必须先得到本课实际引用集合；按全库图谱中心点取若干跳，不能证明这些材料在本课用过。用户已规定节点是实际资料，不另建概念/认知状态网络。

## 4. 两个需要纠正的原设计假设

### 首页开课不能无条件使用 ensureTeachingSession

`client-source.ts` 的 `ensureTeachingSession` 首句是“已有 current 就返回 current”。它服务于当前课堂的教学设置，不保证返回空课。从“今日”发起新问题时直接复用它，可能把新问题交给正在进行的旧课。

已核对原生 `uiWorkspace.connectWorkspace(workspaceId)`：只复用该工作区内、未归档的 blank session，否则调用原生 create；同时对正在创建的请求去重。`openWorkspace` 还管理后续导航取消。接入时应走这些入口，明确工作区与草稿归属，等待 session scope/input 可用，再交接内容；不能伪造 ID 或直接复用任意 current。

原生 `ctx.conversation.input.for(scope).submit(mode)` **确实存在**；它负责输入准入、序列化和发送。原设计“找不到提交接口就再按一次发送”的条件可以收窄为：接口已找到，但跨新课交接、失败保留草稿、重复点击与切课竞争仍需真实浏览器验证。不能直接调用文本 send 跳过引用/附件序列化，也不能自己清空草稿宣称发送成功。

### 首页内容不能塞到 conversation.hero.workspace

本地 rc.2 代码已核实：这个槽只接 workspace picker 的 open/anchorRef/onPick/onClose。它不是首页内容槽。

建议将 Today 组织放在 Workspace/全局页面层。若目标是完整复刻原型“标题＋原生输入框＋今日内容”的首屏，再补一个窄的首页内容接缝，使原生输入框继续归原生组件；先验证挂载与草稿边界，不靠重排真实 DOM 或克隆 composer 拼界面。导航布局方案可与主题第一批分开验收。

## 5. 推荐实施顺序与完成条件

1. **主题进入真实插件。** 保留现有功能布局，统一白灰、字体、字重、圆角、按钮与焦点；检查原生发送/停止、权限提示、菜单、Markdown/公式/PDF、图谱在深浅色及小屏的可读性。此步不需要白板或新的学习事实。
2. **导航与既有页面重组。** 用真实数据接今日/资料库/计划，课堂继续用原生输入；先完成“从今日开新课 → 发送 → 查看资料 → 返回同一课堂”的完整路径，再迁移其余视图。明确数据根，单 Vault 启动环境可用无 session scope 的 Host 启动工作区；多工作区不能沿用此假设。
3. **白板正式机制。** 沿用 Markdown 文件事实源和现有保存版本检查，先明确课堂绑定与块更新边界，再实现块投影、资料引用子图、选中追问和导出；原型 localStorage、固定例题、选择题脚本都不搬入产品。最终板书视觉另行设计。

第一步的验收不能只看构建：至少新隔离实例、新课堂的真实 UI、窄屏、深浅色、菜单/弹窗、输入与停止。第二步加草稿/引用/切课/重连与原生输入单实例检查。第三步加文件 CAS 冲突、刷新/重开、引用版本变化、跨资料定位和两种导出范围。真实模型教学质量另行评估。

构建走 `npm run build:native-vault`；隔离入口走 `scripts/dev-isolated.ts` 导出的 `startVaultIsolated`。现有 `native-vault-minimal.spec.ts` 已包含分屏交换仍是同一个输入 DOM 的断言，可扩展为新布局回归；`native-vault-layout.spec.ts`、`native-vault-conversation-navigation.spec.ts`、`native-vault-pdf.spec.ts`、`card-preview-teaching-rendering.spec.ts` 可按改动范围选用。旧启动目录固定插件副本，重新构建不会升级旧实例，不直接覆盖用户运行目录。

## 6. 证据与验证状态

- **已核对**：两工作树 HEAD/脏状态、插件 manifest/入口/打包、Native Vault 启动安装集合、原生 theme/sidebar/workspace 接口及本地已补丁 rc.2 产物、输入 submit、工作区 blank session 行为、现有 RPC 清单和关键测试断言。
- **未运行**：构建、单测、集成、浏览器、新主题实际插件验收、真实模型。只读探索不以历史原型通过代替生产证据。
- 两个只读分工分别提供插件样式面与后端能力清单，主 Agent 核对并修正：小结不冒充白板；“白板合同待定”不阻塞纯主题接入；Host 不接受客户端指定任意数据根，但文件读写正常携带相对 path。

主要源码锚点：`client-source.ts` 的 `STYLE/ensureTeachingSession/insertVaultReference/apply`；`workspace-client.js` 的 `createVaultWorkspace`；`remote-client.js` 的 `createVaultClient/VAULT_REMOTE_METHODS`；`index.js` 的 `editorFor/save`；`scripts/dev-native-vault.ts` 的 `seedVault`；`scripts/build-native-vault.ts`；`scripts/patch-conversation-views.ts`；`scripts/patch-sidebar.ts`。
