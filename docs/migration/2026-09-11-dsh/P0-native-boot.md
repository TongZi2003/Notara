# P0：原生插件接入 Implementation Plan

**执行状态（2026-09-11）**：P0.1–P0.3完成，G0 PASS；接受代码 `a45d9f5749062229f5f96ff3efa3dd989931d9f1`。证据与SDK限制见 `docs/evidence/P0/review.md`。依用户指令，本轮到P0结束，P1–P9未执行。

> **For agentic workers:** 使用 `superpowers:executing-plans`；每次一个任务，P0.3 后交 Codex G0 review。

**Goal:** 证明独立 StudyForge 插件能通过真实 DSH Host/Remote/Client/Slots 装配、运行和卸载。
**Architecture:** 最小闭环只返回合成学习空间名称并渲染原生页面；先锁定接入事实，再让后续业务消费。
**Tech Stack:** 最新核验的 DSH、Node 24、TypeScript、npm workspaces、Playwright。

## 全局约束

继承[总计划](../2026-09-11-DSH原生迁移计划.md)和[共同契约](CONTRACTS.md)。本阶段没有学习数据和课堂功能，不导入旧 SPA。文件相对 `仓库根目录/`；本阶段只允许创建实施 worktree，旧 DSH 的脏 checkout 保持原状。

## P0.1：隔离工作区与可重复版本基线

**创建：** `package.json`、`package-lock.json`、`tsconfig.base.json`、`.gitignore`、`docs/runtime/upstream-lock.json`、`docs/runtime/bootstrap.md`。创建/复制到 R 的计划文件仅限总计划、本目录全部分册和两份已确认勘查文档；同步复制本轮计划交接，并在 R 的 CLAUDE 索引登记本迁移入口。
**输入：** S 的真实 HEAD、未跟踪计划、官方发行元数据。
**输出：** 可复现空工程与上游证据；后续任务只能使用该锁定版本。

- [x] 在 S 检查 `git status --short`、`git rev-parse HEAD`、`git worktree list`；记录原仓身份，确认目标路径不属于现有 worktree。读 `using-git-worktrees` 技能后创建隔离分支：

```bash
git -C <母仓库> worktree add -b codex/dsh-native-migration <DSH迁移工作区> HEAD
```

- [x] 将 S 中的总计划、`2026-09-11-dsh/` 与两份勘查文档按同一相对路径复制进 R；不复制 `sessions/` 等未跟踪数据。若 S 的 HEAD 已不同于编制基线，记录 diff 影响，行为范围变化先 review。
- [x] 查官方 GitHub releases/tags 与 `npm view @deepseek-ai/dsh dist-tags --json`，比较发行日期；记录所选版本、commit、依赖包版本/exports、SRI、Node/npm。若最新版本接口变化，更新本阶段证据，不自动借用旧版本用法。官方入口：[releases](https://github.com/deepseek-ai/deepseek-harness/releases)、[registry](https://registry.npmjs.org/@deepseek-ai%2Fdsh)。
- [x] 创建最小 npm workspace 与 strict TS 配置。清单锁定精确版本；`private: true`，新代码 ESM；不启用 `skipLibCheck` 掩盖本项目类型错误，不用 `any` 填补未核实 SDK。`dsh/.gitignore` 排除 `.runtime/`、测试输出、认证文件和 `node_modules/`。
- [x] 创建 bootstrap 记录：空学习空间路径、隔离 DSH home 的官方配置键、插件装配命令、临时端口参数、构建前置。从所选版本 CLI help/源码核验实际键名，不能把本文的概念名当成 CLI 参数。
- [x] 区分代码 checkout 与课堂 workdir：Git worktree 可能自带已跟踪学习文件，不能把它直接当“空数据”。课堂 fixture 通过 `mkdtemp` 在系统临时目录建立全新的工作目录、数据目录和 DSH home；不在会自动向上读取开发 AGENTS/CLAUDE 的目录中开课。后续仅显式装配教学资源，验证初始请求没有旧学习文件或开发指令。
- [x] 运行 `npm install` 产生 lockfile，再运行 `npm ci`；核对依赖树无意外混用不同 rc。记录 `node --version`、`npm --version`、完整命令退出码。提交本任务文件和交接。

**验收：** R 独立、原仓状态未被清理或覆盖、依赖可从锁文件重建、DSH 版本有一手依据。尚未 boot 不得写插件接入 PASS。

## P0.2：Host → 生成 Remote → Client 的真实往返

**创建：** 根 `tsconfig.json`、`packages/{contracts,domain,host,client}/package.json` 与对应 `tsconfig.json`；`packages/contracts/src/probe.ts`、`packages/host/src/{index,probe-service}.ts`、`packages/client/src/{index.tsx,probe-model.ts}`、`scripts/{build,generate-remotes,dev-isolated}.ts`、`docs/runtime/remote-contract.md`。生成代码放 `packages/host/src/generated/` 与 `packages/client/src/generated/`，位置可按真实生成器要求调整并记录。
**输入：** P0.1 锁定 SDK、官方 Remote generator/boot 合同。
**输出：** 可由正式装配加载的 Host 与 Client 包；`ProbeReply` 在真实 Remote 往返中一致。

**2026-09-11 Codex 前置审查补充**：rc.2 官方生成器不能识别普通 npm 安装的协议声明。允许 `scripts/patch-sdk.ts` 对构建期生成器做精确摘要约束的最小包身份识别修正；其源证据、边界与重验要求见 `docs/evidence/P0/generator-pre-review.md`。运行时与 api-remotes 不打补丁；生成物仍由正式生成器产生，不能跳过真实 Remote 验收。

```ts
export interface ProbeReply {
  workspaceLabel: string;
  echoedNonce: string;
}
export interface ProbeService {
  inspect(input: { nonce: string }): Promise<ProbeReply>;
}
```

- [x] 阅读锁定版 `docs/subsystems/client-modules.md`、`packages/api/remotes/README.md`、`packages/boot/app-boot/README.md` 和一个官方完整插件。写明 package discovery、Host inject、`./client` export、Remote descriptor 生成与 `$mount()` 装配的实际调用和源码锚点。
- [x] 先做最小失败：Client 调未注册 probe 应明确 unavailable，不能返回本地默认值。Host 实现 echo nonce；Client 显示收到的 label；nonce 每次不同，证明没有本地硬编码或假 Remote。
- [x] 用所选发行版正式生成工具产生 descriptors/client contributions。生成脚本应能从干净目录重复运行；确实不存在对外生成/装配路径时，停止并交 G0 前置 review，不改上游 `api-remotes` 冒充独立插件成功。
- [x] 补齐实际 `dsh.client` 声明、inject 和 built exports。脚本 `build` 按依赖拓扑构建；`dev:isolated` 创建本任务独占目录和端口，调用 bootstrap 已核实的 DSH boot 命令。不把默认认证配置打印进日志。
- [x] 执行 `npm run typecheck`、`npm run build`、`npm run dev:isolated`；从浏览器触发 nonce 请求，保留 Host 处理与 Client 结果。卸载 Host 后调用应明确失败；恢复后重新往返成功。
- [x] 把完整正式 API 签名、生成命令、配置样例写入 `remote-contract.md`，所有后续 Remote 工具复用这一条路径。提交代码、证据和交接。

**验收：** 干净 build 的两个包正式装配，Remote 请求确实跨 Host/Client；不依赖旧 DSH 源码的未提交修改。未知接口未被假成功隐藏。

## P0.3：原生页面、预览入口与生命周期冒烟

**2026-09-11 Codex 核验调整（用户本轮允许设计调整，且只完成 P0）**：rc.2 `client-hmr/src/client/index.ts` 明确忽略 graph 帧，Host 插件清单改变须刷新后采用新 boot graph；仅 rebuilt 帧执行原位 fiber teardown/remount。因此装卸验收采用正式配置变更→刷新→默认界面/学生界面，并另外用原生 bundle HMR 证明旧 DOM/样式销毁、单例重挂和单次调用。不得用轮询私有 Loader 表或模拟 UI 消失代替生命周期。测试在临时目录复制本次插件构建产物，HMR 只改该副本，不改共享源码或构建目录。

**创建：** `packages/client/src/{shell/StudyForgeShell.tsx,shell/register-slots.ts}`、`tests/e2e/native-boot.spec.ts`、`tests/e2e/fixtures/dsh.ts`、`playwright.config.ts`、`docs/runtime/client-slots.md`；修改 P0.2 Client 入口。
**输入：** 已接通 probe、实际 slots/preview 注册合同。
**输出：** 左导航/中主区/右资料的原生 shell、可卸载注册、后续浏览器 fixture。

- [x] 用官方 Slots API 替换 root 或经过核验的页面槽；现版全局面板为 `sidebar.panellist/main`，不要复用旧笔记中的 `conversation` 子槽名字。只注册 renderer，不重复声明已有 children。
- [x] 在 shell 显示一个可被测试定位的根：`<main data-testid="studyforge-shell" />`；保留 DSH 需要的设置/连接入口，学生内容不显示 probe、raw path、session ID。开发 probe 仅留测试面。
- [x] 注册/复用官方 document preview，打开一份合成 `.md`。记录 `ctx.documentPreviews.register`、资源授权入口和清理回调的实际形状；这里只验证预览接缝，不声称拥有行号/框选能力。
- [x] 实现可重复挂载与 cleanup：取消 Remote subscription、事件监听、timer、ObjectURL；不能直接 import 旧 `app/js/main.js` 的全局副作用。
- [x] 将真实 DSH boot 放入 `tests/e2e/fixtures/dsh.ts`，每次独占 home/workspace/动态端口，失败时保留调试附件，结束只停止 fixture 创建的进程。测试断言包括：

```ts
await expect(page.getByTestId('studyforge-shell')).toBeVisible();
await page.reload();
await expect(page.getByTestId('studyforge-shell')).toHaveCount(1);
```

另用真实插件生命周期完成 disable→默认界面恢复→enable→单个新 shell；检查一次点击只发一次 probe 请求。
- [x] 跑 `npm run test:e2e -- tests/e2e/native-boot.spec.ts`、`npm run typecheck`、`npm run build`；保留三栏、刷新、卸载各截图与客户端 console。提交交接，产出 `docs/evidence/P0/review.md`。

## G0 review 必看

Host/Remote/Client 都来自正式独立插件装配；版本、生成器、slot 与 preview API 有实际证据；卸载恢复默认 UI；原工程/旧 DSH/4877 未动。**G0 未 PASS，不开始领域大规模移植。**
