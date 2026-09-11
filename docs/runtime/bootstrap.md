# DSH 隔离启动基线（P0.1）

本文件是 P0.2/P0.3 的启动前置事实。**只记录 2026-09-11 在本机一手核验过的内容**；
本文里的概念名（空学习空间、隔离 DSH home、装配命令、临时端口）都已换成 rc.2 的**实际 CLI 键**。
上游锁定值以 [`upstream-lock.json`](./upstream-lock.json) 为准，本文不复制版本号。

## 1. 事实来源

| 来源 | 用法 |
|---|---|
| `apps/cli/src/args.ts`、`apps/cli/src/profile-boot.ts`（rc.2 tag commit） | launcher 旗标与 profile 装配语义 |
| `packages/util/home-paths/src/index.ts` | `DSH_HOME` 解析优先级 |
| `packages/boot/app-boot/src/profile.ts` | profile 目录、模板、pnpm 设置 |
| `packages/bundle/web-app/cordis.patch.yml`、`src/startup.ts` | web 面旗标与默认 host/port |
| 实跑 `dsh --help` / `dsh --profile web --help`（0.1.5-rc.2，隔离 `DSH_HOME`） | 上面几条的运行时确认 |

## 2. 隔离 DSH home

- 环境变量：`DSH_HOME`。优先级 **显式配置路径 > `DSH_HOME` > `~/.dsh`**；空白值视为未设置。
- profile 目录：`$DSH_HOME/profiles/<name>`；该 profile 的根配置是 `cordis.yml`，用户层是 `cordis.patch.yml`，另有 home 级 `$DSH_HOME/cordis.patch.yml` 覆盖所有 profile。
- **开发与课堂都不许落在真实 `~/.dsh`。** 每个任务/测试自己 `mkdtemp` 一个目录，把 `DSH_HOME` 指过去，结束只清理自己创建的那份。
- 已实测：`DSH_HOME=<scratch> dsh --profile web --help` 会在 scratch 下初始化 `profiles/web/`（含 `package.json`、`cordis.yml`、`cordis.patch.yml`、`pnpm-workspace.yaml`、`.dsh-module-fallback`）并在 `profiles/node_modules` 链接依赖；真实 `~/.dsh` 的 mtime 全程未变。
- 注意：**`--help` 也会初始化 profile 并链接依赖**，不是零副作用。隔离 home 必须在此之前就设好。
- 本机实跑时 CLI 会先打印一行 `all_proxy` 是 SOCKS 代理、将直连的警告；这是本机环境提示，不是启动失败。

## 3. 启动一个隔离 web 实例

```bash
scratch=$(mktemp -d)                       # 任务自己的临时根
export DSH_HOME="$scratch/dsh-home"        # 不碰 ~/.dsh
export DSH_TELEMETRY_DISABLED=1            # 非空即关闭（隐私开关）
cd "$scratch/classroom"                     # 专用空课堂工作目录，见 §4
dsh --profile web --host 127.0.0.1 --port 0 --no-open
```

- `--profile <name>`：启动 `$DSH_HOME/profiles/<name>`；`web` 是硬编码别名（`dsh web` 等价）。
- 自定义 profile：`dsh --profile <新名> --from-default-profile web` 从随发行模板初始化一次；已存在的目录不会被复用或覆盖。
- 端口：`--port <n>`；**`--port 0` 让操作系统挑空闲端口**（并发测试用这个，不要抢固定端口）。默认是 `127.0.0.1:3080`。
- `--host`：`0.0.0.0` 被上游**显式拒绝**（会把 RCE 暴露到网络）；本机隔离只用 `127.0.0.1`。
- `--no-open`：不打开默认浏览器。另有 `--trusted-host <authority...>`（可重复）供 `/api` 浏览器信任栅栏使用。
- 退出：正常收信号即可；任务结束只停自己启的进程。**永远不要动 4877、旧 DSH checkout 或其他 worktree 的服务。**

## 4. 代码 checkout ≠ 课堂 workdir

Git worktree 里带着本仓**已跟踪**的学习文件与开发指令（`AGENTS.md`、`CLAUDE.md`）。直接在 worktree 根开课，
课堂会把开发指令当成上下文读进去，也会看到旧学习文件——这不是「空学习空间」。

P0.2/P0.3 的 fixture 必须：

1. `mkdtemp` 一个**系统临时目录**做课堂工作目录，不复用 worktree 目录；
2. 在其中放全新的数据目录与 `DSH_HOME`；
3. 让工作目录里**没有** `AGENTS.md`/`CLAUDE.md`——尤其不能摆在一个会自动向上读取开发指令的目录下；
4. 只显式装配教学资源；验证初始请求看不到旧学习文件或开发指令。

## 5. 插件装配

- 命令：`dsh plugin --profile <name> <pnpm 参数...>`，把剩余参数**原样转发给 profile 目录里的 pnpm**（如 `add <pkg>`、`remove <pkg>`、`why <pkg>`）。
- profile 首次使用会自动初始化：`pnpm-workspace.yaml` 写明 `nodeLinker: hoisted`、`autoInstallPeers: false`；profile 目录里的 `node_modules` 是平坦的，缺的 peer 通过 `profiles/node_modules` 安装回落拿到同一个 cordis 实例。
- 查看装配后的树（不进 app、不绑端口）：`dsh --profile <name> --dump-config`；只看 bundle 层：`--dump-default-config`。
- 一次性附加覆盖层：`dsh --profile <name> --patch <path.yml>`（可重复，按 argv 顺序叠在 profile 层与 home 层之上）。

## 6. 构建前置

- Node：仓库 `engines.node` 下限 `>=24.0.0`；P0.1 在 `v24.13.0` / npm `11.6.2` 下核验。
- 依赖树里的 `@deepseek-ai/dsh-*` 必须整体落在同一个 rc；混 rc 视为缺陷，以 `dsh/package-lock.json` 为准。
- TypeScript 与 `@deepseek-ai/dsh-typert-generator` 的 `^6.0.3` 声明匹配（见 `upstream-lock.json`）；**不要用 TS 5**。
- 本项目 `tsconfig.base.json` 只定义 strict 基座：`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、
  `verbatimModuleSyntax`、`erasableSyntaxOnly`、`customConditions: ["@deepseek-ai/dsh-source"]`，且 **不启用 `skipLibCheck`**。
  消费它的配置要自带 ESM 语境（`package.json` 的 `"type": "module"`），否则 `verbatimModuleSyntax` 会把文件判成 CommonJS 报 `TS1287`。
- 包管理与遥测：`DSH_TELEMETRY_DISABLED` 非空即关闭；不要打印任何认证配置到日志。

## 7. 尚未验证（留给 P0.2/P0.3，不要在这里写成 PASS）

- 真正绑定端口起服务的 `dev:isolated`；本任务只核到 CLI 的旗标与默认值。
- Host/Client 插件包装配、Remote 生成与 `$mount()` 往返。
- 浏览器页面替换、卸载恢复默认 UI、刷新后单例 shell。
