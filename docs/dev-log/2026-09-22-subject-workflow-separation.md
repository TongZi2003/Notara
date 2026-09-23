# 学科关注点分离与知识型课本工作流

## 本轮范围

2026-09-22 先交方案，用户随后确认实施并补充：知识型课本以知识单元研究为主线，general 独立研究动机、条件、依赖、解释、例证与边界，不能降成摘录。实施与验收于北京时间 2026-09-23 收尾。Native Vault 升至0.14.0，实际验证 Node v24.19.0。

工作树：`/Users/yangrundong/.codex/worktrees/notara-vault-clean/DSH`，分支 `codex/notara-vault-clean`。已有大量未提交改动保留，未提交、回滚或清理。

## 文档锚点

- `docs/migration/2026-09-22-subject-workflow-separation.md`：现状差距、分层职责、两个通用流程、六科学科重点、旧领域兜底、卡片与工作员合同、显式加载、四项实施任务及分层验收。
- `docs/migration/README.md / 当前 Vault 教学迁移`：当前合同入口，链接本轮实现和分层验证记录。四份前序合同增加当前规范说明，保留历史阶段记录。

## 实际改动

- `resources/vault-teaching/skills/subject-*.md` 与 `manifest.json`：六科独立关注，加 science/humanities 两个未细分领域兜底，共八个学科入口；不改四种教法选项，不把学科规则全部常驻。
- `base.md`、`persona.md` 与通用 Skill：独立拆书与课程编排，支持上传、网络、无教材目标驱动。主教师定范围和框架，显式选读学科并通过 `ask_worker.skills` 交接，最后审阅、写回和归纳知识联系。
- `workers/base.md / 当任务要求卡片时`：工作员共用三段合同，完整原文与原答案进入可检索正文，学生理解无证据留空；problem 单题研究，general 知识单元研究或纯证据报告，不强造题卡。
- `worker-catalog.js` 与 `solver-runtime.js / installSolver`：目录、工具说明和 goal 材料指引同步知识研究职责。保持五角色、独立上下文、至多四个 Skill、原生权限与单任务并发；工作员无 Bash、联网、写入或嵌套委派。
- `lesson-preparation`、`workers/lesson.md`、`workers/exercise.md`：学习任务与对应教师参考，涵盖解答、文本分析、实验解释、代码与测试；实际运行由主教师执行并保留结果，未执行不声称通过。
- `templates/{lesson,lesson-script}.md` 与 `vault.js / SUPERSEDED_TEMPLATES`：任务式模板、就近折叠，仅精确升级旧内置文本，不覆盖自定义模板或既有剧本。独立旧模板 fixture 在 `tests/fixtures/native-vault/`。
- `AGENTS.md` 同步0.14.0职责与构建副本优先读取事实。

## 关键取舍

复用 `manifest.json` 与 `ask_worker.skills`，不新增路由引擎或角色。非题目语义单元交 `general`；编程测试内容由工作员设计、主教师用既有工具执行。原题、原答案、三段卡片与真实学生证据保持；开放任务允许有依据的不同表达。保留旧 science/humanities 入口作为未细分领域兜底。

只读子审查确认生成副本优先读取风险，方案已将构建及副本一致性检查放在测试前；补充唯一 locator 和 `subject-` 前缀约束。未采纳把旧入口改名为 biology/history 的建议：这会缩小既有人文语言范围并制造无必要的 ID 变动。未采纳自动将 subjects 映射到加载或把流程注册成教法选项；继续按当前任务显式选取。

## 验证与证据

所有自动化使用 `scripts/dev-isolated.ts` 的临时目录、随机端口和冻结插件快照，未拿真实课堂当fixture。以下命令在仓库根使用Node24与锁定依赖；证据目录为 `docs/evidence/subject-workflow-separation/`。

| 层级 | 结果与命令 |
| --- | --- |
| 修改前回归定位 | 预期FAIL，11项中3通过、8失败：新学科未登记、旧模板未升级，见 `before-unit.txt`。最初测试误将父执行句柄算成模型内容，已修为检查persona/prompt，最终请求由HTTP另验 |
| 构建与副本 | PASS：`node node_modules/tsx/dist/cli.mjs scripts/build-native-vault.ts`；`diff -qr resources/vault-teaching examples/native-vault/teaching`；资源测试逐文件检查无陈旧残留 |
| 定向单测 | PASS，54/54：`node --test examples/native-vault/teaching-resources.test.js examples/native-vault/worker-runtime.test.js examples/native-vault/solver-runtime.test.js examples/native-vault/card-contract.test.js examples/native-vault/lesson-script.test.js examples/native-vault/teaching-runtime.test.js`，最终说明文字修订后重新通过，见 `unit-results.txt` |
| 真实Host、合成模型 | PASS，15/15：`node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/native-vault-solver.test.ts`；最终字符串修订后新增学科用例补测1/1，其他14项未重复执行。见 `integration-results.txt`、`integration-final-retest.txt` |
| 可见浏览器 | PASS，两个场景覆盖：`playwright test tests/e2e/native-vault-subjects.spec.ts tests/e2e/native-vault-fold.spec.ts --headed`。首轮1/2，新用例错误假定刷新保留资产分页，实际会回对话；改为重新打开资产，补测1/1，最终快照再次1/1。保留 `browser-results.txt`、`browser-subject-retest.txt`、`browser-final.txt` |
| 根构建类型检查 | PASS，退出码0：`node node_modules/typescript/bin/tsc --build`；成功无输出，`typecheck.txt`为空，不代表测试代码类型检查也通过 |
| 测试代码类型检查 | FAIL，退出码2：`node node_modules/typescript/bin/tsc -p tsconfig.tests.json`；teaching-rounds、tool-disclosure、journey三个未改文件共5处既存错误；本轮新测试未报错，见 `tests-typecheck.txt` |
| 打包与文本检查 | PASS：`npm pack --dry-run --json --ignore-scripts`，0.14.0及八份学科资源入包；`git diff --check`。未推送或发布远程包 |
| 真实模型教学质量 | BLOCKED，未运行：独立测试环境未提供 `DEEPSEEK_API_KEY/OPENAI_API_KEY`，未提取长期实例凭据；`model-scenarios.json` 保存六科十二个合成场景，先数学拆解和无教材计算机备课两例，再扩展其余十例 |
| 真实学生学习效果 | 未运行；确定性调用、截图与模型自评不等于理解、迁移或成本改善 |

新增HTTP用例检查最终子请求含所选完整学科正文、未选学科缺席、父历史隔离、无工具工作员及课堂投影不含产物；科目标签不会自动注入学科全文。UI核对八个入口可发现、新建任务式剧本、折叠/展开不改文件、刷新重开仍默认折叠，控制台未捕获错误为空。

## 审查与修正

独立只读审查已完成。修正：文科禁止整段引用与完整语境冲突；无教材备课入口仍要求“按资料”；人格数学专属倾向；工具说明未同步general知识研究；兜底H1与入口不一致；文档阶段状态滞后。教学样例读取归通用规则，`DSH_NOTARA_TEACHING` 确实由Host注入，不是虚构变量。

未采纳subjects自动加载、把旧入口改名为biology/history或新增学科角色的建议。原文参考答案完整保留，开放任务允许有依据的不同表达；复习、身份、版本和保存仍归既有机制。

## 长期实例与回退

已将 `http://127.0.0.1:57093/` 的长期试用实例升级到 Native Vault 0.14.0；数据根仍为 `/Users/yangrundong/.notara/vault-runtime`，Pixel Classroom保持0.3.0。切换前两次确认原生session/list的7个会话均未运行，再核实旧launcher属于本工作树后正常停止。全量classroom读取曾返回gateway/internal，未据此推断任务状态；停机依据是原生session的明确running=false。

新快照 `vault-plugin-0.14.0`，保留旧0.13.0。备份目录 `pre-subject-workflow-1790093425728680000` 包含原cordis.patch.yml、两处原链接及待装配配置。只切换两处Vault链接与preset资源路径，未改模型凭据或已有课堂正文。

新进程PID1269，父launcher PID1260，exec session3261。启动后确认0.14.0、八份资源与源文件一致、7个会话身份摘要不变、无运行任务；见 `deployment.json`。使用时刷新页面，新任务用新资源；历史请求中已读到的旧文本不会被重写。

回退前重新核实实例归属和无任务，正常停止，恢复备份配置及两处原链接，再从同一 `scripts/vault.ts --no-open` 启动。不要删除数据根、旧快照或任务记录；进程号是交接时状态，后续操作前须重查。

## 剩余验证

实现与确定性验收完成；十二个真实模型场景尚未执行，没有“六科教学质量全面通过”或“费用下降”的结论。具备独立测试模型配置后按已有场景继续，不需要重新实施本轮改动。
