# v2.3 独立审计采纳与原生接入

日期：2026-09-11。用户已明确要求依据[独立审计报告](<独立审计报告>)调整。本文是当前计划的执行裁决；旧计划中相反的内部步骤/字段要求失效，原报告保留不改。

## 1. 采纳范围

| 审计项 | 本版执行裁决 | 具体阶段 |
|---|---|---|
| A1 子Agent管理重复 | 原生ctx.subagents管理创建/继续/取消/父子目录/结果，ui-subagent管活动与用量；角色只提供任务/persona/toolFilter/outputSchema，命题额外登记原卡 | P1.5、P7.4、P8.3 |
| A2 搜索统一协议过重 | 外网沿原生web_search/web_fetch或ctx.web，本地只补卡/知识/资料语义查询；移除外网EntityRef/readState强制和通用SearchService | P1.5、P4.2 |
| A3 五预设/提示基础设施 | 五条可扩展配置共享learning composition，原生Skill provider/动态systemPrompt.section；临时要求直接在本课保存，发布复用版本才制包 | P1.5、P7.3 |
| A4 过早通用事务/证据账 | native Session为唯一接受/事件来源，E按需查询；单记录优先storage-domain，真实跨记录操作才在业务写者补提交恢复 | P1.3、P2.1、P2.3、P5/P6/P8具体写者 |
| A5 教学启发式硬化 | 取消两对象保存门槛/verifiedAbility、reason必填/minor、global审批、固定重试/裁图次数；推论强弱、原因说明和进一步取证归Skill | P1.2、P3.4、P5.1、P7.1–P7.3、P8.3、REVIEW |
| A6 Creator版本过粗 | 日常按改动文件与真实依赖版本编辑；check/preview/install使用整作品快照；不强制每次两模型制作/审读 | P8.2–P8.3 |
| A7 日报状态过重 | 一个CalendarProjection.readDay，Cordis生命周期定时刷新；只需配置/最近成功时间，无强制缓存实体、revision/digest或全历史补算队列 | P6.5 |
| A8 前端预定包装过多 | 直接slots/native view；模型/用量装配合并，输入/模型控制/预览只写实际差额；知识/学情/历史/日报设置按需到达，不自动各成一级页面 | P2、P3、P5.6、P7.2、P8.6 |

本次还将每页每轮固定两次裁图/必须先拿预览票据的要求移出保存门槛：实际图像、来源版本/几何范围仍校验，何时继续看图由Skill决定。这是A5原则对计划中同类规则的落实。

报告的措辞已作两处限定：SearchHit/readState原计划是DTO，不是已实现持久实体，本次删的是强制统一接口；分文件命名本身不证明已造重复运行管理器，本次取消无差额包装的必建要求。当前产品仅P0，以下均是计划修订，不宣称已有代码删除或速度提升。

## 2. 核验后的原生接缝

固定DSH版本0.1.5-rc.2，对应官方commit fb2c4b9e698e30edb738bca4cf0618587db7d203；P0已审构建修正仍保留。独立报告核对了安装声明/README，本任务复核关键边界。实施依实际安装类型，不能抄近似名字冒充可调用API。

- [subagent](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/subagent/subagent/README.md)：start/startContinuable/sendMessage/interrupt与outputSchema。原生spawn可能继承父配置，persona只覆盖一段；角色需要的提示/工具/resources仍要从实际请求验证。
- [web](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/web/web/README.md)：provider、来源、fetch/取消/截断沿原生。安装存在不等于账户已配置；P1.5就探测，相关未通过不能在P9假报成功。
- [system-prompt](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/core/system-prompt/README.md)和[skills](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/skill/skill/README.md)：动态section每次assembly求值，complete可给完整文本，Skill provider处理目录/读取。[agent-presets](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/preset/agent-presets/README.md)只允许空会话换composition，已有课堂用教学配置+动态prompt。
- [storage-domain](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/storage/storage-domain/README.md)与[storage-json](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/storage/storage-json/README.md)：单记录update/原子持久发布可复用；无跨表事务/跨进程锁，确有多写者或跨对象发布时仍需具体保障。
- [tool-fs](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/fs/tool-fs/README.md)与[observation policy](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/fs/fs-observation-policy/README.md)：按文件读后编辑/版本guard。fs-sandbox读范围、grep subprocess不自动等价于学生/作品授权，P1.4验真实路径。
- [schedule](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/schedule/schedule/README.md)向原会话发follow-up，不用来代替日历日报。定时刷新复用安装的Cordis timer 1.1.4之ctx.timeout/interval与effect清理，不需要第二调度管理类。
- 既有[原生对话设计](DSH-NATIVE-EXPERIENCE.md)与[预览设计](DSH-PREVIEW.md)继续定义流式、模型、用量、Raw、红笔与来源定位的实际差额。

## 3. 字段与文档结构

**保留实际消费者需要的数据：** 原生session/request/event引用、material/version/locator、真实作答时间、卡前后内容版本、同版确认采用的内容、复习日程。题面/答案遮挡与系统历史分离，知识单body，脑图/日历返回DTO继续存在。

**简化为配置或正文：** 五教学目录、学情默认分类、通用/学科适用范围、临时语气/要求、观察强弱/原因/待验证描述。自由正文不规定七段、固定标题或观察中状态机；语义质量由Skill与自然课堂验收检验。

**改为按需投影：** E别名、当前/旧依据关系、changedFields、日期活动/到期数量、脑图结构；不预写第二事实账。原生日志引用稳定时不复制原始提案全文，可靠恢复需要时保留最小快照。

**删除强制内部结构：** 全输入证据表、统一全来源SearchService、日报sourceDigest/revision/启用区间/全历史队列、无逻辑native组件包装、每次编辑全作品digest。VersionToken依对象选一种，作品整体digest只管检查/预览/安装。

## 4. 旧新任务映射

| v2.2 | v2.3 |
|---|---|
| P0.1–P0.3 | 原样，不改文件/代码/证据 |
| P1.1–P1.4 | 同号，按本审计重写基线/schema/存储/授权 |
| P1.5输入依据合同 | 依据合入P2.3；P1.5改为提前原生能力联通，live入口一并提前 |
| P2.1–P2.5 | 同号，取消平行Session CRUD/输入证据接受流程/空包装 |
| P2.6模型 + P2.7用量 | 合为P2.6原生模型/强度/用量装配与验收 |
| P2.8调试 | P2.7 |
| P3/P4/P5 | 编号保持，裁图/搜索/修改原因/卡视图等要求已修 |
| P6.5日期视图 + P6.7定时日报 | 合为P6.5日历/日报/roadmap时间筛选 |
| P6.6书籍阅读 | P6.6 |
| P7.1–P7.2 | 同号，移除计数认证与硬范围门槛 |
| P7.3教学Skill + P7.4提示更新 | 合为P7.3五教学配置/原生Skill/动态prompt |
| P7.5帮手 | P7.4原生委派与结果登记 |
| P7.6收课 | P7.5 |
| P8/P9 | 编号保持，文件编辑/整作品验收/UI/验收口径已修 |

阶段计数：P0=3，P1=5，P2=7，P3=4，P4=4，P5=7，P6=6，P7=5，P8=6，P9=5；总52项，产品49项。数量减少不等于性能/成本节省证据，不承诺比例。

## 5. 执行与验收重点

先P1.1确认正确源与G0成果，再做最小存储/授权与P1.5原生联通；web/子任务/提示问题在完整UI前暴露。后续以已经核验的原生接缝接领域功能，不让“原计划预定了服务”成为自建理由。

每个删减有对应行为用例：一次观察可存且无认证；临时要求无需制包；Creator无关A/B编辑不冲突而同文件陈旧写失败；真实搜索/子任务/来源回流；定时/恢复/晚确认日期正确；原卡视图、书籍回源、Raw/红笔入口保留。缓存类名、固定文件数和内部revision变化不作为学生体验通过条件。

本轮仅计划文档调整。P0 G0 PASS只引用已有审查，产品功能、真实模型/搜索provider及定时行为仍待对应阶段验证。
