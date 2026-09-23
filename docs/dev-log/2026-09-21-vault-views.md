# Vault 图谱、卡片库与阅读器

## 目标与工作树

实现 `docs/evidence/vault-views/design.md`，视觉按用户要求沿用 DSH 原生主题令牌。

- 工作树：`/Users/yangrundong/.codex/worktrees/notara-vault-clean/DSH`
- 分支：`codex/notara-vault-clean`，起点 `6592886`
- 原有未跟踪的 `docs/evidence/vault-views/design.md` 与 `mockup.html` 保留。
- 插件版本：`@notara/vault-native` 从 `0.2.6` 升至 `0.3.0`。

## 实际改动与锚点

- `examples/native-vault/graph.js`：`buildVaultGraph` 扫描真实 Markdown 与媒体摘要，派生节点角色、拆分/引用边、来源、摘录、子卡数与层级。缺失/自引用不生成幽灵边；循环层级返回 `null`；`parent` 仅连接已有卡片。忽略代码块和行内代码中的嵌入示例。
- `examples/native-vault/graph.js`：`scanSections` 是 Markdown 标题定位的共同来源；`markdownSections` 与 `findAnchorLine` 共用 frontmatter 偏移、代码围栏、重复标题及无标题段落规则。`buildMarkdownCardContent` 写普通 Markdown、来源 embed 和可选 `parent:`。
- `examples/native-vault/vault.js` / `index.js`：`graph()` 为参数严格为空的只读派生接口；没有新增持久化表或图谱事实。
- `examples/native-vault/views-client.js`：`GraphView`、`CardsView`、`ReaderView` 注册为原生 `conversation.view`；`ReadingPane` 复用 PDF 阅读器，支持 Markdown 标题摘录和父卡继续拆分。
- `GraphBoard`：无新增依赖的力导向布局；SVG 连线与原生按钮节点；点击详情、双击打开、右键菜单、固定拖拽、平移、缩放、一阶邻居高亮。详情宽度支持鼠标与键盘调整，窄屏切换为完整详情面板。
- `CardsView`：搜索、来源过滤、层级分组、打开 Markdown、来源定位与图谱定位。
- `ReaderView` / `PdfReader`：独立文件选择、页码/区域定位、缩放、适应宽度、框选拆卡、按页拆卡。批量跳过同名文件，可补齐缺页，不覆盖已有内容；保存失败报告实际数量。
- `client-source.ts`：`App` 消费原生 `viewRequest`；跨视图恢复未保存草稿，保留原始 revision 用于冲突检查。新视图按 session 保存图谱固定位置、镜头、详情宽度和阅读页码。slot 组件以 session 为 key。
- `media.js`：anchor 只经 `URLSearchParams` 解码一次，百分号文本可往返。
- `live-preview.js`：Markdown 来源 embed 渲染成带标题定位的来源链接，避免被误当媒体后永久显示加载中。
- `scripts/dev-isolated.ts`：导出 Vault 隔离入口，委托既有专用 fixture；三个 Vault E2E 均从此入口启动。`dev-native-vault.ts` 环境变量声明补齐类型。
- `scripts/patch-layout.ts` / `patch-conversation-views.ts`：DSH 应用外壳及活动会话外壳使用 `overflow: clip`，避免聚焦节点/编辑器时把隐藏的右栏或窄屏溢出的输入区程序性滚入。内部阅读区仍由原有滚动容器负责；补丁验证原版摘要，可从旧补丁升级且重复执行不改结果。

## 验证

命令均使用 Node `v24.13.0`（`PATH=/Users/yangrundong/.nvm/versions/node/v24.13.0/bin:$PATH`）。

- PASS：`node --test examples/native-vault/graph.test.js examples/native-vault/vault.test.js examples/native-vault/live-preview.test.js`，43/43。
- PASS：`npm run generate:remotes` 后 `npm run typecheck`。初次失败源于本工作树尚未生成的 Remote 声明；生成后通过，未修改公共类型合同。
- PASS：`npm run build:native-vault`；使用 lockfile 内 esbuild 与 pdf.js，未增加依赖。
- PASS：三个 Vault Playwright 用例，`--headed` Chromium，3/3，56.7 秒。完整验证矩阵、截图与隔离数据根见 `docs/evidence/vault-views/verification.md`。
- 未运行：真实模型、真实学生教学质量；本轮属于文件视图与交互验证。

## 验收中修正的问题

- PDF 首次加载强制回第一页：改为使用目标页并约束到有效页数，恢复原始框选区域。
- 力图斥力方向与边界导致节点离开画布：归一化方向并限制自由节点布局范围。
- SVG pointer capture 吞点击：节点命中层改为原生按钮；拖动捕获保留在命中节点；滚轮使用非 passive 监听。
- 交互断言通过但截图仍横向偏移：补充视图边界与裁剪容器 `scrollLeft` 断言，将 DSH 两层仅用于裁剪的外壳从 `hidden` 改成 `clip`。桌面/窄屏均重新验收，保留原生侧栏开合。
- 编辑器与摘录标题规则不一致：共同使用 `scanSections`，覆盖围栏标题及无标题回退。
- 标签卸载造成草稿、固定位置、页码丢失：会话范围内保留 UI 状态。
- 批量拆卡遇同名文件无法继续：跳过已有路径并继续剩余页，汇报新增、跳过与失败数。

## 当前边界

- 图谱每 2.5 秒从文件重新派生，切入视图与本地写入也触发刷新；不是文件监听服务。
- UI 位置和阅读进度在当前客户端会话内保留；浏览器刷新后关系从文件重建。
- 标题锚点可承受前文插入；标题重命名后明确提示未找到原段落，同名标题按出现顺序编号。
- PDF 摘录来自已有文字层；扫描件仍只保存位置，不新增 OCR。
- 所有浏览器验收使用临时 DSH_HOME 与临时 vault，未安装到真实用户目录或操作其他实例。
