# P0.1 隔离边界记录

本任务只创建文件和安装依赖，**没有启动任何端口上的服务**。

| 资源 | 本任务的动作 | 边界证据 |
|---|---|---|
| 原仓 `S=/Users/yangrundong/Oh-My-Student` | 只读（`git status`／`rev-parse`／`worktree list`）+ `git worktree add` 登记 | 开工前与收尾时 `git status --porcelain` 逐条一致；`HEAD` 仍为 `4d21a15`；未清理、未暂存、未提交任何 S 的文件 |
| 实施 worktree `R` / `branch codex/dsh-native-migration` | 唯一写入落点 | 起始 commit `4d21a15`，与 S `main` 同点；本任务提交在 R 内 |
| 真实 `~/.dsh` | **只读**：`ls -la` 看 mtime | CLI 探针全部设 `DSH_HOME=<scratch>`；探测前后 `~/.dsh` mtime 均为 `2026-08-24 18:12` |
| CLI 探针临时根 `/tmp/dsh-p01-probe-*` | 读写 | `DSH_HOME` 指向其下 `isolated-home/`；含 `profiles/web` 初始化与 `profiles/node_modules` 链接 |
| DSH 源码归档 `/tmp/dsh-p01-probe-*/arch/` | 读写 | 只解压 rc.2 tag commit 的归档做源码核对，未安装、未修改 |
| npm 依赖 | `R/dsh` 内 `node_modules` | 51 个包，全部在 `R/dsh/node_modules`，不入 Git（`.gitignore`） |
| 端口 | **未占用任何端口** | 只跑 `--help` 路径：上游 app 不提供 bind 服务，不监听 |
| StudyForge 4877 | 未接触 | 未 kill／未重启／未请求；只在文档里列为禁动项 |
| 旧 DSH checkout | 未接触 | 本任务不读写 `/Users/yangrundong/.dsh`（真实 home）以外的 DSH 状态 |
| 其他 worktree 的服务 | 未接触 | `git worktree list` 只读列出 |
| 真实用户凭据 | 未读取 | 没有打开任何 auth/credentials 文件；`.gitignore` 显式排除 `auth.json`／`credentials.json`／`.env*` |
| 真实的课堂/学习数据 | 未读取、未复制 | 只复制了计划与勘查文档，未复制 `sessions/` 下的未跟踪元数据 |
