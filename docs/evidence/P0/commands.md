# P0.1 命令与退出码日志

日期 2026-09-11。所有命令都在 `S=/Users/yangrundong/Oh-My-Student`、
`R=/Users/yangrundong/Oh-My-Student-dsh-migration` 或任务临时目录 `/tmp/dsh-p01-probe-*` 内执行。
DSH 探针一律带隔离 `DSH_HOME`。

## 1. 原仓身份与 worktree

| # | 完整命令 | 退出码 | 结果 |
|---|---|---|---|
| 1 | `git -C $S status --porcelain` | 0 | 1 个已修改（`CLAUDE.md`）+ 9 个未跟踪条目；与开工前逐条一致，未被本任务清理 |
| 2 | `git -C $S rev-parse HEAD` | 0 | `4d21a1523ace1c24f5074bf8ea5bf01609ae9c5a` |
| 3 | `git -C $S worktree list` | 0 | 目标路径 `$R` 不在既有 worktree 列表内 |
| 4 | `git -C $S worktree add -b codex/dsh-native-migration $R HEAD` | 0 | `Preparing worktree (new branch 'codex/dsh-native-migration')` |

## 2. 文档复制（只复制计划这条线的文件）

| # | 完整命令 | 退出码 | 结果 |
|---|---|---|---|
| 5 | `cp $S/docs/superpowers/plans/2026-09-11-DSH原生迁移计划.md $R/docs/superpowers/plans/` | 0 | 总计划 |
| 6 | `cp $S/docs/superpowers/plans/2026-09-11-dsh/*.md $R/docs/superpowers/plans/2026-09-11-dsh/` | 0 | 分册 12 份（P0–P9 + CONTRACTS + COVERAGE + REVIEW） |
| 7 | `cp $S/docs/dev-log/2026-09-11-{DSH分阶段迁移计划,DeepSeek-Harness迁移勘查,DSH技术勘查-会话写入与插件接入}.md $R/docs/dev-log/` | 0 | 本轮计划交接 + 两份已确认勘查 |

未复制：`sessions/_daily.json`、`sessions/_maplayout.json`、`.playwright-cli/`、
`docs/dev-log/2026-09-03-*`、`2026-09-05-已实现机制削减检查.md`（与本任务无关的未跟踪数据）。

## 3. 上游版本核验

| # | 完整命令 | 退出码 | 结果 |
|---|---|---|---|
| 8 | `npm view @deepseek-ai/dsh dist-tags --json` | 0 | `next=0.1.5-rc.2`、`latest=0.1.5-rc.1`、`alpha=0.1.5-alpha.2` |
| 9 | `npm view @deepseek-ai/dsh versions --json` | 0 | rc.2 为最新已发布版本 |
| 10 | `npm view @deepseek-ai/dsh time --json` | 0 | rc.2 发布 `2026-09-10T14:57:10.790Z` |
| 11 | `npm view @deepseek-ai/dsh@0.1.5-rc.2 dist --json` | 0 | SRI `sha512-8Xc8hCQ…`、shasum `2c78db39…` |
| 12 | `curl -sSL https://api.github.com/repos/deepseek-ai/deepseek-harness/tags?per_page=30` | 0 | `dsh-v0.1.5-rc.2 → fb2c4b9e698e30edb738bca4cf0618587db7d203` |
| 13 | `curl -sSL https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=20` | 0 | release `2026-09-10T15:09:34Z`，prerelease |
| 14 | `curl -sSL -o dsh.tar.gz https://codeload.github.com/.../tar.gz/fb2c4b9e...` | 0 | 上游源码归档 |
| 15 | `shasum -a 256 dsh.tar.gz` | 0 | `60038295d9ea8849dc50a9d77dfcbed6c14397f0d54fadb035f768841415a3bd` |
| 16 | `npm view @deepseek-ai/dsh-typert-generator@0.1.5-rc.2 --json` | 0 | exports `.`/`./tsdown`；`dependencies.typescript=^6.0.3` |
| 17 | `npm view typescript versions --json` | 0 | 含 `6.0.3`（`^6.0.3` 的可满足稳定版） |

## 4. CLI 隔离键实跑

| # | 完整命令 | 退出码 | 结果 |
|---|---|---|---|
| 18 | `npm install @deepseek-ai/dsh@0.1.5-rc.2`（临时工程） | 0 | `added 522 packages in 1m` |
| 19 | `npx --no-install dsh --help` | 0 | launcher 旗标与上游源码一致 |
| 20 | `DSH_HOME=$TMP/isolated-home npx --no-install dsh --profile web --help` | 0 | web 旗标正确；scratch 下初始化 `profiles/web/`；真实 `~/.dsh` 未变 |

## 5. 新工程安装与重建

| # | 完整命令 | 退出码 | 结果 |
|---|---|---|---|
| 21 | `cd $R/dsh && npm install --no-audit --no-fund` | 0 | `added 51 packages in 7s`，生成 `package-lock.json`（lockfileVersion 3） |
| 22 | `cd $R/dsh && npm install --no-audit --no-fund`（二次，幂等） | 0 | `up to date in 129ms` |
| 23 | `cd $R/dsh && npm ci --no-audit --no-fund` | 0 | `added 51 packages in 428ms`（从锁文件重建） |
| 24 | `npx --no-install tsc --version` | 0 | `Version 6.0.3` |
| 25 | `tsc --showConfig -p tsconfig.base.json` | 1 | `TS18003 No inputs were found`（P0.2 才加消费该配置的包；非配置错误，见 §失败与恢复） |
| 26 | `tsc --showConfig -p /tmp/dsh-p01-tscheck/tsconfig.json`（探针，extends 本工程基座） | 0 | `strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes/skipLibCheck=false/verbatimModuleSyntax` 全部生效 |
| 27 | `tsc --noEmit -p /tmp/dsh-p01-tscheck/tsconfig.json` | 0 | 严格正/负样例均按预期（`@ts-expect-error` 未报未使用） |

## 失败与恢复（保留第一次失败）

1. **`tsc --showConfig -p tsconfig.base.json` 退出 1（TS18003）**——首次运行在写工程后立刻执行。
   原因：`tsconfig.base.json` 是基座，此时工程里还没有任何 `.ts` 输入，TS 把「无输入」当错误。
   处理：不改配置去迁就空工程（不塞占位源码，也不加 `files: []` 之类的假通过写法）。
   在 `/tmp` 建一个 `extends` 本基座的探针工程（带 `"type":"module"` 与一份正样例 + 一份 `@ts-expect-error` 负样例）
   验证配置本身可解析、strict 旗标确实生效：命令 26/27 均退出 0。
   基座留给 P0.2 由真正的包消费；P0.2 的 `typecheck` 才是这条配置的正式验收。
2. **探针首次 `tsc --noEmit` 退出 2（TS1287）**——探针目录缺 `package.json` 的 `"type": "module"`，
   `verbatimModuleSyntax` 按 CommonJS 处理了带顶层 `export` 的文件。补上 ESM 语境后退出 0；
   已把「消费配置要自带 ESM 语境」写进 `bootstrap.md` §6。
3. **`npm view` 批量查 8 个包的可用性被用户中断**——该查询只是为了确认包已发布；
   改用已验证的 rc.2 依赖树直接安装（命令 21）后成功，未再阻塞。

## 未运行（明确留位）

- 真正绑端口的 `dsh --profile web --port 0` 起服务：P0.2/P0.3。
- `npm run typecheck/build/dev:isolated/test:e2e`：对应脚本按 CONTRACTS 属于 P0.2/P0.3，P0.1 未创建假脚本。
- 任何真实模型或真实凭据使用。
