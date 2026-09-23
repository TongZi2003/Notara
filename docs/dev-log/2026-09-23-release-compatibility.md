# Native Vault 兼容性审计与工作流验收

日期：2026-09-23。目标：审计 `codex/notara-vault-clean` 的累积实现，跑通资料拆解与教学流程，交付同名远端分支。

## 结论与边界

兼容性检查通过；DeepSeek Flash 主教师与 OAuth 接入的 `gpt-5.6-sol` 子代理实际完成拆卡、备课、模拟授课、小结和续课绑定。流程中发生过数学错误、评估误判与漏写认知演变，经人工纠正后推进，**不能称为无干预教学质量通过**。评估规则已针对真实失败修订，并在有限回放中验证。最终 Native Vault 为 0.14.7，Pixel Classroom 为 0.4.0。

用户最后确认：**小结保存就是教学归档，默认保留原会话供继续交流**。因此不再把原生会话移入归档集合当作教学验收门槛；原生菜单的归档仍是用户明确选择的收起动作。

## 环境与隔离

- 工作树：`/Users/yangrundong/.codex/worktrees/notara-vault-clean/DSH`；分支 `codex/notara-vault-clean`，主目录 `main` 未修改。远端 `TongZi2003/Notara`，正常推送功能分支，不强推或合并 main。
- Node 24.13.0，DSH 依赖保持 lockfile 中的 0.1.5-rc.2。所有实例来自 `scripts/dev-isolated.ts`，随机端口，仅合成学习资料；用户授权复用模型配置及凭据到临时环境，没有导入真实学习数据。
- 完整真实流程：`http://127.0.0.1:64383/`；数据根 `/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-wzK4aU`。
- 0.14.7 评估回放与小结浏览器检查：`http://127.0.0.1:57420/`；数据根 `/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-pTDnPZ`。

## 修复与兼容性

1. `packages/host/src/teaching/teaching-context.ts / installTeaching`：旧 Host 过滤掉了原生子代理的 `structured_output`，造成命题回合无法返回结果。补齐只提交结果的工具白名单，仍保留写入、学情和嵌套委派限制，相关 17 项与全量集成均通过。
2. `examples/native-vault/classroom-client.js / taskElapsedLabel`：运行态用当前时间，完成态固定到 `finishedAt`；无结束时间的旧中断记录不编造耗时。真实 GPT 任务完成后列表/像素视图耗时不再增长。
3. 修正与现合同漂移的测试：路线总述日志、共用 RPC 清单、受限世界书标题、渐进披露请求取样、跨集已读历史、默认工具清单与卡片来源夹具。未放宽来源、权限、版本和隔离断言。
4. `resources/vault-teaching/base.md`、`skills/method-distillation.md`、CLI help：明确困难必须有实际负面证据，缺少步骤不算失败；先保存认知演变正文，再记录评估并分别核对回执。分析见 [评估证据审计](2026-09-23-assessment-evidence.md)。
5. `teaching-runtime.js / requestSummary`、`SummaryEntry`：教学按钮改为“总结本课”，默认保存小结、保留会话；重复请求已保存小结不触发隐藏。原生归档入口单独保留失败重试与新输入保护。工具说明、Skill 和设计合同同步。
6. 清除早期 dev-log 残留登录参数。候选文件扫描未发现实际密钥、私钥、认证文件或超过 10 MiB 的文件。凭据、隔离运行目录与完整会话不提交。

干净源码副本完成离线 `npm ci --ignore-scripts`、`npm run postinstall` 和两个插件构建，rc.2 摘要校验补丁可从干净安装重建。Native Vault 包有 74 个文件；Pixel 包有 112 个文件、10 张生产人物图集，运行模块引用闭合。旧 `notara/solver-*` 只读兼容，新 worker 配置按预设独立保存，冷恢复、取消与跨会话边界有确定性集成证据。

OAuth 底层 `llm-pi-ai/openai-codex` 已真实调用成功，Web 模型设置仍没有授权入口。本次通过临时原生设备码授权流程接入，没有将订阅凭据导出成 API Key。Node 默认不采用 macOS 系统代理，临时 OAuth 进程显式采用已启用的本地代理后连接成功，TLS 校验未关闭。

## 验证记录

| 层级 | 结果 | 证据 |
| --- | --- | --- |
| 产品/测试类型、合同 | PASS | `tsc --build --pretty false`、`tsc -p tsconfig.tests.json`；91 个同源 schema |
| 构建与干净安装 | PASS | `npm run build`；Native Vault/Pixel 构建；干净副本离线安装与 postinstall |
| 主体单元检查 | PASS | Native Vault 249/249、像素插件 4/4、领域 195/195 |
| 全量集成首轮 | FAIL，已修复 | 340/344，结构化输出过滤与默认工具名单问题 |
| 主体实现全量集成 | PASS | 84 文件、344/344，日志 `release-compatibility/integration.log` |
| 0.14.7 针对性单元 | PASS | teaching-runtime、teaching-resources、agent-tools、vault-cli、review-data，29/29 |
| 0.14.7 针对性集成 | PASS | native-vault-teaching、native-vault-review，串行 6/6 |
| 0.14.7 真实回放 | 有限场景 PASS | 正确但省略过程：3 demonstrated + 1 not_observed，无 needs_practice、无排期；当前困难：保留 needs_practice。两次均先正文后评估并回读核对 |
| 0.14.7 浏览器 | PASS | 点击“总结本课”→真实模型保存与索引小结→课堂仍在列表→输入草稿可发送；console error/warn 为零 |
| 无干预教学质量 | 未通过 | 完整课堂曾误改正确卡片、误判未观察为困难、漏写学生理解；详见下文 |

针对性集成首次并行运行撞到共用的 `examples/native-vault/teaching/skills` 构建目录，`ENOTEMPTY` 导致 6 项失败；串行运行后 6/6 通过。这个失败属于测试启动方式的共享构建冲突，不是课堂行为回归。后续同类隔离实例测试必须串行重建插件目录。临时回放第一次直接用 Node 运行 TS 入口失败于 `.js`→`.ts` 解析，改用 lockfile 的 tsx 后启动成功，没有改动源码掩盖错误。

0.14.7 只重跑受影响检查，没有重复全部 344 项。macOS/Node 24 的结果不代表 Windows/Linux 或其他 DSH 版本通过。

## 真实教学链路与失败

主教师使用 `deepseek-official/deepseek-flash` high；problem、lesson、review 工作员使用 `openai-codex/gpt-5.6-sol` high，8192 输出预算、无工具。以两道合成二次方程为资料：

- 略读→两个独立题目工作员→主教师保存两题卡与共性父专题（236 秒、3 次写批准）。题卡保留题面、原答案、三段正文、tags 与 parent。
- 备课工作员→主教师保存四阶段、10 分钟剧本（330 行、5 个默认折叠教师块）及路线（343 秒）。浏览器从路线进入真实课堂。
- 模拟学生从“两因数都必须为零”的误解出发，经反例修正，完成两题及一题迁移；第三题创建新卡。
- 小结追加原剧本，lesson_log 指向同一块，不产生重复小结文件；原节点重开复用同一会话，下一课读取显式前课小结。主教师还添加了符号变式后续节点和备课资料。
- 浏览器核对：原生子记录可打开；任务耗时固定；卡片公式/标签/折叠可见；图谱父节点子卡列表、右键菜单、邻接图和标签筛选成立。

**保留的质量失败：** 教师混用根之和与因式常数之和，曾在修路线时改坏 GPT 原本正确的题卡句子，经独立 review 和明确反馈后修正。题1把未展示逐对核验记成困难，且认知演变正文为空；纠正后保留撤销痕迹并重记、补正文。最终旧课堂回读仍发现题2学生理解为空。收课阶段曾有两次 Bash 失败，后自行恢复；最初“归档完成”的口头说法与原生归档参数不一致，用户随后明确教学归档仅要求小结保存，默认不需隐藏会话。

评估回放第一场耗时18秒、12次工具调用，无工具失败；第二场17次工具调用，一次探测不存在模板目录的 Bash 返回1，随后正常完成。第二场在独立会话但共用隔离 Vault 中读取了第一场的相关记录，因此它证明存在历史成功信息时仍可按当前明确困难记录，不是严格独立输入的模型对比。最终话术仍偶有内部文件路径等不理想表达，没有据此宣称学生体验全面验收通过。

## 证据

日志和截图在 `docs/evidence/release-compatibility/`；`workflow-closeout.json` 为旧真实课堂最终回读，`assessment-replay.json` 为新回放题卡与小结结果。只保留合成资料的有限结果与脱敏证据，不提交完整原始对话或授权数据。推送目标为 `origin/codex/notara-vault-clean`，提交与远端 SHA 由交付时单独核对。
