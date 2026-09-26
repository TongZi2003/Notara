# HyperKnow 产品调研与 Notara 吸纳建议

调研日期：2026-09-24。范围：公开官方资料、用户提供的实际界面与课堂片段，以及 Notara Native Vault 当前源码。本文记录调研结论和已确认的产品取舍，尚不是具体实施设计。

后续已确认的 AI 教学见解、共同填充上下文、Markdown/HTML 双面白板和 Opus 新前端设计稿接续位置，集中记录在 [AI 教学见解与双面课堂白板](../ui/2026-09-24-adaptive-teaching-whiteboard.md)。其中“知识视图”按用户最后澄清，专指本课真实资料及其联系。

## 判断

用户确认本轮重点借鉴 HyperKnow 的白板板书呈现和可选语音。课程质量由 Notara 自行打磨：课堂应因材施教，不按既定剧本逐项讲完。备课提供目标、材料、候选问题和教学策略，现场根据学生实际回应决定展开、跳过、加深或调整。

复习提纲归入现有复习课备课，可依据近期学情、当前复习队列和明确目标综合准备；提纲是课堂的配套产物，不另立生成器。Notara 已有路线、课堂、题卡、教学记忆、复习和日历基础，本轮重点是吸收白板交互与呈现，教学效果仍须独立验证。

## 证据范围与限制

- **已观察**：官网、官方创始人指南和四篇产品文章可读取，下面的产品描述可以追溯到具体页面。
- **官方自述、未实测**：生成质量、引用准确率、自动调整计划、个性化效果、1000 页文档处理和约两分钟生成等。本文不把这些宣传转成独立验证结论。
- **Agent 直接实测受阻**：浏览器导航多次超时；`agent.hyperknow.io` 的公开请求曾出现 TLS 连接错误。本轮没有登录、注册、付费或上传用户材料，也没有由 Agent 完成生成流程。
- **用户提供的实际使用证据**：白板与课程页截图、页面可访问性文本和一段课堂对话。可以确认板书、图解、圈画、高亮与侧栏对话的呈现，以及语音、翻页、缩放、回放和导出入口；不能仅凭入口确认回放、语音打断和导出的实际效果。本报告只记录必要的结构观察，不复制完整私密对话、身份或会话地址。
- **Notara 是静态对照**：核查 Native Vault 源码和随包教学资源，未启动实例、未运行测试、未做学生体验验收。
- 主仓 `/Users/yangrundong/DSH` 为 `main@f84a29b`，调研开始时干净；该 checkout 没有 `examples/native-vault`。
- 新版对照来自 `/Users/yangrundong/.codex/worktrees/notara-vault-clean/DSH`，`codex/notara-vault-clean@5a5886f`，`@notara/vault-native` 版本 `0.14.9`。其中已有无关的未跟踪文档，未作修改。

## HyperKnow 当前公开功能

官网地址：[hyperknow.io](https://www.hyperknow.io/)。其定位是 all-round learning companion，首页主张是将任意学习目标转成一对一 AI 课程；最初面向大学生，官方指南也包括高中生、自学者和研究者。

| 能力 | 官方具体描述 | 对 Notara 的启发 |
| --- | --- | --- |
| 从目标生成课程 | 从零开始的学习路径；Deep Learning Session 提供系统引导，根据作答调整教学 | 把已有路线规划和课堂入口串成一次可开始的行动 |
| 基于自己的材料学习 | 上传 PDF、教材、课件、笔记；总结结构、提取论点、解释概念、引用对应页码 | 让材料直接进入讲解、练习和整理动作，保持来源可回到原文 |
| Cheatsheet / 复习提纲 | 按主题组织概念、定义、公式及关系；每点回链来源；支持列数、字体、高亮等布局调整和打印 | 归入按近期学情或复习队列准备的复习课，作为配套材料 |
| 闪卡、小测、练习题 | 从用户材料生成，作为主动回忆和互动教学的一部分 | 共用题目和来源，提供不同练习视图，避免重复保存同一题 |
| 多材料对照找遗漏 | 比较课堂笔记、教材和课件，找出未覆盖或描述不一致的部分 | 先提出可核验的材料差异，再用小任务确认是否真的不会 |
| 学习计划与日历 | 从课程材料、教学大纲与 LMS 导入截止日期，估计负担；文章宣称漏学后可重新分配安排 | 展示今天最值得做的一小步，并依据实际进度调整未来安排 |
| 个性化与语音 | Learner's Persona 随学习积累；不同解释方式；voice mode 支持听讲解 | 语音作为可选课堂输入输出；教学适应性独立打磨 |
| 讲解视频 | 输入主题或 URL，生成脚本、旁白和视觉元素，产出通常约两分钟的短讲解 | 对空间、过程和变化类难点按需提供更合适的表示 |
| 外部课程接入 | 官方指南明确提到连接 Canvas；首页提到 LMS deadlines | 对美国大学场景有价值，对当前高中教材试用应后置 |

来源：[创始人指南 S2](https://www.hyperknow.io/blogs/3-minute-guide-hyperknow)、[复习提纲 S3](https://www.hyperknow.io/blogs/ai-cheatsheet-generator)、[短视频 S4](https://www.hyperknow.io/blogs/get-explainer-video)、[学习流程 S5](https://www.hyperknow.io/blogs/study-with-ai)。

需要保留的区别：

- 首页使用了 “interactive videos” 的表述，但视频文章主要描述脚本、旁白和视觉讲解；本轮没有确认具体的交互控件或自适应视频行为。
- 视频文章里的「通常约两分钟」描述成片时长；复习提纲文章里的「约两分钟」描述生成耗时，不能混为同一个性能指标。
- 官方比较文章表格宣称支持 spaced repetition；算法、触发条件和真实复习流程未核验。
- 没有从本轮一手资料确认其知识图谱、Obsidian 集成、本地离线运行、开放 API、开源许可证或完整 Markdown 导出；不能把这些同类产品常见功能归给 HyperKnow。
- 不采用其博客对其他竞品的评价和用户数作为客观比较证据。

官网当日展示 Starter 免费、Pro 18 美元/用户/月、Max 50 美元/用户/月，并标有限时优惠。Pro 列有 memory enabled；页面未给出稳定、可比的绝对调用额度。首页注明当前仅桌面站点，官方比较文称移动端开发中。这些都是当日网页口径，不代表实际结算和全部可用条件。

## 与 Notara 0.14.9 的实际差额

下列代码锚点均位于新版 Native Vault 工作树；「已有」仅表示实现或资源存在。

| 方向 | 源码中已有内容 | 差额判断与锚点 |
| --- | --- | --- |
| 目标与系统课程 | 目标、截止日、每日时长；路线主线、补练、拓展、先修和局部修订 | 无须新建课程系统。`examples/native-vault/agent-tools.js` / `set_teaching_settings`；`route-plan.js` / `parseRouteBody`；`vault-cli.js` / `create-route`、`revise-route` |
| 多种教学方式 | 苏格拉底、费曼、讲解式、结构分析四种教法 | 重点是当前内容上的操作便利度。`resources/vault-teaching/manifest.json` / `choices` |
| PDF 伴读与源引用 | PDF 页/区域读取、框选、批注、区域引用卡片、带入对话；引用含 revision | 引用基础可复用。`client-source.ts` / `PdfReader`、`insertVaultReference`；`agent-media.js` / `readPdfPage`；`pdf-annotations.js` / `createPdfAnnotationStore` |
| 笔记、卡片与关系 | Markdown/frontmatter、双链解析和图谱模块 | 新产物沿用现有文件。`vault.js` / `parseMarkdownDocument`；`graph.js` / `buildVaultGraph` |
| 白板课堂 | `canvas-client.js` / `createVaultCanvas` 用于图谱和路线布局；旧 `examples/plugin-sources/blackboard.ts` 提供板书块编辑和文字追问原型 | 当前 Native Vault 尚无与对话共同推进的白板课堂；旧原型的存在不等于当前已具备该体验 |
| 讲义生成 | 从已核对资料生成、编辑同一份 Markdown，保留来源 | 未找到专门的 Cheatsheet 样式控制和打印流程。`resources/vault-teaching/skills/markdown-handout.md` |
| 小测与变式 | `exercise` 工作预设，要求先自解，区分学生题面和教师参考 | 不宜再做第二个出题 Agent；可补轻量的练习操作和结果衔接。`worker-catalog.js`；`resources/vault-teaching/workers/exercise.md` |
| 复习与日历 | 卡片能力评估、1/3/7/16/35 天排期，日历聚合路线、复习、小结 | 已有调度基础；不等于已有 LMS 导入或自动重排完整体验。`review-data.js` / `validateAssessments`、`REVIEW_INTERVALS`；`calendar-data.js` / `calendarProjection` |
| 学习复盘 | 基于小结、卡片学生理解、评估、画像和锦囊给 1–3 个下一步建议 | 可扩展多材料覆盖对照。现有复盘没有把「笔记没写」直接当作薄弱项。`resources/vault-teaching/skills/learning-review.md` |
| 音视频 | 媒体类型识别、视频/音频播放和媒体引用 | 不能等同于录音转录、语音对话或视频生成。`media.js` / `mediaForPath`；`client-source.ts` / `AssetPreview` |

## 确认的吸纳方向

### 白板随课堂讨论形成

用户提供的界面以大面积白板承载板书与图解，侧栏保留对话。板书通过标题、短句、分列、少量高亮和圈画形成层次，重点内容能够持续留在眼前。对话中也显示板书、示意图、高亮和小测等教学动作。

Notara 借鉴这种课堂呈现：老师根据正在讨论的内容组织公式、图示、推导和关键结论，必要时补充、修改或重组已有板书。不能只不断追加内容；发现错误后，原板书也要得到明确修订。白板沿用现有课堂，不另建会话生命周期。

学生自由手写、共同绘图和动画不是本轮已核验的 HyperKnow 能力，也尚未被确定为 Notara 的实施范围。后续讨论已确定以课堂 Markdown 笔记为内容来源，按 block 投影 HTML，并提供板书面、本课资料关系面和导出分享；具体锚点、编辑接口与布局另行确定，见上述讨论记录。

### 语音可选

语音是同一课堂的可选输入输出方式，学生可以选择听讲或开口提问，文字仍可独立完成学习。不要求每节课使用语音；语音不产生另一套课程、会话或学习事实。具体语音服务、打断方式和与板书的同步机制尚未选定，不能由截图推定已经可用。

### 教学依据学生回应调整

用户提供的课堂片段呈现出反复「肯定回答—吸收成板书—转到下一个知识点」的行为。学生已提出较复杂的解释和反驳，教师仍继续入门级二选一问题，没有充分展现难度调整、证据核验和主线重组。这是该次课堂的行为观察，不能据此断定其内部实现，也不能推断所有课程均如此。

Notara 的课程方向由学生实际表现驱动：

- 已经理解的内容及时跳过或压缩；出现困难时改变解释与任务；提出深入观点时提高问题深度。
- 遇到反驳时独立核查双方说法，区分事实、解释与假设，不用赞美替代判断。
- 备课保留目标、来源、候选问题和策略，课堂不以完成固定讲解顺序或预写问答为目标。
- 学生理解、评估和后续复习仍由实际表现支持，生成板书、听过讲解和完成话题均不等于掌握。

现有代码中的剧本与阶段目录机制并未在本轮修改；上述是确认的产品方向，如何调整既有备课和课堂合同需后续核对，不能将文档取舍写成运行时已经改变。

### 复习课复用现有备课能力

近期课堂表现、学生理解和当前复习队列共同提供候选内容。老师综合共同概念、方法、易混点和时间预算，准备回忆、比较、混合练习或迁移任务；不必逐张讲完整个队列。复习提纲可作为课前导航或课后整理，复用现有 Markdown 讲义与来源引用。

材料对照、LMS 接入、完整视频生成等保留为调研信息，不作为本轮吸纳重点。

## 后续验证关注点

- 白板呈现：讲解、板书、强调和修订是否对应；重点是否清楚；关闭后能否回到原课堂继续。
- 可选语音：启停、打断和文字衔接的真实行为，单独验收，不以按钮存在代替功能通过。
- 教学质量：分别观察初学者、已理解基础的学生和提出反驳的学生；教师是否真正改变下一步教学，而不是换一句肯定语后继续既定顺序。

这些关注点尚未执行，不代表 Notara 已经达到相应教学水平。

## 来源清单

- S1：[官网与价格](https://www.hyperknow.io/) — 定位、主要能力、桌面端、套餐。
- S2：[3 Minute Guide @ Hyperknow](https://www.hyperknow.io/blogs/3-minute-guide-hyperknow) — 创始人使用指南、Deep Learning Session、Canvas、语音和材料学习。
- S3：[AI Cheatsheet Generator](https://www.hyperknow.io/blogs/ai-cheatsheet-generator) — 来源页码、布局定制、主题组织、格式和性能自述。
- S4：[Get Explainer Video](https://www.hyperknow.io/blogs/get-explainer-video) — 主题/URL 输入、脚本、旁白、视觉和短视频边界。
- S5：[How to Study with AI](https://www.hyperknow.io/blogs/study-with-ai) — 多材料查漏、主动回忆、计划调整、Learner's Persona。
- S6：[Quizlet Alternative](https://www.hyperknow.io/blogs/quizlet-alternative) — 仅采用 HyperKnow 自身功能描述；竞品比较与学习效果论断不作事实依据。
- S7：[Manifesto](https://www.hyperknow.io/manifesto) — 主动学习和完整学习流程的产品理念，不作已实现能力证明。
- S8：[Privacy Policy](https://www.hyperknow.io/privacy-policy) — 页面注明更新于 2026-02-24；说明云端处理和外部服务处理商，不支持将其描述为本地离线产品。
- S9：用户于本次对话提供的 HyperKnow 白板、课程页截图及课堂片段 — 支持界面观察与该次教学行为分析；不对外链接私密课堂，不复存完整对话。

本轮仅新增并更新此调研文档，未修改产品代码、运行环境或用户学习数据。
