# 产品基线/范围记录（P1.1）

本文件只登记 P1.1 接收的**事实**与**边界**。它不证明任何产品行为；
行为证据按各阶段自己的命令与日志登记。裁决来源：`docs/superpowers/plans/2026-09-11-dsh/`
下的总计划 v2.3、[CONTRACTS](../../../docs/superpowers/plans/2026-09-11-dsh/CONTRACTS.md)、
[SIMPLIFICATION](../../../docs/superpowers/plans/2026-09-11-dsh/SIMPLIFICATION.md)、
[BASELINE](../../../docs/superpowers/plans/2026-09-11-dsh/BASELINE.md)。近目录规则见 `dsh/AGENTS.md`。

## 1. 两个仓的职责

| 角色 | 位置 | commit | 用途 |
|---|---|---|---|
| **B 产品基线** | `/Users/yangrundong/.codex/worktrees/8f7d/Oh-My-Student` | `3831987c0568b66b6b43aacaf999760757922e3c`（`codex/contract-repair-integration`，2026-09-11 16:38:05 +0800） | 旧产品**行为**事实源：只读，用 `git show <commit>:<path>` 取证 |
| **R 迁移产物** | `/Users/yangrundong/Oh-My-Student-dsh-migration/dsh` | 分支 `codex/dsh-native-migration` | 本迁移的唯一写入范围；已接 P0 |

B 只读，不写、不 checkout、不跑测试；BASELINE 记录的唯一脏项是无关的已删除 swap 文件，不纳入基线。
本仓旧 `bin/ app/ .pi/` **不是**新系统的产品合同源。

## 2. 版本锁定（锁文件是唯一裁判）

| 项 | 值 | 来源 |
|---|---|---|
| DSH | `0.1.5-rc.2`，tag commit `fb2c4b9e698e30edb738bca4cf0618587db7d203` | `docs/runtime/upstream-lock.json`；P0 G0 |
| Node / npm | `>=24` / 本机 `v24.13.0`、`11.6.2` | `dsh/package.json` `engines`、`.nvmrc` |
| TypeScript | `6.0.3` | 由 rc.2 生成器的 `^6.0.3` 定点决定；不用 TS 5 |
| cordis | `4.0.2` 家族 | `package-lock.json` |
| React / Playwright | `18.3.1` / `1.63.0`（Chromium 153） | P0 G0 运行环境 |
| Vitest | `4.0.18`（Vite `7.3.6`） | **P1.1 新增**：`vitest run --config` 两条入口 |

所有 `@deepseek-ai/dsh-*` 必须整体落在同一 rc；混 rc 视为缺陷。
**P0 版本/构建补丁保留**：`scripts/patch-sdk.ts` 验证原/新 SHA256 后只补生成器对普通 npm 协议声明的识别；
升级 SDK 必须重新核验，不能静默沿用。

## 3. 实际目录映射

| 边界 | 路径 | 现状 |
|---|---|---|
| 契约 | `packages/contracts/src/` | P0 只有 `probe.ts`；P1.2 在此落 schema |
| 领域 | `packages/domain/src/` | 空包边界（`tsconfig` 仅引用 contracts）；P1.3 落 `storage/record-store.ts` |
| Host | `packages/host/src/` | P0 `probe-service.ts`/`index.ts`；P1.4/P1.5 在此接线 |
| Client | `packages/client/src/` | P0 原生 shell/slots；P2 才动学生界面 |
| 测试 | `tests/e2e`、**`tests/unit`**、**`tests/integration`** | e2e 为 P0；unit/integration 目录与入口为 P1.1 新建 |

复用 P0 的测试启动 fixture：`scripts/dev-isolated.ts` 的 `startIsolated()`（临时 `DSH_HOME`、
系统临时课堂目录、`--port 0`、`stop()` 幂等并回收）。集成测试不得抢固定端口或碰共享服务。

## 4. 新用户裁决优先（不得回退）

按 SIMPLIFICATION，旧计划中以下要求**失效**：两对象学情保存门槛/`verifiedAbility`、`reason` 必填与
`minor` 例外、全树编辑版本、全输入证据表、global 审批、固定重试/裁图次数、「每次编辑全作品 digest」。
同时**不删除**真实要求：身份/来源/确认/复习的实际结果、真实作答时间、卡前后内容版本、
同版确认采用的内容、不可变原件版本与 locator、单记录原子条件更新与陈旧写拒绝。

## 5. 本阶段边界与验证入口

- P1.1 只做基线接收与测试配置；**不实现 P1.2–P1.5 的 schema/存储/授权/原生能力接线**。
- 命令（本目录，Node PATH 显式指向 `v24.13.0`）：

  | 检查 | 命令 | 期望 |
  |---|---|---|
  | 基线可读 | `git -C <B> cat-file -e 3831987c…` | 退出 0 |
  | 类型检查 | `npm run typecheck` | 退出 0 |
  | 单元入口 | `npm run test:unit` | **退出 1**：P1.1 尚无 `tests/unit` 用例，零匹配按设计失败 |
  | 集成入口 | `npm run test:integration` | **退出 1**：P1.1 尚无 `tests/integration` 用例，零匹配按设计失败 |
  | P0 浏览器回归 | `npm run test:e2e` | **仅在接线影响 P0 时**重跑；P1.1 未改 P0 产物 |

- 未接受：真实模型、真实搜索 provider、托管多租户、Windows 与真实学生课堂。
