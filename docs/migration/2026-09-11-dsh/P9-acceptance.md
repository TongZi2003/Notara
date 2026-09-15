# P9：完整产品、自然课堂与交付 Implementation Plan

> **For agentic workers:** 使用superpowers:executing-plans与verification-before-completion。G8 PASS后执行五项，交G9；不能将B的历史PASS填成DSH结果。

**Goal:** 验证最新产品功能迁移完整，交付真实可安装候选与明确的剩余边界。
**Architecture:** 从空workspace和打包插件验学习/创作完整路径，正常课堂、故障、平台各自记录。
**Tech Stack:** Vitest、Playwright、真实DSH模型、npm pack、干净安装。

## 全局约束
COVERAGE每行是必查，不只验证原计划旧功能。真实学习数据/既有服务不动；不自动公开发布。执行器名称不等于DSH课堂model ID。

## P9.1：功能覆盖与当前学生页面
**文件：** scripts/test-all.ts；tests/e2e/full-product-v2.spec.ts；docs/evidence/P9/{coverage-results,ui-matrix}.md。
**输入：** BASELINE/COVERAGE/UI-FIRST-RELEASE、P1–P8接受commit；**输出：** 当前产品每条路径的实际证据。
- [ ] 全新空间串联：零材料问课题→找本人材料→四类导入→多材料课→选区发送→卡/知识共同编辑→学习记录→计划→学情→确认小结→课后→下一课。
- [ ] 另跑Creator→人改→真实预览→安装→课堂互动/图示/模具→卸载事实保留→公开导出。
- [ ] 首页/课程/资料/学习集紧凑总览、本课面板、未结束折叠/异常/未学无提醒逐项验；增加原生长流式/公式/围栏/Queue-Steer、模型/effort、真实与估算token、Raw JSON切换、红笔差异/复制/答案边界，1440/1024/390宽度留截图。
- [ ] 资料页实测：打开书左原文/右书根→逐层展开（无模型调用）→明确拆解→确认保存→卡详情→原文图层；脑图/列表同身份同选择，原卡顺序/按书/标签/放射视图保持，窄屏阅读可用。
- [ ] 开课/本课菜单恰好五种内置主预设；同课切换保留材料/草稿/model。roadmap按日期筛选清除后关系/布局不变；日历昨日回顾/今日已做与待办/明日due与课程准确，未学卡不计到期。
- [ ] 日报配置→定时生成→新活动更新→关闭/恢复补算→禁用后停止；真Host时间推进或受控Clock驱动真实调度，不只测试按钮。搜索主/子身份、返回出处和卡片定位不丢。
- [ ] 检查已撤销规则未回流：单题观察可保存、两题无自动认证、原因可选、无minor门槛、通用范围无需额外审批、临时教法要求无需制包。验实际结果，不断言固定服务类名/文件数/缓存revision。
- [ ] test:all串unit/integration/e2e，零匹配失败；live/平台分列，不静默SKIP当全部通过。
- [ ] 运行 npm run test:all、check:contracts、typecheck、build；coverage写测试命令/实际结果/commit/截图，不用源码检查替代UI。

## P9.2：正常学习的真实模型连续课
**文件：** tests/live/learning-product-v2.test.ts；docs/evidence/P9/live-learning.md。
**输入：** 已授权实际provider/route/model、合成材料/学情fixture；**输出：** 至少三节有独立验收的真实课堂，并覆盖全部五种主预设、搜索委派和书籍拆解；可在课内明确切换，不为凑数量开无意义新课。
- [ ] 记录真实模型、route、systemPrompt能力、请求/工具、耗时和预算。模型可回答不代表写者/投影正确。
- [ ] 第一课：只说主题，教师必要澄清→跨资料检索→读正文→混合路线；学生明确要完整讲解时能讲清，另测独立表现。核实体页/原文/未学卡状态。
- [ ] 第二课：从明确小结版本接续，读真实知识与学情；人改卡/知识后老师续改，不降级对象、不复制；独立命题/助教按实际隔离上下文。
- [ ] 第三课：反证修订偏好/能力、完整system变化；在途请求切model/effort检查下一请求生效；确认小结/晚复习/课后更正，核旧接续/发生时间；检查usage和Raw JSON对应原生记录、卡片红笔变化对应同课真实operation。
- [ ] 自然覆盖资料整理节点拆解/诊断分析真实作答/苏格拉底引导与明确讲解/头脑风暴知识拓展/搜索主入口追问；另由教师委派真实搜索子会话，比较授权、来源和实际provider。没有外部检索能力时单列BLOCKED，不把模型回忆当搜索完成。
- [ ] 日报链接回上述真实课堂/已保存卡/复习发生日；定时生成不触发新课堂或强制收课。复跑P7 book-breakdown和search-main-subagent已有证据时，记录实际复用范围，不重复消耗模型只为凑测试。
- [ ] 正常学生用语不点工具名；记录首次成功/拒绝原因/调用数/源码调查需求。保留数学错误、无效重试和未完成，不挑最好的一轮。
- [ ] 运行 npm run test:live -- tests/live/learning-product-v2.test.ts；缺凭据/模型外部问题如实BLOCKED，功能失败如实FAIL。

## P9.3：共同编辑、故障窗口与自然Creator
**文件：** tests/integration/recovery-matrix-v2.test.ts；tests/live/creator-handoff-v2.test.ts；docs/evidence/P9/failure-matrix.md。
**输入：** 事务/确认/outbox、所有authoring服务、真实Creator；**输出：** 当前已知问题有回归，不凭“最终保存了”忽略过程。
- [ ] C01卡、C02学情、C03组织、C04小结、C05作品分别跑“学生新建→模型续改→学生再改→同目标冲突→合并→刷新”；Creator另验无依赖A/B文件互不冲突，同文件陈旧编辑被拒，整作品安装只接受已验快照。
- [ ] 按P1.3已列的实际操作注入提交前/后崩溃、原生接受前后断线、晚到旧scope、旧目标删除/改名、卡/梯子变更、重复确认、输出对象删除后重建。
- [ ] 检查冻结效果不重投、旧检验history-only不覆盖新schedule、pending小结失败同单重试、saved后继版本不改旧接续。
- [ ] 增加日报重复回调/生成后恢复/跨午夜/源读取失败/晚确认/禁用卸载，以及书节点局部确认失败/兄弟章保全、搜索子任务取消/迟到；检查无重复日报/卡/复习与串课。
- [ ] 自然Creator保留首次失败轨迹；人工改稿→模型续作→preview/check/install同整作品digest→真实课堂使用。编译/静态报告不能冒充真实交互。
- [ ] 运行 npm run test:integration -- tests/integration/recovery-matrix-v2.test.ts、npm run test:live -- tests/live/creator-handoff-v2.test.ts；无外部模型仍保留可重复的集成证据。

## P9.4：干净安装、包完整性与独立依赖
**文件：** scripts/{pack-plugins,verify-install}.ts；tests/e2e/clean-install-v2.spec.ts；docs/{INSTALL,DEPENDENCIES,DEVELOPMENT}.md。
**输入：** P0已审生成链、实际插件exports、全部资源；**输出：** 可安装tarballs/digest和精确说明。
- [ ] npm pack包含Host/Client/Remote生成物、教学资源、预览/VM资源；不靠开发源码路径/node_modules补缺件。
- [ ] 完全新安装目录、DSH home、空workspace只用包和声明依赖启动；确认原生页面、开课、导入、选择、保存、重启、停用恢复默认页。
- [ ] 保留P0已审构建期修正的锁定摘要、安装复现和升级停止条件；未经审查的新上游补丁不能随包隐藏。
- [ ] 干净安装实际包含五预设正文/共享Skill/搜索委派资源，书籍脑图与原卡浏览都可用；验证Host日报调度设置重启保留、卸载不残留timer，离线恢复如实补算。外部搜索配置声明完整，缺能力明确提示。
- [ ] 不要求Pi/Python旧runtime；新数据schema不兼容时明确拒绝，不默默读取旧数据。再安装同版可读保留学习事实。
- [ ] 记录实际依赖许可证/上游链接，二进制/preview VM/字体资源打包闭包；公开发布和签名未授权不执行。
- [ ] 运行 npm run pack:plugins、npm run test:e2e -- tests/e2e/clean-install-v2.spec.ts；保存digest/安装日志/截图。

## P9.5：回顾基线差异与最终交付
**文件：** docs/DELIVERY-MATRIX.md、docs/evidence/P9/review.md；更新R的CLAUDE及逐轮交接。
**输入：** 52任务状态、G0–G8接受commit、当前DSH实际证据；**输出：** Codex G9 review可审结果。
- [ ] 对照SIMPLIFICATION逐项核八类精简：原生运行/搜索/提示/存储接线、教学软规则、文件版本粒度、日期投影和前端差额；不拿固定任务数/包装层数量作完成标准。
- [ ] 再核B是否在本轮后前进；新提交列差异，不自动改冻结目标。逐项证明v1错误已消除：多材料、三类学情、单正文知识、全局读、共同编辑、确认收课、Creator；同时核用户新裁决：书籍逐层阅读/原卡视图、五主预设/搜索双入口、roadmap时间过滤、日历日报；不将已缩减的旧模式菜单列为回归缺失。
- [ ] macOS本机、Windows文件能力/中文路径/preview/安装、托管隔离分别列真实结果。缺环境明确未运行；不把原产品Windows历史PASS继承，也不让未授权托管部署成为本机功能完成前提。
- [ ] 测试进程只清理自己的；包中排除凭据、真实材料、日志、开发probe。保留失败证据和复跑脚本。
- [ ] 报告产品功能、真实课堂、Creator、故障恢复、干净包各层状态；剩余失败须有代码/场景/入口，不用“基本完成”隐去。
- [ ] Codex亲自审diff并抽跑关键路径后记录G9 PASS或CHANGES_REQUIRED。执行者停在READY_FOR_REVIEW，不自行放行。

**完成定义：** P1–P8功能与P9对应本机真实课堂/创作/安装验收通过才称本机迁移完成；平台未验另列。没有真实模型时只能交“实现候选，真实体验验收未完成”。
