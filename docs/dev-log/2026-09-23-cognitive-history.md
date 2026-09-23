# 学生理解的认知演变与诊断召回

## 目标与实际边界

用户要求诊断能够召回过往错误模式，并将“学生理解”扩展为有证据的完整认知演变：保留早先不完备/错误认识、改变的触发、得到的帮助和后续实际表现。本轮更新现有 Skill 与提示接线，不实现新的并发诊断调度或新增数据实体。

工作树 `/Users/yangrundong/.codex/worktrees/notara-vault-clean/DSH`，分支 `codex/notara-vault-clean`。Native Vault 0.14.0 → 0.14.1；保护已有未提交改动，未提交、清理或重写学生资料。

## 改动锚点

- `resources/vault-teaching/skills/method-distillation.md / 学生理解：保留认知演变、诊断时怎样使用历史`：记录真实旧认识、转折、支持程度与后续表现；一次经历可记录，但不自动成为稳定错误模式。当前判断与历史分开，来源、日期和缺失环节不能编造。
- `skills/material-search.md / 诊断与错误模式召回`：从当前作答出发，检索卡片/专题的学生理解、画像、锦囊及小结；读完整时间上下文，包含后来修正、成功表现与反证，避免只摘旧错。一个经历的多处引用不重复计数。
- `base.md`、`workers/base.md`、`workers/review.md`、`skills/{material-outline,vault-workflow,worker-orchestration,lesson-preparation,route-planning}.md`：教学、拆卡、写回、交接、核验、备课、路线同口径；旧错不直接代表当前状态，老师解释和原因假设不冒充学生理解。
- `manifest.json`：现有 material-search 与 method-distillation 的描述能发现新用途，不增加重复 Skill ID。两类长期教学记忆仍为画像与锦囊，详细经历仍在已有卡片。
- `teaching-context.js / CONTEXT_ENTRIES、CONTEXT_TRIGGER`：L0 导航提示读取卡片理解历史和后续修正；仍使用既有1200字符预算，不自动注入整段历史。
- `agent-tools.js / save_lesson_summary` 与 `teaching-runtime.js / requestSummary`：工具正文指引及实际归档请求保留有证据的认知变化。小结同课更新语义不变，Skill 明确先读旧小结并保留重要经历。
- `docs/migration/2026-09-23-cognitive-history-and-diagnosis.md`：合同与合成示例；旧记忆、卡片合同入口和 `AGENTS.md` 同步。三段模板保持空白，未加入演变占位或虚构样例。

## 审查结论

主 Agent 核对 `learning-data.js / findLearning`：该候选索引只覆盖 learner-profile/insight，普通卡片历史应通过原生 glob/grep/read 访问；本轮没有把它扩成第三类记忆。revision 仍只检测文件变化，不提供历史正文恢复。

安排的只读子审查遇到上游502，未产出结论；主 Agent 接手完成必要源码核对，没有把失败任务算作独立审查通过。

## 分层验证

证据在 `docs/evidence/cognitive-history/`，使用 Node24 与仓库锁定依赖。

- PASS，构建：`node node_modules/tsx/dist/cli.mjs scripts/build-native-vault.ts`。`diff -qr resources/vault-teaching examples/native-vault/teaching` 一致；安装后又逐文件核对源、快照资源与三份提示接线文件一致。
- PASS，50/50定向测试：`node --test examples/native-vault/teaching-resources.test.js examples/native-vault/worker-runtime.test.js examples/native-vault/card-contract.test.js examples/native-vault/teaching-context.test.js examples/native-vault/teaching-runtime.test.js examples/native-vault/agent-tools.test.js examples/native-vault/learning-data.test.js`。见 `unit-results.txt`。覆盖资源登记、子请求组装、上下文预算、卡片与小结接缝；不是模型认知行为验证。
- PASS，5/5真实Host、合成模型集成：`node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/native-vault-teaching.test.ts`。见 `integration-results.txt`，含设置装配、原生读取、权限、CAS、路线续课、小结与归档。
- PASS，静态：三份JavaScript修改的 `node --check`；`node node_modules/typescript/bin/tsc --build` 退出0，成功无输出；`git diff --check`；教学资源引用均在manifest登记，card/topic/insight模板的学生理解仍为空。
- PASS，打包：`npm pack --dry-run --json --ignore-scripts`，0.14.1及更新资源入包，见 `package-content.json`。未发布远程包。
- 未运行：浏览器（无UI或模板结构变更）、全仓测试代码类型检查、真实学生体验。
- BLOCKED，真实模型质量：独立测试环境未提供模型凭据，未提取长期实例凭据、未发起付费模型请求。尚未证明模型会稳定记录全部关键转折、正确召回旧错与反证或做出可靠诊断。

## 长期实例

原 `http://127.0.0.1:57093/` 已更新到0.14.1；数据根 `/Users/yangrundong/.notara/vault-runtime`。升级前两次确认7个会话均未运行，并核实进程属于本工作树，正常停止后切换两处Vault链接和preset资源路径；未改模型配置、已有卡片或课堂正文。

冻结快照 `vault-plugin-0.14.1`，旧0.14.0保留。备份 `pre-cognitive-history-1790096281631111000` 保存旧cordis.patch.yml、两处原链接和待装配配置。新进程PID12149，父launcher PID12147，exec session32203；安装资源核对一致，7个原生会话身份摘要不变，无运行任务。详见 `deployment.json`。

回退前重新核实实例归属与空闲状态，正常停止，恢复备份配置和原链接，再从同一 `scripts/vault.ts --no-open` 启动；不删除数据根或快照。进程号仅代表本次交接状态。新请求使用新提示，已有模型历史中的旧文本不会被物理改写。
