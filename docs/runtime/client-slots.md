# P0 原生 Client 接缝

核验版本：DSH `0.1.5-rc.2` / `fb2c4b9e698e30edb738bca4cf0618587db7d203`。实现入口 `packages/client/src/shell/register-slots.tsx`，验收 `tests/e2e/native-boot.spec.ts`。这里只接通空学习页面与合成 Markdown 预览；课堂、资料领域与学习事实没有迁入。

## 页面与模块

- 保留官方 `root` / AppFrame、侧栏根、设置、overlay、Session 与右侧 Surface。以 `ctx.slots.inject(name, () => ctx.slots.register(options, renderer))` 注入现有槽，返回清理函数交 `ctx.effect`；不重复声明 children。
- 主区为 `main` 的 `conversation` **entry key**（不是旧版本 conversation 子槽）；另覆盖 `sidebar.workspaces`、`sidebar.brand.name`。本版 `priority: -10` 优先于内置 0，小值先选。
- 导航消费公开 `PropsRuntime<'sidebar.workspaces'>` 的 `wide`；折叠成 56px 栏时只显示有可访问名称的图标。响应式由原生 AppFrame 的 ResizeObserver 和 1024px 收拢阈值负责，测试等动画后的真实几何，不自行监听窗口并强制 toggle。
- Client 包名是 `@studyforge/dsh-client`，目录仍为 `packages/client`。不能使用 `@studyforge/client`：上游 `stripClientSuffix()` 会截断 `/client`，导致 built module id 与 HMR 解析不一致。首次 eager preload 成功不能证明 HMR 接通。
- 浏览器产物采用官方 `window.__ModuleLoader__.load({id, factory(require)})` 形状，React、JSX runtime、ReactDOM 与 Cordis external，使用 DSH 已加载的 React 18.3.1。仅 `?studyforge-probe=1` 是开发 probe 面。

## 官方预览

`ctx.documentPreviews.register(definition): () => void` 注册 renderer 元信息，definition 含 `id/extensions/title/loading` 及可选 `priority/wrap`；实际文档 body 注册在 `sidebar.right.tab.document` 的同名 entry。P0 **复用已装的官方 Markdown renderer**，以 `candidates('学习示例.md')` 确认其 id 为 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown`，不复制 TextPreview、file provider 或读取逻辑。

测试经原生 `session/create` 创建临时 Session，只为读本次 fixture 的 `学习示例.md`，未发送 prompt。UI 用已存在的 Session：`flushSync(() => { ctx.sessions.open(id); ctx.layout.selectPanel(null); })` 提交其挂载，再调用 `ctx.sidebarRight.openResource(fileAddressFor(id, cwd, '学习示例.md'))`。`fileAddressFor(sessionId, cwd, path): string` 保留真实 Session 授权；不能把 `active()` 当作“已挂载”的就绪判断，空 Surface 本来就没有 active tab。没有 Session 时不显示示例按钮，页面不为浏览创建占位课。

原生文件资源的元信息返回 `absolutePath`，TextPreview 固定把它画进 `data-textpreview-path`，rc.2 没有路径标题插槽。学生主题仅在 `.sf-shell` 在场时隐藏这条重复路径行（包含其原生 title tooltip），沿用原生文件名标签与操作栏；不修改地址、元信息或文件字节。这是版本绑定的显示适配，不是文件访问权限隔离。测试检查整个可见 body 不含临时根、路径行隐藏、原生 Markdown 内容在视口内。

## 生命周期与隔离

样式元素、Slots disposers、React session 订阅、Remote `$mount()` disposer 均归 Cordis/React 生命周期。无自己的 SSE、轮询 Loader、ObjectURL 或布局持久化。Shell 中的预览标记只让空资料占位退场，不维护 native tabs、active tab 或 pane tree。

两类变化分别验收：

1. `rebuilt`：只给本测试复制到临时目录的 Client bundle 追加 revision 注释。原生 HMR 收到该模块 id，旧 DOM/样式断开、新实例唯一、无页面导航；probe 重挂后一次点击恰好新增一次 Host 处理。
2. 插件清单变化：改本次 DSH_HOME 的 `cordis.patch.yml`，等新 HTML boot graph，再刷新采用。卸载后恢复原生默认界面，启用后单个学生 shell。rc.2 `client-hmr` 忽略 `graph` 帧，不宣称清单增删会自动热更。

`scripts/dev-isolated.ts` 通过系统 `mkdtemp` 为每次运行建立独占 home、空 classroom、Host/Client 构建副本和动态端口。它从本工程锁定 CLI 启动，只停止自己创建的进程；认证 URL 仅在内存交给浏览器，持久日志脱敏。`stop()` 幂等，停止进程后删除临时根（包含临时凭据），诊断由内存 `log()` 交测试附件保留。准备阶段与启动后异常同样回收目录；不宣称能在测试worker被SIGKILL后执行清理。

## 已证实与边界

`npm run test:e2e` 的两条 Chromium 用例覆盖真实 Remote、Host 装卸、Client HMR/清单装卸、刷新、设置可达、原生 Markdown、390px 主区至少 330px、按钮和折叠导航完整在视口内。console/pageerror 断言为空。截图需与测试一起审阅，单凭无横向滚动不够。

不承诺刷新恢复右栏 tab/滚动位置、Markdown 行锚、PDF 页码/框选、跨课连续性、模型或托管学生边界；这些均不属于 P0。本轮不实施 P1–P9。

上游源码锚：`packages/client/{ui-layout/src/client/AppFrame.tsx,ui-sidebar/src/client/contract/slots.ts,ui-sidebar-right/src/client/service.ts,ui-sidebar-documentpreview/src/client/{index.ts,TextPreview.tsx,document/registry.ts},client-hmr/src/client/index.ts}`，以及 `packages/util/workspace-path/src/index.ts`；均以本页顶部 commit 为准。
