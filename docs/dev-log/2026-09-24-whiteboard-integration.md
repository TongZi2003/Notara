# 双面白板正式接入

用户已批准将 `docs/ui/whiteboard-study.html` 设计接入 Native Vault。工作树：DSH-frontend-design，codex/notara-modern-ui；保留此前未提交改动。

## 实施顺序与合同

1. Host 从原生课堂绑定 `lesson-board/<session hash>.md`，每个块有稳定标识与布局元数据；正文只保存 Markdown。原生 CAS 处理冲突，拒绝写坏或错课文件。
2. 增加窄工具 `write_lesson_board`，以语义标题选区、正文替换及相对布局完成板书。工具参数流是暂态，工具成功后以笔记为准；失败/取消不得冒充保存。
3. 增加 `board` / `mutateBoard` 远程方法。知识面只投影板书实际引用的资料及这些资料之间的链接，注释不覆盖资料原文。
4. 接入双面画布，保留唯一原生对话输入。实现拖动、缩放、跟随、局部彩色高亮、折叠、来源定位、Markdown/HTML 导出；保护既有草稿。
5. 相关模块测试、构建、类型检查；新版本隔离实例中验证真实工具参数流、保存/刷新、知识来源、布局和高亮持久化。

## 验证

最终插件版本：0.16.6，未提交、未合并、未部署到真实用户目录。

- PASS：`node --test examples/native-vault/board.test.js examples/native-vault/agent-tools.test.js examples/native-vault/remote-client.test.js examples/native-vault/remote-scope.test.js examples/native-vault/graph.test.js examples/native-vault/teaching-runtime.test.js examples/native-vault/live-preview.test.js examples/native-vault/client-bindings.test.js`，78 项通过；输出在 `docs/evidence/whiteboard-integration/tests.txt`。
- PASS：`npm run typecheck`；`npm run build:native-vault`（最终 bundle 5,590,354 bytes）；`git diff --check`。
- PASS：新版隔离实例真实浏览器下的工具参数流 → 待批准 → Markdown 保存。长流在未提交时从 46 字增长到 132 字；点击停止撤掉暂态，保留已保存内容。修复过程中发现 rc.2 不为纯工具输出建立可见 Chat node，最终直接订阅 `SessionBinding.eventSource`，没有修改上游生命周期。
- PASS：拖动块、高亮上色、刷新后重新进入课堂保留原布局/正文/草稿；资料源打开与返回板书；知识面仅两份实际引用资料和一条真实引用边；修复 `overflow:hidden` 在聚焦时自动滚动画布的问题，使用 `overflow:clip`。
- PASS：最终 0.16.6 在 1155px 下三个过程行均为 21px 高、3px 间距，空 Chat seat 隐藏；时钟按钮 26px，文字保留无障碍名称和悬停提示；输入栏两组控件中心同为 y=695，同排且不挤压。390px 下无页面横向溢出，只有一个可见面，唯一 composer 和草稿保留；控制台无 error。
- PASS：导出编码器物理排除未勾选私密种类，安全 HTML 渲染，Markdown/HTML 独立产物保存在 evidence。BLOCKED：内嵌浏览器触发下载后未收到 download 事件，也未观察到默认下载文件；不将此写成下载链路通过。
- 未运行：真实模型教学质量、语音、真实学生体验。合成模型只证明传输/保存/界面链路。

## 实际锚点

- `examples/native-vault/board-data.js / parseBoard、upsertBoard、projectBoard`：唯一正文、稳定身份、相对位置与资料范围。
- `board-runtime.js / createBoardRuntime`：Host 课堂绑定、CAS、更新前版本检查。
- `board-stream.js / createBoardEventTracker、createBoardStream`：原生暂态参数流与中断/完成收束。
- `board-client.js / createLessonBoard`、`board-client.css`：双面画布、拖动、跟随、高亮、来源、折叠与导出。
- `board-render.js / renderBoardMarkdown、exportBoard`：安全 Markdown、公式、表格和受控 Vault 图片；独立 HTML 包含已加载图片及数学字体样式。
- `workspace-client.js / createVaultWorkspace`：白板座位与原生对话唯一输入；按实际工作区宽度收为切换视图。
- `modern-theme.css / rc.2 compact conversation rules`：移除隐藏空席间距、压缩过程行、窄栏时钟与输入工具排布。
- `resources/vault-teaching/base.md / 教学动作`：板书工具与因材施教规则。

## 当前试用入口

最终隔离实例 `http://127.0.0.1:63700/`；数据根 `/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-Mr5eut`。仅合成资料和测试模型，未使用真实 Vault。登录信息仅在 mode 0600 的 `.runtime/board-preview.json`，不记入文档。通过 `scripts/dev-isolated.ts` 导出的 `startVaultIsolated` 启动；安装使用本轮新构建快照，不在旧快照上改代码。

独立 HTML 已在真实浏览器打开并展开“想一想”，排版、颜色和折叠可用，截图为 `export-preview.png`；这不替代下载事件验收。已停止本轮被替换的六个合成预览实例，只保留上面的最终实例；未操作其他任务的服务。

剩余：在支持下载的完整浏览器中确认文件下载，以及真实模型教学体验验证。当前排版采用文本长度估计初始位置，手动位置优先；复杂图解布局仍应结合真实课程打磨。
