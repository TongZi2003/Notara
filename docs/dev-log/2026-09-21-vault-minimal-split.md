# Vault 简约布局与分页分屏

## 已授权目标

按用户批准的简约 demo 落地，并纳入后续调整：阅读器并入资产；原生对话与其他分页左右分屏；节点中心拓扑和标签过滤；图谱详情以子卡片列表为主；拆分改成带上下文进入原生对话。

工作树 `/Users/yangrundong/.codex/worktrees/notara-vault-clean/DSH`，分支 `codex/notara-vault-clean`。保留本任务前序未提交实现。当前 `50183` 实例及其数据不用于新代码验收。

## 执行顺序

- [x] 资产页：树栏图标、右键/更多菜单、模板弹窗、折叠属性与紧凑文档工具。
- [x] 阅读器合并：PDF 与 Markdown 在资产页打开、定位、编辑；摘录/页拆分收进图标操作。
- [x] 原生分页分屏：唯一原生会话与输入；两侧独立导航和定位，调整宽度/交换/退出。
- [x] 图谱：节点中心 1/2 跳、标签筛选、子卡片数量和可点击名称、带上下文进入对话。
- [x] 从新状态验证：纯函数、引用链路、真实浏览器的单屏/分屏/窄屏/刷新/草稿。
- [x] 独立审查、构建、留存截图与验收记录；启动新版隔离实例供体验。

## 边界

- 不复制对话记录、发送管线或第二个模型输入控件；分屏只编排原生 view。
- 取消独立阅读器 tab；来源页码与 Markdown anchor 仍有效。
- 标签与子卡片仍从文件事实派生，不增加图谱实体。
- “带入对话拆分”先放入可检查的文件引用与拆分意图，不自动发消息或声称 AI 已完成拆分。
- 分屏中的两侧导航分别保留各自上下文；窄屏用上下排列承载同一分屏。

## 验证与完成情况

插件版本提升至 `0.4.0`。主 Agent 合并后执行：50/50 node:test、4/4 Chromium E2E（1.2m）、`npm run typecheck`、`npm run build`、插件构建、SDK 补丁两次重入、`npm pack --dry-run --json`、`git diff --check` 均 PASS。真实模型和教学效果未运行。

## 实现锚点

- `assets-client.js / createVaultAssets`：保留文件事实、revision 保存冲突和未保存稿；文件栏默认收起，Cmd/Ctrl+S 保存。PDF 页码、区域定位与 Markdown 标题摘录都在资产页。首次加载文件与定位请求避免重复打开覆盖页码。
- `ui-client.js / createVaultUI`：复用 DSH 主题，图标按钮保留可访问名称；模板弹窗与低频菜单。
- `workspace-client.js / createVaultWorkspace`：稳定挂载唯一 nativeConversationBody。隐藏面板用 visibility/inert 保留测量，首次访问后保留组件；隐藏文件/图谱停止轮询。左右分页包括原生轨迹，支持交换、键盘/拖拽调宽、关闭，窄屏上下排列。
- `scripts/patch-conversation-views.ts / applyConversationSeams`：保留默认 fallback，给 workspace 提供公共 nativeHeader、独立 nativeTrajectory 和无内嵌标题的 nativeConversationBody。轨迹禁用第二份 draft mirror。补丁可从旧版本归一化并验证 rc.2 原始摘要。
- `graph.js / filterVaultGraph / childCardsOf`：1/2 跳双向邻域与标签 AND；中心保留；详情计数和标题来自完整图的拆分边。
- `views-client.js / GraphBoard / GraphView`：镜头持续以中心节点为原点，隐藏节点的固定坐标保留。选中状态立即更新，首次展开详情稍后布局，兼顾双击与快速引用正确节点。
- `client-source.ts / insertVaultReference / pdfReferenceText`：通过原生引用和文本事件加入可审阅草稿，不自动发送。拆分意图附子卡片清单；PDF 序列化读当前版本文字层，无文字层如实注明。
- `live-preview.js / PropertiesWidget`：默认折叠，源 Markdown 仍可编辑；删除外部重复标题。

## 审查与证据

只读子 Agent 审查指出的来源面板被替换、隐藏节点布局、布局串会话、嵌入重复读取与 PDF 缺正文问题均已处理。最后一轮补丁复审工具受 502 阻断；主 Agent 已检查源码并完成新鲜浏览器回归。没有将该轮独立复审记为 PASS。

完整命令、截图、体验实例路径和局限见 `docs/evidence/vault-views/minimal-split/verification.md`。前序未提交改动保留；未提交或合并分支。
