# 工具可发现性与读取能力修复

2026-09-12；基于`8eadff1`。接续[首次工具审计](../notebook/tool-schema-review.md)，本次落实已确认缺口，不改学生确认权限、事实身份或DSH锁定版本。

## 已实施

| 课堂动作 | 现在的入口与约束 |
|---|---|
| 今天复习什么 | `list_cards({state:"due"})`列今天到期和逾期的实际普通卡；排除未学卡，按到期日、引用稳定排序；日期取Host时区 |
| 按标签、章节、原件、学习集找卡 | `list_cards`支持`tags`全含、`chapter`本级及下级、`materialId`、`learningSetRef`；学习集按显式成员或实际来源派生，未知集报错；省略过滤读全学习空间 |
| 卡片枚举翻页 | 默认20、最多100；`nextOffset`为下一页，空值表示结束；下一页保持筛选不变，数据变动时从0重读 |
| 一次核对几张卡 | `read_cards({targets:[...]})`一次1–20张且不重复，返回完整卡和各自版本。任一目标读失败则整次失败，不发布部分成功版本；批读成功后可直接`update_card`或`propose_review` |
| 学情按类别列出 | `search_memory`省略query即可枚举，`kinds`过滤；增加`offset/nextOffset`分页，不再只能看到最前100条。摘要仍需`read_memory`精读后才可修改 |
| 内容与学情的分工 | `search_learning`描述以“查内容”开头，`search_memory`以“查学生”开头；`read/note/revise_method`明确指私人知识，memory明确指学生观察。模型面删除不可用的`include:memory`，执行面同样拒绝；已有Remote仍如实返回学情专用入口提示 |
| 复习计划输入 | `kind=campaign`除分支标识外只需title/dailyCount/start/end；learningSetRef默认null，tags/cards/schedule默认[]。patch没有默认，不清空已有日程。Remote输入也使用同源`PlanContentDraft` |
| 日程与每日额度 | 非空schedule是完整的显式安排，日期未列出不补排，已列出的数量不被dailyCount裁掉；空schedule按额度从限定集合中的已学到期卡选择，优先较早到期。只生成读侧引用，不创建复习事实；过去的自由选择候选不从当前状态倒推 |
| 工具边界说明 | 归档只整理课列表，收课与小结用propose_handoff；删除错链由学生编辑页操作；delegate_*用于有材料隔离要求的专门任务，后台用真实childId接原生管理工具 |

卡片名单没有版本，也不被`observedVersion`认可；完整批读的每张卡分别绑定其版本。失败批次不更新绑定，其他写者修改后仍报冲突。新工具同时加入helper的装配过滤与执行拒绝集合，没有让独立助教读到学情。

## 保留的设计

- `propose_*`的待确认通路和窄直接写工具保持独立。被拒时不得换直接写工具绕过确认。
- `SourceLocatorSchema`仍是唯一源。DSH rc.2拒绝`$ref/$defs`以及部分结构化长度/数量约束，所以模型schema继续保留内联结构和约束描述；Zod在实际执行前强校验。没有为了去重生成上游不支持的schema。
- 未统一改工具名或增加新的domain路由参数；明确的工具描述、合法枚举项与读侧候选先解决实际选用问题。

## 验证结果

| 类型 | 结果 |
|---|---|
| 正式build | PASS；`logs/tools-usability-final-build2.log` |
| 应用strict、测试strict、同源合同 | PASS；84个JSON schema；`logs/tools-usability-final-checks.log` |
| 单元 | 15 PASS：到期/未学/过滤/分页、批读限制、计划默认/patch及真实注册schema、原模型根投影 |
| 集成 | 29 PASS：真实原生工具调用、每卡版本/失败批读/并发、最小计划提案→确认→实际保存、重启回读、日投影/计划校验/学情分页/helper隔离；`logs/tools-usability-final-integration.log` |
| 浏览器 | 3 PASS：学情共同编辑与冲突、学习集窄屏、日历实际开课与设置刷新；`logs/tools-usability-browser.log` |
| 独立只读审查 | 未发现可复现P1/P2；提出的新工具helper测试名单缺口在最终版本已补齐并重跑 |
| 真实模型语义选择与调用成本 | 未运行；受控模型的正确执行不证明真实模型首次选工具准确率或更低重试率 |

真实装配现在共50工具：38个StudyForge注册工具（包含复用原生子会话的4个delegate包装工具），12个DSH原生工具。此前报告的48工具按“32+16”分组把4个包装工具归到了原生一侧；总数和5个根联合修复不受影响，此处纠正归属口径。当前5个根联合继续通过，另外45个根不需要转换。

原始失败仍在`logs/tools-discovery-before.log`与`tools-discovery-after.log`：前者在实现前缺少查询函数，后者源实现已写但运行时仍解析到旧contracts/lib。正式构建后重跑通过，未把旧产物结果当新源码验证。提交日志仅清理行尾空白，原始输出在`.runtime/`。

复现入口（本目录、Node24）：

```sh
npm run build
npm run typecheck
npm run typecheck:tests
npm run check:contracts
npm run test:unit -- tests/unit/card-discovery.test.ts tests/unit/plan-authoring-defaults.test.ts tests/unit/tool-schema.test.ts
npm run test:integration -- tests/integration/card-discovery-tools.test.ts tests/integration/day-projection.test.ts tests/integration/tool-schema-projection.test.ts tests/integration/assistant-boundaries.test.ts tests/integration/plan-target-skeleton.test.ts tests/integration/memory-v2.test.ts
npm run test:e2e -- tests/e2e/sets-calendar.spec.ts tests/e2e/coauthor-memory.spec.ts
```

## 试用更新

同一`http://127.0.0.1:64004/`实例加载新的contracts/domain/host/client构建，使用独立产物目录避免旧ESM依赖缓存；只替换两个插件入口，模型配置、课堂、卡片、记忆保持原位置。旧产物目录保留作为入口回退点，不复制或改写用户凭据。共享4877/15565未改。

已在可见Edge刷新原已认证的学情页，路由仍为`#studyforge/memory`，页面显示已连接、原课程列表保留、学情正常读取。没有向用户课堂发送测试消息；上一轮锁屏造成的可见复核缺口已补上。
