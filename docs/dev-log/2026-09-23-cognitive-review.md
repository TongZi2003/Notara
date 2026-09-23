# 具体能力评估与间隔复习

## 用户目标与边界

用户确认：评价学生承担了哪些关键认知工作，不按老师提示次数或“提示后做对”统一降级。同次作答可以支持某项能力，而另一项尚未观察；未知不是失败。认知演变决定下次检验内容，间隔机制安排检验时间。

工作树 `/Users/yangrundong/.codex/worktrees/notara-vault-clean/DSH`，分支 `codex/notara-vault-clean`。Native Vault 0.14.2 → 0.14.3。保留全部先前脏改动，不涉及旧 packages 下的数据库复习账本，不导入或改写已有学生资料。

## 实际合同

`record-review` / `recordReview` 接收现有 path、expectedRevision、必需 note，以及 `assessments`：1–8个仅含具体 ability 与 outcome 的对象，名称不重复。结果为 demonstrated、needs_practice、not_observed。一次评估里的目标在教学语义上由主教师负责；运行时不试图用关键词或提示数量推断能力。

- 任何实际困难：降一档（最低1）；尚未开始则从1档安排。
- 无困难但有未知：追加历史，原档位、last_review、next_review 不变；未开始的卡保持未排期。
- 全部能力得到证据支持：首次第1档；到期后才升一档（最高5），提前或同日成功不延后到期。
- 1/3/7/16/35天不变，mastery只代表复习档位，learned表示已开始复习。
- 旧 passed 历史只读保留，不推导成新的能力观察；新写拒绝旧格式及混合字段。旧行和快照的附加字段在追加或撤销时保留，格式损坏则明确报告并阻止写入，不伪造actor或历史快照。

详细认知演变仍归卡片正文“学生理解”；note只存当次证据摘要，没有另建画像、掌握度分数、目标账本或认知事件系统。

## 改动锚点

- `review-data.js / validateAssessments、validateReviewNote、historyRecord、nextState、recordReviewContent`：唯一校验、三态调度、时距门槛、旧记录保留；历史未知条目也可撤销。日期及身份仍由Host绑定。
- `review-runtime.js / record`、`index.js / recordReview`、`vault-cli.js / record-review`：新合同贯通UI与教师CLI，回执返回派生的scheduleChanged；CLI直接复用校验，字段错误给出修复说明，Unicode预算一致。
- `calendar-data.js / calendarProjection`、`calendar-client.js / assess`、`live-preview.js / PropertiesWidget`：能力逐项填写、保存回执、三态展示、旧记录明确标注；资产与日历不会把未知写成失败。损坏记录有到对应文件的检查入口；写入失败展示Host给出的原因并保留输入。
- `resources/vault-teaching/skills/method-distillation.md / 记录评估与复习档位`：详细判断口径，苏格拉底引导示例、目标范围、证据缺口和下次检验。base、vault-workflow、material-search、socratic及worker公共/核验/出题规则同步；不为每句话生成评估，不强制引导后立刻补测。
- `docs/migration/2026-09-22-vault-calendar-review.md`、迁移索引与AGENTS更新有效合同。

## 子代理与主审裁决

只读explorer核对旧调用方与测试覆盖，资源写者独占8份教学正文，主Agent核对并修正base仍残留的“有无提示”三分口径。独立审查验证了确定性调度，并指出历史附加字段丢失、旧passed机读投影推成新结论、CLI错误与Unicode口径等问题，均已修正并加回归。

审查建议对缺actor/快照的旧行补齐或容错：未采纳。核对已部署0.14.2源码，原写者本来就写完整字段；不凭损坏记录编造出处或before/after。保留fail-closed，增加可定位的检查入口。此结论不声称读取或修复了任何真实学生数据。

## 验证

证据目录 `docs/evidence/cognitive-review/`，Node v24.19.0，锁定依赖。

- PASS，44/44定向node:test：`node --test examples/native-vault/review-data.test.js examples/native-vault/vault-cli.test.js examples/native-vault/card-contract.test.js examples/native-vault/live-preview.test.js examples/native-vault/teaching-resources.test.js`，见unit-reviewed.txt。含未知/混合观察、提示不作机器惩罚、同日/提前不升档、到期升档、真实困难、上下界、非法参数、重试、旧历史附加信息、撤销、CAS、日历投影和CLI修复反馈。
- PASS，真实可见浏览器：`node node_modules/@playwright/test/cli.js test tests/e2e/native-vault-review.spec.ts --headed`。临时Vault、合成资料，覆盖逐项填写、未知不排期、刷新重开、同日复习不升档、撤销、卡片属性展示及损坏记录定位；见browser-accepted-retest.txt与ability-review.png，console/pageerror无异常。
- PASS，真实Host、合成模型：`node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/native-vault-review.test.ts`，1/1，见integration-final.txt。检查完整新Skill正文实际进入请求，原生Bash调用CLI后真实文件落盘，actor/session/id/time由运行时绑定，未知不启动排期。
- PASS，根tsc --build、6份改动JS的node --check、git diff --check、构建资源一致；类型检查成功无输出。生成客户端和teaching副本由标准构建生成。
- PASS，`npm pack --dry-run --json --ignore-scripts`，0.14.3及新教学资源入包，见package-content.json；未发布远程包。
- 初次红测7/7失败证明旧写者拒绝新合同。浏览器初次在空会话尚未稳定时切页丢失，随后以真实合成会话验证；另一次测试定位器误写为复数property-records，已改为现有真实类名。扩展往返检查发现真正的既有缺陷：点同一张卡清空详情而selected未变，读取effect不触发，导致永久加载；pick现在增加现有刷新tick，往返测试通过。失败证据保留。
- 未运行：全仓测试、真实模型教学判断质量、真实学生体验。合成模型证明装配与落盘链路，不证明模型会稳定区分认知贡献、证据缺口及适当复习目标。

## 服务交付与回退边界

已更新原 `http://127.0.0.1:57093/`，数据根 `/Users/yangrundong/.notara/vault-runtime`。冷启动后0.14.3、两处插件链接、preset资源及12份关键安装文件核对一致；升级前后7个会话身份摘要相同，无运行任务。记录见deployment.json。未改模型配置、课堂正文或学生卡片。

PID28289，launcher PID28287，exec session20396；这些只代表本轮交接状态，操作前须重查。快照vault-plugin-0.14.3，备份pre-cognitive-review-1790100812997保留旧配置与链接，旧0.14.2快照仍保留。

新版本读旧历史；0.14.2读者不能读取新的assessments历史，因此一旦已有新评估落盘，不能只切回旧插件快照。需要回退时保留新历史读侧或在当前版本修复，不能把新记录删除或压回passed以换取兼容。
