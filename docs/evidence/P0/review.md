# P0 阶段包（供 Codex G0 review）

状态：P0.1 **DONE**；P0.2、P0.3 未开始。**G0 未 PASS**，本文件不代 Codex 下结论。

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
