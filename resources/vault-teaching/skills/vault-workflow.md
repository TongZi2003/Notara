# Vault 工作流

需要动文件、跑命令、查复习或看日历时读这份规范。工作区由 `$DSH_NOTARA_WORKSPACE` 标识，当前资料根由 `$DSH_NOTARA_VAULT_ROOT` 注入；它可能是工作区本身，也可能是兼容旧布局的 `vault/` 子目录。Host 优先保留旧布局：`vault/` 里已有资料时始终读写它；只有用户选中的目录本身已经能看到 Markdown/媒体资料（在目录里，或在该目录的 `知识/`、`卡片/`、`媒体/`、`备课/`、`路线/`、`锦囊/`、`学情/`、`日记/`、`lesson_log/` 下）时，资料根才是这个目录本身。不要自己推断根，直接用注入的变量。Markdown 是唯一事实源，没有数据库，也没有第二套账本。目录与结构是约定，不是权限：只能读写本次接入范围内的文件。

路径分两套，别混用：Bash 通过 `$DSH_NOTARA_VAULT_ROOT` 访问资料（如 `"$DSH_NOTARA_VAULT_ROOT/知识/向量.md"`）；命令行的 `path`，以及 `open_learning_lesson` 的 `path`、`set_teaching_settings` 的 `scriptPath`，都是资料根内相对路径、不带 `vault/`（`知识/向量.md`、`路线/学习路线.md`）。旧工作区需要显示兼容前缀时使用 `$DSH_NOTARA_VAULT_PREFIX`，不要手写固定前缀。

Host 另提供只读教学资源目录 `$DSH_NOTARA_TEACHING`，它不属于学生 Vault。按需读取某份内置样例时，将实际资源索引中的相对路径接在此目录后；不能把这个路径当学生已有资料写入 `materials`。例如用 Bash 读取资源登记：

```sh
cat "$DSH_NOTARA_TEACHING/manifest.json"
```

此类调用的 `description` 使用 `[notara:lesson-read] 查阅教学资源`。只给工作员实际需要的正文与来源说明；无工具工作员不会因为获得索引就读到正文。

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

frontmatter 只支持扁平子集：单行标量、`[a, b]` 列表或单行 JSON。`title` 写真实标题；`tags`、`subjects` 按需。新建笔记先读 `_templates/` 里同类模板，照它的结构写正文；保存的正文去掉 `template: true`、`name` 和 `{{title}}`、`{{date}}` 这类占位，标题写真实标题，日期行没有真实来源就删掉，不自己填今天的日期；卡片、共性父节点（以及旧锦囊）使用“内容/参考理解/学生理解”三段，旧模板仍是旧标题时按此规范新建，不自动重写已有笔记。学情仍保留何时想起/观察/学生原话/教学偏好，不改成题卡。

## 读写文件

- 普通读写都用原生 Bash：找文件用 `ls`、`rg --files`，搜正文用 `rg`／`grep`，读原文用 `sed -n`、`cat`，看图用 `read_image`。这里的 `rg` 都指随包的 `"$DSH_NOTARA_RG"`（参数与 rg 相同，不依赖系统是否装了 rg；变量不存在时改用 `grep -r` 与 `find`）。多步可以接管道，例如先 `"$DSH_NOTARA_RG" -l 不变区间 "$DSH_NOTARA_VAULT_ROOT/知识"` 缩小候选，再 `sed -n '1,80p'` 读候选正文。资料路径相对于 `$DSH_NOTARA_VAULT_ROOT`，例如 `"$DSH_NOTARA_VAULT_ROOT/知识/向量.md"`、`"$DSH_NOTARA_VAULT_ROOT/媒体/向量讲义.pdf"`。
- Vault 里的 Markdown 不用原生 read／write／edit（这三个只对代码文件开放，见“代码文件”），也没有 glob／grep 工具：普通读取直接用 shell，写 Vault Markdown 用 `write-batch` 命令（见“本地命令行”），新建用 `op: "create"`、局部精确替换用 `op: "edit"`。`echo >`、`cat >`、`sed -i` 这类直接改文件不经过 `write-batch` 的路径校验与 CAS，也不套用 write/edit 工具那种写保护，别当作等价写法；普通 shell 读取同样不记进原生 read 的读取记录。改已有文件前先读原文，保留不应改动的部分，尤其是程序写入的 frontmatter 字段。
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

- 编程课的代码放在 `代码/<课程或项目>/` 下，一门课一个目录；学生在图标列的 Vault 里用代码编辑器打开、修改、保存。
- 代码文件用原生 `read`、`edit`、`write`：改已有文件前先用 `read` 读一遍（原生写保护要求先读后写），再用 `edit` 精确替换或 `write` 整体写入。对话里会出现改动对比，学生据此看你改了什么。Markdown 不能用这三个工具，仍按上文用 `write-batch`；检索仍用 shell。
- 学生正在编辑同一个文件时，先请学生保存；你改完后，学生的编辑器会自动载入新内容，未保存的改动不会被覆盖。
- 运行与测试用 Bash 调用本机已有的工具链（如 `python3 -m doctest`、`python3 -m pytest`、`gcc`），在代码所在目录执行，读完整输出与退出码。Windows 上 Python 常叫 `python` 或 `py`，先用 `command -v python3 python py` 看有哪个。缺少解释器或依赖时如实说明，不自动安装系统依赖；耗时长的命令可以放后台。
- 目录用 git 管理时，可以用 `git diff` 给学生看一段时间内的改动；是否初始化 git 由学生决定。

## 本地命令行

Host 注入入口与身份，老师用原生 bash 在当前工作区执行；只使用这些环境变量，不自己拼 Node 路径、脚本位置或身份：

- `DSH_NOTARA_NODE`、`DSH_NOTARA_CLI`：命令入口。
- `DSH_NOTARA_WORKSPACE`：真实工作区根。
- `DSH_NOTARA_VAULT_ROOT`：当前资料根；Markdown、PDF、图片和其他资料都从这里读写。
- `DSH_NOTARA_VAULT_PREFIX`：兼容旧布局的相对前缀，旧布局为 `vault/`，直接选择 Vault 文件夹时为空；不要自行猜测。
- `DSH_NOTARA_WORKSPACE_ID`：这个工作区的注册 id。
- `DSH_SESSION_ID`：本次原生课堂身份，由 Host 内建。
- `DSH_NOTARA_CALL_ID`：本次调用的身份，用于幂等。
- `DSH_NOTARA_LESSON`：Host 给出的本课绑定剧本位置与版本，读剧本的两个命令用它核对绑定；不由你填写或修改。

```sh
"$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" <command>            # 内容参数按 JSON 从 stdin 传入
"$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" <command> --help     # 每条命令自描述的精确 schema
```

命令一览（每条命令的 JSON stdin 字段以它自己的 `--help` 为准，照那份 schema 传参）：

- `write-batch`：写 Vault 里的 Markdown，用法见下。
- `review-queue`、`record-review`、`undo-review`、`calendar`：复习与评估，用法见 `notara-method-distillation`。
- `route-outline`、`create-route`、`revise-route`、`schedule-lesson`：路线与排课，用法见 `notara-route-planning`。
- `lesson-outline`、`lesson-section`：按阶段读本课剧本，用法见 `notara-lesson-preparation`。
- `lesson-log`：查课堂小结索引，用法见 `notara-material-search`。
- `pdf-page`、`source-cards`：按页读 PDF、按引用位置查已拆出的卡，用法见 `notara-material-outline`。
- `skill-list`、`skill-read`、`skill-save`：学科层与学习集层技能，用法见 `notara-skill-authoring`。

- `write-batch`：一次写当前 Vault 里的 Markdown，stdin 是 `{files:[...]}`，每项 `{op, path, ...}`。
  - `op: "create"`：新建，`content` 是完整 Markdown；文件已存在时拒绝。
  - `op: "edit"`：`oldText` 必须非空且在该文件里恰好匹配一次，只替换这一处，其余内容原样保留；命令用实际文件 revision 做 CAS。
  - 一批最多 50 个文件，`path` 互不重复；逐文件返回 `saved` 或 `error`，有失败时整批返回非零，只重试失败项；字段与上限以 `write-batch --help` 为准。
  它是命令行命令，不是模型工具；`description` 用 `[notara:note-write]` 或 `[notara:memory-write]`。用单引号 heredoc 传 JSON，避免 LaTeX 反斜杠、反引号和 `$` 被 shell 展开：

```sh
"$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" write-batch <<'JSON'
{"files":[
  {"op":"create","path":"卡片/例.md","content":"# 例\n\n完整 Markdown"},
  {"op":"edit","path":"卡片/旧.md","oldText":"精确原文","newText":"替换文"}
]}
JSON
```
命令行约定补充：

- 只传内容参数：要读的路径与页码、卡片的能力评估与说明、目标标题，以及用户明确说出的排课日期这类教学内容。记录日期、记录 ID、会话与调用身份由命令和环境变量补齐，不由你传；命令拒绝某个字段就如实说明，不绕过也不编造。
- 命令行的 `path` 是资料根内相对路径（不带 `vault/` 前缀），如 `知识/向量.md`、`媒体/向量讲义.pdf`；换成 shell 路径时拼接到 `"$DSH_NOTARA_VAULT_ROOT"`，不要固定写 `vault/`。工具参数同理：`open_learning_lesson` 的 `path` 如 `路线/学习路线.md`，`set_teaching_settings` 的 `scriptPath` 如 `备课/剧本.md`。
- `record-review`、`undo-review`、`revise-route`、`schedule-lesson` 等要求 `expectedRevision` 的领域命令，用 `review-queue`、`calendar`、`route-outline`、`create-route`、`revise-route`、`lesson-outline` 返回的真实 `revision`，照抄，不自己算也不猜。过期就重新读取再试。`write-batch` 不收这个字段：edit核对已读原文唯一匹配后，由程序取当前revision提交保存；它的逐文件回执带保存后的 `revision`，紧接着记评估时直接照抄。
- `create-route` 是新建路线，不传 `expectedRevision`。卡片的第一次 `record-review` 若手里没有 `expectedRevision`，先用 `review-queue` 的 `status: all` 或 `pending` 取到这张已有卡的 `revision`。
- 返回的路径、日期、记录 ID、`revision` 都是真实值，照抄引用；不自行拼路径、编日期或编号。
- 命令失败时如实说明失败原因与影响，不说成已经保存。

## Bash 意图标记

每次 bash 调用的 `description` 以 `[notara:<intent>] 简短中文说明` 开头，例如 `[notara:review-record] 记录这次作答并安排复习`。说明只写学习目的，不带路径、ID 或命令，也不出现 `vault/`、Node、CLI 这类内部词；标识只放在 `description`，不写进 command、不 echo、不出现在学生看到的正文里。一次调用只标一个主意图：命令可以多 step，但不要把不同目的藏在同一次调用里，无法归类就用 `other`。普通文本读取与写入也都是 bash 调用（shell 或 `write-batch`），同样要标记。

| intent | 用途 | 当前命令 |
| --- | --- | --- |
| `material-read` | 读资料正文、检索候选、看 PDF 或图片、查资料已拆出的卡 | `pdf-page`、`source-cards`，以及 shell 的 `ls`／`rg`／`grep`／`sed` |
| `note-write` | 写普通资料、讲义、笔记 | `write-batch` |
| `memory-read` | 查学情、方法要点与旧锦囊 | shell 的 `ls`／`rg`／`grep`／`sed` |
| `memory-write` | 写学情画像（方法要点用 `skill-save`） | `write-batch` |
| `review-read` | 看复习队列与到期卡片 | `review-queue` |
| `review-record` | 记录一次实际评估 | `record-review` |
| `review-undo` | 撤销最近一次评估 | `undo-review` |
| `calendar-read` | 看日历与课程安排 | `calendar` |
| `lesson-log` | 查当前学习集的课堂小结索引 | `lesson-log` |
| `lesson-read` | 读课程导航或剧本阶段 | `route-outline`、`lesson-outline`、`lesson-section` |
| `route-write` | 建路线、局部调整或排课 | `create-route`、`revise-route`、`schedule-lesson` |
| `other` | `help`、`--help` 或无法归类 | `help` |
