# R/dsh 近目录规则（DSH 原生迁移）

本目录是 DSH 原生迁移产物根（**R/dsh**）。仓库根 `AGENTS.md` / `CLAUDE.md` 继续适用；
**离本目录更近的规则以本文为准**，与旧计划或旧仓实现冲突时，以用户在本次迁移中的精简裁决优先。

## 当前事实源（P1.1 锁定）

- 产品行为基线：**B** = `/Users/yangrundong/.codex/worktrees/8f7d/Oh-My-Student` @
  `3831987c0568b66b6b43aacaf999760757922e3c`（`codex/contract-repair-integration`）。
  **B 只读**：只允许 `git -C <B> show/cat-file` 取证，不写、不 checkout、不跑测试。
- 本仓库旧 `bin/ app/ .pi/` **不是**新系统的产品合同源；不要照抄，也不要为了兼容旧格式复活它们。
- 原生接缝与版本锁定见 `docs/runtime/upstream-lock.json` 与 `docs/runtime/bootstrap.md`；不要凭记忆升级 DSH。
- DSH `0.1.5-rc.2`（tag commit `fb2c4b9e698e30edb738bca4cf0618587db7d203`）、Node `>=24`（本机 `v24.13.0`）、
  TS `6.0.3`、cordis `4.0.2`。**锁文件是唯一裁判**，不允许混 rc。
- P0 已接受 commit `a45d9f5749062229f5f96ff3efa3dd989931d9f1`，G0 PASS 审查 `13b5c2e`。
  **保留 P0 版本/构建补丁**：`scripts/patch-sdk.ts` 的生成器构建期修正连同 `package-lock.json` 一起保留；
  升级 SDK 时必须重新核验该补丁，不能静默沿用。

## 新用户裁决优先（不得回退）

以下旧计划/旧仓要求**已失效**，不要以“保持一致性”为名恢复：

- 不恢复「两个对象才能保存学情 / `verifiedAbility`」门槛；一次真实观察可以带情境保存。
- 不恢复 `reason` 必填、`minor` 例外、全树编辑版本、全输入证据表、global 审批、固定重试/裁图次数。
- 身份、来源、确认、复习**实际结果**仍必须正确：模型不填 ID/路径/时间戳/派生结论；
  回复失败不装成功；复习只由记档推进。

## 文件与目录

- 唯一产物是 **R/dsh**；所有相对路径默认从本目录算。
- 已知包边界：`packages/contracts`（schema/DTO）、`packages/domain`（领域逻辑与存储）、
  `packages/host`（原生 Host 接线）、`packages/client`（原生前端接线）。
  包边界是职责声明，**空包不自动等于要建服务**；同职责可并入已有文件。
- 测试按层放：`tests/unit`（纯逻辑，`vitest.unit.config.ts`）、
  `tests/integration`（真实进程/端口/文件系统接缝，`vitest.integration.config.ts`）、
  `tests/e2e`（Playwright 原生浏览器，`playwright.config.ts`）；后续 `tests/live` 只放真实模型/外部服务。
- 两条 Vitest 配置一律 `passWithNoTests: false`：**零匹配就是失败**，不许用兜底把空测试假装成 PASS。
  P1.1 阶段 `tests/unit`、`tests/integration` 尚无真实用例，跑 `npm run test:unit` / `test:integration`
  预期各自退出 1（`No test files found, exiting with code 1`）——这是未使用例的正确红灯，不是缺陷。
- 临时运行态一律进 `.runtime/`（已 gitignore）。

## 执行红线

- 不用 `npx` 或全局 CLI 隐式拉版本；只用本目录锁定的脚本与依赖。
- 不启动/不 kill 共享服务（研究仓 4877、旧 DSH checkout、其他 worktree 的任何端口）。
  需要真实运行时一律用 `scripts/dev-isolated.ts` 的临时 `DSH_HOME` + `--port 0`。
- 不读取真实用户凭据，不把认证 token 写进日志、补丁或提交。
- Git worktree 根带开发指令与旧学习文件：**不要把 worktree 目录当课堂工作目录**。
- 不提交：本迁移由主 Agent 统一维护台账与提交。
