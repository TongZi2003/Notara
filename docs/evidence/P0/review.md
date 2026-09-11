# P0 阶段包（供 Codex G0 review）

状态：P0.1 **DONE**；P0.2、P0.3 未开始。**G0 未 PASS**，本文件不代 Codex 下结论。

## Codex P0.1 审查与 inline 修正（2026-09-11）

任务验收通过；这不是 G0 阶段通过。基座无源码时 TS18003 不构成接口缺口；脚本按 P0.2/P0.3 交付，维持原任务顺序。

发现并已修正：

- 启动示例缺 `mkdir` 且裸 `dsh` 会使用未锁定全局程序。CLI 已加入精确 devDependency，例子先创建独占目录，再用本项目 `.bin/dsh`。
- 迁移目录的默认 PATH 实际解析到 Node 23.11.0/npm 10.9.2，首次补装出现 EBADENGINE 警告。明确激活 `/Users/yangrundong/.nvm/versions/node/v24.13.0/bin` 后重跑 install/ci；增加 `.nvmrc` 和 `.npmrc` 的 engine-strict 防止错误版本继续安装。未修改用户全局 Node 配置。
- 文档分册数量改为 13；调度中断的来源改为主 Agent；官方生成器核验归属于 Codex，不误记为用户验证。

新鲜验证：Node v24.13.0/npm 11.6.2 下 `npm install --no-audit --no-fund` 与 `npm ci --no-audit --no-fund` 均退出 0（ci 实装 527 包）；锁文件 587 条非根包记录，其中 DSH 家族 232 条均为 rc.2。临时空课堂目录、独占 DSH_HOME 下，本项目 CLI 的 `--help` 与 `--profile web --help` 均退出 0，预期旗标存在。所有直接依赖的非通配 exports 目标存在；strict 正例编译退出 0，`string = undefined` 负例被 TS2322 拒绝（退出 2）。机器可读结果见 `p01-review-checks.json`。

未启动服务，未运行浏览器、Remote 或真实课堂。下一任务 P0.2，继续使用此锁文件与 Node 24。

## diff 范围与变更文件

- base：`4d21a1523ace1c24f5074bf8ea5bf01609ae9c5a`（= `S main`）
- head：见 `docs/dev-log/2026-09-11-DSH-P0.1.md` 的 end commit
- 变更文件：本批提交清单（`git show --stat <commit>`）

## 任务交接

- P0.1 → `docs/dev-log/2026-09-11-DSH-P0.1.md`

## 测试入口

| 入口 | 命令 | 本轮结论 |
|---|---|---|
| 锁文件重建 | `cd dsh && npm ci --no-audit --no-fund` | PASS（退出 0，51 包） |
| strict 基座 | `tsc --noEmit -p <探针 extends 本工程基座>` | PASS（退出 0） |
| typecheck / build / dev:isolated / test:e2e | 按 CONTRACTS 属 P0.2/P0.3 | 未运行（P0.1 不创建脚本） |

## 证据

- `version-baseline.md`：npm 通道、tag↔commit、SRI、源码归档、生成器 exports、CLI 隔离键
- `commands.md`：完整命令、退出码、失败与恢复
- `isolation.md`：原仓 / 真实 `~/.dsh` / 端口 / 凭据 / 共享服务的隔离边界

## coverage 行

P0.1 只覆盖「隔离工作区与可重复版本基线」。G0 的三项验收（独立插件装配、真实 Remote 往返、
页面替换与卸载）分别落在 P0.2/P0.3，**均无证据**。

## 未完成项

P0.2 Host→生成 Remote→Client 的真实往返；P0.3 原生页面、预览入口与生命周期冒烟。
