# Vault 工作流

需要动文件、跑命令、查复习或看日历时读这份规范。工作区根是 `$DSH_NOTARA_WORKSPACE`，Vault 是它下面的 `vault/`：一个 Markdown 文件树，Markdown 是唯一事实源，没有数据库，也没有第二套账本。目录与结构是约定，不是权限：只能读写本次接入范围内的文件。

路径分两套，别混用：Bash 在工作区根执行，路径带 `vault/` 前缀（`vault/知识/向量.md`）；命令行的 `path`，以及 `open_learning_lesson` 的 `path`、`set_teaching_settings` 的 `scriptPath`，是 Vault 内相对路径、不带 `vault/`（`知识/向量.md`、`路线/学习路线.md`）。

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
| `锦囊/` | `insight` | 可召回的方法与教法经历 |
| `学情/` | `learner-profile` | 学生画像条目 |
| `备课/` | `lesson` | 备课页/剧本，也可在文末追加本课小结 |
| `路线/` | `route` | 学习路线；身份与关系在 `lessons`，节点规划在同文件正文，读侧统一投影 |
| `lesson_log/` | `lesson-summary` | 没有剧本时的独立课堂小结 |
| `日记/` | `daily` | `日记/YYYY-MM-DD.md`，或 frontmatter 里写 `date` |
| `媒体/` | — | PDF、图片等二进制资料 |
| `_templates/` | `template: true` | 模板，不当作资料 |

frontmatter 只支持扁平子集：单行标量、`[a, b]` 列表或单行 JSON。`title` 写真实标题；`tags`、`subjects` 按需。新建笔记先读 `_templates/` 里同类模板；卡片、锦囊、共性父节点使用“内容/参考理解/学生理解”三段，旧模板仍是旧标题时按此规范新建，不自动重写已有笔记。学情仍保留何时想起/观察/学生原话/教学偏好，不改成题卡。

## 读写文件

- 普通读写都用原生 Bash：找文件用 `ls`、`rg --files`，搜正文用 `rg`／`grep`，读原文用 `sed -n`、`cat`，看图用 `read_image`；多步可以接管道，例如先 `rg -l 不变区间 vault/知识` 缩小候选，再 `sed -n '1,80p'` 读候选正文。路径相对工作区根，带 `vault/` 前缀，如 `vault/知识/向量.md`、`vault/媒体/向量讲义.pdf`。
- 没有单独的 read／write／edit／glob／grep 工具：普通读取直接用 shell，写 Vault Markdown 用 `write-batch` 命令（见“本地命令行”），新建用 `op: "create"`、局部精确替换用 `op: "edit"`。`echo >`、`cat >`、`sed -i` 这类直接改文件不经过 `write-batch` 的路径校验与 CAS，也不套用 write/edit 工具那种写保护，别当作等价写法。改已有文件前先读原文，保留不应改动的部分，尤其是程序写入的 frontmatter 字段。
- 更新学生理解前读完整小节，在原有经历之后补充新的理解与证据；保留旧错、修正经过和提示程度，不以最新正确结论覆盖历史。可以另写有依据的当前概括，但仍保留演变记录。来源链接与日期沿用真实证据，未知不编；误转写或误归因可据证据更正并说明，不将记录错误当作学生真实经历。
- 引用资料给真实标题；图片、PDF 放在 `媒体/` 下，用工作区相对路径（`vault/媒体/...`）在 Markdown 里引用。
- 保存前把要写入的内容讲清楚；写入服从原生沙箱与审批，完全权限下按原生允许直接执行，不再追加一轮对话确认。用户已经要求保存时不要再用对话二次确认。被拒绝就说还没保存，保存失败如实说明，不换别的路径绕开。Bash（包括 PDF 辅助命令与 `write-batch`）沿用原生沙箱与审批决定，不按命令内容另设分类，也不承诺每次写入都会弹窗。
- `type: card` 的复习字段 `learned`、`mastery`、`interval`、`last_review`、`next_review`、`review_history` 由复习流程维护：普通读写必须原样保留，不能手改，也不能编造评估历史。
- 新建题卡原则上一题一卡，页头 `tags`，正文仅 `## 内容` / `## 参考理解` / `## 学生理解`（与工作员共同规则里的“当任务要求卡片时”是同一份合同）。内容保留可检索的完整题干、必要图形和原文参考答案，公式用 LaTeX；理解与原文分开，没有学生表达就留空。具体质量流程见 `notara-material-outline`，不能继续套“结论/解释/例子”旧结构。
- 同类内容用 `type: topic` 父节点归纳共性，子卡 `parent` 写真实 Vault 相对路径；父节点也用三段，在内容里列出真实子卡双链，不带复习字段。知识型课本的父节点还要说明概念之间的依赖与区别、它们共同回答的问题。旧卡修订保留已有学生理解与历史，不以新模板覆盖用户自定义内容。

## 本地命令行

Host 注入入口与身份，老师用原生 bash 在当前工作区执行；只使用这些环境变量，不自己拼 Node 路径、脚本位置或身份：

- `DSH_NOTARA_NODE`、`DSH_NOTARA_CLI`：命令入口。
- `DSH_NOTARA_WORKSPACE`：真实工作区根，`vault/` 在它下面；命令行的 `path` 相对 `vault/`。
- `DSH_NOTARA_WORKSPACE_ID`：这个工作区的注册 id。
- `DSH_SESSION_ID`：本次原生课堂身份，由 Host 内建。
- `DSH_NOTARA_CALL_ID`：本次调用的身份，用于幂等。
- `DSH_NOTARA_LESSON`：Host 给出的本课绑定剧本位置与版本，读剧本的两个命令用它核对绑定；不由你填写或修改。

```sh
"$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" <command>            # 内容参数按 JSON 从 stdin 传入
"$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" <command> --help     # 每条命令自描述的精确 schema
```

命令：`help`、`lesson-outline`、`lesson-section`、`review-queue`、`record-review`、`undo-review`、`calendar`、`lesson-log`、`route-outline`、`create-route`、`revise-route`、`schedule-lesson`、`pdf-page`、`write-batch`。每条命令的 JSON stdin schema 以它自己的 `--help` 为准，照该 schema 传参；下面的用法只说明时机。

- `pdf-page`：按页读 PDF 的 `path` 与 `page`（可选归一化 `rect` 取一块），返回 `text`、`pageCount`、真实 `revision`、工作区内部临时 `imagePath`，以及确定性的 `locator` 与 `embed`。有公式、图形或表格时必须用 `read_image` 核对 `imagePath` 的页面图像，文字层仅用于找位置，不当作准确转写。引用照抄返回的 `embed`，不自己拼坐标或版本；只引用整页时不必先裁区域，要引用区域就先看整页图选 `rect`、再看裁切图核对。它的 `revision` 只用来核对与引用，不当写入的 `expectedRevision`。
  工作员需要核对原题或原文答案时，将返回的 `embed` 照抄到 `ask_worker.sources`，Host按版本核对并传原页图像；不是传临时 `imagePath` 让工作员自己打开。最多4处，只选本次题目及原解；文字材料和实际卡片正文用 `materials` 显式交接。
不能把每页文字层直接复制成卡片；按题目或知识结构组织，保留原页/区域引用后再写核实过的内容。阅读器创建的区域引用卡片保留 PDF 原版图像和定位，可带高亮标注引用；图层与批注由阅读器维护在 `.notara/pdf-annotations/`，普通资料扫描不把它当作卡片。用户或阅读器真的给了带标注的 locator 就沿用它，不要自己生成标注身份或改写这份元数据；原 PDF 版本变化后，先核对原文位置，不沿用旧坐标宣称引用准确。
工作员没有联网、Bash 与写入能力：网页正文、代码与实验记录用 `materials` 交接，PDF 原页用 `sources` 交接，联网取材与编程/命令的实际执行留在你这边，没运行就标“未运行”。
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
- `review-queue`：准备复习时查当前学习集的卡片候选（可按标题检索、标签、状态和分页），返回卡片的真实路径与 `revision`。
- `record-review`：一道题讨论收束、转入下一题前主动记录到本题题卡，同段讨论只记一次。用读到的 `path` 与正文更新后的最新 `revision`（作为 `expectedRevision`），按本次检验点传 `assessments`（每项 `ability` 与 `outcome`）和必需的 `note`；只有老师讲解、没有学生表现时写 `not_observed`，不能编成通过。字段、取值与上限以 `record-review --help` 为准，找卡/建卡、补学生理解、判断与回执核对的完整步骤见 `notara-method-distillation`。评估与排期保存在同一题卡页头的 `review_history` 和复习字段，详细演变在正文；日期、记录 ID、课堂身份和排期由命令处理，不由你传或手改。早期 `passed` 只读保留，新写不再使用。
- `undo-review`：记错了就撤销最近一次未撤销的评估，恢复它之前的档位；当前值已被外部改动时命令会拒绝，重新读取后再决定，不要新建一条相反的记录。
- `calendar`：按 `from`/`to`（`YYYY-MM-DD`）看路线安排、课堂小结、日记和到期卡片；返回的 `routes` 也列出未排期节点与路线 revision，可用于首次排课。
- `lesson-log`：按时间、科目或关键词查课堂小结索引，可回到剧本内或独立小结；它只覆盖当前学习集，跨学习集要按原生授权目录自己用 shell（`ls`／`rg`／`grep`）查，不要说它做了跨集索引。
- `lesson-outline`：只读剧本的公共阶段目录，不把教师正文读进上下文。`path` 填剧本的 Vault 相对路径；跨集时用本课背景给出的 `readPath` 原样传入，绝对 `readPath` 只对已经绑定的剧本有效，也不要用同名的相对路径去别的工作区试。返回 `sections`（`key` 是程序派生的 `section-1`、`section-2`…，不是 Markdown 里手写的编号）、每段的 `lineFrom`/`lineTo`、`teacherCount`、真实 `revision`、`readPath`、绑定版本 `boundRevision` 与 `stale`；目录默认 40 条、最多 100，`nextOffset` 非空就照抄续读。`stale` 表示文件与绑定版本已经不一致：先重新读取核对、重新绑定，再按当前版本继续，不拿旧目录当成新版本。
- `lesson-section`：按阶段读这一段正文与它的就近教师参考。`path` 用 `lesson-outline` 返回的 `readPath`，`section` 用同一份目录的 `key`，`expectedRevision` 必须填那份目录返回的真实 `revision`。正文按 Unicode 字符分页，默认 6000、最多 12000，`nextOffset` 不为空就照抄续读，不跨阶段预读后面的答案。绑定剧本被改动后命令会要求重新绑定：先重新读取核对，再用 `set_teaching_settings` 的 `scriptPath` 重新绑定后继续。
- `route-outline`：读取节点身份、阶段、主线/分支、先修与真实 revision；不返回规划正文。默认40个节点，`nextOffset` 非空时继续读。用它提供的 revision 局部修订，不混用 shell 里读到的文件版本，也不用为了查版本虚构日期范围。
- `create-route`：新建学习路线，overview写课程总述，brief写各课规划；stage分组、pathway主线/条件补练/拓展、prerequisiteIndexes表示知识先修。节点身份和正文挂点由程序生成，默认主线接上一主线，分支要明确parentIndex；已写好的剧本用scriptPath指真实文件。具体规划方法按需读 `notara-route-planning`。
- `revise-route`：按真实课堂依据局部调整。传path、expectedRevision、reason及updates/additions；省略字段保持，允许的null清除，[]清空数组。已开展课堂不覆盖，需要重学或新目标就新增节点。身份、既有课堂和日期不由模型改写；Host保留修改原因与受影响节点。无变化返回saved:false。新节点要被后续节点引用时，先保存取得真实id再调整。
- `schedule-lesson`：按用户给出的日期更新已有路线节点；`date` 为 `null` 清除安排。没有日期不要调用。

读剧本的两个命令长这样，bash 用途写 `[notara:lesson-read]`，例如 `[notara:lesson-read] 读本课剧本的阶段目录`；下面的 `path`、`section` 与 `expectedRevision` 照抄上一条命令的返回，不自己编：

```sh
printf '%s' '{"path":"备课/迭代数列.md"}' | "$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" lesson-outline
printf '%s' '{"path":"来自目录的 readPath","section":"section-2","expectedRevision":"来自目录的 revision"}' | "$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" lesson-section
```

命令行约定补充：

- 只传内容参数：要读的路径与页码、卡片的能力评估与说明、目标标题，以及用户明确说出的排课日期这类教学内容。记录日期、记录 ID、会话与调用身份由命令和环境变量补齐，不由你传；命令拒绝某个字段就如实说明，不绕过也不编造。
- 命令行的 `path` 是 Vault 内相对路径（相对 `vault/`，不带 `vault/` 前缀），如 `知识/向量.md`、`媒体/向量讲义.pdf`；换成 shell 路径时写成 `vault/知识/向量.md`（相对工作区根）。工具参数同理：`open_learning_lesson` 的 `path` 如 `路线/学习路线.md`，`set_teaching_settings` 的 `scriptPath` 如 `备课/剧本.md`。
- `record-review`、`undo-review`、`revise-route`、`schedule-lesson` 等要求 `expectedRevision` 的领域命令，用 `review-queue`、`calendar`、`route-outline`、`create-route`、`revise-route`、`lesson-outline` 返回的真实 `revision`，照抄，不自己算也不猜。过期就重新读取再试。`write-batch` 不收这个字段：edit核对已读原文唯一匹配后，由程序取当前revision提交保存。
- `create-route` 是新建路线，不传 `expectedRevision`。卡片的第一次 `record-review` 若手里没有 `expectedRevision`，先用 `review-queue` 的 `status: all` 或 `pending` 取到这张已有卡的 `revision`。
- 返回的路径、日期、记录 ID、`revision` 都是真实值，照抄引用；不自行拼路径、编日期或编号。
- 命令失败时如实说明失败原因与影响，不说成已经保存。

## Bash 意图标记

每次 bash 调用的 `description` 以 `[notara:<intent>] 简短中文说明` 开头，例如 `[notara:review-record] 记录这次作答并安排复习`。说明只写学习目的，不带路径、ID 或命令，也不出现 `vault/`、Node、CLI 这类内部词；标识只放在 `description`，不写进 command、不 echo、不出现在学生看到的正文里。一次调用只标一个主意图：命令可以多 step，但不要把不同目的藏在同一次调用里，无法归类就用 `other`。普通文本读取与写入也都是 bash 调用（shell 或 `write-batch`），同样要标记。

| intent | 用途 | 当前命令 |
| --- | --- | --- |
| `material-read` | 读资料正文、检索候选、看 PDF 或图片 | `pdf-page`，以及 shell 的 `ls`／`rg`／`grep`／`sed` |
| `note-write` | 写普通资料、讲义、笔记 | `write-batch` |
| `memory-read` | 查学情与锦囊候选 | shell 的 `ls`／`rg`／`grep`／`sed` |
| `memory-write` | 写学情或锦囊 | `write-batch` |
| `review-read` | 看复习队列与到期卡片 | `review-queue` |
| `review-record` | 记录一次实际评估 | `record-review` |
| `review-undo` | 撤销最近一次评估 | `undo-review` |
| `calendar-read` | 看日历与课程安排 | `calendar` |
| `lesson-log` | 查当前学习集的课堂小结索引 | `lesson-log` |
| `lesson-read` | 读课程导航或剧本阶段 | `route-outline`、`lesson-outline`、`lesson-section` |
| `route-write` | 建路线、局部调整或排课 | `create-route`、`revise-route`、`schedule-lesson` |
| `other` | `help`、`--help` 或无法归类 | `help` |

## 路线与开课

- 路线文件本身就是一个 Markdown 资料：机器身份、关系、阶段、主线/分支写在 frontmatter 的 `lessons`；各课规划只在稳定标记的正文块保存一次。普通规划正文用 `write-batch` 精确替换，保留标记与真实身份；新建节点、关系调整和局部修订走 `create-route` / `revise-route`，排期走 `schedule-lesson`。不能新增一套“已掌握”字段，不因有小结就自动通过课程检查。
- 正式课堂小结用 `save_lesson_summary` 保存并索引到本课；有剧本则更新它的小结区，没有则生成独立小结。小结保存就是教学上的归档，默认保留原会话继续聊天。只有学生明确要把会话从列表归档收起时才传 `archive: true`；“收课、总结、归档学习经历”不意味着隐藏会话。后续在同一课堂继续学习，先读旧小结再更新，保留已有真实经历。续课入口用 `## 下次从这里继续` 标题。普通题内笔记用 `write-batch` 写回。
- 学生要上某一节课时用 `open_learning_lesson`，参数是路线的 Vault 内相对 `path`（如 `路线/学习路线.md`，不带 `vault/`）、节点的 `nodeId`，以及用户明确要求再学一次时的 `repeat: true`；重复打开回到同一课堂，`repeat` 才新增一次课堂。不要自己生成或改写节点身份。
- 排课只是把日期写到节点上，不自动开课、不标完成、不归档。
- 备课页用 `set_teaching_settings` 的 `scriptPath` 绑定成本课剧本，`null` 解除；路径相对 vault，也可以写已注册外集的绝对路径。绑定后本课小结追加到该剧本文末，不再另建一份；只看过一份备课页不改变当前绑定。
- 有剧本的课堂：开课注入的是阶段目录与绑定版本，不是正文。要讲哪一段，先用 `lesson-outline` 取目录，再用 `lesson-section` 读那一段正文和它就近的教师参考；阶段（`##`）由文件决定，`section-1` 这类 key 由命令派生，别自己编号、猜编号或改写目录。绑定只记真实路径与版本，不冻结全文；剧本被改动后以当前文件为准，重新核对后再绑定。
