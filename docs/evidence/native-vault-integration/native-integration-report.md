# 原生隔离集成验收报告（HTTP，无浏览器）

范围：`tests/integration/native-vault-teaching.test.ts` + `tests/fixtures/vault-http.ts`（本轮只写这两个测试文件）
实例：`startVaultIsolated({ testModel: true })`（临时 DSH_HOME、临时课堂、随机端口、本实例插件快照 `root/vault-plugin`）
模型：合成 `notara-vault-test/vault-test` 适配器，`model-requests.jsonl` 记录真实装配请求
夹具：原生 `/api` RPC + `/api/remote.mux` 上打开 `$events` 流，并用 `/api/$events/result` 回原生 approval —— 写入不绕批准直调工具

运行命令（仓库根，Node 24 本地运行时，单文件）：

```
/Users/yangrundong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts \
  tests/integration/native-vault-teaching.test.ts
```

## 状态：4 PASS（2026-09-21，连续两轮 `Tests 4 passed (4)`）

日志：`/tmp/vault-test5.log`（最终轮，含新增 C 段断言）、`/tmp/vault-test4.log`（归档修复后首轮）。

| 用例 | 结论 | 证据 |
| --- | --- | --- |
| A01/A02 教学设置→装配请求、同课切教法、重启冷恢复、普通预设 | PASS | 首条主请求生效系统快照含费曼法/理解条件概率/先让我自己试；切讲解式后生效快照为讲解式、旧快照按原生 in-history 保留（设计行为）；重启后 revision 2 设置仍在、同一 session 未分裂；`standard` 会话 skill 目录无 `notara-*`、toolSchemas 无 Vault 教学工具 |
| A04/A05 目录/检索/正文/PDF 页 | PASS | `vault_list` 只给文件名不注入正文；`vault_search` 命中 `知识/向量.md` 且带 `vault:` ref 与 24 位 revision；PDF 第 2 页返回真实页文本 `A point can be described by its coordinates.`，页图 attachment 进入下一次真实模型请求 |
| A08 原生批准与 CAS | PASS | 允许一次→`卡片/条件概率卡片.md` 落盘、`"saved":true`、approval 帧含 `vault_save`+callId；拒绝→无文件、模型看到原生 `rejected` 文本；外部改文件后按旧 ref 保存→失败，外部内容保留，失败文本原样回灌 |
| C01/C02/C03 路线、小结落点、索引、归档 | PASS | 路由建/开、重复打开同 session、两路线交错时后课绑定的是本节课真实前课小结、「归档并总结」排真实模型回合、有剧本 append 到原文、无剧本独立小结、同课堂新截止点修订原块（不新增块）、`lesson_log` 索引、`archive:true` 真实归档进 `archivedSessionIds`、未要求归档时不归档、归档后小结仍可索引 |

## 归档失败（本轮已修复并复验）

首轮 3 PASS/1 FAIL：`save_lesson_summary {archive:true}` 恒返回 `archived:false / archivePending:true / cutoff:"empty"`，`archivedSessionIds` 为空。
根因：`system-prompt/assemble` 早于 inbox 消费，在那里冻结的 `prepared.cutoff` 与真实会话不一致，`archiveSaved` 的 `teachingCutoff(session).cutoff !== result.cutoff` 恒真（实测 user/message 在 seq 8，冻结值为 `"empty"`；独立重放 `agent/inbox/spliced` 得 pending=0，不是新输入分支）。
修复（主 Agent，`examples/native-vault/agent-tools.js` + `teaching-runtime.js`）：pre-execute 最开头 `service.prepareTool(exec)`，在真实 user/message 已入 log、原生批准等待之前按 `session.id:callId` 冻结 cutoff；`writeSummary` 优先用该 operation 快照。复验：第 4 条转为 PASS，`archived:true` 且 Host 自身归档列表含该 session。

## 分层记账

- 类型检查：`tsc -p tsconfig.tests.json --noEmit` 对本轮两个新文件无报错（仓库其他测试文件存在既有报错，与本轮无关）。
- 确定性集成：本轮单文件 4/4 PASS，连续两轮一致。
- 真实模型：未运行（`DEEPSEEK_API_KEY` 不存在，Live 层独立标 BLOCKED）。
- 真实学生体验/浏览器：本轮不覆盖，由 Playwright lane 负责。
