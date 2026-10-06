# Vault 工作流

Host 绑定真实工作区、资料根、课堂、调用身份和时间；模型只传内容与已读取对象引用。
普通资料路径是资料根内相对路径，不带 vault/ 前缀；跨集只用 Host 实际提供的已授权位置。不能填写或覆盖 Host 根目录与身份。
Markdown 是事实源。普通已授权写入无需再问一遍；拒绝或失败如实说明，不能换路径绕开。

## 读写与代码

- 模型工具只有 `bash`、`read_image`、`web_search`、`web_fetch`、`ask_worker`、`job_list`、`job_output`、`job_kill`；`notara` 是经 `bash` 调用的私有 CLI，具体命令以帮助为准，不能把它当成任意路径都可读写的入口。
- 普通阅读用 Bash `ls` 看真实文件清单、`sed -n '1,120p' '知识/例.md'` 分段读；检索用 `grep`，只有确认 `rg` 可用时才用它。先找候选再精读，片段命中不等于理解或掌握。Bash 读取正文不返回 revision；领域写入所需版本必须从对应领域读取命令或成功写入回执取得，不能猜值。
- 普通保存用 `notara write-batch --input <UTF8 JSON文件或->`，新建传 `op/path/content`，修改传 `op/path/oldText/newText`，两个分支不混用；保留原格式、CRLF、唯一原文匹配和 CAS 校验。
- 技能按目录中的准确 name 用 `notara skill load --name <原真实skill名>` 按需取正文，例如 `notara skill load --name notara-subject-math`；内置样例用 `notara resource read --path examples/iterated-sequences.md`，它不是学生 Vault 来源。
- `read_image` 读取真实图片；`notara pdf-page --input <UTF8 JSON文件或->` 返回 `imageRef` 与带版本的 `embed`，再将该真实图像引用照抄为 `read_image` 的 `path` 读取原图，不能把文字层冒称原图核对。引用失效时以原回执 `recovery` 对象重新调用 `pdf-page`；版本冲突时重新核对原件，不省略版本条件冒充恢复。高清、区域读取、书签与按页范围查卡见 `notara-material-outline`。
- `bash` 仅在工具清单实际存在时可运行。它受 OS 沙箱与当前权限约束：仅授权工作区按权限可写、无命令网络、无凭据环境；`notara` 仍受 Host 权限和领域校验约束。`run_in_background=true` 返回 jobId，用 `job_list`/`job_output`/`job_kill` 按完成通知或用户要求读状态、输出和停止，不轮询等待。缺工具链、命令或授权时如实说明，不改环境、普通 spawn 或换路径绕过沙箱。
- 代码仍先读后改，保留原文与格式，用 `notara write-batch --input <UTF8 JSON文件或->` 写入适用的 Markdown 资料；其他文件不得冒用 Markdown 保存合同。代码运行由可用的 `bash` 执行本机已有工具链。
- 白板先读 `notara board --help`，按准确 schema 和 `notara-board` 操作，不猜测图形 ops，不用普通文件写入绕过白板合同；技能只用 `notara skill-save --input <UTF8 JSON文件或->` 保存草稿/待采用修订，不直接改启用状态。

## 确定性命令

领域命令均用 `notara <原命令名> --input <UTF8 JSON文件或->`。先用 `notara <命令> --help` 读准确 schema 和 example，再照实际字段调用；输入只放原参数对象，不包 tool/arguments/command/input 层，不填写课堂、actor、记录时间或其他 Host 身份字段。

```bash
notara write-batch --help
```

write-batch / review-queue / record-review / undo-review / calendar / lesson-log /
route-outline / create-route / revise-route / schedule-lesson / lesson-outline /
lesson-section / pdf-page / pdf-outline / source-cards / skill-list / skill-read / skill-save。

复杂输入先准备 UTF-8 JSON 文件，再传 `--input '写入参数.json'`；也可用 quoted heredoc 从 stdin 提交。下面只示范已核对内容的新建形状，实际文件仍按对应模板与类型写：

```bash
notara write-batch --input - <<'NOTARA_JSON'
{"files":[{"op":"create","path":"知识/例.md","content":"# 例\n\n实际核对后的内容\n"}]}
NOTARA_JSON
```

修改先读目标原文，将已读且唯一匹配的 `oldText` 与替换正文 `newText` 放入同一个 edit 项；不传 create 的 `content` 或自行添加 `expectedRevision`。例如确认例文件含以下唯一段落之后：

```bash
notara write-batch --input - <<'NOTARA_JSON'
{"files":[{"op":"edit","path":"知识/例.md","oldText":"实际核对后的内容","newText":"再次核对后的补充内容"}]}
NOTARA_JSON
```

`notara write-batch` 每批最多50个互不重复路径；create拒绝同名；edit的oldText须恰好唯一匹配，保留CRLF并用当前revision保存。逐文件回执，成功项保留，只重试失败项；原文失配或 CAS 过期先重读实际内容再改，不覆盖学生编辑，不用 shell 直接覆盖代替。
`notara record-review`、`notara undo-review`、`notara revise-route`、`notara schedule-lesson` 等照抄实际 expectedRevision；过期必须重新读取，不猜值。
复习只对 type:card；新记录只有 keyStep、result(done|missed|unchecked)、note。student理解保留真实演变。

## 课堂命令

课堂、actor、时间与绑定版本由 Host 提供，不由模型补填，也不直接改会话文件：

- `notara lesson settings --input <UTF8 JSON文件或->` 使用原教学设置参数对象，例如 `{"subjects":["数学"]}`；剧本绑定传 `{"scriptPath":"备课/已核对的剧本.md"}`，解除传 `{"scriptPath":null}`，先核对真实路径。
- `notara lesson open --input <UTF8 JSON文件或->` 传 `path`、真实 `nodeId`，仅明确重学时加 `repeat: true`；按 `bound` 与原因处理，不覆盖已有绑定。
- `notara lesson summary --input <UTF8 JSON文件或->` 传 `body` 与可选 `archive`；正式正文必含 `## 下次从这里继续`，仅学生明确要求收起课堂时 `archive: true`，普通小结保留课堂。

以上命令先读各自的 `--help`，复杂正文仍用 JSON 文件或 quoted heredoc，按实际回执确认结果；失败保持未完成。已授权范围内不重复审批，拒绝不能通过改环境或换执行入口绕过。

## 文件类型

文件类型由 frontmatter 的 `type` 决定，落地目录按用途区分：

| 目录 | type | 用途 |
| --- | --- | --- |
| `知识/` | `note` | 普通资料、讲义、笔记 |
| `卡片/` | `card` | 知识卡片；只有它带复习生命周期 |
| `锦囊/` | `insight` | 旧的方法与教法经历，照旧可读；新的方法要点写进学习集层技能（`notara skill-save`） |
| `学情/` | `learner-profile` | 学生画像条目 |
| `备课/` | `lesson` | 备课页/剧本，也可在文末追加本课小结 |
| `路线/` | `route` | 学习路线；身份与关系在 `lessons`，节点规划在同文件正文，读侧统一投影 |
| `lesson_log/` | `lesson-summary` | 没有剧本时的独立课堂小结 |
| `日记/` | `daily` | `日记/YYYY-MM-DD.md`，或 frontmatter 里写 `date` |
| `媒体/` | — | PDF、图片等二进制资料 |
| `_templates/` | `template: true` | 模板，不当作资料 |
| `技能/` | `skill` | 本学习集的学习集层技能；只用 `notara skill-save` 写，新建为草稿，启用与采用修订由学生在技能页确认 |
| `lesson-board/` | — | 课堂白板，先读 `notara board --help` 按专用合同维护；可以读，不用 `notara write-batch` 或 shell 直接改 |

frontmatter 只支持扁平子集：单行标量、`[a, b]` 列表或单行 JSON。`title` 写真实标题；`tags`、`subjects` 按需。新建笔记先读 `_templates/` 里同类模板，照它的结构写正文；保存的正文去掉 `template: true`、`name` 和 `{{title}}`、`{{date}}` 这类占位，标题写真实标题，日期行没有真实来源就删掉，不自己填今天的日期；卡片、共性父节点（以及旧锦囊）使用“内容/参考理解/学生理解”三段，旧模板仍是旧标题时按此规范新建，不自动重写已有笔记。学情仍保留何时想起/观察/学生原话/教学偏好，不改成题卡。
