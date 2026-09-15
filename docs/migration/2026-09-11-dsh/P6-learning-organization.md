# P6：学习组织、混合路线与共同规划 Implementation Plan

> **For agentic workers:** 使用superpowers:executing-plans；G5 PASS后执行六项，交G6。

**Goal:** 保留学习组织事实，交付精简书籍阅读/逐层脑图、可按时间筛选的 roadmap 与定时日报；一课仍可使用多种材料。
**Architecture:** 集管组织与默认关注，路线管课的连接，计划管安排；书籍脑图与日报从既有事实派生，Host调度只刷新日报，不新增学习事实或自动收课。
**Tech Stack:** TS领域服务、既有ProposalService、TSX、Playwright。

## 全局约束
来源B最新sets、organization_meta、learning_structure_authoring、lesson_authoring、confirmations和规划Skill。旧稿“既有集老师只能加卡”“一节点一种材料”均撤销。学习集不会成为跨科读取权限。界面和首版范围按 [UI-FIRST-RELEASE.md](UI-FIRST-RELEASE.md)；旧布局不覆盖本轮设计。

## P6.1：学习集总览、书架与策略
**文件：** packages/domain/src/organization/set-service.ts；packages/client/src/sets/{SetOverview,SetBookshelf,SetSettings}.tsx；tests/integration/set-policy-v2.test.ts；tests/e2e/sets-bookshelf.spec.ts。
**输入：** 材料/普通卡/有效梯子；**输出：** create/list/read/update、成员归属与refit。
- [ ] 一级学习集进入紧凑总览，每集一行，点击其书架后直接进入P6.6左原文右结构的书籍阅读页；设置按需展开，关注/检查/辅助角色收在说明用途的高级设置。
- [ ] 源归属∪显式成员保留，未归属卡全局可见；选集只改变导航/默认新课关注，不改当前课堂。
- [ ] 改梯后有效策略按当前规则选最短梯；refit只改due，无未学激活或新学习事实。
- [ ] 资料/集改名用稳定ID传播展示，旧来源版本不变；明确删除需影响预览，不借卸载/改名删事实。
- [ ] 测16集合成列表、390px总览、空集/全局、同源多集、改梯/改名后刷新与卡/课程显示。
- [ ] 运行 npm run test:integration -- tests/integration/set-policy-v2.test.ts、npm run test:e2e -- tests/e2e/sets-bookshelf.spec.ts、typecheck；提交。

## P6.2：多材料路线、教学重点与开课
**文件：** packages/contracts/src/routes.ts；packages/domain/src/organization/route-service.ts；packages/host/src/tools/route-tools.ts；packages/client/src/courses/RouteEditor.tsx；tests/integration/mixed-route.test.ts；tests/e2e/mixed-route-open.spec.ts。
**输入：** LessonMaterials、原生session-controller/CourseMetadata/LessonResources/NativePreviewAdapter、ProposalService；**输出：** propose/edit/openPlanned/mount，已开节点绑定native session。

- [ ] 节点保存有序materials（空/混合均合法）、日期及decl教学配置引用/stance；首版内置目录仅资料整理、诊断分析、苏格拉底授课、头脑风暴拓展、搜索，稳定键见CONTRACTS。没有材料也可规划方向并开课。
- [ ] materials仅表示安排中采用的书段/卡/图片引用，非文件白名单或打开标签镜像；initialIndex通过DSH原生资源路径选首次预览，不强制打开/读入全部。课堂可随需预览其他本人资料，保留跨资料原卡身份。
- [ ] stance写短目标/切入/观察重点，对学生可读，不放答案/完整教案；明确teachingRef指向五教学配置或用户安装配置，不能拿它切换已有原生composition；教学节点不误继承资料整理配置。继承按最近祖先覆盖。
- [ ] 编辑/确认冻结材料和声明；缺目标/环/跨workspace父节点拒绝。双击/两tab/重启开同planned只创建同一原生课。
- [ ] 真实纵向测试：源A页+卡B+图C→确认路线→刷新→开第二课→教学引用完整有序且默认项在native tab→自由打开B/C及分栏→重点/teachingRef进入brief；关闭tab不改路线，无材料/非连续来源也验。
- [ ] 运行 npm run test:integration -- tests/integration/mixed-route.test.ts、npm run test:e2e -- tests/e2e/mixed-route-open.spec.ts、P4deck回归/typecheck；提交。

## P6.3：精确计划目标与骨架编辑
**文件：** packages/contracts/src/plans.ts；packages/domain/src/organization/{plan-service,skeleton-authoring}.ts；packages/host/src/tools/planning-tools.ts；tests/integration/plan-target-skeleton.test.ts。
**参考：** B/bin/learning_structure_authoring.py；dev/tests/structured-planning-r03.sh、pack-plan-ownership-r01.sh。
**输入：** 材料/骨架/复习/ProposalService；**输出：** 精确book/campaign target读写；按章追加/repath一致事务。

- [ ] plan排日期，route排课；book plan与review campaign是不同target。重名章节/多个campaign返回实际候选，不默认第一本或第一个计划。
- [ ] 已有计划编辑先read_learning_organization获得target/内容/version，再用edit确认；部分追加不覆盖另一书或campaign。
- [ ] 显式每日卡清单原样保存，日期不能在下一课重新顺延。自由取到期卡不纳入未学库存。
- [ ] 骨架编辑先读取已有全量，再按章append或明确修改；repath给旧新映射，同步相关卡章节与未开安排，原始source locator不改。
- [ ] 删节点/改径导致悬挂先报告影响；多文件全预检事务发布。测试重名书、同名campaign、陈旧target、重放、半失败、保全未改章。
- [ ] 运行 npm run test:integration -- tests/integration/plan-target-skeleton.test.ts、confirmation/storage回归/typecheck；提交。

## P6.4：学习组织与本课设置共同编辑
**文件：** packages/domain/src/organization/{organization-authoring,lesson-authoring}.ts；packages/host/src/tools/organization-tools.ts；packages/client/src/organization/OrganizationEditor.tsx；tests/e2e/coauthor-organization.spec.ts。
**参考：** B/bin/organization_meta.py、lesson_authoring.py；dev/tests/organization-meta-c03.sh、lesson-authoring-c03.sh。
**输入：** 当前target/digest及学生动作；**输出：** read/preview/save和propose_set.edit/propose_book_name/propose_lesson_settings等教师提案。

- [ ] 学生能建/改集、计划、骨架、路线和本课材料/方式；老师在明确要求下可提议修改同一对象，包括既有集设置，经学生确认。
- [ ] 读/编辑使用真实目标和version，scope冻结到操作对象；用户在另一个集打开旧提案不改变保存目标。
- [ ] 本课材料编辑的是教学关联引用，P4只投影并交native预览；标签开闭不反写材料清单。修改默认教法/角色沿P7显式完整提示更新，P7未完成前不假报模型已生效。
- [ ] 冲突保留草稿、展示最新版、明确合并；不能重用新digest强行写旧稿。计划修改后的确认展示等于实际保存。
- [ ] 测“学生建立→老师续改→学生再改”、陈旧确认、改名/改梯、不同课异步回调、跨集目标不漂移；宽窄屏真实操作。
- [ ] 运行 npm run test:e2e -- tests/e2e/coauthor-organization.spec.ts、P6集成/typecheck/build；提交。

## P6.5：日历、定时日报与roadmap时间筛选
**文件：** packages/contracts/src/calendar.ts；packages/domain/src/organization/{calendar-projection,roadmap-projection}.ts；packages/client/src/{planning/Calendar.tsx,planning/CalendarDay.tsx,courses/CourseMap.tsx}；日报设置从日历按需打开；Host现有入口使用Cordis timer；tests/integration/calendar-order.test.ts；tests/integration/daily-report.test.ts；tests/e2e/planning-overview-v2.spec.ts；tests/e2e/daily-report.spec.ts。
**参考：** B/screens/calendar.js、screens/map.js；UI-FIRST-RELEASE与SIMPLIFICATION；原生schedule不用于本功能。
**输入：** 真实route/plan/course/review/native活动时间及最小定时设置；**输出：** CalendarProjection.readDay、RoadmapProjection.filter，日历和日报同一日期查询。

- [ ] 原roadmap的接续/分叉/定位/布局保留；承接已有日期快捷筛选并加范围。未开课读安排日期，已开课读实际活动日期，不从DSH身份截时间。
- [ ] 筛选只改变可见结果，祖先上下文不算命中，清除恢复原图；不改mount/继承/坐标。无日期节点仍在全部图；额外时间视图种类另议。
- [ ] 日历过去显示真实活动与原安排，今天显示已做/剩余，未来显示当前schedule预计到期卡数和已排课程。参与课堂与完成分开，计划不另写completed真相；P7接真实小结前用合法fixture并注明。
- [ ] 未学/知识不计due，已学卡按当日到期去重，不模拟未来答题滚梯。今天逾期单列；显式安排未学卡的课程保留。第二行开第二课按真实identity，不按显示下标猜。
- [ ] 一个readDay聚合原生活动、保存操作和真实复习发生日；日报直接呈现这份结果。删除重复DailyReportService、日报实体revision/sourceDigest和额外活动账，读取失败不能保存/显示成零活动。
- [ ] 定时只保存enabled/timeZone/localTime及最近成功生成时间，复用原生单记录storage；默认几点未定，用户可配置。到点通过ctx.timeout/interval调用日期查询、通知页面刷新并记录成功时间；插件dispose自动撤销timer，不另造调度管理类。
- [ ] 恢复后刷新最近到期/当前日期，其他旧日按需计算；晚确认按occurredAt自动归旧日。不强制启用区间、全历史补算队列或提前写每一天缓存；性能测量确有需要再加可重建缓存。
- [ ] 当天生成后继续学习，日历与日报同一查询即时反映；来源可回真实课/对象。空活动如实为空，数据错误明确不可用；不发课堂follow-up、不触发模型、不自动收课或写学情。原生schedule是会话消息提醒，与此区分。
- [ ] 以注入Clock测配置前/后一分钟、重复回调、恢复/禁用卸载、跨月/午夜/一次DST/时区修改；测试值21:00不当产品默认。用户可见摘要/来源/最近生成时间准确即可，不断言内部缓存revision必须递增。
- [ ] fixture：未学A、目标日到期B、后日C和两门课程，期望due=1、第二行正确开课；晚确认旧作答不增加今天复习数，重复回调不产生新学习事实，筛选清除原图关系不变。
~~~ts
expect(day.dueCount).toBe(1);
expect(afterTimer.reviewOccurrences).toEqual(beforeTimer.reviewOccurrences);
expect(afterClear.mounts).toEqual(beforeFilter.mounts);
~~~
这些数据读取真实临时存储和UI结果，不能用另一套测试内聚合函数产生expected。
- [ ] 运行 npm run test:integration -- tests/integration/calendar-order.test.ts、npm run test:integration -- tests/integration/daily-report.test.ts、npm run test:e2e -- tests/e2e/planning-overview-v2.spec.ts、npm run test:e2e -- tests/e2e/daily-report.spec.ts、typecheck；提交。

## P6.6：书籍原文、逐层脑图与列表
**文件：** packages/contracts/src/book-exploration.ts；packages/domain/src/materials/book-exploration.ts；packages/client/src/materials/{BookWorkspace,BookMindMap,BookOutlineList,BookNodeActions}.tsx；tests/integration/book-exploration.test.ts；tests/e2e/book-workspace.spec.ts。
**参考：** B/app/js/screens/{book,reader,assets,card}.js；UI-FIRST-RELEASE.md §2为新的界面依据，不能照旧书籍页面还原布局。
**输入：** P3原件/骨架读、P4定位器、P5卡/知识详情、P6.3骨架写者、P2原生开课/输入；**输出：** BookExploration.read（同一书的只读层级），BookBreakdownIntent（固定版本的明确拆解意图），左原文右结构页。

- [ ] 从资料页/学习集打开书后直接可阅读原文，右侧初始只有书根；已有骨架/卡不删除。根→任意层级骨架→卡片叶节点由同一数据投影，切换列表保留选择与展开状态；展开状态只属于该资料页。
- [ ] 叶节点使用普通卡（包括普通知识卡）的原ref，不新建脑图专属卡。已有收录知识只有存在真实该书关系时才可展示，沿同一知识ref，不为入图自动收录或复制。按source/chapter真实关系归入书，跨书来源保留、无来源卡留全库，不靠标题猜书。
- [ ] 点击已有层可展开/收起；节点的“继续拆解”是独立明确动作。只展开、定位或开详情不得产生模型请求、提案、卡片或review。
- [ ] 拆解意图包含materialId/versionId、根或已存在nodePath、skeletonRevision及已知sources；Host验证目标后，经原生输入绑定进入资料整理课。没有课时只在用户明确拆解动作后创建真实课；不能后台造第二聊天。根尚无骨架时允许仅书版本，范围由读取原文后确定。
- [ ] P6只接意图/确认/已保存结构更新；P7.3负责资料整理Skill和真实生成。生成结果仍经propose_skeleton/propose_card及原确认通路；局部保存/拒绝/失败分别显示，重试不重复卡，冲突保留草稿后读新版本。取消不得撤销已保存的其他项。
- [ ] 点击卡显示现有详情，点来源后在左侧准确定位和标记；多来源可分别选择，换原件版本不偷换锚。原文/卡片图层、公式和选区沿P3/P4，不依赖DSH私有侧栏布局；没有Session时用workspace授权阅读接口。
- [ ] 1440/1024宽度看原文与图并排；390窄屏切原文/结构仍保持节点与位置。列表与脑图都能打开同一卡、回源/开始学习；原P5卡浏览页不被替换。
- [ ] 先构造root→章→节→普通知识卡K，期望初始仅root可见；逐层展开到K后详情ref仍K；切列表保持选择；框定位回原件；展开全过程调用数/新事实数为0。另验无该书真实关系的私人知识不被强行入图。明确拆解后仅发一次真实native意图；保存新增支路不改兄弟章。
~~~ts
expect(initial.visibleNodes.map(node => node.kind)).toEqual(['book']);
expect(selectedCard.target).toBe(cardK.ref);
expect(afterSibling.sources).toEqual(beforeSibling.sources);
expect(afterBrowse.reviewCount).toBe(beforeBrowse.reviewCount);
~~~
这些断言中的数据来自真实schema构造的fixture、BookExploration读侧和UI交互前后结果；不得在测试内另写一个假脑图实现。
- [ ] 运行 npm run test:integration -- tests/integration/book-exploration.test.ts、npm run test:e2e -- tests/e2e/book-workspace.spec.ts、P4定位/P5卡浏览回归、typecheck/build；记录P7真实生成尚未验，提交。

**G6：** 混合路线/精确目标/共同编辑、原卡视图、单书逐层阅读/定位、时间筛选和日期日报通过。P7真实拆书/确认收课的接线须随后联验，不能用fixture代替自然教学。
