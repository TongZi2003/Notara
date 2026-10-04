# Vault 工作流

需要动文件、跑命令、查复习或看日历时读这份规范。工作区由 `$DSH_NOTARA_WORKSPACE` 标识，当前资料根由 `$DSH_NOTARA_VAULT_ROOT` 注入；它可能是工作区本身，也可能是兼容旧布局的 `vault/` 子目录。Host 优先保留旧布局：`vault/` 里已有资料时始终读写它；只有用户选中的目录本身已经能看到 Markdown/媒体资料（在目录里，或在该目录的 `知识/`、`卡片/`、`媒体/`、`备课/`、`路线/`、`锦囊/`、`学情/`、`日记/`、`lesson_log/` 下）时，资料根才是这个目录本身。不要自己推断根，直接用注入的变量。Markdown 是唯一事实源，没有数据库，也没有第二套账本。目录与结构是约定，不是权限：只能读写本次接入范围内的文件。

路径分两套，别混用：Bash 通过 `$DSH_NOTARA_VAULT_ROOT` 访问资料（如 `"$DSH_NOTARA_VAULT_ROOT/知识/向量.md"`）；命令行的 `path`，以及 `open_learning_lesson` 的 `path`、`set_teaching_settings` 的 `scriptPath`，都是资料根内相对路径、不带 `vault/`（`知识/向量.md`、`路线/学习路线.md`）。旧工作区需要显示兼容前缀时使用 `$DSH_NOTARA_VAULT_PREFIX`，不要手写固定前缀。

Host 另提供只读教学资源目录 `$DSH_NOTARA_TEACHING`，它不属于学生 Vault。按需读取某份内置样例时，将实际资源索引中的相对路径接在此目录后；不能把这个路径当学生已有资料写入 `materials`。例如用 Bash 读取资源登记：

```sh
cat "$DSH_NOTARA_TEACHING/manifest.json"
```

此类调用的 `description` 使用 `[notara:lesson-read] 查阅教学资源`。只给工作员实际需要的正文与来源说明；无工具工作员不会因为获得索引就读到正文。

## 原生资料工具

- `vault_read` 读取授权资料根内的 Markdown，并返回真实 revision；长文可按行读取。路径始终是资料根内相对路径。
- `vault_search` 按标题、路径和正文检索已登记资料。结果只是候选和片段，不替代 `vault_read` 精读，也不保证不同措辞都能命中。
- `vault_save` 保存授权资料内的 Markdown 或代码文件。新建传空的 `expectedRevision`，修改时先读取并照抄真实 revision；不要用它维护白板、复习字段或技能启用状态。
- `vault_command` 执行确定性 Vault 领域命令；通过 `help` 列出命令，再用 `command-help` 查询参数。`write-batch` 仅处理 Markdown，最多逐项回执，不是代码文件保存入口。
- Bash 用于当前清单提供的命令、高级组合检索、运行与测试；它不能替代带版本的资料保存。联网能力只按实际提供的网页工具判断，不从 Bash 推断。
- 教学技能通过原生 `notara-*` 技能名按需调用；没有 `load_skill` 或 `load_teaching_resource` 工具。工作员是否有资料、Bash 或网页工具由本次实际工具清单与权限决定。

## 文件类型

文件类型由 frontmatter 的 `type` 决定，落地目录按用途区分：

| 目录 | type | 用途 |
| --- | --- | --- |
| `知识/` | `note` | 普通资料、讲义、笔记 |
| `卡片/` | `card` | 知识卡片；只有它带复习生命周期 |
| `锦囊/` | `insight` | 旧的方法与教法经历，照旧可读；新的方法要点写进学习集层技能（`skill-save`） |
| `学情/` | `learner-profile` | 学生画像条目 |
| `备课/` | `lesson` | 备课页/剧本，也可在文末追加本课小结 |
| `路线/` | `route` | 学习路线；身份与关系在 `lessons`，节点规划在同文件正文，读侧统一投影 |
| `lesson_log/` | `lesson-summary` | 没有剧本时的独立课堂小结 |
| `日记/` | `daily` | `日记/YYYY-MM-DD.md`，或 frontmatter 里写 `date` |
| `媒体/` | — | PDF、图片等二进制资料 |
| `_templates/` | `template: true` | 模板，不当作资料 |
| `技能/` | `skill` | 本学习集的学习集层技能；只用 `skill-save` 写，新建为草稿，启用与采用修订由学生在技能页确认 |
| `lesson-board/` | — | 课堂白板，只由 `write_lesson_board` 维护；可以读，不用 `write-batch` 或 shell 直接改 |

frontmatter 只支持扁平子集：单行标量、`[a, b]` 列表或单行 JSON。`title` 写真实标题；`tags`、`subjects` 按需。新建笔记先读 `_templates/` 里同类模板，照它的结构写正文；保存的正文去掉 `template: true`、`name` 和 `{{title}}`、`{{date}}` 这类占位，标题写真实标题，日期行没有真实来源就删掉，不自己填今天的日期；卡片、共性父节点（以及旧锦囊）使用“内容/参考理解/学生理解”三段，旧模板仍是旧标题时按此规范新建，不自动重写已有笔记。学情模板按日期追加具体表现与判断，最后一段保留“当前判断”；学情正文不另设“何时想起”，需要画像时按教学任务和主题检索。

## 读写文件

- 普通 Vault 资料优先用 `vault_read`、`vault_search` 和 `vault_save`；需要多条件管道、枚举文件、查看未登记的项目文件或运行程序时，才使用当前清单提供的 Bash。随包 `"$DSH_NOTARA_RG"` 可用于高级全文检索，缺失时可用 grep/find。Bash 文件路径相对于 `$DSH_NOTARA_VAULT_ROOT`，例如 `"$DSH_NOTARA_VAULT_ROOT/知识/向量.md"`、`"$DSH_NOTARA_VAULT_ROOT/媒体/向量讲义.pdf"`。
- Markdown 的新增与修改用 `vault_save`，或在需要同一领域命令合同的批次中用 `vault_command` 的 `write-batch`；后者仅限 Markdown。按 revision 做 CAS，冲突时重新读取并合并，不得用 `echo >`、`cat >`、`sed -i` 绕过。改已有文件前先读原文，保留不应改动的部分，尤其是程序写入的 frontmatter 字段。
- 更新学生理解按 `notara-method-distillation` 的“学生理解：保留认知演变”：先读完整小节，在原有经历之后补充新的理解与证据。
- 引用资料给真实标题；图片、PDF 放在 `媒体/` 下，用资料根相对路径（`媒体/...`）在 Markdown 里引用。
- 耗时长、又不影响眼前这一步的命令（大范围检索、批量处理 PDF）可以用 Bash 的 `run_in_background: true` 放到后台，结束时会话里会有通知，再用 `job_output` 读取结果；需要马上用结果的命令照常同步执行。后台命令同样服从原生沙箱与审批。
- 保存前把要写入的内容讲清楚；写入服从原生沙箱与审批，完全权限下按原生允许直接执行，不再追加一轮对话确认。用户已经要求保存时不要再用对话二次确认。被拒绝就说还没保存，保存失败如实说明，不换别的路径绕开。Bash（包括 PDF 辅助命令与 `write-batch`）沿用原生沙箱与审批决定，不按命令内容另设分类，也不承诺每次写入都会弹窗。读取 PDF 用现有的读取权限即可。遇到拒绝按真实工具结果说明原因；审批弹窗被关掉时，如实说这一次没有得到批准。
- `type: card` 的复习字段 `learned`、`mastery`、`interval`、`last_review`、`next_review`、`review_history` 由复习流程维护：普通读写必须原样保留，不能手改，也不能编造评估历史。
- 新建题卡原则上一题一卡，页头 `tags`，正文仅 `## 内容` / `## 参考理解` / `## 学生理解`（与工作员共同规则里的“当任务要求卡片时”是同一份合同）。内容保留可检索的完整题干、必要图形和原文参考答案，公式用 LaTeX；理解与原文分开，与原文冲突时保留原文、另记待核对的疑点，没有学生表达就留空。具体质量流程见 `notara-material-outline`，不能继续套“结论/解释/例子”旧结构。
  - 参考理解的最后写 `### 常见错法`：
    - 预判：建卡时就写好，第一次用这张卡就能拿来检验。每条写错的样子（错误结果或写法）、机制（错在哪一步、什么误解）和一句只测那一步的区分追问；只写有把握的，通常两三条，没有值得预判的坑就不写这一小节。
    - 实见：学生在课上的实际表现，写在对应预判下面，一行带日期：踩中了没有、怎样纠正的。踩了预判外的坑，另起一条“实见（预判外）”，补上机制和区分追问。完整过程仍记在“学生理解”里，这里只记踩没踩中。
- 同类内容用 `type: topic` 父节点归纳共性，子卡 `parent` 写真实 Vault 相对路径；父节点也用三段，在内容里列出真实子卡双链，不带复习字段。知识型课本的父节点还要说明概念之间的依赖与区别、它们共同回答的问题。旧卡修订保留已有学生理解与历史，不以新模板覆盖用户自定义内容。

## 代码文件

- 编程课的代码放在 `代码/<课程或项目>/` 下，一门课一个目录；学生在 Vault 里用代码编辑器打开、修改、保存。
- 代码文件先用 `vault_read` 读当前版本，再用 `vault_save` 按真实 `expectedRevision` 保存；`write-batch` 只接受 Markdown。运行与测试用当前清单实际提供的 Bash 和本机已有工具链，不能把保存成功说成程序运行通过。
- 学生正在编辑同一个文件时，先请学生保存；你改完后，学生的编辑器会自动载入新内容，未保存的改动不会被覆盖。
- 运行与测试用 Bash 调用本机已有的工具链（如 `python3 -m doctest`、`python3 -m pytest`、`gcc`），在代码所在目录执行，读完整输出与退出码。Windows 上 Python 常叫 `python` 或 `py`，先用 `command -v python3 python py` 看有哪个。缺少解释器或依赖时如实说明，不自动安装系统依赖；耗时长的命令可以放后台。
- 目录用 git 管理时，可以用 `git diff` 给学生看一段时间内的改动；是否初始化 git 由学生决定。

## Vault 领域命令

优先用原生 `vault_command`，直接传 `command` 与 `input`，不启动 shell。`command: "help"` 列出命令；`command: "command-help", input: {command: "命令名"}` 返回该命令的准确字段。只传内容参数，Host 绑定资料根、会话身份、调用身份与记录时间。

命令一览：

- `write-batch`：成批保存 Markdown，用法见下。
- `review-queue`、`record-review`、`undo-review`、`calendar`：复习与评估，见 `notara-method-distillation`。
- `route-outline`、`create-route`、`revise-route`、`schedule-lesson`：路线与排课，见 `notara-lesson-preparation`。
- `lesson-outline`、`lesson-section`：按阶段读本课剧本，见 `notara-lesson-preparation`。
- `lesson-log`：课堂小结索引，见 `notara-material-search`。
- `pdf-page`、`source-cards`：按页读 PDF、按引用查已拆卡片，见 `notara-material-outline`。
- `skill-list`、`skill-read`、`skill-save`：两层技能，见 `notara-skill-authoring`。

`write-batch` 的 `input` 是 `{files:[...]}`，每项 `{op,path,...}`：

- `op: "create"` 新建，`content` 是完整 Markdown，文件已存在时拒绝。
- `op: "edit"` 的 `oldText` 必须非空且恰好匹配一次，替换为 `newText`，其余原样保留；程序用当前 revision 做 CAS。
- 一批最多 50 个不同路径，逐文件返回 `saved` 或 `error`。检查 `failedCount` 与每项回执，部分失败不撤销已成功项，只重试失败项；不要把外层调用完成当作每一项保存成功。
- 单文件全文保存优先 `vault_save`；代码文件不使用 write-batch。字段与上限以 command-help 为准。

`vault_command` 参数示例：

```json
{"command":"write-batch","input":{"files":[
  {"op":"create","path":"卡片/例.md","content":"# 例\n\n完整 Markdown"},
  {"op":"edit","path":"卡片/旧.md","oldText":"精确原文","newText":"替换文"}
]}}
```

- `path` 是资料根内相对路径，不带 `vault/`；跨集剧本只按 Host 回执中的真实 `readPath` 使用。
- 领域命令要求 `expectedRevision` 时，照抄读取或保存回执的真实 revision；冲突先重新读取并合并。write-batch 不收该字段，由程序核对原文后提交 CAS。
- create-route 是新建，不传 expectedRevision；第一次 record-review 缺少 revision 时先用 review-queue 的 all/pending 取得已有卡片版本。
- 日期、记录 ID、执行身份和 revision 都照真实回执，不编造。用户明确给出的排课日期是内容参数，与 Host 记录时间区分。
- PDF 图像通过原生持久附件返回；`imageAvailable: false` 表示只拿到了文字层，不能声称看过原页。

## 兼容 Bash 命令行

旧脚本或确有需要时仍可通过 Bash 调用同一领域命令。原生资料工具不需要这层包装。Host 注入 `DSH_NOTARA_NODE`、`DSH_NOTARA_CLI`、`DSH_NOTARA_WORKSPACE`、`DSH_NOTARA_VAULT_ROOT`、`DSH_NOTARA_VAULT_PREFIX`、`DSH_NOTARA_WORKSPACE_ID`、`DSH_SESSION_ID`、`DSH_NOTARA_CALL_ID`、`DSH_NOTARA_LESSON`；不自己拼执行身份或脚本位置。shell 资料路径使用 `"$DSH_NOTARA_VAULT_ROOT"`，不要固定假定 vault/ 布局。

```sh
"$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" <command> --help
"$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" write-batch <<'JSON'
{"files":[{"op":"create","path":"卡片/例.md","content":"# 例\n\n完整 Markdown"}]}
JSON
```

CLI 从 stdin 接收 JSON；单引号 heredoc 保留 LaTeX、反引号与美元符号。退出码非零表示失败或部分失败，仍须逐项核对。不要用重定向、sed -i 等绕过 CAS。

## Bash 意图标记

使用 Bash 时，`description` 以 `[notara:<intent>] 简短中文说明` 开头，例如 `[notara:review-record] 记录这次作答并安排复习`。说明只写学习目的，不带路径、ID 或命令，也不出现 `vault/`、Node、CLI 这类内部词；标识只放在 `description`，不写进 command、不 echo、不出现在学生看到的正文里。一次调用只标一个主意图：命令可以多 step，但不要把不同目的藏在同一次调用里，无法归类就用 `other`。原生 `vault_read`、`vault_search`、`vault_save` 与 `vault_command` 不经 Bash，因此不使用 Bash 意图标记。

| intent | 用途 | 当前命令 |
| --- | --- | --- |
| `material-read` | 高级检索、看 PDF 或图片、查资料已拆出的卡 | `pdf-page`、`source-cards`，以及 Bash 的 `ls`／`rg`／`grep`／`sed` |
| `note-write` | 运行旧的 Markdown 批量保存命令 | `write-batch` |
| `memory-read` | 用高级检索查学情、方法要点与旧锦囊 | Bash 的 `ls`／`rg`／`grep`／`sed` |
| `memory-write` | 运行旧的画像批量保存命令 | `write-batch`（方法要点用 `skill-save`） |
| `review-read` | 看复习队列与到期卡片 | `review-queue` |
| `review-record` | 记录一次实际评估 | `record-review` |
| `review-undo` | 撤销最近一次评估 | `undo-review` |
| `calendar-read` | 看日历与课程安排 | `calendar` |
| `lesson-log` | 查当前学习集的课堂小结索引 | `lesson-log` |
| `lesson-read` | 读课程导航或剧本阶段 | `route-outline`、`lesson-outline`、`lesson-section` |
| `route-write` | 建路线、局部调整或排课 | `create-route`、`revise-route`、`schedule-lesson` |
| `other` | `help`、`--help` 或无法归类 | `help` |
