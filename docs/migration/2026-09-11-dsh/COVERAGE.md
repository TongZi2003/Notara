# v2.3 功能覆盖矩阵

产品源B=3831987；v2.3共52任务，P0原3项保留、P1–P9共49项；三组任务合并，功能按行为覆盖，旧新映射见SIMPLIFICATION。表是验收分配，不是PASS清单。结果回填docs/evidence/P9/coverage-results.md；一条功能没有新DSH证据不能用B历史测试替代。

| 功能/当前裁决 | 任务 | 新测试主要入口（相对仓库根目录/tests） |
|---|---|---|
| 正确基线与P0无损衔接 | P1.1 | 固定git commit + P0接受证据 |
| 同源schema、可配置学情分类/知识/用途/多材料 | P1.2 | unit/contracts-v2.test.ts |
| 原生单记录更新、实际写者独占、窄多对象恢复 | P1.3 | integration/storage-v2.test.ts |
| 本人跨科读/新增归属/用途/账户隔离 | P1.4 | integration/access-binding.test.ts |
| 按需native输入E/发生时刻/采用依据引用 | P2.3 | unit/evidence-binding.test.ts、integration/native-input-evidence.test.ts |
| 原生web/subagents/动态prompt/文件接缝提前验证 | P1.5 | integration/native-capability-wiring.test.ts、live/native-capabilities.test.ts |
| 原生会话create/name/archive/purpose | P2.1 | integration/native-course.test.ts |
| 零材料开课、当前主导航、本课面板 | P2.2 | e2e/current-classroom.spec.ts |
| 每课draft/staged/upload/delegate隔离 | P2.2–P2.3 | e2e/current-classroom.spec.ts、send-recovery.spec.ts |
| 原生composer/流式assembler/Markdown/TeX/代码/Queue-Steer/Stop及重连 | P2.2–P2.4 | e2e/send-recovery.spec.ts、native-reconnect.spec.ts |
| 原生model/effort、下一请求生效、无能力/不可路由 | P2.6 | e2e/native-model-controls.spec.ts、integration/model-selection-boundary.test.ts |
| Turn/Session用量、retry/sample替代、估算占用、帮手范围 | P2.6、P7.4 | integration/native-usage.test.ts、e2e/native-usage.spec.ts |
| 显式调试、Trajectory/Raw JSON、共享事件源、公开导出隔离 | P2.7、P8.6 | e2e/raw-debug.spec.ts、integration/export-history-v2.test.ts |
| 不自动关课、普通未结束折叠、异常分列 | P2.4、P7.5 | integration/course-state.test.ts、close-handoff-v2.test.ts |
| 本课产出来自真实写者，不建第二台账 | P2.5、P5.6 | integration/output-projection.test.ts |
| 原件导入/未归集/版本共享/资源授权 | P3.1 | integration/material-version.test.ts |
| 官方PDF/图片/MD/HTML/code/text预览 | P3.2 | e2e/official-preview.spec.ts |
| DOCX重复段/表格/公式索引与回跳 | P3.3、P4.3–P4.4 | unit/docx-index-v2.test.ts、e2e/source-roundtrip.spec.ts |
| 原文读图、扫描页、真实裁图反馈/预算 | P3.4 | integration/material-read-region.test.ts |
| 原生web+本地学习查询、实际URL/读取范围/入库locator | P4.2 | integration/search-sources.test.ts |
| 物理页/非连续来源/按章骨架保全 | P3.4、P6.3、P7.3 | integration/plan-target-skeleton.test.ts、teaching-current.test.ts |
| 混合教学引用投影、DSH Session多标签/分栏/原生active、课中带回 | P4.1 | integration/mixed-deck.test.ts、e2e/mixed-deck.spec.ts |
| 找笔记含卡背/知识；memory非库存 | P4.2、P5.2 | integration/global-learning-search.test.ts |
| 选区+locator随发送，浏览不发消息 | P4.3 | e2e/selection-message.spec.ts |
| 卡/消息原版本定位、原生布局刷新重置后按锚回跳 | P4.4、P5.5 | e2e/source-roundtrip.spec.ts、coauthor-card-knowledge.spec.ts |
| 普通卡题/知识/source-only/作者正文保真 | P5.1 | integration/card-content-v2.test.ts |
| 知识自由body/不强制七栏/无concept写入 | P5.2 | integration/knowledge-identity.test.ts |
| 私人沉淀→锦囊同身份收录/修改/删除 | P5.2 | integration/knowledge-identity.test.ts |
| 教师links增量、学生可删、不改学习记录 | P5.2、P5.5 | e2e/coauthor-card-knowledge.spec.ts |
| 提案原稿/学生编辑版/所见确认/冻结target | P5.3、P6.3 | integration/confirmation-v2.test.ts |
| 课后/断线确认、部分结果、回执状态 | P5.3、P7.5 | integration/confirmation-v2.test.ts、close-handoff-v2.test.ts |
| 五档、首学、发生时刻、迟到history-only | P5.4 | unit/review-occurrence.test.ts、integration/review-transaction.test.ts |
| C01普通卡与知识共同编辑 | P5.5 | e2e/coauthor-card-knowledge.spec.ts |
| 本课修改精确归属、旧行红笔划除/新内容、原文复制和答案边界 | P5.7 | integration/card-change-scope.test.ts、e2e/card-redline.spec.ts |
| 普通知识卡/题卡学习记录与全部消费者 | P5.6 | e2e/learning-records-home.spec.ts |
| 原卡片视图保持：顺序/按书/标签/放射及同卡详情 | P5.6 | e2e/card-browsing.spec.ts |
| 未学不提醒、仍可主动学、复习讲义 | P5.6、P6.5 | e2e/learning-records-home.spec.ts |
| 紧凑学习集总览→书架→书，低频设置 | P6.1 | e2e/sets-bookshelf.spec.ts |
| 源归属+成员、有效梯/refit、改名 | P6.1 | integration/set-policy-v2.test.ts |
| 混合路线、teachingRef/stance、继承、并发开课 | P6.2 | integration/mixed-route.test.ts、e2e/mixed-route-open.spec.ts |
| 精确书/campaign target、日程保留 | P6.3 | integration/plan-target-skeleton.test.ts |
| 骨架repath、多章/相关卡/未开课保全 | P6.3 | integration/plan-target-skeleton.test.ts |
| C03组织及本课材料/设置人机共同编辑 | P6.4 | e2e/coauthor-organization.spec.ts |
| 日历第二行/过去今天未来/原roadmap日期过滤不改关系 | P6.5 | integration/calendar-order.test.ts、e2e/planning-overview-v2.spec.ts |
| 左原文右单书脑图/列表、初始书根、逐层展开、叶卡原身份与回源 | P6.6 | integration/book-exploration.test.ts、e2e/book-workspace.spec.ts |
| 明确节点拆解→真实资料整理→确认骨架/卡→图/列表更新/兄弟保全 | P6.6、P7.3 | live/book-breakdown.test.ts |
| 日报真实活动/未学排除/未来due与排课、同日去重/晚确认归原日 | P6.5、P7.5 | integration/daily-report.test.ts、e2e/daily-report.spec.ts |
| Cordis定时/日期查询/恢复按需读取/时区/源坏，不自动收课 | P6.5、P9.3–P9.4 | integration/daily-report.test.ts、e2e/clean-install-v2.spec.ts |
| 新记忆独立身份/精确修订/偏好原话绑定 | P7.1 | integration/memory-v2.test.ts |
| 一次观察可存、无自动认证、当前采用依据/旧版本反证修正 | P7.1–P7.2 | integration/memory-evidence-projection.test.ts |
| C02学生学情编辑、自述不作掌握证明 | P7.2 | e2e/coauthor-memory.spec.ts |
| 五教学配置、原生Skill/dynamic prompt、同课临时要求无须制包 | P7.3 | integration/teaching-current.test.ts、e2e/teaching-presets.spec.ts |
| 搜索可作主Agent及真实subagent、同服务、必要上下文/权限/来源回流 | P7.3、P7.4 | live/search-main-subagent.test.ts、integration/assistant-boundaries.test.ts |
| 零选材目标驱动检索、按需知识回访 | P7.3、P9.2 | live/learning-product-v2.test.ts |
| 要求完整讲解时讲清、另看独立表现 | P7.3、P9.2 | live/learning-product-v2.test.ts |
| 公共包只读绑定、无.d活动写者 | P7.3、P8.1 | integration/teaching-current.test.ts、package-binding.test.ts |
| 明确要求完整system更新，无自动模式状态 | P7.3 | integration/prompt-current.test.ts、live/prompt-change.test.ts |
| 独立Scout→普通未学题→deck→同卡记录 | P7.4 | live/problem-and-delegates.test.ts |
| 助教/同伴/点名帮手隔离与原文回流 | P7.4 | integration/assistant-boundaries.test.ts |
| C04确认小结/保存失败同单重试/真实关闭 | P7.5 | e2e/coauthor-handoff.spec.ts |
| 课后仍原课、无r2、不追补旧漏记 | P7.5 | integration/close-handoff-v2.test.ts |
| 小结更正后继版本与接续固定版本 | P7.5 | live/lesson-continuity-v2.test.ts |
| 不可变包/预设版本/卸载保留学生事实 | P8.1 | integration/package-binding.test.ts |
| Creator明确用途/受限reference/draft | P8.2 | integration/draft-version.test.ts |
| C05按文件版本、人改与模型续改/无关文件不冲突 | P8.2 | e2e/coauthor-creator.spec.ts |
| 按需原生author/review、真实preview/check/install整作品同版 | P8.3 | live/creator-natural.test.ts、e2e/creator-install.spec.ts |
| 课堂inert图示/受限VM/主题不重置/模具 | P8.4 | integration/visual-policy.test.ts、e2e/visual-mold.spec.ts |
| widget提交预览/轨迹/回放/六类讲义 | P8.5 | e2e/handout-widget-v2.spec.ts |
| 当前纸面字迹/三色笔/数学复制/公开导出 | P8.6 | e2e/notebook-settings.spec.ts |
| 新数据版本健康/补账/显式恢复 | P8.6 | integration/export-history-v2.test.ts |
| 最新功能完整流程与真实课堂 | P9.1–P9.2 | e2e/full-product-v2.spec.ts、live/learning-product-v2.test.ts |
| 故障与C01–C05/Creator自然回归 | P9.3 | integration/recovery-matrix-v2.test.ts、live/creator-handoff-v2.test.ts |
| 干净安装/依赖闭包/P0修正可复现 | P9.4 | e2e/clean-install-v2.spec.ts |
| 最新基线变化、平台/交付单列证据 | P9.5 | DELIVERY-MATRIX.md、G9 review |

## 不继承与不虚报

- 不继承旧系统数据导入、旧Pi/JSON/哈希/锁/迁移入口；只迁当前产品行为与新系统可靠性。
- 不把B仍有的单材料route限制带入DSH；用户已指出不合理。
- 不恢复concept新写入、私人.d写者、强制只给提示、自动收课/值守、写handoff直写、已关课r2、教师不能编辑既有组织等旧稿规则。
- 不排除Creator、三色纸面、共同编辑、当前课堂产出等B已实施功能；但旧繁复布局和全部模式主菜单被用户明确裁减，不列为必迁。
- roadmap新增视图种类、日报默认时刻/具体排版未冻结；最小必交是已有图的时间筛选、可配置定时与事实摘要，不擅自增加多页面/日报Agent。
- 不把普通跨科读取改成确认才能读；不把跨科读取变成随意改写归属。
- 不把源码存在/旧测试PASS写成新DSH已验证；数学、裁图、选材和Creator原失败均进入自然验收。
- PPT/XLSX/音视频/二进制DOC、公网发布、签名和托管上线仍不自动新增为本次必交实现。
