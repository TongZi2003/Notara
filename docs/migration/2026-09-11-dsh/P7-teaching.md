# P7：学情、当前教法与确认收课 Implementation Plan

> **For agentic workers:** 使用superpowers:executing-plans；G6 PASS后执行五项，交G7。涉及教学schema和工具使用designing-teaching-schemas、authoring-skill-tool-contracts。

**Goal:** 以五种内置主Agent预设承载当前教学能力，支持搜索主/子双入口，保留学情/知识分工、独立命题和可纠正的课堂连续性。
**Architecture:** 学情记录真实可修订认识，知识服务保存内容；Skill负责教学判断，Host负责依据与权限；学生确认小结关闭原课。
**Tech Stack:** TS、DSH skills/tools/systemPrompt/native sessions，Vitest/Playwright/live。

## 全局约束
以B/AGENTS.md、.pi/skills/teaching和bin当前实现为源。旧main的强制追问、concept写入、.d沉淀和自动收课不得带入。日常读Skill不等于新增模式状态机；Creator用途隔离不被误删。首版主预设按UI-FIRST-RELEASE.md收敛为资料整理、诊断分析、苏格拉底授课、头脑风暴拓展、搜索；底层Skill/工具/辅助进程不因此误删。

## P7.1：可修订学情与真实来源
**文件：** packages/domain/src/memory/{memory-service,memory-index}.ts；packages/host/src/tools/memory-tools.ts；tests/integration/memory-v2.test.ts。
**参考：** B memory规则仅供行为来源；两对象阈值/verifiedAbility由本版明确撤销。
**输入：** EvidenceQuery、RecordStore、实际目标；**输出：** note/revise/read/search，自由正文与所采用的来源。
- [ ] 默认分类ability/habit/preference来自配置，允许合理自定义分类；不因对象数量或分类决定能否保存观察，知识内容仍归KnowledgeService。
- [ ] 一次真实观察可写带情境/不确定性的正文，是否形成长期判断由Skill评估；删除两对象硬门槛和自动verifiedAbility字段/标签，两次观察也不自动认证。
- [ ] 偏好使用真实学生表达；学生自述和独立作答的来源身份清楚。对象、原文、时间真实可解析，代码不判断推论强弱。
- [ ] 当前版本采用的来源集合和旧版本形成current/prior读侧，不另外迁移一套依据状态。更正沿原target保留旧内容/出处，冲突先读取新版本再合并。
- [ ] 通用偏好可直接使用通用适用范围，学科判断可填相关科目；含混时Skill询问，不经过global审批或unresolved生命周期。
- [ ] 测单题观察可存、两题不自动认证、自述与作答区别、反例更正、同名新记录不合并、旧版本并发修改被拒、跨科本人读取。
- [ ] 运行 npm run test:integration -- tests/integration/memory-v2.test.ts、evidence/review回归、check:contracts/typecheck；提交。

## P7.2：学情共同编辑与来源展示
**文件：** packages/domain/src/memory/memory-authoring.ts；packages/client/src/memory/MemoryEditor.tsx（本课/学习设置按需打开）；tests/e2e/coauthor-memory.spec.ts；tests/integration/memory-evidence-projection.test.ts。
**输入：** 同一MemoryService/目标版本和真实来源；**输出：** read/preview/save及“和老师更正”意图。
- [ ] 学生和老师编辑同一自由正文、分类及适用范围，显示目前判断和实际来源，历史按需打开；不自动给“已证实”认证或添观察中状态机。
- [ ] 自述来源保留，不能因分类名就变成独立检验；无记录不等于没有学过。当前采用/历史依据由版本投影，旧反证不强制引用到新判断。
- [ ] 学情编辑在已有本课/学习设置入口打开，不强制独立一级MemoryScreen；适用范围对学生可读可改。
- [ ] 读→人改→模型接同target续改→人再改→冲突→重读合并，保留草稿与原话；修改范围不改变账号权限。
- [ ] 运行 npm run test:e2e -- tests/e2e/coauthor-memory.spec.ts、npm run test:integration -- tests/integration/memory-evidence-projection.test.ts、typecheck；验390宽度编辑和恢复。

## P7.3：五教学配置、原生Skill与同课提示更新
**文件：** resources/teaching/manifest.json、base.md、presets/{material-organization,diagnostic-analysis,socratic-teaching,brainstorming-extension,search}.md及按需skills/；packages/host/src/teaching/teaching-context.ts；packages/client/src/classroom/TeachingPresetPicker.tsx；tests/integration/teaching-current.test.ts；tests/integration/prompt-current.test.ts；tests/e2e/teaching-presets.spec.ts；tests/live/prompt-change.test.ts；tests/live/book-breakdown.test.ts。
**参考：** P1.5原生能力证据、B当前teaching/book-prep正文、SIMPLIFICATION。
**输入：** 原生skills/systemPrompt、教学配置和可选临时要求、材料/卡/知识/学情工具；**输出：** 同课可切的五教学选择、原生按需Skill与真实节点拆解。
- [ ] 五项默认目录是配置数据：资料整理、诊断分析、苏格拉底授课、头脑风暴拓展、搜索，共享一个learning composition和工具；不复制工具授权/catalog管理器或全部旧模式菜单。
- [ ] ctx.skills.registerProvider提供真实目录/正文/失效；资料整理吸收book-prep/相关规划，授课吸收导学/讲题，其余按需Skill保持。课堂不加载开发AGENTS/CLAUDE，教师私有知识沿KnowledgeService。
- [ ] 只保留一个当前教学选择和临时要求覆盖文本；systemPrompt.section动态函数每次assembly生成完整教法/纪律，底层in-history/leading-system变化交DSH loop。原生agent-presets只用于空会话composition选择，不能替代本课切换。
- [ ] 学生临时改语气/加要求直接作用于本课，无需去Creator制作安装；需要保存为可复用预设才发布版本包。切教法后session/materials/draft/model/effort保留，重启恢复选择，旧异步返回不覆盖新选择。
- [ ] 已有背景直接用，必要时才问影响决策的问题；教师主动搜索本人/可用外部材料，读实际内容判断。是否多取证、需要改写原因、何时停止重试归Skill，删除固定次数/保存门槛。
- [ ] 苏格拉底默认逐步引导，明确要完整讲解就讲清，再用独立任务观察表现；诊断可记录候选/反证，头脑风暴围绕知识关联。没有固定五段流水线。
- [ ] P6书根/节点“继续拆解”→真实资料整理课→读当前原文/骨架→提出所需下一层/卡→确认保存→图/列表更新→同卡详情回源；保全兄弟章和已有卡，不因点展开调用模型，不因拆解自动排课。
- [ ] 测五项初始菜单一致且来自配置、自制条目可接入、临时一句要求直接生效；捕获真实prepared requests，不以模型自述证明切换。节点拆解测拒绝/取消/陈旧版本/重试无重复。
- [ ] 运行 npm run test:integration -- tests/integration/teaching-current.test.ts、npm run test:integration -- tests/integration/prompt-current.test.ts、npm run test:e2e -- tests/e2e/teaching-presets.spec.ts、npm run test:live -- tests/live/prompt-change.test.ts、npm run test:live -- tests/live/book-breakdown.test.ts、typecheck；记录第一次失败与恢复。

## P7.4：原生搜索子任务、命题与帮手
**文件：** packages/host/src/teaching/native-delegation.ts（只做角色输入/结果的领域适配）；resources/teaching/assistants/配置；现有ui-subagent与必要的原文结果renderer；tests/integration/assistant-boundaries.test.ts；tests/live/problem-and-delegates.test.ts；tests/live/search-main-subagent.test.ts。
**输入：** P1.5 ctx.subagents、原生web/本地查询及CardService；**输出：** 原生子任务、点名原文与命题成功后原卡登记。
- [ ] 搜索/命题/制作/审读共用ctx.subagents.start/startContinuable/sendMessage/interrupt及原生父子目录、结果和恢复；不各建delegate/search/scout运行管理器。需要结构化产物时传原生outputSchema。
- [ ] 搜索可独立对话或接受真实子会话委派，共用原生web/本地工具；来源URL/资料版本定位保留。结果只是线索，父Agent可继续判断/读文，不自动写学习事实。
- [ ] 角色所需信息由任务/persona/toolFilter等接线；spawn空历史可能继承父prompt/tools/resources，检查实际出站请求；不能只改persona就宣称隔离。必要的学生/作品读取范围交真实backend保证。
- [ ] 命题只交目标/约束到独立上下文，产物验证后宿主登记普通未学题卡并展示题面，后续学习沿同ID；不复制主模型转抄卡。参考解仍不提前公开。
- [ ] 助教只收材料/既有标准，同伴不收参考解；点名结果原文显示。原生ui-subagent已经负责活动/用量/打开子会话，额外renderer仅承担用户要求的教学呈现。
- [ ] 运行一次主搜索连续追问、授课委派搜索、结构化命题；核真实父子身份、权限/继承、取消/迟到回原课、同卡登记/真实用量。模型或搜索provider不可用如实返回，不假称已派出或已找到。
- [ ] 运行 npm run test:integration -- tests/integration/assistant-boundaries.test.ts、npm run test:live -- tests/live/problem-and-delegates.test.ts、npm run test:live -- tests/live/search-main-subagent.test.ts、typecheck；提交。

## P7.5：确认小结、课后原课与固定接续版本
**文件：** packages/domain/src/courses/{handoff-service,class-close-service}.ts；packages/host/src/teaching/lesson-brief.ts；packages/client/src/classroom/HandoffEditor.tsx；tests/integration/close-handoff-v2.test.ts；tests/e2e/coauthor-handoff.spec.ts；tests/live/lesson-continuity-v2.test.ts。
**参考：** B/bin/class_close.py、class_handoff.py、handoff_authoring.py；teaching/SKILL.md §12。
**输入：** ProposalService、真实input截止点、产出/记忆/组织事实；**输出：** propose_handoff确认写入关闭、版本更正、下一课精确brief。
- [ ] 只有学生确认所见小结后保存/关闭；关页、切课、沉默、idle不触发。小结教师自由body与系统材料/写入/待确认事实分开，不要求固定标题或全部整理完成。
- [ ] pending人改稿与original proposal分开，所见确认一致；保存失败学生原单重试，沿原事务恢复，不重复模型办公或生成新小结。
- [ ] 关闭后可主动讨论/制卡/更正，仍原课且closed保持，不产生r2/新收课义务。回执处理只说明实际结果，工具清单为空；真实学生新输入可按原用途讨论。
- [ ] 关课后新制卡不得补关课前漏记检验；已有冻结复习按原occurrence完成，后来的真实新表现另记。新卡保存与旧检验资格分开测试。
- [ ] saved handoff更正生成不可变后继版本；已接续课固定原version，新接续读取明确选定版本。目标/日期不自动顺延，旁支不冒充本线已学。
- [ ] 跑人改确认→关闭→晚确认→课后讨论→纠正→新课接续→再纠正流程，检查原课/旧接续不变；接P6.5日报/日历验证参与与完成分开、晚复习归原日、关闭后当天新活动仍进入同日报。定时生成不触发propose_handoff、不关闭课堂。
- [ ] 运行 npm run test:integration -- tests/integration/close-handoff-v2.test.ts、npm run test:e2e -- tests/e2e/coauthor-handoff.spec.ts、npm run test:live -- tests/live/lesson-continuity-v2.test.ts、P7回归/typecheck/build；交G7。
**G7：** 五主预设、同课显式切换、搜索主/子真实调用、逐层拆书回源、当前教学/学情/关闭及日报接线全通；无真实模型只能报相应阻塞，不能用漂亮Skill正文代替课堂验收。
