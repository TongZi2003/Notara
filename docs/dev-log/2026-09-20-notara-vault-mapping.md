# Notara 旧功能到 Vault 的文件层映射

日期：2026-09-20  
调研基线：`main@24ffe77`  
范围：只读核对旧 DSH Notara 的功能入口、持久化所有者、前端投影，以及向 Markdown vault 的迁移收敛方式。没有修改运行代码。

## 结论先行

旧 Notara 不是一个单独的小插件，而是 Host、domain、contracts、client 和示例插件共同组成的学习运行时。它把很多“可以由页面、链接、frontmatter、任务和查询投影出来的组织关系”提前做成了独立 RecordStore 对象。

真正需要保留独立运行时所有权的只有几类：

- 原生 DSH 会话、子 Agent、工具执行、权限和并发状态；
- 二进制原始资料及其不可变版本；
- 学生学情证据、复习发生记录、确认提案和冲突/幂等状态；
- 插件安装、版本、权限和代码生命周期。

其余大部分教学内容和组织关系可以收敛为 Markdown 页面：一份页面正文、少量 frontmatter、`[[链接]]`、反向链接、模板和查询。路线、学习集、备课、计划、卡片、讲义和资料使用关系不必各自拥有第二份实体。

## 一、旧功能清单与代码入口

Host 的装配点可以直接看到旧系统注册了哪些长期能力：`packages/host/src/index.ts:127-292`。前端对应的页面、画布和 Sidebar 接线集中在 `packages/client/src/client/index.tsx:44-69`。

| 功能 | 主要文件 | 用户看到的能力 |
|---|---|---|
| 原生学习会话 | `packages/contracts/src/courses.ts`；`packages/domain/src/courses/course-metadata.ts`；`packages/host/src/course-service.ts`；`packages/client/src/classroom/LearningEntry.tsx`、`LearningComposer.tsx`、`LearningWorkspace.tsx` | 从主题、问题或目标进入对话，保存本课设置、课程元数据和继续学习关系 |
| 资料库、导入、版本和阅读 | `packages/contracts/src/material-records.ts`、`materials.ts`、`material-api.ts`、`material-read.ts`；`packages/domain/src/materials/material-service.ts`、`version-store.ts`、`read-material.ts`；`packages/host/src/materials/resource-service.ts`、`source-service.ts`；`packages/client/src/materials/` | 上传 PDF、图片、Word、Markdown，读取、编辑、固定版本、定位页段/行段、引用来源 |
| 骨架与资料章节 | `packages/contracts/src/skeleton.ts`；`packages/domain/src/materials/skeleton-service.ts`；`packages/domain/src/materials/docx/`；`packages/client/src/materials/MaterialOutline.tsx`、`lesson-deck.ts` | 从原始资料建立章节/段落结构，给卡片和讲义提供来源挂点 |
| 卡片与复习 | `packages/contracts/src/cards.ts`、`reviews.ts`；`packages/domain/src/cards/card-service.ts`、`cards/card-changes.ts`、`review/`；`packages/host/src/learning-service.ts`、`tools/card-tools.ts`、`tools/review-tools.ts`；`packages/client/src/cards/`、`materials/CardResource.tsx` | 创建、编辑、批量读取卡片，按来源/标签/学习集筛选，记录复习历史和到期日 |
| 知识笔记 | `packages/contracts/src/knowledge.ts`；`packages/domain/src/knowledge/knowledge-service.ts`；`packages/host/src/learning-service.ts`、`tools/knowledge-tools.ts`；`packages/client/src/cards/`、`materials/` | 保存可积累的共同知识正文，建立关系和公开教法来源；不进入复习梯子 |
| 学情记忆 | `packages/contracts/src/memory.ts`；`packages/domain/src/memory/memory-service.ts`、`memory/memory-index.ts`；`packages/host/src/memory-service.ts`、`tools/memory-tools.ts`；`packages/client/src/memory/` | 保存能力、习惯、偏好等判断及证据，修订时保留历史依据 |
| 学习集 | `packages/contracts/src/sets.ts`；`packages/domain/src/organization/set-service.ts`；`packages/host/src/organization-service.ts`；`packages/client/src/planning/`、`courses/` | 给卡片和资料分组，覆盖复习梯子，提供筛选范围 |
| 路线、课程和计划 | `packages/contracts/src/routes.ts`、`courses.ts`、`plans.ts`；`packages/domain/src/organization/route-service.ts`、`courses/course-metadata.ts`、`courses/journey.ts`；`packages/host/src/organization-service.ts`、`course-service.ts`；`packages/client/src/courses/`、`planning/` | 路线树、课程节点、排课、计划、打开下一课、继续上课 |
| 书籍骨架、知识地图和拆书 | `packages/contracts/src/skeleton.ts`、`atlas.ts`、`book-exploration.ts`；`packages/domain/src/organization/skeleton-authoring.ts`、`chapter-deriver.ts`、`atlas.ts`、`book-exploration.ts`；`packages/client/src/materials/mindmap.tsx`、`lesson-materials-mindmap.ts` | 单书目录、跨书主题地图、拆书预览和路线结构 |
| 日历与日报 | `packages/contracts/src/calendar.ts`；`packages/domain/src/organization/daily-report.ts`；`packages/host/src/calendar-service.ts`；`packages/client/src/planning/Calendar.tsx` | 把课程、复习、保存、路线节点投影到某个日期，生成日报 |
| 教室、世界书和角色规则 | `packages/contracts/src/classroom.ts`、`plugins.ts`；`packages/host/src/plugins/classroom-runtime.ts`、`classroom-service.ts`、`plugins/workbench-data.ts`；`packages/client/src/plugins/ClassroomWorkbench.tsx`、`creation/`；`examples/plugins/worldbook/` | 角色、关系、世界书、触发器、参与规则、任务派发和教师/同学协作 |
| 子 Agent、研讨和教学回合 | `packages/contracts/src/teaching-rounds.ts`、`plugin-learning.ts`；`packages/host/src/teaching/native-delegation.ts`、`teaching/rounds.ts`、`plugins/seminar.ts`；`packages/client/src/classroom/RoundsPanel.tsx`、`plugins/` | 独立子会话、角色发言、研讨过程、停止/继续、公开回复和私有备课投影 |
| 提案、确认和收课小结 | `packages/contracts/src/proposals.ts`、`handoffs.ts`；`packages/domain/src/proposals/`、`courses/class-close-service.ts`；`packages/host/src/proposals-service.ts`、`handoff-service.ts`；`packages/client/src/proposals/`、`classroom/HandoffEditor.tsx` | 先提案、用户确认后写入，冲突/失败可恢复；收课小结固定真实输入截止点和来源快照 |
| 思维图与运行轨迹 | `packages/contracts/src/classroom-trace.ts`；`packages/host/src/classroom-trace-service.ts`、`thought-stages.ts`；`packages/client/src/classroom/ClassroomTrace.tsx`、`debug/` | 从真实会话、保存和教学阶段投影路线图/思维图/调试轨迹 |
| 插件和作品系统 | `packages/contracts/src/plugins.ts`、`creation.ts`；`packages/host/src/plugins/`、`creation/`、`plugins-service.ts`、`creation-service.ts`；`packages/client/src/plugins/`、`creation/`；`examples/plugins/*` | 安装、启停、更新、卸载、版本固定、HTML 工作台、技能、教法、世界书和数学工作台 |
| Vault 资产层 | `packages/contracts/src/vault.ts`；`packages/domain/src/vault/vault-kernel.ts`；`packages/host/src/vault-service.ts`；`packages/client/src/vault/VaultPanel.tsx`；`examples/plugins/vault/` | Markdown 文件树、frontmatter、任务、双向链接、搜索、查询、编辑、冲突保护和带入对话 |

示例插件本身还包括函数实验台、论证工作台、黑板、错解诊所、史料侦探局、几何作图台、数学工作台、情境模拟器、研讨室、时空地图、学习复盘和教室；它们是学习行为或可视化工作台，不应自动被当成 Vault 的实体类型。插件名称与能力入口见 `examples/plugins/*/package.json`。

## 二、底层事实、实体与投影

### 1. 真实持久化边界

旧系统的 RecordStore 使用 workspace 下的 `.studyforge` JSON 存储。`packages/host/src/storage.ts:11-66` 建立工作区锁、`JsonStorageBackend` 和 collection；`packages/domain/src/storage/record-store.ts:1-60` 规定每个对象的版本、操作、删除和幂等记录。Host 的 collection 清单在 `packages/host/src/index.ts:131-256`，包括：

`plugin`、`pluginpin`、`worldbook`、`worldbookuse`、`workbenchdraft`、`workbenchactivity`、`plugindocument`、`seminar`、`classroomtask`、`classroomsession`、`classroomcue`、`course`、`relation`、`thought`、`creation`、`artifact`、`subjectbinding`、`teaching`、`material`、`skeleton`、`atlas`、`card`、`knowledge`、`set`、`route`、`plan`、`memory`、`handoff`、`dailyreport`、`proposal`、`teachinground`。

真正的文件系统内容主要有三类：

1. **原始资料字节**：`packages/domain/src/materials/material-service.ts:20-35` 和 `version-store.ts:1-28` 规定每个资料版本落在 `<workspace>/materials/<materialId>/<versionId>/`，版本文件不可改写；RecordStore 只保存元数据、版本和来源。
2. **作品/插件快照**：`packages/host/src/creation/artifact-service.ts:20-80` 把 `content.md`、`index.html`、`worldbook.json` 等自包含作品快照写入 `.studyforge/artifacts/`；源代码插件仍由 DSH profile/安装快照管理。
3. **原生 DSH 会话和附件**：对话、子会话、工具调用、运行轨迹和附件由 DSH 原生 session/attachment 存储拥有，不是 Notara 的 Markdown 事实。

`vault/` 是新资产层唯一直接以 Markdown 为事实源的目录。`packages/host/src/vault-service.ts:16-63` 只扫描当前 workspace 下的 Markdown，拒绝符号链接和越界路径。

### 2. 哪些是实体

这里的“实体”指重启后仍需要独立身份、版本、权限或并发保护的东西：

- `material`：原始资料元数据和不可变版本身份；字节在 `materials/`。
- `card`：可复习对象；正文、来源、版本、复习历史和 schedule 有不同生命周期。
- `knowledge`：不进入复习梯子的知识正文及收集事实。
- `memory`：关于学生的判断及其证据历史。
- `course`、`handoff`、`proposal`：真实课程、收课小结和待确认写入；它们绑定原生会话、截止点、版本或确认回执。
- `classroomtask`、`classroomsession`、`classroomcue`、`teachinground`、`seminar`：运行中的子 Agent/教室状态。
- `plugin`、`pluginpin`、`artifact`、`workbenchdraft` 等：扩展安装和工作台生命周期。

这些对象不是因为界面上有一张卡片就成为实体，而是因为它们有自己的写者、版本、冲突或恢复合同。

### 3. 哪些是投影

以下内容可以从事实重建，当前代码已经明确表现出这种关系：

- `VaultDocument` 的标题、标签、任务、双链、树、搜索和 backlinks：`packages/domain/src/vault/vault-kernel.ts:38-95`。
- Vault Host 的 `list/query/links` 和 client 的文件树、搜索、反链：`packages/host/src/vault-service.ts:66-119`、`packages/client/src/vault/VaultPanel.tsx:34-98`。
- 日历的 `ActivityItem`、日报、课程日期和到期数量：`packages/contracts/src/calendar.ts:1-110`，由 card/plan/route/course 等真实来源聚合。
- ThoughtMap/阶段图、课程输出、资料关系视图、学习集筛选、书籍地图和各种 `*View`：它们是 read-side projection，不应再复制正文。
- 前端工作台、路线画布、卡片详情、教室座位和插件管理页：都是 `Remote` 或 native session 的读取投影。

## 三、向 Obsidian/SilverBullet 式 Vault 的迁移映射

迁移的基本单位不是“把每个 RecordStore 改成一个 Markdown 文件”，而是先判断它是否已经有独立生命周期。没有独立生命周期的组织关系，统一收敛到页面和索引。

| 旧能力 | Vault 中的最小表达 | 是否保留独立实体 |
|---|---|---|
| 一次备课/一节课的准备 | 一个 `type: lesson-prep` 页面；正文写目标和教法；链接到预先准备的资料；未完成部分用 `- [ ]` | 页面是事实；原生课堂 session 仍是运行时实体 |
| 资料使用关系 | 页面之间的 `[[链接]]`；从资料页反查 backlinks | 不新增 relation 表 |
| 资料树 | 文件夹/页面树 | 不新增 route/tree 实体 |
| 学习集 | `set`/`tags`/`subject` frontmatter + 查询 | 默认不新增 set 实体 |
| 路线 | `type: route` 页面、父子链接、顺序字段或文件夹层级 | 作为查询视图；需要真正打开原生课程时才绑定 session |
| 计划 | 一个计划页面中的任务、日期和资料链接 | 不新增 plan 实体；日历从 frontmatter/任务查询 |
| 卡片 | `type: card` 页面，正文是卡面/答案，`source` 和 `[[链接]]` 保留来源 | 初期可与 Markdown 页面共用文件模型；复习状态若仍需可靠调度，暂由 Host 维护最小元数据 |
| 知识笔记/讲义 | `type: note` 或普通 Markdown 页面，正文只有一份 | 不新增 knowledge/讲义实体 |
| 骨架/atlas | 页面树、标题层级、标签和 backlinks | 作为索引/查询；不另存 skeleton/atlas |
| 复习队列 | 查询 `next_review`、`review` 或任务状态 | 队列是投影；真实复习发生/证据仍需要运行时写者 |
| 日历/日报 | 按日期查询页面、任务和真实 session 事件 | 不把日报当第二份活动账本 |
| 收课小结 | `type: handoff` 页面，链接本课、资料和产出 | 正文可以是文件；确认截止点和版本快照仍由 Host 绑定 |
| 学情记忆 | `type: memory` 页面 + 证据链接 | 如果需要证据历史、修订和权限，先保留 Host-owned metadata，不用普通 checkbox 冒充掌握 |
| 世界书/教室模板 | 模板文件或独立插件作品；页面可保存创作内容 | 活跃角色、任务、子会话和触发器仍属会话层 |
| 思维图/轨迹 | 从对话、写回和页面链接重建；用户需要时导出为普通 Markdown | 不新增 ThoughtMap 事实库 |
| 插件/工作台 | DSH 插件包、技能和自包含作品文件 | 不放进普通 Vault 页面；安装/权限/版本仍属插件系统 |

### 模板、索引和任务分别负责什么

- **模板**只负责生成页面骨架，例如备课页、资料页、卡片页、收课页；不产生额外数据库对象。
- **索引**扫描 Markdown 页面，建立标题、frontmatter、标签、任务、双链和反向链接；它是可重建缓存。
- **任务**是页面里的可查询 checkbox。它适合“这节课还要读哪份资料、准备哪道例题、补哪一章”，不代表掌握，也不取代复习证据。
- **查询**把路线、学习集、复习队列、某节课使用的资料和待备课项投影出来；查询结果不是新的事实。

## 四、需要保留的边界

不能为了追求“全都 Markdown 化”而丢掉旧系统已经解决的事实边界：

1. 文件正文可以是 Markdown，但当前 revision、写入冲突和原生会话身份由 Host 绑定；Vault 当前的 `expectedRevision` 保存合同见 `packages/contracts/src/vault.ts:7-18` 和 `packages/host/src/vault-service.ts:87-98`。
2. `- [x]` 只能表示任务完成。它不能表示学生掌握、复习发生或学情判断；卡片 schema 已把内容、复习 schedule 和历史拆开，见 `packages/contracts/src/cards.ts:65-80`。
3. 学情记忆必须保留来源和修订历史，见 `packages/contracts/src/memory.ts:35-77`；可以把它显示成 Markdown 页面，但不能只靠页面文字推导证据。
4. 提案、确认、收课和子 Agent 状态需要幂等、冲突和恢复，不能被普通文件编辑替代；它们的运行记录仍在 `.studyforge` 和 DSH session 中。
5. 世界书可以由模板和作品文件生成，但运行中的角色背景、任务结果和私有备课不能自动写进学生可见的普通资产页。

## 最终收敛

旧 Notara 的文件层迁移可以压缩为四种东西：

1. **页面**：正文和少量 frontmatter；
2. **链接**：资料、课程、卡片、讲义和来源之间的关系；
3. **任务**：页面内可查询的准备/练习 checklist；
4. **索引/查询**：文件树、路线、学习集、反链、复习队列和日历等投影。

DSH 只继续拥有不能由文件自然重建的部分：会话、Agent、权限、版本冲突、确认写入、复习发生和学情证据。其他旧对象先不迁移成同名实体；先用模板、链接和索引表达，只有实际出现独立生命周期时才增加实体。

## 未决但不阻塞的点

- Markdown 卡片的复习历史具体放在 frontmatter、受控附属区，还是 Host sidecar，需要在真正接入复习写者时决定。
- 非 Markdown 原始资料是否继续保留现有 `materials/` 版本库，当前结论是保留；Vault 只保存其页面化目录和来源链接。
- Worldbook 是否最终使用 Markdown 模板，还是保留 JSON 作品文件，由世界书编辑体验决定；这不影响 Vault 资产层的最小内核。
