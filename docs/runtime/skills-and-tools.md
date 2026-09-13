# 当前 Skill、Tool 与功能清单

核对日期：2026-09-13。范围为当前 StudyForge DSH 产品，不包含开发用 Codex Skills 或旧 Pi 前端。

当前内置 **5 个教学 Skill、39 个 StudyForge 工具（含新增的 `load_tools`）、12 个 DSH 原生工具**。注册总数51，主课堂实行渐进披露：新课默认仅发送8个完整工具接口，其余通过简短目录按需加载。普通课堂最多可加载48个，诊断课49个；学习会话不提供原生write/edit，制作会话的组合保持原样。完整机制见[工具渐进披露](tool-disclosure.md)。

## 1. 会话预设与教学 Skill

会话预设：`studyforge-learning`（界面“学习”）承载课堂；`studyforge-creation`（“制作”）编辑选定作品。前者的教学方式由下面五个选项决定。

| Skill 名 | 教学选项 | 功能 | 常用工具 |
|---|---|---|---|
| `studyforge-organize` | 资料整理 | 共读原文，逐层拆目录、把原题拆成卡，按要求组织后续安排；拆卡不自动转成讲题 | `read_material`、`read_skeleton`、`list_cards`、`propose_skeleton`、`propose_card` |
| `studyforge-diagnose` | 诊断分析 | 根据真实作答区分概念、方法、计算、题意等原因，保留反例和不确定性 | `query_evidence`、`delegate_assistant`、`delegate_problem`、`register_cards`、`note_memory` |
| `studyforge-socratic` | 苏格拉底授课（默认） | 从学生能做的一步开始引导，根据独立表现调整步长；明确要求完整讲解时允许讲解 | `read_card`、`read_method`、`query_evidence`、`propose_review`、`record_review` |
| `studyforge-brainstorm` | 头脑风暴拓展 | 探索前置、推广、反例、表示转换与方法迁移，区分结论、类比和猜想 | `search_learning`、`read_method`、`note_method`、`revise_method` |
| `studyforge-search` | 搜索 | 检索本人资料和外部来源，精读出处、核对读取范围，支持独立检索委派 | `search_learning`、`read_material`、`web_search`、`web_fetch`、`delegate_search` |

这五个 Skill 和教学选项来自同一组提示文本，共用 `resources/teaching/base.md` 的课堂规则。`skill` 工具加载文本；课程的 `teachingRef` 决定动态注入哪份教学预设。切换教学方式不改变工具权限。章节整理任务会按固定任务上下文采用资料整理规则。

## 2. StudyForge 工具（39）

“待确认”表示产生提案，教学内容在学生确认后才保存；“直接保存”表示满足用途、来源和版本要求后直接写入。“只读”不代表学生已经学过。

### 工具加载（1）

| Tool | 功能 | 效果 |
|---|---|---|
| `load_tools` | 根据目录中的精确名称，一次加载一个或多个完整工具接口；下一步再调用 | 仅改变本课模型请求的工具展示；不执行所选工具、不保存学习事实，跨轮/重启保留，新课重置 |

### 资料和检索（4）

| Tool | 功能 | 效果 |
|---|---|---|
| `list_materials` | 列出或按名称查找已导入资料，取得实际版本引用 | 只读 |
| `read_material` | 按固定版本与位置读取PDF、图片、Word、Markdown、文本等原件 | 只读；可返回真实图像 |
| `preview_region` | 查看PDF页或图片中指定区域 | 只读；须明确页/图片及矩形区域 |
| `search_learning` | 检索或枚举资料正文、卡片和私人知识；命中后再精读 | 只读 |

### 卡片（6）

| Tool | 功能 | 效果 |
|---|---|---|
| `list_cards` | 按到期、标签、章节、资料、学习集筛选和分页列卡 | 只读；到期名单排除未学卡 |
| `read_card` | 读取一张卡的正文、来源、笔记和学习记录 | 只读；绑定所读版本 |
| `read_cards` | 批量读取1–20张卡 | 只读；逐卡绑定版本 |
| `propose_card` | 提议保存普通卡；`kind=method`时提议把已有知识收录为锦囊 | 待确认 |
| `update_card` | 修订刚读过的卡，增补正文、来源、标签、笔记和关联 | 直接保存；保留学习记录，关联删除走学生编辑页 |
| `register_cards` | 批量登记诊断收尾的题卡，整批校验后写入 | 限定用途直接保存；课堂调用受诊断预设限制，全部未学 |

### 知识与方法（3）

| Tool | 功能 | 效果 |
|---|---|---|
| `read_method` | 读取私人知识/方法正文、关系、公共教法来源与收录状态 | 只读 |
| `note_method` | 新增私人知识或方法笔记 | 直接保存；尚未收录为锦囊 |
| `revise_method` | 修订刚读过的同一知识条目 | 直接保存；版本检查，不创建第二条复习梯子 |

### 学情（4）

| Tool | 功能 | 效果 |
|---|---|---|
| `search_memory` | 检索学生观察；省略query可按类别枚举 | 只读 |
| `read_memory` | 精读某条能力、习惯、偏好等观察及依据 | 只读 |
| `note_memory` | 保存一次带情境和真实依据的学生观察 | 直接保存；偏好来自学生实际表达 |
| `revise_memory` | 更正同一观察，保留先前措辞和依据 | 直接保存；先读再改 |

### 学习证据与复习（3）

| Tool | 功能 | 效果 |
|---|---|---|
| `query_evidence` | 从原生课堂中查询已接受的学生原话/作答及E引用 | 只读；系统回执、模型回答不算学生证据 |
| `propose_review` | 提出通常课内复习的判定与依据 | 待确认 |
| `record_review` | 记录首次实际学过，或非复习课堂顺带实际使用既有卡的结果 | 限定用途直接记档；不能替代通常复习确认 |

### 学习集、计划、路线、目录、课程（12）

| Tool | 功能 | 效果 |
|---|---|---|
| `list_sets` | 列学习集 | 只读 |
| `read_set` | 读取学习集的资料、成员和复习政策 | 只读 |
| `propose_set` | 新建或修改学习集，明确增删资料和成员 | 待确认 |
| `list_plans` | 列出书本安排与复习计划 | 只读 |
| `read_plan` | 读取某份已有计划 | 只读 |
| `propose_plan` | 新建/修改阅读安排或复习计划；支持每日额度或明确日程 | 待确认 |
| `read_route` | 读取计划课程、父子关系和已开课绑定 | 只读 |
| `propose_route` | 新增/修改课程路线节点，配置材料、父节点和教法 | 待确认；保存计划节点不等于开课 |
| `read_skeleton` | 读取资料实际目录 | 只读 |
| `propose_skeleton` | 增补目录、改径或按明确影响处理删除 | 待确认；保留未涉及的兄弟章节 |
| `read_lesson` | 读取当前课的资料、学习集、教学方式和状态 | 只读 |
| `propose_lesson_settings` | 修改本课资料、学习集、教法、临时要求或归档状态 | 待确认；归档不等于收课 |

### 小结与接续（2）

| Tool | 功能 | 效果 |
|---|---|---|
| `read_handoff` | 读取本课小结，或上一课固定交给本课的版本 | 只读 |
| `propose_handoff` | 提议收课小结并结束课程，或更正已有小结 | 待确认；截止点与事实快照由Host冻结 |

### 专用委派（4）

| Tool | 帮手与功能 | 输入与结果边界 |
|---|---|---|
| `delegate_search` | 检索帮手：独立查资料和出处 | 只接任务与必要线索；默认返回结果，`background=true`可持续追问；不保存学习事实 |
| `delegate_assistant` | 助教：按已有标准核对/判断 | 只接材料和已有标准，没有标准不评分；返回原话，不写事实 |
| `delegate_peer` | 同伴：评审学生自己的解释是否连贯 | 接材料和学生解释，不给参考答案；返回原话，不写事实 |
| `delegate_problem` | 命题帮手：按目标与约束出题 | 只接目标、约束、真实来源；Host校验后**直接登记未学题卡**，答案留在卡背 |

四个专用帮手使用独立上下文，不获得父课堂完整对话和学情，也不能继续委派。它们是角色提示与工具权限组合，没有额外注册为四个Skill。

## 3. DSH 原生工具（12）

| Tool | 功能 | 当前边界 |
|---|---|---|
| `skill` | 按名称加载可用Skill的完整规则 | 加载规则文本，不保存课程教学选项 |
| `read` | 按行读取文本文件 | 受当前会话读取范围限制 |
| `read_image` | 读取本地图片 | 受读取范围及模型图像能力限制 |
| `glob` | 按文件路径模式找文件 | 受会话范围限制 |
| `grep` | 用正则搜索文件正文 | 受会话范围限制 |
| `write` | 创建或整份替换文本文件 | 不进入学习课堂目录或schema；制作会话只能写选定作品 |
| `edit` | 用精确文本替换编辑文件 | 不进入学习课堂目录或schema；制作会话只能写选定作品 |
| `web_search` | 检索外网信息 | 外部检索，不自动成为本地资料 |
| `web_fetch` | 读取明确URL的内容 | 返回实际内容及截断/错误信息 |
| `subagent` | 创建原生子任务，可后台运行并持续交互 | 学习预设使用spawn；生命周期交给DSH |
| `send_message` | 给直接子任务继续发消息；子任务可回父任务 | 忙时插入，空闲时启动下一轮；仅确认送达 |
| `interrupt_agent` | 请求停止后台任务的当前回合 | 保留任务供后续继续；已完成者为no-op |

51是注册总数，不是每次发送给主课堂的接口数量。教学方式改变默认行为，不强制加载整组工具；诊断专用register_cards仍受原有用途限制。加载subagent或delegate_search时会同时提供send_message/interrupt_agent，以保持后台任务可追问、可停止。制作会话及帮手工具范围不受主课堂展示裁剪影响。当前课堂不开放任意shell/run_code。

## 4. 功能对应关系

| 学生想做的事 | 教学方式与工具流程 |
|---|---|
| 拆一本书的目录 | 资料整理 → 读原文/目录 → `propose_skeleton` → 学生确认 |
| 把某节原题拆成卡 | 资料整理 → 读原文/枚举已有卡 → `propose_card` → 学生确认 |
| 上课讲题 | 苏格拉底授课 → 原文/卡片/方法读取 → 引导与观察 |
| 今天复习什么 | `list_cards(state=due)` → `read_card/read_cards` → 实际作答 → `propose_review` |
| 找出卡点 | 诊断分析 → 真实作答与依据 → 必要时助教/命题 → 学情观察 |
| 找规律与推广 | 头脑风暴拓展 → 检索与精读 → 知识笔记 → 按需确认收录锦囊 |
| 找外部资料 | 搜索 → `web_search/web_fetch`或`delegate_search` |
| 安排后续课程 | `read_route` → `propose_route` → 确认 → 学生点节点开课 |
| 安排复习日期 | `list_plans/read_plan` → `propose_plan` → 确认 |
| 收课并接着上 | `propose_handoff` → 确认小结 → 按所选固定版本开接续课 |
| 上传资料、切换视图、缩放、点开节点 | 学生界面直接调用Host/本地展示，不是额外的模型Tool |

顶部“学习”对应会话预设；五种教学方式属于课程配置。后续设计课中切换入口，应分别考虑这两层以及当前资料整理任务的固定范围。

## 代码依据

- `resources/teaching/manifest.json`、`base.md`、`presets/*.md`：五种教学方式与规则。
- `packages/host/src/teaching/teaching-context.ts`：Skill提供器、动态注入、角色限制。
- `packages/host/src/tools/*.ts`：学习工具真实注册及输入校验。
- `packages/host/src/teaching/native-delegation.ts`：四种专用委派及命题保存行为。
- `packages/host/presets/*/agent.cordis.yml`：学习/制作原生插件组合。
- `packages/host/src/access/context.ts`、`packages/domain/src/access/`：用途与文件权限。
- 最新装配核查：[渐进披露证据](../evidence/tool-disclosure/README.md)：新课8个完整接口，显式加载后扫验49个课堂可用接口（含诊断专用工具），对象根schema兼容修正仍有效。
