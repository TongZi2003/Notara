# P1–P7 最终验证（2026-09-12）

实施：`Oh-My-Student-dsh-migration/dsh`，分支 `codex/dsh-native-migration`。产品 B 固定 `3831987c0568b66b6b43aacaf999760757922e3c`；DSH `0.1.5-rc.2` / `fb2c4b9e698e30edb738bca4cf0618587db7d203`，Node `v24.13.0`，TypeScript `6.0.3`。原仓、B、共享服务不参与写入或启动。全部 runtime 由 `startIsolated` 创建、独立端口和目录，结束回收。

归档日志仅清理行尾空白与末尾空行，保留实际成功/失败内容。最终源码相对构建只另清理了一处文件末尾空行。

## 结果

| 检查 | 最终证据 | 结果 |
|---|---|---|
| 正式 build、生成 Remote、产品 strict | `build.log` | PASS，exit 0 |
| 测试 strict | `test-types.log` | PASS，exit 0 |
| 单元套件 | `unit.log` | 63/63 PASS |
| 同源 schema | `contracts.log` | 80 PASS |
| 集成套件 | `integration.log` + `day-corrected.log` | 全套 210 PASS/1 FAIL；修正日历旧断言后该文件 7/7 PASS，211 个不同用例均有最终通过结果 |
| P4 + 跨阶段浏览器 | `../P4/browser.log` | 11 PASS |
| P5 + Memory 浏览器 | `../P5/browser.log` | 9 PASS |
| P6 规划浏览器 | `../P6/browser.log` | 7 PASS |
| P7 小结/接续 | `../P7/browser-review.md`、`browser-last-run.json` | 5 PASS；其中一项主要通过 native Remote |
| P3/P5 浏览器回归 | `p35-browser.log` | 11 PASS |
| 收尾 UI 定向验证 | `ui-closeout.log` + `lesson-draft.log` | 3 PASS/1 等待条件失败；等待真实草稿保存完成后，新增本课设置用例 1/1 PASS |
| 外部能力与 P7 专项 live | `live.log` | 2 PASS、7 BLOCKED（runner 用明确原因 skip），没有真实模型 PASS |

以上 Playwright 文件共 **44 个不同场景**，收尾重复的三个旧场景不重复计数。P0–P2 的阶段报告继续保留；这不是一次 P9 全产品验收，也不是 44 次真实学生上课。

主套件在正式 bundle 上完成；随后只改本课设置提案编辑、目录选择注入、书结构刷新失败和一处提示文案，再统一正式 build，按影响跑四条浏览器复验。底层领域与 Host 源码未在这一轮 UI 修复中变动。最终源码/锁文件/构建摘要见 `snapshot.json`。

## 命令

在 `dsh/`，将 Node v24.13.0 加到 PATH 后运行：

```sh
npm run build
npm run typecheck:tests
npm run test:unit
npm run check:contracts
npm run test:integration
npm run test:integration -- tests/integration/day-projection.test.ts
npm run test:live
```

每组浏览器的精确文件列表在对应日志第一段；`P7/browser-review.md` 保留其实际命令。最后本课设置用例为 `npm run test:e2e -- tests/e2e/lesson-settings-draft.spec.ts`。

## 失败与恢复

1. 集成旧断言认为已开课节点应从原日期安排中消失，与 P6.5 合同冲突。保留原失败，修正断言后七条日期投影通过；没有为绿灯删掉场景。
2. 新增本课设置浏览器用例发现卡片页缺 `remote.studyforgeTeaching` 的 Cordis inject；访问目录时整个 scope 被卸载，无 window pageerror。补齐依赖后编辑器可用。初始失败见 `ui-injection-failure.log`。
3. 下一次用例过早读取草稿，原稿也满足“包含 learningSetRef”，因此读到保存前文本。改为等待编辑器在成功保存后关闭，再核对真实草稿和课堂结果；`lesson-draft.log` 通过。没有绕过 UI 或直接给测试改存储。
4. P5 未知写入恢复测试让真实 Host 先成功，再丢响应；回放相同 operation/payload，卡和复习都仅有一份效果。P7 planned/continuation 开课修复了 DSH workspaceId/cwd 互斥参数，且从 UI 验证新课真正可输入。

## 外部模型边界与执行入口

`DEEPSEEK_API_KEY` 缺失；用户备用 OpenCode 密钥未读取到运行配置、未使用、未写入文件。`test:live` 的两个 PASS 仅是 provider 装配和匿名真实 HTTP，不是课堂或搜索模型。

P7 五个专项入口已存在、strict 通过，缺凭据时逐项明确 BLOCKED：

- `tests/live/prompt-change.test.ts`：同课教法/临时要求进入原生 prepared prompt。
- `tests/live/book-breakdown.test.ts`：真实阅读→骨架/卡提案→确认→固定来源。
- `tests/live/problem-and-delegates.test.ts`：独立子任务结构化命题→Host 登记普通未学卡。
- `tests/live/search-main-subagent.test.ts`：主搜索与追问、原生子搜索和真实 URL。
- `tests/live/lesson-continuity-v2.test.ts`：真实讨论→确认关闭→课后原课→日历日报→固定版接续。

这些测试使用独立正式 Host、真实 provider 和公开 session/page；辅助传输曾由验证 Agent 用隔离可控模型校准，不记作实模证据。测试默认选择 `deepseek-official/deepseek-v4.1-flash`，可用 `STUDYFORGE_LIVE_MODEL` 显式选模型。自然模型行为、搜索服务可靠性与完整课堂效果仍未验证，G7 的完整实模门保持 BLOCKED。
