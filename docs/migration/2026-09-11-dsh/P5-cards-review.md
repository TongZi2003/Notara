# P5：卡片、知识与真实学习记录 Implementation Plan

> **For agentic workers:** 使用superpowers:executing-plans；G4 PASS后执行七项，交G5。schema/工具编写应用designing-teaching-schemas与authoring-skill-tool-contracts。

**Goal:** 承接当前单正文知识、人机共同编辑、持久确认和按真实发生时刻记档。
**Architecture:** 普通卡、知识记录、提案和复习服务各司其职；知识收录不复制身份，学习记录只绑定普通学习对象。
**Tech Stack:** TS同源schema、事务/证据服务、Markdown内容、DSH工具与Remote。

## 全局约束
源码B/bin/{asset_schema,asset_state,method_schema,method_store,card_authoring,review_evidence,confirmations}.py。禁止恢复concept知识记忆、core/expression双正文、按标题拆系统历史和整组覆盖学生links。

## P5.1：普通卡与作者内容边界
**文件：** packages/contracts/src/cards.ts；packages/domain/src/cards/{card-service,content-projection}.ts；packages/host/src/tools/card-tools.ts；tests/integration/card-content-v2.test.ts。
**输入：** 来源/证据/事务；**输出：** OrdinaryCard、CardService.create/read/edit；字段title/presentation/front/sections/notes/sources/chapter/tags/links，系统history分开。

- [ ] 四种presentation保留；普通题卡/知识卡都可承载内容，无来源的命题卡合法，source-only也合法。创建没有review。
- [ ] 作者可写正常二/三级标题，包括“复习”“重写”；系统review/rewrite history为独立字段，renderer不得从body猜边界。
- [ ] 省略字段保留原文；新正文数学格式验证不阻断未改正文的元数据编辑。修改原因可选；前后版本用于展示真实改动，删除reason必填/minor自报例外。成功编辑沿P1事务保存前后内容revision与真实操作归属，供P5.7读侧diff；不把红笔删除线写回卡正文。
- [ ] chapter来自真实骨架或明确无挂点；Host检查引用存在性、原件version和几何范围，不要求先拿裁区预览票据才准保存。是否需要进一步看图归Skill判断。新书卡不能自行造未来ID。
- [ ] 测原正文保真、保留历史、同名标题不截断、notes改动、元数据单改、source-only/无来源、批量全验后写。
- [ ] 运行 npm run test:integration -- tests/integration/card-content-v2.test.ts、source回归/typecheck；提交。

## P5.2：私人知识与锦囊同身份
**文件：** packages/contracts/src/knowledge.ts（完善P1形状）；packages/domain/src/knowledge/{knowledge-service,knowledge-index}.ts；packages/host/src/tools/knowledge-tools.ts；tests/integration/knowledge-identity.test.ts。
**输入：** RecordStore、public teaching refs、普通卡候选；**输出：** note/revise/collect/read，KnowledgeRecord自由body、scope、分类、links、publicSources、collection receipt。

- [ ] note_method保存未收录私人知识，revise沿精确target；经propose_card.method收录同一记录，不复制成第二卡。
- [ ] 顶层title/body是唯一正文入口，method元数据只放target/分类/关联；无需七栏、第一人称、教师/学生分区，也无独立concept桶。
- [ ] 可无关联卡保存章内总结；关联普通题卡或知识卡不改其复习。cards_add增量，移除保留原题/学习轨迹；变更原因可选。
- [ ] 已收录修改沿同知识身份并留下rewrite；公共来源固定package entry version，私人正文不写回公共包。
- [ ] 测未收录→学生确认→同ID收录→人改→模型续改→重启读回；无卡总结、双命中检索、删除知识不删卡、不产生review。
- [ ] 运行 npm run test:integration -- tests/integration/knowledge-identity.test.ts、global-learning-search回归、check:contracts/typecheck；提交。

## P5.3：冻结目标、编辑版与持久确认
**文件：** packages/contracts/src/proposals.ts；packages/domain/src/proposals/{proposal-service,receipt-outbox}.ts；packages/host/src/receipts/dispatcher.ts；packages/client/src/proposals/ProposalCard.tsx；tests/integration/confirmation-v2.test.ts；tests/e2e/confirmation-editor.spec.ts。
**参考：** B/bin/confirmations.py与organization-confirmation-c03测试。
**输入：** P1事务、卡/知识写者、native replay；**输出：** propose/edit/confirm/query，后续plan/skeleton/set/route/handoff共用。

- [ ] 原始提案优先引用稳定native记录，无法可靠恢复时才保留必要原稿快照；学生正在编辑的稿件与确认采用的版本明确区分。确认绑定所见内容、目标和基线，不强制额外旧稿回退功能或状态机。
- [ ] 多项分别pending/applied/rejected/failed；成功项不重复，失败项保留可重试。取消剩余项不撤销已应用事实。
- [ ] 编辑或目标改变后旧确认冲突；重读合并，不能把new digest贴旧稿。展示和写者使用同一canonical内容。
- [ ] 模型turn结束/关闭原课/刷新/cancel不丢确认。实际写完才进outbox；保存成功、待投递和Git失败按实际需要分开；不为无法观测的显示/消费状态增加通用协议。
- [ ] 测commit前/后故障、发送后ack前重启、双tab确认、学生中途编辑、局部失败、跨科旧单保持原目标。native无强幂等时明确重复窗口，不虚报exactly-once。
- [ ] 运行 npm run test:integration -- tests/integration/confirmation-v2.test.ts、npm run test:e2e -- tests/e2e/confirmation-editor.spec.ts、storage回归/typecheck；提交。

## P5.4：发生时刻、晚到确认与复习算术
**文件：** packages/contracts/src/reviews.ts；packages/domain/src/review/{review-service,schedule-step,occurrence-effect}.ts；packages/host/src/tools/review-tools.ts；tests/unit/review-occurrence.test.ts；tests/integration/review-transaction.test.ts。
**输入：** E真实依据、卡baseline/梯子version、ProposalService；**输出：** record/refit/project，mode=advance/history_only/initialize/duplicate。

- [ ] 五档三通道保持；新卡review缺省，初/涉不计次；首学/顺带按现行窄工具权限，通常课内复习经确认。作答时间由Host绑定，非确认日/保存日。
- [ ] 从B/review_evidence.py::schedule_step抽取独立期望：3天档早测牢仍3天，到期牢7天，隔10天再牢14天；忘/初1天，糊/涉保档，封顶。
- [ ] 冻结occurrence/卡baseline/ladder：较新且匹配才推进；较旧或不匹配只追加真实历史与相应计次，不覆盖新due；未学但baseline变更保守第一档初始化。
- [ ] 同occurrence重试不加次数；同occurrence换判定明确冲突，不伪造成新事件。换梯refit无新证据。真实记录与支持条件分开，不把“提示一次”机械降档。
- [ ] 表驱动测试跨日/时区/夏令时、延迟确认、乱序、同日可比较与不可比较、内容/梯子变化、知识不可评、初学幂等。
~~~ts
expect(lateEffect.mode).toBe('history_only');
expect(lateEffect.nextDue).toBe(current.nextDue);
expect(retriedEffect.countDelta).toBe(0);
~~~
这些变量由真实fixture和occurrenceEffect返回；期望数值手工冻结，不调用生产函数生成expected。
- [ ] 运行 npm run test:unit -- tests/unit/review-occurrence.test.ts、npm run test:integration -- tests/integration/review-transaction.test.ts、confirmation回归/typecheck；提交。

## P5.5：卡与知识的共同编辑
**文件：** packages/domain/src/authoring/card-authoring.ts；packages/client/src/cards/{CardEditor,KnowledgeEditor,CardDetail}.tsx；tests/e2e/coauthor-card-knowledge.spec.ts。
**参考：** B/bin/card_authoring.py；app/js/card-editor.js；dev/tests/c01-card-editor.mjs。
**输入：** 卡/知识读写、revision与preview；**输出：** read/preview/save和“和老师继续修改”精确对象意图。

- [ ] 学生可建/改普通卡与知识；编辑同一对象，显示真实公式预览、来源、章节、标签、关系，不用新副本绕过冲突。
- [ ] 教师普通links_add只增量；学生可删。一次编辑不把其他字段/关系/历史清空，知识改写同一body。
- [ ] 冲突保留本地草稿→只读最新版→明确采用新版为基线→合并→保存；禁止隐藏刷新后直接覆盖。
- [ ] 学生交给老师的intent绑定target/current version，老师读后续改，不能依靠学生抄ID/digest。
- [ ] 宽窄屏真实路径：人新建→模型续改→人再改→冲突→重启；四类source回跳；正文保真、copy数学原文。
- [ ] 运行 npm run test:e2e -- tests/e2e/coauthor-card-knowledge.spec.ts、card/knowledge集成/typecheck/build；提交。

## P5.6：学习记录、产出与未学首页
**文件：** packages/domain/src/review/learning-record-projection.ts；packages/client/src/cards/CardBrowser.tsx（内部按实际复杂度组织顺序/按书/标签/放射，不预定四份无逻辑壳）；packages/client/src/{review/ReviewScreen.tsx,review/FirstStudy.tsx,review/ReviewHandout.tsx,home/HomeScreen.tsx}；tests/e2e/learning-records-home.spec.ts；tests/e2e/card-browsing.spec.ts。
**参考：** B/app/js/screens/assets.js::renderAssets/tocViewHtml/radialData、screens/card.js；UI-FIRST-RELEASE.md §2.2。
**输入：** 卡/知识/occurrence/receipts，P2输出投影；**输出：** 资料/题卡/锦囊/学习记录/首页一致读侧；知识是资料中的筛选/详情，无需新增一级KnowledgeScreen。

- [ ] 资料页卡片视图保持当前行为和样式：顺序排列、按书组织、标签筛选、放射图、详情与学习入口；沿用B现有排序/关系语义，不为书籍新脑图重做卡片展示或复制数据。未归书/未学卡可检索，过滤只改变视图。
- [ ] 学习记录投影所有符合当前语义的普通学习对象，不只presentation=problem；知识条目自身无梯子。真实发生时刻、历史补记和当前schedule分开显示。
- [ ] 本课新题直接进入deck和产出，知识/学情等产出走其原对象入口；不由展示推断“学过”。
- [ ] 未学卡在资料可看可学，首页不因库存数量产生提示；到期复习和显式计划保留。复习讲义不混未学卡或知识。
- [ ] 卡背答案/notes/history分区；source-only能先学再记，直接打开不自动“牢”。当前学习/复习行为不被三色纸面样式暗示掌握。
- [ ] 测未学A、到期B、未到期C、知识D、普通note/flashcard学习记录；人改→模型续改→真实记档→重启各屏一致。
- [ ] 真实浏览器验顺序/按书/标签/放射来回切换后仍同一卡、条件保留、关系不被改写；卡片来源回跳正确，打开/排序不新增review。
- [ ] 运行 npm run test:e2e -- tests/e2e/learning-records-home.spec.ts、npm run test:e2e -- tests/e2e/card-browsing.spec.ts、P5回归/typecheck/build；提交。
## P5.7：本课卡片修改与红笔修订
**文件：** packages/contracts/src/changes.ts；packages/domain/src/cards/card-changes.ts；packages/client/src/cards/{CardChangeList,CardRedline,CardTechnicalDiff}.tsx；tests/integration/card-change-scope.test.ts；tests/e2e/card-redline.spec.ts。
**输入：** RecordStore保全的内容revision与operation归属、Card/Knowledge读侧、DSH DiffBlock/Markdown原子；**输出：** 只读变更投影，旧行红色删除线和新版内容，不改持久正文。
- [ ] 每个成功编辑由Host记录target/operationId/actor/sessionId及before/afterRevision；本课视图只选择属于这节课的真实操作，课外编辑不猜归最近课。
- [ ] 比较对应版本的实际改动字段与最小变化行；未变内容正常显示，旧行红笔划掉，新行用当前墨色及新增标识。保留“修改前/后/技术diff”和折叠长上下文。
- [ ] DSH DiffBlock消费的是已给定旧/新文本块，不负责最小diff；先计算差异，技术视图复用它。红笔正文需要专门窄renderer，复用公共Markdown/折叠/复制，不依赖DSH私有CSS或伪造Git patch。
- [ ] 同卡多次编辑按操作顺序列出；只有无其他课/课外修改插入的连续版本链可汇总。禁止用全仓HEAD范围当本课变化，Git未提交但领域已成功仍可看。
- [ ] 公式以完整数学块比较渲染，重复行/移动/空行/纯删除/新增正确；机械字段不当正文变化，来源/标签等单独摘要。缺旧版本明确不可用，不凭模型生成原文。
- [ ] 普通卡仍显示当前内容，复制当前卡不带删除线/旧文；卡背未公开时不因diff揭答案，已删除对象不由变更投影复活。提案预览叫“拟修改”，只有已提交操作叫“已修改”。
- [ ] 测一课单改、人机连续改、两课交错改、重试/失败/no-op、改后刷新、未公开卡背、长段/中文/公式与390px；核diff前后字节与真实revision对应。
- [ ] 运行 npm run test:integration -- tests/integration/card-change-scope.test.ts、npm run test:e2e -- tests/e2e/card-redline.spec.ts、卡/确认回归、typecheck/build；交G5。

**G5：** 除原卡/知识/学习合同外，本课修改归属、红笔旧行与新内容真实对应；没有把删除线写进正文或把别课变化算成本课。
