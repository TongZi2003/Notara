# 工具 schema：真实定义与课堂反馈的核对

2026-09-12；DSH 0.1.5-rc.2。课堂模型自述为零次工具调用，所以它的建议是可用性假设，不能当成调用失败率或长期使用证据。

## 已修复并验证的请求阻断

原生注册表允许对象联合只有 `oneOf`，真实 provider 要求函数参数根显式 `type: object`。受影响的五个工具为 `propose_card`、`propose_handoff`、`propose_plan`、`propose_route`、`propose_set`。

`packages/host/src/tools/model-tool-schemas.ts` 只对最终模型工具列表做等价投影：给全对象分支的根联合补对象类型，不修改分支、字段、顺序或注册对象。`toolSchema()` 保持 DSH 子集合规；真实写入仍经过 Zod 和领域服务校验。

验证来自正式构建的隔离 Host 的 `request/header`：48 个工具，32 个 StudyForge、16 个 DSH 内置；43 个根无需改动，5 个根需投影。所有 StudyForge 输入及输出通过原生子集检查，模型终稿任意深度的结构也已扫描。嵌套联合保持原意，未依据猜测拍平或删除约束。测试：`tests/unit/tool-schema.test.ts`、`tests/integration/tool-schema-projection.test.ts`。

试用实例 64004 更新 Host 后，主 Agent 在浏览器观察到用户 09:51 的 `hi` 已得到实际模型回答；没有替用户改写历史失败记录。这只证明该次请求和工具表被真实 provider 接受，不等于 48 个工具的执行效果全部经过实模验证。

## 对建议逐项裁决

| 建议/观察 | 真实情况 | 裁决 |
|---|---|---|
| 只能 query，不能枚举 | `LearningSearchInputSchema.query`、`MemorySearchInputSchema.query` 都默认空字符串；两个读实现明确支持空查询列出现有条目。学情还支持 `kinds`。两者最多返回 100 项并报告截断，不是无限枚举。 | 首先应在工具描述中明确空查询用法；“完全不能枚举”不成立。 |
| 缺少今天该复习哪些卡 | 领域已有到期/逾期集合，`CalendarDay` 只暴露数量，模型工具没有到期卡清单；普通搜索也没有 due/tag/chapter 过滤。 | 真缺口；优先增加复用现有卡记录的有界到期读取，返回实际卡引用与状态。不能只把 `dueCount` 包成工具。 |
| search_learning / search_memory 易混淆 | 两个描述已区分“资料/卡/知识”和“关于学生的观察”；但 `search_learning.include` 仍允许 `memory`，领域实现会过滤它并返回 `memory_purpose_required`。 | 真正的合同漂移是不可用枚举项，宜先删掉模型面这个选项；全量改名不是本轮修复的前提。 |
| 确认通路统一成参数 | `propose_*` 暂存待确认；`record_review`、`register_cards` 有明确限定用途。合并不能消除选错通道的问题，也不能赋予新的直接写权限。 | 保留显式通路。应完善描述中的使用条件与相互指路，不做 `confirm:false` 式捷径。 |
| locator 改共享 $ref | 合同源码已有唯一 `SourceLocatorSchema`；DSH 子集拒绝 `$ref/$defs`。模型渲染看到重复不代表源码有九套定义。 | 当前版本不采用；不能用上游会拒的结构换取文本去重。 |
| prose 约束搬回结构字段 | DSH 子集也拒绝 `minItems/minLength/format/pattern` 等；适配器把这些条件放进描述，Zod 在副作用前继续强校验。 | 当前是版本限制下的适配，不是条件被删除；如升级原生子集，应再改投影。 |
| dailyCount 与 schedule 天然矛盾 | 创建时确实都必填，`schedule` 可传 `[]`。`PlanService.check` 已检查日期范围、重复日期、重复卡和真实引用，所以“没有任何联动校验”不成立。指定日程与每日自由选卡可以是两个合法用法。 | 需明确优先关系并降低空数组输入负担。另一个实质缺口是 `read-day.ts` 对 campaign 只消费显式日程，没有用 `dailyCount` 生成自由选卡的日投影。 |
| archived 与 close 都结束课 | `archived` 和 `closure` 是不同字段：前者是归档，后者保存学生确认的小结和结束事实；两者在提案入口都需要学生确认。 | 不应直接删掉字段。工具描述应明确“归档不等于收课”，模型不应拿归档代替收尾。 |
| 错链无法删除 | 共享 CardPatch 有 `links_remove`，学生编辑器可删除；模型工具刻意 omit 该字段，保护学生自己整理过的关系。 | 是写者边界，不是数据永远删不掉；描述应指出学生编辑入口。若放开老师删除，应单独裁决权限。 |
| delegate 与 subagent 分工含糊 | StudyForge 的委派构造独立材料输入并限制学情访问；DSH 的 subagent 是通用原生子会话能力。 | 描述可补相互指路，保留材料和学生观察的隔离边界。 |

主要源码：`packages/contracts/src/{learning-search,memory,plans,cards,courses}.ts`；`packages/domain/src/materials/learning-search.ts`；`packages/domain/src/memory/memory-index.ts`；`packages/domain/src/organization/{plan-service,read-day}.ts`；`packages/host/src/tools/`；`packages/host/src/teaching/native-delegation.ts`。

本轮实际产品修复是五个根联合的 provider 兼容问题。上表其余项是核查结论和改进建议，未据此批量改工具名、读写权限或计划事实格式。
