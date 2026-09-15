# P2：原生课堂与精简界面 Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans；G1 PASS 后依序执行七项，交 G2 review。

**Goal:** 在DSH原生对话中恢复当前零材料入口、多课操作、“本课”面板和可重建产出。
**Architecture:** 原生session是课堂身份；保留ui-conversation的Session绑定/composer/assembler和ui-chat流式renderer，课程只补教学metadata、上下文及自有结果类型。
**Tech Stack:** P0 native runtime/Remote/Slots、TSX、Playwright。

## 全局约束
来源B的app/js/course.js、course-state.js、classroom.js、class-outputs.js与最新CLAUDE。保留当前笔记本主题，主入口/布局按UI-FIRST-RELEASE.md精简；关页/沉默不结束课堂；creation不显示学习收课/学情入口。

## P2.1：原生会话与最小课程元数据
**文件：** packages/domain/src/courses/course-metadata.ts；packages/contracts/src/courses.ts；tests/integration/native-course.test.ts；Host入口复用P1.5原生接线。
**输入：** native session-controller、HostContext、RecordStore；**输出：** 原生create/list/rename/replay与CourseMetadata.bind/read/update教学附加信息；归档缺少原生支持时仅加导航标记。
- [ ] 创建/继续/命名/输入/历史直接调用原生服务；不新建native-runtime/session-reader/CourseService来复制相同CRUD。课名只有原生一个权威，显式学生/计划标题不被自动命名覆盖。
- [ ] 只保存DSH原生没有的课程材料引用、归档导航（若原生无）、小结/接续等教学信息，sessionId直接用DSH身份。
- [ ] 原生create/setup与元数据绑定发生故障时，沿实际operation/native引用恢复已创建课，不重复造空课；不声称跨存储天然原子。
- [ ] 允许零材料/未选集创建学习课；learning/creation目的来自真实composition，坏授权不能猜默认。
- [ ] 测并发开计划课、元数据失败重试、名称恢复、归档回看和重启；UI读取原生课名，不维护第二名称。
- [ ] 运行 npm run test:integration -- tests/integration/native-course.test.ts、typecheck/check:contracts；提交。

## P2.2：最新入口、每课状态与本课面板
**文件：** packages/client/src/{shell/StudyForgeShell.tsx,shell/navigation.ts,classroom/Classroom.tsx,classroom/LessonPanel.tsx}；tests/e2e/current-classroom.spec.ts。
**输入：** 原生课程/read/list、ui-conversation/inputActions/ui-chat；**输出：** 精简产品壳；draft/附件/队列/滚动/预览标签由DSH持有，教学附加状态就近保存，不先造course-store或Composer包装。

- [ ] 保留首页/课程/资料/学习集入口和可直接到达的日历；同一页面不重复铺多套工具栏或长设置表单。资料页分书籍阅读/卡片浏览，P6接书籍左原文右结构；学习集接紧凑总览。保留主题，具体排版在对应UI任务验收。
- [ ] P0验证用的main/conversation占位替换在本阶段改为原生Conversation壳内的合法slots/View组合；不能让占位Shell挡住native Chat后再重写聊天。输入区直接使用native slot，教学引用codec有实际转换才新增文件。
- [ ] 课堂顶端保留“本课”入口；保留DSH rightbar/session与预览类型注册，材料打开/聚焦/分栏走原生controller，不在自制MaterialPanel再维护一套标签。UI不铺出工具/用途schema/会话ID。
- [ ] 开课入口预留P7共用的五主预设目录，P2不填旧全模式菜单或假预设正文；model/effort仍用原生控件。允许“我想学某主题”零材料发送；选书/卡的直接学习入口保留，不能要求先选集、建卡或拆书。
- [ ] 保留native composer的草稿/上传/提交echo/Queue/Steer/Stop和失败恢复，A/B切课由原生binding隔离；本插件只把来源引用挂接其codec，不再维护一套staged文本/附件队列。
- [ ] 用1440×900、1024×768、390×844测试开课/切课/输入/本课面板、抽屉与主题，保存截图。
- [ ] 运行 npm run test:e2e -- tests/e2e/current-classroom.spec.ts、typecheck/build；提交。

## P2.3：原生流与采用依据的按需查询
**文件：** packages/domain/src/evidence/evidence-query.ts；packages/client/src/classroom/{teaching-definitions,context-codec}.ts、teaching-renderers.tsx；tests/unit/evidence-binding.test.ts；tests/integration/native-input-evidence.test.ts；tests/e2e/send-recovery.spec.ts。
**输入：** 原生Session Controller窗口/inputActions、MessageEnvelope附加来源；**输出：** EvidenceQuery.catalogue/resolve及原生教学renderer；没有第二消息接收或证据表。
- [ ] native提交requestId/echo/ack/Queue/Steer/Stop与失败恢复直接保留；来源snapshot挂到同一submission。未知接受状态沿原生关联查询，不另造accept/recover状态机。
- [ ] E短别名由已接受native消息按需产生，真实时间/对象由Host解析。只有后续复习或学情采用时才持久关联必要引用和对象版本，不保存全部输入的平行证据账。
- [ ] 系统回执/助手内容与学生原话分清；允许一消息多对象和一对象多消息，不把数量转成学情保存门槛。
- [ ] ui-conversation/Session Controller拥有唯一事件窗口/assembler；ui-chat/MarkdownText处理chunk/TeX/代码/滚动。StudyForge仅为真实教学结果注册Definition/View。
- [ ] 用真实DSH+可控模型验长Markdown、未闭合TeX/围栏、确认renderer、取消重试落定、两课并行、Queue/Steer、阅读旧行不抢滚动；稳定块不每chunk重挂。
- [ ] 从原生历史独立读消息identity/时间核EvidenceQuery；失败未接受消息不可作依据，重复查询不生成新记录。未来P5/P7保存采用的引用后，重启仍能解析其原文/版本。
- [ ] 运行 npm run test:unit -- tests/unit/evidence-binding.test.ts、npm run test:integration -- tests/integration/native-input-evidence.test.ts、npm run test:e2e -- tests/e2e/send-recovery.spec.ts、typecheck；提交。

## P2.4：刷新、回看与关闭状态分离
**文件：** 现有classroom原生binding接线（不强制新增转发文件）；packages/domain/src/courses/course-projection.ts；tests/e2e/native-reconnect.spec.ts；tests/integration/course-state.test.ts。
**参考：** B/bin/class_close.py、app/js/classroom.js。
**输入：** 原生snapshot/增量、course metadata；**输出：** 一致回看与课堂未结束/已结束状态，实际关闭操作由P7.5提供。

- [ ] 直接复用DSH Session窗口与ui-conversation replacement/prepend/settlement语义；view绑定和教学projection跟同一revision，不实现自己的reconcile算法，不重新发prompt重建。
- [ ] 刷新、断网、Host重启、同课多浏览器tab不会重复回复或永久“在想”；cancel后校准。DSH切Session保留其预览surface，但浏览器刷新会重置布局；分别验，不把原生内存布局说成持久恢复，来源引用由P4重开。
- [ ] 离开/静默/切课/进程idle不改closed；当前普通未结束课可折叠，保存异常单列。不得恢复旧watchdog自动收课。
- [ ] 历史回看不启动模型；已关闭原课在学生主动输入时仍可讨论。状态投影预留P7关闭事实，不能实现r2式重新开课。
- [ ] 用真实原生事件identity集合验证UI，无重复/丢失/串课。关闭fixture只通过合法测试写者构造，报告P7关闭链尚未接通。
- [ ] 运行 npm run test:e2e -- tests/e2e/native-reconnect.spec.ts、npm run test:integration -- tests/integration/course-state.test.ts、发送回归/typecheck；提交。

## P2.5：本课产出投影骨架
**文件：** packages/domain/src/courses/output-projection.ts；packages/client/src/classroom/Outputs.tsx；tests/integration/output-projection.test.ts。
**参考：** B/bin/class_outputs.py::session_projection/created_cards；app/js/class-outputs.js。
**输入：** 领域receipt和可读取对象；**输出：** typed output target列表；卡/知识/学情/小结/图示由后续真实写者接入。

- [ ] 从receipt和仍存在的对象构建列表，不另写“产出完成台账”；区分已保存/待确认/状态未知。
- [ ] 只有普通problem卡进入题目deck，学情与知识入口展示自己的对象，不用卡片壳蒙混类型。
- [ ] 题目按来源顺序、同批提交序/题号合理排序；旧文件名排序不是新合同。对象删除后重建不得复活。
- [ ] fixture模拟真实新事务结果而非硬编码UI数组；测试并发旧请求返回、切课、失效对象、局部查询失败。
- [ ] 运行 npm run test:integration -- tests/integration/output-projection.test.ts、P2全部针对性回归、typecheck/build；提交。
## P2.6：原生模型、思考强度与用量
**文件：** 现有classroom slot注册；需要本课累计展示时增加packages/client/src/classroom/NativeUsage.tsx；tests/e2e/native-model-controls.spec.ts；tests/integration/model-selection-boundary.test.ts；tests/integration/native-usage.test.ts；tests/e2e/native-usage.spec.ts。
**输入：** ui-model-selection的conversation.input.model、modelDirectories、session.models/selectModel；**输出：** 共用Host选择的模型/effort入口，无第二份模型配置。
- [ ] 保留输入区原生模型控件和/model命令。读取实际provider分组及exact model宣告的effort，不自造统一等级或字符串映射。
- [ ] 已有普通Session可切换；无Session阶段沿DSH原生默认和创建流程，不发送占位消息。addressed子代理不硬塞独立选择器。
- [ ] Host在下一请求边界应用完整selection；正在运行的step仍用开始时的配置，界面不谎称已切换在途响应。
- [ ] 目录缺行但route可用不误禁；无adapter才阻塞，配置恢复不用刷新。并发目录加载/切换/重连不能用旧响应覆盖新选择。
- [ ] 测模型A有effort、B没有、默认值、切换中请求、冷启动、目录失败但可路由、真正不可路由与恢复；实际prepared request验证provider/model/effort，不只看按钮文字。
- [ ] 运行 npm run test:e2e -- tests/e2e/native-model-controls.spec.ts、npm run test:integration -- tests/integration/model-selection-boundary.test.ts；与下列用量检查一起交付本任务。

### 同任务：原生用量和上下文占用
不新建native-model-controls或usage-projection管理器；原生已有目录并发、恢复和计数，只有实际教学呈现差额才写组件。
**输入：** ui-chat Turn usage、tokenUsage/contextPressure/contextBreakdown投影；**输出：** 本对话/回合实际用量和独立标注的上下文估算，Host层仅必要的授权读取适配。
- [ ] 保留原生完成回合用量行，在本课面板展示本对话累计输入/输出/缓存等实际可用分项，不按前端当前加载窗口求全部课用量。
- [ ] contextPressure/组成估算单列，不当实际消耗；reasoningTokens是输出子集，不再重复相加；没有数据标不可用，不填0。
- [ ] final sample替代同attempt的流式sample，retry是另一次尝试；使用native fold，不按chunk手工累加。partial/矛盾计数不能冒充完整精确总计。
- [ ] 帮手Session不默默算作主Session；P7.4接实际关联后可单列其用量。汇总如有缺项注明覆盖范围，禁止重复汇总/估算费用。
- [ ] 测stream→final替换、retry、cancel、窗口只加载尾部、缓存桶缺失、reasoning子集、模型变更、压缩前后“累计消费仍在/占用可下降”。
- [ ] 固定计数样例：同attempt输出stream=2、final=5，输出只计5；再有独立retry输出3则计8。另一例uncached input=8、cache read=2、output=5、其中reasoning=3，总数为15而非18；这些是测试fixture的实际报告数，不从估算器反算期望。
- [ ] 运行 npm run test:integration -- tests/integration/native-usage.test.ts、npm run test:e2e -- tests/e2e/native-usage.spec.ts、typecheck；提交。

## P2.7：调试者模式、Trajectory与Raw JSON
**文件：** packages/client/src/debug/{RawSessionView,DomainRecordInspector}.tsx；调试开关放现有设置；packages/client/src/debug/register-views.ts；tests/e2e/raw-debug.spec.ts。
**输入：** 同一Session binding的原生窗口、ui-trajectory、JsonTree/JsonBlock；**输出：** 默认关闭的只读调试视图，不新建事件采集服务。
- [ ] 显式开关开放原生Trajectory以及Raw JSON查看器；普通课堂显示策略不被全局修改。模型/effort/token控件是用户要求的正常入口，不依赖打开调试。
- [ ] Raw窗口来自真实Session数据，标明已加载范围、durable/transient和事件身份；支持折叠、搜索、复制与加载旧页。不将ui-trajectory的整理结果冒充raw event。
- [ ] 调试可看本会话实际记录的请求配置、工具I/O、usage；缺失记录/未加载页明确说明。StudyForge事务/确认记录通过授权只读接口单列来源，P5接真实数据。
- [ ] 不修改原始JSON，不读额外Host密钥/环境变量，不因打开调试扩大账号权限；公开导出继续使用公开投影。
- [ ] streaming更新保持检查焦点/展开态；Chat↔Trajectory↔Raw切换共用一次事件源，不重开模型，不重复下载同附件或写学习事实。
- [ ] 运行 npm run test:e2e -- tests/e2e/raw-debug.spec.ts、发送/重连/用量回归、typecheck/build；交G2。

**G2：** 原生composer/assembler/stream、课程身份、依据接线、模型/effort、真实用量与只读调试均通过；领域卡/知识/小结的后续renderer不冒称已经完成。
