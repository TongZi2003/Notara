# 原生工具与教学 Skills

用户于 2026-09-22 确认缩减模型工具面：普通资料、画像、锦囊、备课和路线文件由原生工具处理；2026-09-23 进一步统一为主教师原生 Bash 入口；确定性的复习计算收进本地脚本；保留真实课堂生命周期接缝。此文替代旧教学合同的模型工具清单，不改变 Vault 文件格式或已有界面 Remote。

## 模型工具

专用工具由 16 个降到 4 个：

- `set_teaching_settings`：教法、目标、临时要求与已读剧本绑定。`scriptPath` 使用当前 Vault 相对路径，或已注册学习集内的绝对路径；`null` 解除。
- `open_learning_lesson`：使用已读路线的 `path` 与真实 `nodeId` 开课/回课，Host 生成和绑定会话；`repeat` 明确新开重学。
- `save_lesson_summary`：正式课堂小结的来源、截止点、剧本追加、日志身份与可选归档。随手笔记和题内小结直接编辑文件。
- `ask_worker`：原生后台任务编排；通过 problem/lesson/review/general/exercise 五预设分别完成题目研究、课时备课、核验、局部工作和出题。主教师显式交接并负责保存，none/read 工具能力由教室设置决定。当前合同见 [五种工作预设](2026-09-22-worker-orchestration.md)，旧 ask_solver 不再提供新调用入口。

主教师普通文本操作只暴露原生 `bash`，不再暴露或接受 `read/write/edit/glob/grep` 调用；`read_image/skill/web_search/web_fetch` 按原预设保留。`ls/rg/grep/sed/cat` 可组合读取与检索。Vault Markdown 可通过同一次 Bash 调用 `write-batch` 集中保存：新建拒绝重名，修改要求实际读过的原文唯一匹配，读取当前文件后复用原生 CAS 保存，逐文件回执、部分失败只重试失败项。普通任意 shell 写入不自动获得这些保护。课堂写工具仍默认请求原生批准，完全权限覆盖这层额外要求。Bash 沿用原生沙箱与审批策略，不统一追加批准，也不靠字符串分析猜测写入性质。恢复会话或外部文件修改后要重新读取。Bash 有任意文件操作能力，Skill 的格式要求是行为规范，不宣称它提供与窄工具相同的强制 schema 边界。

只读工作员保持 `none/read` 能力约束，read 模式仍用原生 `read/glob/grep/read_image`，不授予 Bash。锁定 rc.2 没有 spawn 级只读沙箱参数，父会话的完全权限会被子会话继承；不能仅靠提示词把任意 shell 当作只读。普通编码预设与旧 Host 的原生工具不受本插件过滤影响。

`write-batch` 支持1..50个不同Markdown目标，整批stdin最多2MiB。create只接受path/content，edit只接受path/oldText/newText；无效分支在落盘前拒绝。批次不是多文件事务：已成功的文件不会因另一项失败回滚；修改不要求整个文件自上次查看以来都未变，必须匹配的原文及保存瞬间的版本受保护，其他变化原样保留。

## 渐进披露

常驻提示词仅保留教学原则、召回时机、权限与命令意图约定。文件布局、格式、模板、工具选择和 CLI 使用说明在 `notara-vault-workflow` Skill。不再注册通用文件操作的教学别名，也不通过隐藏 dispatcher 兼容旧模型工具。

本地入口为 `"$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI"`。`help` 展示命令摘要，`<command> --help` 展开该命令的精确 stdin JSON 合同。当前命令：`review-queue`、`record-review`、`undo-review`、`calendar`、`lesson-log`、`lesson-outline`、`lesson-section`、`route-outline`、`create-route`、`revise-route`、`schedule-lesson`、`pdf-page`、`write-batch`。工作区由原生 `shellEnv` 注入；独立使用必须显式指定 `--workspace`，不会猜测当前目录。

`route-outline` 提供真实节点身份和revision，课程规划正文仍用 Bash 中的 sed/rg 按需读取。`create-route` 同时保存总述、阶段/分支/先修与各课规划；`revise-route` 按原因局部调整未来课程，保护已绑定节点并保留完整修改日志，未变化时不写日志。规则见[路线规划](2026-09-22-route-planning.md)。

`lesson-outline` 只读目录，`lesson-section` 按目录 key 和真实 revision 读取当前阶段及教师参考，长阶段明确分页。跨集绑定使用 Host 给出的 readPath，剧本变更需核对并重绑；不注入旧截断快照。细节见 [课堂剧本合同](2026-09-22-lesson-script-preparation.md)。

卡片评估与 UI 共用 `review-runtime.js` / `review-data.js`；路线创建与 UI 共用 `createRouteInVault`；文件写入复用 `LocalFileSystem` 和 Vault IO 的 revision 校验。PDF 页生成本地临时图片给原生 `read_image`，输出保留原始路径、页码与 revision。

CLI 不接受记录 ID、记录时间或课堂身份等内容参数，常规教学调用从原生执行环境取得；这是一份已获原生权限允许的 Bash 进程的运行约定，不宣称环境变量能防止任意 shell 改写或恶意伪造。

## Bash 意图标识

每次 Bash 的原生 `description` 格式为 `[notara:<intent>] 简短中文说明`，例如 `[notara:review-record] 记录这次作答并安排复习`。标识不写进命令、不 echo，也不混入学生正文。完整标识列表在 Skill 中，无法分类使用 `other`。

该字段用于对话展示，不作为执行成功、权限、学习证据或数据类型的事实依据。Native Vault 0.8.2 在原生 `tool.call.toolview` 中把带标记的 Bash 用途显示为紧凑的小字折叠行，例如“记录这次作答并安排复习”；标记与可选的 `###` 前缀不显示。点击用途文字展开命令、文本输出和原始记录入口，不另设标题或“查看执行详情”一行。

未标记、参数不完整或历史记录缺少调用参数时沿用原生 Bash 行。状态来自实际工具结果，非零退出与中断明确显示；普通返回不另显示状态文字，不宣称业务保存成功或后台任务完成。整轮工具过程的折叠、会话与批准面板仍由 DSH 管理。

## 验证边界

本轮只做工具合同、原生批准、脚本读写与课堂绑定的定向检查；完整教学验收和真实模型质量验证仍后置。旧预览保留原版本快照，不能拿旧会话工具清单当新版本证据。
