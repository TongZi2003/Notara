# Vault 排版、属性与日历复习

## 目标与范围

在 `codex/notara-vault-clean` 延续 Native Vault：支持 `==高亮==` 与 LaTeX、Obsidian 式属性/标签展示，并按用户指定 Obsidian 工作流接入日历及间隔复习。保留已有未提交修改；不导入或改动真实 Obsidian 数据。

## 实际改动与锚点

- `examples/native-vault/live-preview.js` / `PropertiesWidget`、`buildDecorations`：紧凑可折叠属性、标签到图谱筛选、高亮、引用与代码排版。属性仍通过“编辑属性”回到同一 Markdown 源码；没有第二个编辑器。
- `examples/native-vault/math-latex.js` / `mathSyntax`、`MathWidget`：行内/独立段落公式，点击回源；无效公式保留源码。KaTeX 禁止信任扩展，CSS 与字体由 `scripts/build-native-vault.ts` 本地内联。
- `review-data.js` / `reviewState`、`recordReviewContent`、`undoReviewContent`：Obsidian 1/3/7/16/35 天规则，同文件状态与评估经历，首次评估才入队。
- `review-runtime.js` / `createReviewRuntime`：原生作用域、批准、CAS 写入；UI、教师共用持久化入口。`protectReviewFields` 防止模型用普通保存绕过调度合同。
- `calendar-data.js` / `calendarProjection`：路线安排、课堂小结、日记、到期卡片和实际评估的民用日投影。
- `calendar-client.js` / `CalendarView`：月历、日程、日记、课程排期、复习队列和评估详情；`workspace-client.js` 注册并列、可分屏的日历 bench。
- `routes-client.js`、`assets-client.js`、`views-client.js`：日期安排/日历跳转、资产与卡片复习入口、属性标签跳图谱。
- `remote-client.js` / `VAULT_REMOTE_METHODS` 成为 Host/client 共用方法清单。`agent-tools.js` 与 `resources/vault-teaching/base.md` 同步新工具与使用边界。
- 插件版本提升到 `0.7.0`。数据和调度细则见 `docs/migration/2026-09-22-vault-calendar-review.md`。

## 验证与下一入口

- PASS：`npm run build:native-vault`（Node 24，本地 lockfile 依赖），生成本地字体的单 JS bundle。
- PASS（语法）：16 个改动涉及的 JS 入口与生成 bundle 执行 `node --check`；最终字体/焦点修订后再次构建并检查 bundle 与编辑器语法。`git diff --check` 通过。
- 已修正开发期间语法检查发现的日历 JSX-free 嵌套括号错误。
- 独立代码审查发现并修正：frontmatter 只读属性必须拷贝后更新；路线写入需保留 `scheduledOn`；日期命名的卡片不能误判为日记。撤销错误映射同步到实际错误码。
- 按用户要求未运行单元/集成/E2E 测试套件、真实模型测试或完整教学验收。不能把构建与预览等同功能测试通过。
- 侧栏预览使用 `scripts/dev-isolated.ts` 的新隔离实例；实际地址、数据根、PID 在忽略文件 `.runtime/sidebar-preview-v07.json`。样例均为合成资料，旧 `0.6.0` 实例保留。
- 页面预览：Codex 侧栏实际显示 `==高亮==`、行内/多行 KaTeX、本地字体、属性表与胶囊标签；日历读取到合成的课程日期与到期卡片，复习队列显示待评估/到期分流。浏览器当次读取无 error 日志。这只是渲染与读取预览，没有执行评估/撤销/排课写入验收。
- 最终预览地址 `http://127.0.0.1:56756/`，隔离数据根 `/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-xnyhs7`，启动进程 PID `20389`。未配置真实模型。中间两份临时预览已停止，原 `65365` 实例未改动。
- 下一验证入口：公式回源/保存、属性标签跳转、首次评估/到期/撤销、外部修改冲突、路线排课回课、刷新重开，以及真实教师按表现记录评估。无需先重跑旧教学迁移全套。
