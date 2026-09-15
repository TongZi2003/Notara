# DSH 原生对话能力：流式、修订、用量与调试

日期：2026-09-11。DSH证据版本0.1.5-rc.2 / fb2c4b9e698e30edb738bca4cf0618587db7d203。用户要求纳入git diff式卡片修订、token消耗、模型/思考强度选择、Raw JSON调试者模式，并强调复用原生流式组件。本次只补设计和实施任务，不修改P0代码。

## 1. 核实的原生能力与复用边界

| 能力 | 已核官方实现 | StudyForge的接法 |
|---|---|---|
| 流式对话 | ui-conversation共享Session Controller绑定、事件Definitions/Views与inputActions；ui-chat拥有流式节点/折叠/滚动；MarkdownText支持增量Markdown/TeX/code | 保留native composer、事件源和assembler，只注册教学结果/确认/卡片renderer |
| 修改展示 | ui-primitives公开DiffBlock，消费DiffHunk(path,oldText,newText) | 使用真实对象版本生成最小变化，再按纸面风格呈现；它本身不是Git历史查询或最小diff计算器 |
| token用量 | ui-chat完成Turn用量行；token-meter的tokenUsage/contextPressure/contextBreakdown投影 | 展示原生统计，区分实际消耗和上下文估算，缺失不报零 |
| 模型/思考强度 | ui-model-selection的conversation.input.model与/model共享modelDirectories；调用session.models/selectModel | 保留原生控件和Host选择，下一请求生效，不创建第二份配置 |
| 调试 | ui-trajectory有事件时间线/请求检查；JsonTree/JsonBlock可只读检查JSON；Session window持有raw events | 调试者模式复用Trajectory，并增设Raw JSON只读view；不宣称已发现独立完整Raw JSON原生页面 |

一手依据：[Conversation](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/client/ui-conversation/README.md)、[Chat](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/client/ui-chat/README.md)、[DiffBlock源码](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/client/ui-primitives/src/DiffBlock.tsx)、[模型选择](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/client/ui-model-selection/README.md)、[Token meter](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/llm/token-meter/README.md)、[Trajectory](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/client/ui-trajectory/README.md)。

以上为源码/已安装声明核验，非StudyForge实机PASS。

## 2. 流式：沿用同一条原生链

~~~text
DSH Session Controller
        ↓  唯一会话事件窗口/提交状态
ui-conversation binding / inputActions / assembler
        ↓
ui-chat + MarkdownText + StudyForge教学renderer
        ↓
正式对话 / 确认单 / 卡片 / 修改记录
~~~

- 复用原生composer的草稿、附件队列、提交echo、Queue/Steer、Stop及失败恢复；材料引用通过正式codec/扩展附加，不另写send状态机。
- 复用native对暂态assistant chunk、durable final、重试/中断/历史补页的归并；不再维护StudyForge message-store、reconcile或第二SSE。
- 课堂卡/确认单/回执通过真实tool result或持久结果引用注册renderer；view切换不再写一遍事件。
- 普通学习展示保留教学文案与答案边界；模型/强度/token在明确控件里可见。调试开关改变查看方式，不改变prompt、工具权限或事实。
- 模型输出中尚未闭合的公式/代码围栏交原生增量renderer处理；阅读旧消息时新token不抢滚动，完结不把已稳定节点全部重建。

## 3. 卡片“红笔修订”

入口：本课产出中的“查看修改”、卡详情中的修改记录；正常卡仍显示当前正文。

- 每次已提交变更关联target、operationId、actor、真实session（若有）、beforeRevision/afterRevision和改动字段，版本由Host保存。学生脱离课堂的编辑标为课外编辑，不猜属于最近一课。
- 展开某次修改，未变内容正常显示；旧行用红色删除线，新内容使用当前纸面墨色/新增标识。修改长段可折叠上下文；同时可查看修改前、修改后和技术diff。
- 默认只展示这次真实operation的变化。一个课堂同卡多次修改按顺序列出；仅连续、无其他课/课外修改插入的revision链可汇总，避免跨课污染。
- 不直接执行“课堂开始HEAD到现在”的全仓Git diff当课堂事实。Git版本可作证据来源，前后内容和归属仍由精确事务/对象版本确定；Git提交失败不让已成功编辑失去修订展示。
- DSH DiffBlock按输入的old/new块展示，会把所有传入旧行计作删除；先做字段级/行级差异，不能把整张卡传进去使未变行全部变红。原组件无行renderer定制口，红笔正文用窄的StudyForge呈现层和共享Markdown/折叠/复制原子；技术diff复用DiffBlock，二者读同一差异结果，不改或依赖其内部CSS哈希。
- 持久正文不写入删除线。复制当前卡只复制新版；“复制差异”是独立动作。公式按完整数学块比较并渲染，不能拆坏TeX定界符。
- 来源/标签/章节等非正文变化另给可理解摘要；created/due/revision等机械字段不当红笔正文修改。尚未公开的卡背答案不因差异视图提前显示。
- 删除线代表内容发生改变，不判谁对谁错，不产生掌握/复习事件。未提交提案只叫“拟修改”，失败操作不能冒充“本课已修改”。

## 4. 模型、思考强度与token

输入区保留native model/effort控件，/model与之共用同一目录。只有adapter宣告的effort可选，无此能力则不显示强度行；不伪造统一low/medium/high。已有普通Session可选，未建Session时沿native默认路径，不发占位消息激活控件；子代理的选择仍由其正式配置管理。

Host在下一请求边界采纳完整provider/model/effort，运行中的请求继续原选择。UI区分“当前请求”与“下一次选择”，重连按Host恢复。目录缺行但route仍可用不误禁；真正不可路由才按原生block处理。

用量展示以本对话为口径，回合详情及本课面板可查看输入/输出/缓存等原生提供的分项。思考token是输出子集，不再加到总数。尝试重试按native accounting，最终sample替代同attempt的流式sample，不把每chunk累计一次。上下文占用和组成估算独立标“估算”，不当实际token消费或金额。

帮手独立Session的用量单列，后续若提供含帮手合计须按真实关联去重并注明覆盖范围；未报告数据不是0。默认不猜货币价格或强加自动预算策略。

## 5. 调试者模式

提供明确开关，默认关闭；开启后可进入原生Trajectory和Raw JSON，查看本会话实际存在的事件、请求配置、原生工具输入/输出、usage及关联的StudyForge确认/事务状态。JSON可搜索、折叠、复制，初版只读；原生记录与领域状态分别标来源，不伪装成同一种native事件。

Raw view从同一Session binding取已加载窗口，历史页按需加载；标明durable/transient、范围/截断和record identity。流式更新时保持正在检查的节点，不让JSON树不断收起。取消/重试后仍能追溯实际记录。

显式调试允许技术字段、模型名及本会话可访问的原始内容，不适用普通教学正文的去技术化文案规则；不因此扩大账户读取权限，不从Host凭据/环境变量额外取密钥。公开学习导出仍用公开投影，调试内容不自动混入。

## 6. 任务落点

- P1.3 / P5.1：内容revision保全和变更归属。
- P2.2–P2.4：改为复用native composer/assembler/stream renderer。
- P2.6：原生模型/思考强度与token/上下文合并装配验收；P2.7：调试者与Raw JSON。仅实际教学差额才新增组件。
- 新P5.7：真实变更差异和红笔视图。
- P7.3/P7.4：选模与system变化、帮手用量范围联验。
- P8.6 / P9：设置/导出隔离和完整体验验收。

原任务编号不移动；新增4项后P1–P9为50项，含P0共53项。P0文件和正在执行的代码不修改。
