# DSH 仓库开发规则

本仓库是可独立运行的 DSH 原生 StudyForge 插件与课堂运行时（产品名 Notara）。所有相对路径从本仓库根目录计算；本仓库不依赖母仓库的 `AGENTS.md`、`CLAUDE.md` 或旧 Pi 运行时才能构建和测试。本文件是给开发 Agent 的唯一规则源，只记当前有效规则与运行事实，不收叙事；逐轮交接写法见「交接与记账」。

## 当前事实源

- DSH 依赖版本以 `package-lock.json` 和 `docs/runtime/upstream-lock.json` 为准，所有 `@deepseek-ai/dsh-*` 必须保持同一 `0.2.0-rc.1` 系列，`@deepseek-ai/cordis` 为 `4.0.4`。
- Node 下限为 `>=24.0.0`；本机验证使用 Node `v24.13.0`。
- Native Vault 0.15.0 使用现代白灰主题与全局导航（0.18.0 起为图标列「首页 / 计划 / Vault / 技能」，见 0.18.0 与 0.18.1 条）；课堂沿用原生 session 与唯一输入框，切页只切换视图可见性。今日开课以当前课堂所属的已登记 workspace 为目标，未选定时只接受唯一 workspace，不向当前旧课堂直接发送。系统上下文与轨迹默认隐藏，可在设置的「学习界面」显式开启调试。路线的课程列表和图谱共用同一文件投影；双面白板接线以本文 0.16.6 规则为准。
- Native Vault 0.15.1 起可选择学习目录（0.18.0 起在首页面板标题下），课堂列表仅显示原生目录登记中的会话，排除 blank、subagent 和 archived。目录身份优先从当前原生 session 反查；清空会话后可保留仍已登记的目录。选择目录沿用原生 workspaces/UI API，不重建 session 生命周期。极窄分屏按 `notara-pane` 容器适配字号；原生 HeroShell/Composer 的哈希类选择器在上游升级时须重新核对。
- Native Vault 0.15.2 通过 `conversation.hero.intro` 接缝替换空课堂的欢迎说明，原生 composer 与 seat 保持原位置和生命周期；未安装插件时使用原生介绍作为 fallback。目录/教学模式保留在“课程选项”内；缺目录时直接显示原生选择控件，不能把输入框永久置于不可用状态。该接缝在 `scripts/patch-conversation-views.ts` 随锁定版本的摘要校验安装和剥离。
- 新用户使用 Native Vault 的 `npm run vault` 持久入口；旧工作台已在 0.21.0 退役。Windows 安装说明使用 Git for Windows 附带的 Git Bash；`dev-native-vault.ts` 的目录链接统一走 Windows junction。没有 Windows 实机证据时不得报告 Windows 安装或课堂验收通过。已有 Vault 运行目录固定插件快照，不能把 `git pull` 或新建会话宣称为原地版本升级；替换快照用 `npm run vault:upgrade`（0.19.5 起）。
- 旧 StudyForge 产品基线只作为 `docs/migration/` 中记录的历史行为来源，不是运行时依赖；不要读取本机绝对路径来替代仓库内证据。
- `docs/migration/` 保存当前迁移合同、Notara 规格和验收边界；`docs/runtime/`、`docs/ui/` 与 `docs/evidence/` 保存实现、运行和验证记录。
- `examples/native-vault` 是文件事实源上的独立教学组合，教学资源在 `resources/vault-teaching/`。教学设置、剧本绑定与小结操作身份使用原生 session 的 `notara/*` 扩展事件；写入必须用 `appendTeachingEvent` 和 `ignorable` 信封。`scripts/patch-session-extension.ts` 是锁定 DSH 版本的必要写侧接缝（0.2.0 的 `Session.append` 仍丢弃 `ignorable`），不修改已知事件词表或绕过持久化读校验。
- Native Vault 0.14.0 教室支持题目研究员、课时备课员、核验员、通用工作员、出题员五种工作预设；教师用 `ask_worker` 经原生 one-shot spawn 独立运行。`worker-catalog.js` 是预设身份/工具能力共同来源；公共规则、当前预设和至多4个选定学科/教法 Skill 分层组装。每预设独立模型/推理/预算/none或read工具配置（0.17.5 起的默认与范围见 0.17.5 条）。默认界面仅状态，用户主动查看时打开原生只读子记录。
- Native Vault 0.14.0 学科关注按需分为数学、物理、化学、计算机、语文、英语，保留 `subject-science/subject-humanities` 作为未细分领域兜底。manifest 是唯一资源登记，主教师按实际内容选读并通过 `ask_worker.skills` 显式交接；`subjects` 标签不自动注入学科正文，不改变权限。书籍拆解与课程编排共用五角色，课程可来自上传、网络或无预置资料；任务式剧本模板仅精确升级旧内置文本，保留自定义模板与既有剧本。构建后的 `examples/native-vault/teaching/` 优先于源目录，验证前先构建并确认副本一致。
- Native Vault 0.14.1 的“学生理解”保留有证据的认知演变：早先不完备/错误认识、转折、提示程度及后来实际表现；补充新阶段不以最终正确结论覆盖旧认识，不补编缺失过程。诊断通过原生文件检索按需召回相关卡片、画像、方法要点（含旧锦囊）和小结，联合后续修正、成功表现与情境差异，不将旧错直接当当前状态，也不把同一经历的多个引用重复计数。详细记录归卡片，画像与学习集层技能（0.19.1 起锦囊并入其中）为两类长期教学记忆；并发诊断调度尚未实现。
- Native Vault 0.14.2 的输入框“指令”合并原生 command/skill 来源，仍按会话预设和 userInvocable 过滤。中文名称及 `menu: more` 折叠分组来自同一教学 manifest；默认展示常用学习功能，教法、学科关注和辅助工作流在“更多技能”中，搜索覆盖全部可用项。折叠只刷新菜单，不改草稿；选择技能仍插入真实调用名，发送时由原生机制加载。`scripts/patch-input-source-filter.ts`（指令入口带上技能，折叠只刷新菜单）与 `scripts/patch-skill-menu.ts` 是锁定 DSH 版本的可逆、摘要校验接缝；0.21.0 起指令入口在输入框的“添加文件或调用指令”菜单里。
- Native Vault 0.10.0 剧本是单份 Markdown：公共 `##` 阶段与就近 `<details>` 教师参考，默认折叠。`lesson-script.js` 是编辑器折叠与模型阶段目录的共同解析入口；开课只注入导航，`lesson-outline` / `lesson-section` 通过真实 revision 读取阶段，不注入历史截断正文，也不承诺完整历史版本。`source` 为原书结构、`topic` 为教学专题，均无复习生命周期；PDF 来源引用保留页/区域和 revision。主教师负责课程总框架与正式写回，课时备课员按一节课的显式材料独立完善。
- Native Vault 0.11.0 路线以 `stage`、`pathway`、`prerequisites` 区分阶段、主线/补练/拓展与知识先修；`brief` 仅保存在同文件的路线节点正文块，不能复制到 frontmatter。`route-outline` 给真实身份和版本，`revise-route` 在单次 CAS 中局部更新未来课程、保留已绑定课堂与完整修订日志。排课/开课不得改写规划正文。先修不自动锁课，有小结不等于掌握；本课背景只加载当前节点规划（超过6000字符整段延后原生读取）。
- Native Vault 0.12.0 新卡、共性专题（以及旧锦囊）使用页头 tags 和“内容/参考理解/学生理解”三段。题卡原则上一题一卡，原题正文可检索，原文参考答案保留并作为依据；补充解法与疑点分开标明，学生理解无真实表达时留空。同类题以 `parent` 挂在无复习周期的 `topic` 下。只升级与旧内置模板内容一致的模板，不批量重写已有卡片或自定义模板。
- 拆书由主教师略读、确认范围并列语义单元清单；知识型课本以 `ask_worker preset=general` 独立研究知识单元为主线，解释动机、条件、依赖、例证与边界，题目用 `problem` 保留完整题面、原解和推导。主教师轻量审阅、保存并归纳知识联系与共性父节点。备课由主教师给框架后逐课交 `lesson`；小测/变式交 `exercise`，具体疑点交 `review`，知识研究或纯证据整理交 `general`，按任务交完整知识卡或证据报告。每任务生成上限默认32768，配置可独立调整；默认高推理但预算不保证正确性。`sources` 最多4个真实PDF embed，Host按revision读原图并交接。none无工具，read仅原生read/glob/grep/read_image，仍继承原生权限；没有写入/Bash/嵌套委派。对话里的Vault产物在资产分屏打开，不走原生侧栏预览。
- Native Vault 工作员非法JSON/字段返回定位反馈；同一输入、相同任务材料与有效配置下的预算耗尽任务禁止原样重跑，缩小任务、用户新输入或配置变化可再尝试；失败与待核对状态不得在后续摘要中变成已核验。每课堂同时最多 `WORKER_CONCURRENCY`（5）个工作员任务，同步与后台合计。旧 `notara/solver-*` 事件只读兼容，新配置/任务写 `notara/worker-*` ignorable事件，不重写旧日志。预览支持同行 `<details><summary>`，卡片/专题/锦囊的“参考理解”（兼容“教师理解”）默认折叠，折叠不改写Markdown。
- Native Vault 0.12.3 支持教室的 `notara.classroom.view` 子槽，由工作区声明并交给 `ClassroomView` 渲染。可选原生插件 `examples/pixel-classroom` 提供像素视图，和列表共用课堂状态、原生 `SessionSnapshot.running`、查看分析/停止/设置操作；不新增顶层分页或子代理生命周期。实时模式不显示模拟播放或用量，原版 Pixel Agents 引擎与 MIT 素材保持独立来源记录。
- Native Vault 0.14.3 以 `assessments[{ability,outcome}]` 与 `note` 记录具体能力及认知工作归属（0.20.0 起排期只看关键一步，这一代只读，见 0.20.2 条）；三态为 demonstrated/needs_practice/not_observed，不按提示次数减分。存在实际困难才降档；无困难但有未知只记历史，不改原排期；全部得到证据支持且已经到期才升档，提前成功不推迟到期。首次有效评估从第1档开始，1/3/7/16/35天不变。`mastery` 仅为复习档位，`learned` 表示已开始复习；旧passed历史只读保留，新写拒绝旧格式。仅type:card参与，当前状态与历史在同一Markdown原子写入，日期/身份由Host绑定，日历是文件投影；不复用旧数据库账本。`VAULT_REMOTE_METHODS` 是独立插件Host/client的共同方法清单。
- Native Vault 0.14.4 的课堂规则要求主教师在一道题讨论收束、转入下一题前记录一次本轮评估。复用本题题卡，缺卡时按模板与真实题面建卡；有认知变化先补正文“学生理解”，再取最新revision记录评估。纯讲解无学生表现时关键一步记 `unchecked`（0.20.0 前为 not_observed），不凭听过启动复习。收束由教师按语义判断，不是逐消息自动hook；正文与评估是分别核对回执的两次写入，评估和排期本身仍在同文件一次CAS完成。
- Native Vault 0.14.5 的 `material-search` 通过查询意图展开、原生检索与正文语义判断找卡片，可交只读 `general` 独立整理；不是向量索引。`teaching-reflection` 反思教学判断，将必要更新分流至小结、画像、主题要点技能或路线，内置 Skill 先给修订建议，不就地改快照；0.16.23 起老师可用学生已启用的学习集层与学科层技能（见 0.16.23 条）。`learning-review` 综合近期进展、兴趣与目标给下一步方向，按已知授权目录跨集取证，不宣称全局发现或统一复习。找卡片/学习复盘直接展示，教学反思折叠到更多技能；三者按需加载，归档反思并入已有小结。
- Native Vault 0.9.0 的单文件删除走 Vault `.trash` 回收站，可恢复但不覆盖同名文件；所有点目录不进入资产、搜索和图谱投影。PDF 图层与矩形批注保存在 `.notara/pdf-annotations/`，绑定 PDF revision；区域引用卡片保留原版图像、页码、矩形和可选标注引用，不把逐页文字层直接拆成卡片。原 PDF 改版后不得把旧标注自动当作新版位置。
- Native Vault 教师保留 `set_teaching_settings`、`open_learning_lesson`、`save_lesson_summary`、`ask_worker`、`write_lesson_board` 五个专用模型工具；主教师普通文件读写和搜索统一用 DSH 原生 Bash，确定性复习/排课/PDF 辅助走 `vault-cli.js`。CLI 与 UI 共用 IO 和文件计算；Host 通过原生 `shellEnv` 注入 `DSH_NOTARA_*`，不得让模型填写执行身份。0.14.8 起主教师不暴露或接受 `glob/grep`，Markdown 读写不用原生 `read/write/edit`；0.16.23 起原生 `read/write/edit` 只对代码文件开放（`media.js / isCodePath`，guard 按 `file_path` 扩展名判断，拒绝时统一提示 bash 与 write-batch）；0.21.3 起课堂写工具（板书、小结、课程绑定）在原生 `workspace-write` 或 `danger-full-access` 模式下不追加审批；`read-only` 或无法解析权限时仍请求本次批准；原生 deny/ask 和工作员工具范围限制仍保留。Bash 完全沿用原生沙箱与审批决定，不做命令字符串“只读”猜测，也不额外统一审批。每次 Bash 的 `description` 按 Skill 用 `[notara:<intent>] 中文说明` 标记用途，0.8.2 在原生工具 slot 中将用途显示为小字折叠行，点击展开命令与输出，普通返回不另显示状态；未标记的调用沿用原生展示。标记不是权限或执行成功依据。

- Native Vault 0.14.7 的评估要求当前实际困难证据；缺少步骤展示不等于失败，已纠正的历史错误不冒充当前困难。常驻规则、按需 Skill 与 CLI help 同步约束；有真实认知变化先保存题卡正文，再按最新 revision 记评估，分别核对回执。教学小结保存即为教学归档，默认保留原生会话继续交流；只有用户明确从会话列表收起时才调用原生归档。

- Native Vault 0.14.8 主教师可组合 ls/rg/grep/sed 读取资料；CLI `write-batch` 用一批独立 create/edit 操作保存Markdown，create不覆盖、edit唯一原文匹配后按当前revision走原生CAS，部分失败逐文件返回。任意shell写入不自动获得这层保护，Bash权限仍由原生机制决定。只读子代理保留原生read/glob/grep/read_image，不因主教师缩减工具面获得Bash写入能力。

- Native Vault 0.14.8 老师人格在本课教学设置、工作员人格在各预设的教室设置中独立保存，上限4000字符。老师空白恢复默认大肥鱼；工作员空白只用任务职责，省略配置字段保持原值。`persona.js` 是纯文本装配，身份风格不改工具/权限/交付边界，也不按模型名自动猜人格。首次介绍应出现在最终可见答复，不仅是被折叠的工具进度。

## 工作约定

- Native Vault 0.23.1 的 Windows Release 快捷安装入口为 `安装 Notara.cmd` / `scripts/windows-install.ps1`，由 Node 原生执行 `scripts/install-vault.ts`（启动时不能依赖已有 node_modules）。发布包带 `notara-files.json` 源文件哈希清单；源码仓库或修改过的包拒绝覆盖。依赖与新版代码在解压目录的临时子目录构建后切换，原数据与快照不迁移；源码/npm 安装继续保留。测试使用临时包与注入操作，不执行真实 winget 安装或写真实桌面。
- Native Vault 0.23.1 的 ChatGPT 订阅接入在 `chatgpt-auth.js / chatgpt-provider.js / chatgpt-runtime.js`。使用 OpenAI 官方动态注册、PKCE 和 loopback callback；令牌只写 `DSH_HOME/notara-chatgpt`，禁止进入浏览器、日志、Vault 或发布包。每账号独立路由，模型从授权目录读取，Responses 必须等 `response.completed` 才完成。无真实账号时只能记录协议模拟与浏览器登录入口测试，不能宣称真实订阅推理通过。
- 0.23.1 白板卡片的可选 `height` 与 `width` 随布局持久化；resize 使用指针捕获并按相机缩放换算，恢复默认同时清除位置和手动尺寸，全览也采用资料卡手动高度。公式保持原 KaTeX 渲染，只在卡内局部滚动。课堂永久删除经独立 `notaraSession` Remote 和输入标题确认，删除前证明整棵关联会话树空闲；删除保护覆盖原生会话修改入口，等待已开始的修改后重新核对确认，不能只拦新 prompt。仅处理原生 JSONL 会话目录，保留学习资料与共享附件。
- 0.23.1 远控入口在 `scripts/remote-vault.ts`，私有配置和控制状态放在代码目录外的专用目录。修改权限前校验路径及真实目标，拒绝代码目录及其祖先、盘根和用户主目录，避免 Windows 继承 ACL 波及代码与依赖、触发客户端热重载。测试必须显式使用临时配置、临时数据根与独立端口；不得调用真实用户的 ngrok 凭据或启动公网隧道代替隔离测试。真实公网连通需要另行记录。
- 0.23.1 设置里的「远控设置」经 `notaraRemote` 和启动器私有桥管理 ngrok；默认关闭，保存配置不启动，完整重启不自动恢复，关闭远控保留本地课堂。浏览器只接收脱敏状态，密码与令牌不回显或进入浏览器持久存储。桥只监听 loopback 并验证 Bearer，设置操作与 CLI 使用同一运行目录互斥锁。压力测试入口为 `test:stress` / `test:stress:browser`，仅使用合成数据与隔离实例，报告写入 `.runtime/`。
- 0.23.1 更新提示挂在原生 `shell.overlay`，全局右上角、可关闭、不抢焦点，沿用主题 token。启动检查仍由 supervisor 每次启动发起一次（另保留每30分钟与手动检查），浏览器轮询只读状态。公开 `launchId` 只区分启动周期，不是凭据；关闭记忆按 launchId/版本在本浏览器跨页同步，新启动或新版本重新提醒。更新停止阶段部分成功抛错也必须实际尝试恢复旧 Host，不能直接宣称已恢复。
- 0.23.1 Windows 双击与桌面快捷方式入口由根目录三个 `.cmd`、`scripts/windows-launcher.ps1` 和 `desktop-vault.ts` 提供，共用 `remote-vault.ts` 的 local-start/stop。PowerShell 文件保留 UTF-8 BOM，兼容 Windows PowerShell 5.1 中文；参数直接传给 node/npm-cli，不通过拼接 cmd。默认本地后台启动后打开当前登录入口，冷启动等待最多120秒，明确失败立即返回。关闭只处理控制器拥有的实例，不能将外部实例仍运行说成已关闭；必须等待末次 stopping 状态写入完成后再删除控制状态，避免异步写入重建死记录。创建桌面快捷方式的测试必须传临时 ShortcutDirectory/RuntimeRoot/ControllerConfig，不能写真实桌面或默认用户数据目录。

- 发布校验在干净检出后先构建 Native Vault 与像素教室，再运行依赖生成资源的插件测试。发布失败后可用 `release.yml` 的手动入口指定既有正式标签，或推送 `codex/release-v<版本>` 恢复分支；流程重新检出并完整校验该标签的代码，不移动版本标签、不覆盖已经公开的 Release。

- Native Vault 0.22.1 的性能与用量独立于“显示调试记录”，只按原生 `ui-chat.performanceUsage` 的精简/详细选择展示。课堂面板标题的“管理课堂”打开原生 `sidebar.workspaces`，保留归档、运行中停止确认、撤销及已归档列表恢复；经已有 `renderSidebarSlot` 调用，不重复声明原生子槽。插件不再包装 `workspaceRegistry.archiveSession`，菜单与快捷键归档不发起模型回合；“总结本课”仍保存小结并保留会话，老师明确保存并归档时仍在回合结束后归档并保护新学生输入。

- Native Vault 0.22.0 起启动器自动发现 GitHub 正式 release、后台校验并准备更新，首页与“设置 → 更新”提供入口。课堂或后台任务运行时拒绝重启；不同 DSH/Cordis 或 `docs/runtime/update-contract.json` 数据格式标识走手动备份升级。发布包由 `release:bundle` 的代码白名单生成，正式版本标签经 `.github/workflows/release.yml` 检查后发布；改动持久数据兼容性时必须提升数据格式标识。成功更新登记 `notara-release.json`，原代码目录启动会转入管理的代码缓存；显式 `vault:upgrade` 重新采用当前代码目录。不要直接覆盖运行快照或删除正在使用的 `~/.notara/releases/` 缓存。

- Native Vault 0.21.1 使用学生友好默认界面：权限快捷选择和反馈/日志导出菜单默认收起，性能用量默认精简；`ui-settings.enabled=false`，`ui-chat.performanceUsage=compact`。显示默认值由 `scripts/vault-profile.ts` 写入可修改的 Web profile，不写进会锁住界面修改的 home overlay。沙箱与审批策略不变，设置中的原生权限入口保留。显示调试记录联动原生 Coding Tools，保存失败回退；`scripts/patch-student-ui.ts` 是锁定包摘要校验的菜单过滤与用量标记接缝。原生差异查看保留，行内 Vault 文件链接仍进入资料面板。
- 0.21.1 升级从两处已安装的模块链接识别快照，支持旧版的 `vault-plugin-<版本>` 布局；切换链接、保留像素教室，同版本换代码目录也会刷新依赖。升级失败恢复快照、链接、配置与旧设置。跨 DSH 0.2.0 前仍须整份备份。公开文档以 README、`docs/install.md`、`docs/first-lesson.md` 和运行说明为入口；设计、研究、验收原始记录和旧工作台测试配置仅在本地开发分支保留，不进入新增发布历史。

- Native Vault 0.21.0 起 DSH 锁定 0.2.0-rc.1，旧工作台退役（`docs/dev-log/2026-09-29-dsh-0.2.0-0.21.0.md`）。
  - 旧工作台（`packages/`、`examples/plugins`、`examples/plugin-sources`、`npm run trial` 与 `dev:isolated`、`tests/live` 及其测试和构建脚本）从仓库删除，代码留在 git 历史；插件口径见 `docs/runtime/plugins.md`。
  - 预设是一行 `@deepseek-ai/dsh-agent-preset`：`examples/native-vault/teacher-preset.js` 是教学者预设的唯一来源，`vaultPatch` 插入它并在 `agent-preset-registry` 设为默认；`presets/` 目录删除。
  - 原生不再有 `settings.yaml`：Vault 自己的设置是 `home/cordis.patch.yml` 的行（`ui-settings-general.welcomeNoticeVersion`、`ui-chat.transcriptView: verbose`），学生的改动落在 profile。`verbose` 是 0.2.0 唯一不折叠已完成回合的模式，对应 0.17.4 的“完整对话”。
  - 从 0.20.x 升级：`vault:upgrade` 在新版 DSH 第一次导入旧的 `home/settings.yaml` 之前，只把两处旧的种子值改成现在的值（`scripts/legacy-settings.ts / upgradeLegacySettings`：`transcriptView: normal` → `verbose`，更旧的 `welcomeNoticeVersion`），其余原样；0.21 以上的代码目录不启动 0.21 以前的快照（`vault-launcher-state.ts / mustUpgradeBeforeStart`），要求先备份再升级。
  - 会话格式 v4：插件消息用自己的 `source.kind` 加 `form: 'notice'`（番茄钟是 `notara-pomodoro`，后台任务通知是 `tool-jobs`）；工具结果是 `role: 'tool'` 的消息；未知的 ignorable 事件读出来带 `plugin:` 前缀，折叠时一律经 `plugin-events.js / pluginEventType` 去掉。新版 DSH 第一次打开旧课时把它迁成 v4，旧版读不了迁过的课：从 0.20.x 升级前整份备份数据目录（`vault-launcher.md#版本更新`）。
  - 浏览器端：当前课堂由 `session-current.js / currentSessionId`（`retainedBy.mainView`）判断，`mainViewSettled` 表示原生已经恢复了选择，首页在此之前不说“没选目录”，刷新续课也等它（`shell-client.js / resume`，有时限）；打开课堂用 `uiWorkspace.openSession`；远程方法的 strict codec 带 `create()`；工作员面包屑取 `projectionValues.subagent.label`。
  - 接缝：`conversation.workspace` 的 owner props 只带数据（`sessionId`、`nativeConversation`、`nativeConversationBody`、`nativeDebugConversationBody`、`nativeHeader`、`nativeDebugHeader`），否则会盖掉占用者自己的 `renderSlot`。轨迹不再是单独一栏：“显示调试记录”打开原生视图切换，在对话里切到轨迹（原生 Coding Tools 打开时才有这一项）。
  - 工作员：`jobs.start` 的 `owner` 是会话 id，结果字段是 `result`；`subagents.listChildren` 按 `id` 与 `mode` 认子会话。原生拒绝归档正在运行的会话，所以老师在自己的回合里保存小结并要求收起时，工具返回 `archiveScheduled`，回合结束后再收起（`teaching-runtime.js / archiveWhenIdle`）。
  - 对话里的产出：0.2.0 的“改动文件”卡打开的是差异查看，保持原生；行内文件提及照旧进资料面板（`conversation-file-navigation.js`）。
  - 发布包的 `files` 必须覆盖 Host 引用的每个模块（`package-files.test.js`）。
  - Windows 实机仍未验收；不得报告 Windows 课堂通过。

- Native Vault 0.20.1 起讲解式改为“讲解—变式”，老师可以在一节课里临时换讲法（设计稿第五节，`docs/dev-log/2026-09-28-teaching-modes-0.20.1.md`）。
  - `presets/lecture.md` 一轮四步：讲解、类比、询问理解（请学生说出关键一步）、变式迁移（从同结构到改条件再到换情境，尽量瞄准常见错法的预判）；学生做变式的表现是关键一步与深度的证据。`manifest.json` 标题改为“讲解—变式”，id 仍是 `lecture`。
  - 常驻「动态地教」第 2 条“讲还是问”：学生能自己连上的一步用问题引导；关键一步靠新定义、约定或巧妙构造，学生退到特例也接不住，或目标是练熟一类题，就先讲清再出变式。学生选的教法是基调，临时换的一段做完回到基调。
  - 空白课堂的“课程选项”里可以选教法（`lesson-entry-client.js / TeachingChoice`），与“教学设置 → 教法”是同一个设置：每次展开都重新读取，点选立即显示、保存失败退回。写入教学设置不结束空白状态——原生会话列表只在第一次 `turn/start` 时把 `blank` 置为 false（`dsh-api-session-controller / applySessionListMetadata`）。

- Native Vault 0.20.2 起一次复习评估只记关键一步和说明（`docs/dev-log/2026-09-28-key-step-only-0.20.2.md`）；0.20.0 的深度栏与下次检验栏已去掉。
  - 记录是 `keyStep` + `result`（`done` 做出来 / `missed` 没做出来 / `unchecked` 这次没考）+ `note`；`result` 是排期与星图的唯一输入。学生到了哪一层、踩了哪个坑、下次要先查什么，写进卡片的学生理解（最后的当前判断）与常见错法的实见。依据是 0.20.1 真实课：文字叙述把讲解记在老师名下，结构化的深度栏却把同一件事记成了学生做到（`docs/dev-log/2026-09-28-real-lesson-0.20.1.md`）。
  - 取值与中文名只在 `review-data.js / REVIEW_RESULTS` 定义，命令行帮助、报错与日历表单从这里取。老师记 `done` 或 `missed` 必须写 `keyStep`（`review_key_step_required`）；学生自评只填结果、可选的 `keyStep` 与说明。
  - 读取按字段分辨：`passed`、`assessments`、`result` 三代各自只读，一行只能属于一代；0.20.0–0.20.1 记录里的 `depth`、`nextCheck` 原样保留、不参与计算也不显示。写入只收 `keyStep`、`result`、`note`，请求带 `passed`、`assessments`、`depth`、`nextCheck` 报 `review_request_invalid`（命令行经 `retired` 指向当前字段）。卡片的档位与日期不迁移。
  - 常驻「观察与掌握」：判断学生答得对不对之前，先把学生原话里的结论抄出来，再和自己的结果逐条对照。
- Native Vault 0.20.2 起学生看不到老师专用工具的名字，也看不到 Vault 以外的临时文件。
  - `tool-rows-client.js / STATUS_ROWS` 是老师工具只写状态的工具行的唯一名单：后台任务三件、`save_lesson_summary`、`set_teaching_settings`、`open_learning_lesson`；开课结果 `bound: false` 时写“这节课没有换过来”，不说已打开。
  - 老师的原生 `write`/`edit` 只写当前 Vault 里的文件（`agent-tools.js / insideVault`，按会话 `cwd` 与 `resolveVaultRoot` 判断）：原生“本轮文件改动”会把写过的文件列给学生。拒绝时提示用带引号的 heredoc 把 JSON 直接交给本地命令。

- Native Vault 0.19.14 起题卡的“参考理解”最后写 `### 常见错法`（`docs/dev-log/2026-09-28-error-patterns-0.19.14.md`）：预判在建卡时写（错的样子、机制、只测那一步的区分追问，只写有把握的），实见由老师按学生表现补在对应预判下（踩中没有、怎样纠正，带日期；预判外的另起“实见（预判外）”）。写法在工作员卡片合同（`workers/base.md`）与老师侧 `vault-workflow` 各写一次，`method-distillation`、`material-outline` 与常驻只留指向；卡片模板不含这一小节。

- Native Vault 0.19.13 起复习的检查点只落在题目关键的思维步骤上（`docs/dev-log/2026-09-28-review-checkpoints-0.19.13.md`）：结果区分不出原因时，用一个只测那一步的小测试把几种可能分开；证据不够算检查点没选好，拿不准的不记成困难（常驻 `base.md`「观察与掌握」、`method-distillation`「简单复习」）。常驻里与 0.19.12 冲突的“目标内没看到的过程记‘尚未观察’”已改为只列实际检验过的能力。

- Native Vault 0.19.12 起评估只列这次实际检验过的能力（`docs/dev-log/2026-09-28-prompt-review-0.19.12.md`）：没检验到的层次和没展开的过程不列，整段只有讲解、一项也没检验到时才记 `not_observed`（`method-distillation`「能力怎样写」、`vault-cli.js / record-review` 的字段说明与示例）。`review-data.js` 的排期规则不变。0.20.2 起评估只记关键一步，见 0.20.2 条；学生到了哪一层写进学生理解。同版本写入提示词审稿批次第 1–13 条（`docs/dev-log/2026-09-28-prompt-review-batch.md`）。

- Native Vault 0.19.11 起测试有统一入口（`docs/dev-log/2026-09-28-tests-0.19.11.md`）。
  - `npm run test:plugins` 跑 Vault 与像素插件的单元测试；`npm run test:e2e:vault` 跑全部 `native-vault-*` E2E。回归用这两条，不手写文件清单。`typecheck` 与 `typecheck:tests` 都应为 0 个错。
  - 测试引用无类型的插件 JS 时写 `// @ts-expect-error` 注明原因；`scripts` 工程引用的插件 JS 用同名 `.d.ts` 声明（`lazy-assets.d.ts`、`worker-catalog.d.ts`）。
  - 空白课堂的欢迎说明显示当前会话的标题（计划页开出的课即节点名），没有标题才写“新的一课”（`lesson-entry-client.js`）。资料库的“文件”视图可见时总跟外部改动同步列表，不要求有文件打开着。给学生的位置说明不再用“资产页”。

- Native Vault 0.19.10 起老师的 `job_output`、`job_list`、`job_kill` 工具行只写状态（0.20.2 起名单在 `tool-rows-client.js / STATUS_ROWS`），不显示工具名、参数与后台任务编号（`docs/dev-log/2026-09-28-job-rows-0.19.10.md`）。

- Native Vault 0.19.9 起学生能看到的几处不再露出内部信息（`docs/dev-log/2026-09-28-student-visible-0.19.9.md`）。
  - 工作员的第一条消息学生在记录里也看得到，只写任务（`solver-runtime.js / workerTask`：`goal`、`focus`、`materials`、`capabilities`）；角色在它的系统提示里，不写预设 id 与工作区绝对路径。只读工作员在资料根是 `vault/` 时多一个 `materialsRoot`。测试模型按系统提示里的角色标题认工作员（`scripts/fixtures/vault-test-model.ts / workerPresetOf`）。
  - 原生的 lineage 槽由 `client-source.ts / WorkerCrumb` 以 `priority: -1` 接管：课堂顶栏没有“N 个子代理”菜单，工作员记录的面包屑只写角色名，没有切换其他工作员的菜单；工作员只在教室里列出。
  - 行内公式后的标点只和公式的最后一段（KaTeX 最后一个 `.base`）一起不折行（`board-render.js / keepWithPunctuation`），长公式照常在各项之间折行。原子行内元素后面能否断行看它父元素的 `white-space`，插 U+2060 挡不住。
  - 窄屏白板上 `openView('chat')` 把这一面翻到对话（`workspace-client.js / openView`）。
  - 教学资源与带入对话的文字里点名的 `notara-*` 技能都必须存在（`teaching-resources.test.js`）。

- Native Vault 0.19.8 起收紧路径（`docs/dev-log/2026-09-28-path-safety-0.19.8.md`）。
  - 资料根下的路径分段一律用 `vault.js / pathSegments`（两种分隔符都认），软链检查才对 Windows 的目录联接有效。
  - 技能的目录、文件与 `.trash/` 是软链时拒绝（`user-skills.js / refuseLink`）；这段代码在 Host 进程里，不受 shell 沙箱约束。
  - Host 的 `pathInput` 拒绝以点开头的段与 `node_modules`；保留目录（`lesson-board`、`_templates`、`技能`、`node_modules`）一律经 `pathKey` 比较（NFKC 加小写）。
  - 新建文件经 `portablePath` 检查 Windows 能否存下（非法字符、结尾的点或空格、保留名），报 `vault_path_not_portable`；已有文件照常读写。按标题生成的名字由 `safeTitlePath` 先处理成合法的。

- Native Vault 0.19.7 起修正几处半截写入与失效（`docs/dev-log/2026-09-28-data-integrity-0.19.7.md`）。
  - 开课先写路线、再绑定会话；已绑定的课堂补写漏掉的节点；路线的锁按文件加（`teaching-runtime.js / openRouteLessonHere`、`openRouteLesson`）。
  - 绑定剧本同时记 `scriptBodyRevision`（去掉课堂小结块后的正文版本），`DSH_NOTARA_LESSON` 由 `lessonPinText` 生成；是否过期一律由 `script-binding.js / scriptBindingStale` 判断（只在服务端用；`lesson-data.js` 会进浏览器端的包，不能引用 Node 模块），写小结不算改剧本。
  - 读不了的路线单独列出并带 `error`，其余照常；技能的待采用修订被替换时旧文本进 `.trash/`。

- Native Vault 0.19.6 起 Windows 上老师的 Bash 由 Git Bash 在原生沙箱里执行（`docs/dev-log/2026-09-28-git-bash-executor-0.19.6.md`）。
  - `git-bash-executor.js`（导出为 `@notara/vault-native/git-bash-executor`）继承原生 `SandboxBashExecutor`：程序是启动器找到的 `NOTARA_GIT_BASH` 绝对路径，每条命令写成私有临时脚本以 `bash --noprofile --norc <脚本>` 执行后删除，环境加 `GIT_BASH_ENV`；受限模式仍经原生 `ctx.sandbox`，审批、超时、输出上限用原生的。
  - 启动器每次启动经 `scripts/git-bash.ts / findGitBash` 找 Git Bash（`NOTARA_GIT_BASH` → `git --exec-path` → 注册表 → 常见安装目录），拒绝 WSL 的入口，找不到就如实失败，不退回 PowerShell。`vaultPatch` 在 Windows 上关掉 `pwsh-sandbox`、插入 `notara-git-bash`；隔离实例的 `gitBash` 选项用于在其他平台测试这个执行器。
  - Windows 上注入给老师的 `DSH_NOTARA_*` 路径一律是 `C:/...` 正斜杠写法（`teaching-runtime.js / shellPath`）。
  - Windows 实机尚未验收；不得报告 Windows 课堂通过。

- Native Vault 0.19.5 起已有运行目录用 `npm run vault:upgrade` 升级（`docs/dev-log/2026-09-28-vault-upgrade-0.19.5.md`）。
  - `dev-native-vault.ts / upgradeVaultPersistent`：服务运行时或拿不到数据目录锁时拒绝；旧快照改名为 `vault-plugin-<旧版本>` 保留；新快照与 `home/cordis.patch.yml` 由播种时同一对函数生成（`installPluginSnapshot`、`vaultPatch`），依赖链接到执行升级的代码目录；失败时恢复旧快照；课堂、资料、设置与凭据不动。
  - 启动时版本不一致就提示升级（`vault-launcher-state.ts / pluginVersions`）；“设置 → 学习界面”显示构建注入的 `__NOTARA_VERSION__`。
  - 这条替代了“当前没有原地升级命令”的旧事实；已有运行目录仍固定插件快照，只是现在有了明确的替换路径。

- Native Vault 0.19.4 起一个读不了的页头不再拖垮 Vault（`docs/dev-log/2026-09-28-vault-resilience-0.19.4.md`）。
  - 页头支持 Obsidian 的块列表（`名称:` 后接 `- 项`，项为标量）；映射项与其他缩进行仍不合格。
  - 读取、扫描与写回收站用 `parseMarkdownDocument(…, { lenient: true })`：页头读不了时按“没有属性、整页是正文”读出并带 `frontmatterError`；保存与模板仍严格。只需要正文的投影用 `frontmatter.js / frontmatterBody`。
  - 资料库保存失败按 Host 的原因码提示（`assets-client.js / saveFailureNotice`）。
  - 从计划页、日历打开课堂一律经 `navigation.openLesson`，不直接调用原生 `sessions.open`。

- Native Vault 0.19.3 起启动与换行符在 Windows 上也成立（`docs/dev-log/2026-09-28-windows-launch-0.19.3.md`）。
  - 启动器与测试运行器用 `process.execPath` 直接运行包的 JavaScript 入口（`scripts/package-bin.ts / packageBin`），不运行 `node_modules/.bin` 里的垫片：Windows 上它们是 sh 脚本。构建产物按文件名找（`outputNamed`），不写死 `/`。
  - 仓库文本一律以 LF 检出（`.gitattributes`）；播种模板统一 LF；`write-batch` 的 edit 按文件自己的行尾匹配。
  - 停服务时删除 `launcher.json`；记录的进程号还活着但端口拒绝连接时判为未运行。Windows 上停服务用 `taskkill /T` 结束整棵进程树。绑定端口失败时说明原因与换端口的办法，默认端口不变。

- Native Vault 0.19.2 起有头脑风暴与体系梳理两个技能，学科技能统一小节（`docs/dev-log/2026-09-28-teaching-prompts-0.19.2.md`）。
  - `notara-brainstorm` 负责打开：退与进、核实每条联系、`flow` 上板、由学生决定停、用更深的框架收回。`notara-consolidation` 负责收，是精致复习的主场：学生建结构，拿结构攻新东西，攻不动退回机制或特例；相关题卡不到三张时照实说。
  - 八份 `subject-*` 都有“本学科的退与进”“深度怎样检验”，不靠推导的学科写明用什么代替推导；学科层技能按同样的节写。
  - 常驻 `base.md`：课上遇到难题，请题目研究员在后台独立解出，拿不准的一步再请核验员。
  - 工作员子会话取父课堂所在的学习目录（浏览器端会话行的字段是 `parentId`），子会话的标签栏有“返回课堂”。
  - 白板：含分式的公式段上下留 .35em（`board-client.css`）；行内公式与紧跟的中文标点包进 `nb-keep`，不换行（`board-render.js / renderBoardMarkdown`）；板块与块标题按行内写法渲染，导出同。

- Native Vault 0.19.1 起复习、评估与方法要点按设计稿第三、八节（`docs/dev-log/2026-09-27-teaching-prompts-0.19.1.md`）。
  - 评估每项 `ability` 开头写检验的层次（熟练、推导、改条件、反例、边界、迁移（主动）、迁移（提示后））；简单复习只检验熟练层并照常升档，复习档位是“记得、熟练”的间隔；精致复习用出题员按迁移距离出的新情境检验本质层。数据格式与 `review-data.js` 的排期规则不变。0.20.2 起熟练就是评估的关键一步，其余层次写进学生理解（见 0.20.2 条）。
  - 锦囊并进学习集层的主题要点技能：每条要点写何时想起、条件、做法、为什么成立、在哪里失效、依据；一节课的候选合成一份 `skill-save` 修订交学生采用。不再新建 `锦囊/` 文件，旧锦囊照旧可读、不迁移，附索引的代码保留。
  - `vault-workflow` 只放资料根、文件类型、读写文件、代码文件、`write-batch`、命令行通用约定与意图标记；各命令的用法写在用到它的技能里（复习在 `method-distillation`，路线在 `route-planning`，剧本与小结在 `lesson-preparation`，PDF 与已拆卡片在 `material-outline`，小结索引在 `material-search`）。
  - 本地命令的调用方式只写在常驻 `base.md`：`printf '%s' '<JSON>' | "$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" <命令>`，字段用 `--help` 查。拆分后没有这一句时，老师会把命令当系统命令去找（验收计时：读 PDF 时间与 token 翻倍）。

- Native Vault 0.19.0 起教学提示词按 philosophy.md 第 11–14 节（设计：`docs/migration/2026-09-27-teaching-prompt-polish-design.md`）。
  - 常驻 `base.md` 只放每轮都要做对的判断：
    - 「观察与掌握」写深度次序（迁移、边界、反例、改条件、推导）、熟练与深度两条轴、只讲过的记“讲过”；
    - 「动态地教」七条（退与进、交出主导权、留意态度、肯定、被纠正时、发散与收回、守本质的标准），每条配跨学科短例子；0.20.1 起加入“讲还是问”，共八条；
    - 白板、工具与写入、召回做法、备课分工的细节归 `notara-board`、`notara-vault-workflow`、`notara-material-search`、`notara-material-outline`、`notara-worker-orchestration`，常驻只留原则与指向。
  - 四个教法预设（`presets/*.md`）是讲法的形式，何时退、进、交出主导权按「动态地教」判断。
  - 召回的触发条件只写在 `base.md`「主动召回」，`teaching-context.js / CONTEXT_TRIGGER` 只说明入口。
  - 提示词写法：多写该怎么做，否定只留给安全、隐私、诚实这类边界，以及模型惯于误用的操作。
  - 白板加粗的内容按行内语法解析（`board-render.js / renderBoardMarkdown`），加粗里的公式、行内代码与高亮照常渲染。

- Native Vault 0.18.4 修掉图标列的小问题（`docs/dev-log/2026-09-27-rail-minor-fixes-0.18.4.md`）。
  - 空状态只在成功读过之后出现：路线页与资料库页在还没读到内容时，要么显示“正在读取…”，要么显示失败原因加“重试”（广播 `notara-vault-changed`，面板一起重读），不用“还没有…”盖住失败（资料库页的 `listing`）。
  - 首页在原生 `sessions.list` 的 `phase` 为 `ready` 之前，不说没有学习目录。
  - 在首页面板选完目录后留在首页（`createVaultNavigation.adoptHome` 接管新目录的空白课堂）。切换失败时目录对话框重新打开并写明原因。`rememberDirectory` 在一直挂载的 `DirectoryPicker` 里执行。
  - 窄屏上面板里的所有选择（含右键与“新建”菜单、回收站）都会收起面板。
  - 等待插入首页输入框的草稿，离开首页即丢弃。技能页的面板高亮与主区共用 `skills-client.js / selectedSkill`。计划面板只高亮路线页报告的 `routePath`。
  - 常驻 `base.md` 写明图标列的首页、计划、Vault（含代码编辑器）与技能页；给学生的位置说明用这些名字，不再说“资料库”。

- Native Vault 0.18.3 按图标列的整体审查修正交互（`docs/dev-log/2026-09-27-rail-review-fixes-0.18.3.md`）。
  - 面板收起时，点分区图标只在主区已经是这个分区（`nav.section`）时展开面板，其余都切换主区；在课堂里点“首页”回到首页。
  - 首页“去对话里规划”插不进输入框时，原因显示在输入框下方（`today-entry-client.js / TodayEntry` 的 `draftNotice`），离开首页时清掉；`composerError` 只用于准备输入框本身。
  - 代码编辑器经 `onDirty` 报告未保存修改，资料库页据此拒绝打开别的文件、新建与导入，与 Markdown 一样；编辑器有“放弃修改”，载入文件当前的内容与版本。
  - 技能页上缺梗概的学习集也能从其他学习集继承。

- Native Vault 0.18.2 起面板有搜索（`panel-search-client.js / createPanelSearch`：标题旁的放大镜开合，输入时 Escape 关闭并清空）。
  - 首页按标题筛课堂，技能按标题筛各组（没有匹配的组整组隐藏）。
  - Vault 经 `vault.search` 找标题、正文或路径，结果暂时替代文件树；资料库页在 Vault 分区里不再有自己的搜索，课堂右侧的资料面板照旧。
  - 导出与资料库白板存档的 KaTeX 样式取自 `math-latex.js / mathStyleText`（构建时内联的样式与字体），不再读页面上的 `<style>`，页面还没渲染过公式时存档也不会重复显示公式。

- Native Vault 0.18.1 起技能在图标列的“技能”页管理，“设置 → 技能”一节删除。
  - `skills-client.js / createSkillsPage` 给出面板 `SkillsPanel` 与主区 `SkillsView`，两者共用 `createSkillsStore`：同时读取只加载一次，每次进入技能页重读；操作失败时照实保留原因。
  - 面板分三组：各学习集（当前目录排第一，梗概排组内第一；缺梗概时列“学习集梗概 · 未创建”，主区给出创建按钮）、学科层、内置（`BUILTIN_SKILLS`，取教学 manifest 的标题与说明，只读）。
  - 主区沿用原有操作：启用 / 停用、查看 / 采用 / 丢弃修订、从其他学习集继承为草稿。
  - 提示词、学习集梗概提示与命令行报错里给学生的位置说明都改为“技能页”。

- Native Vault 0.18.0 起侧栏是 56px 图标列加当前分区的面板（设计：`docs/ui/2026-09-27-rail-navigation-design.md`）。
  - 两者都渲染在原生 `sidebar.content` 里（`rail-client.js / createVaultRail`）；原生侧栏收起时正好 56px，只剩图标列。默认宽度由 `ctx.layout.setSidebarDefaultWidth(360)` 设定；视口窄于 1024px 时原生自动收起，展开的面板在选完后收起。
  - 分区：首页（课堂列表与学习目录，打开的课堂仍属首页）、计划（日历默认 / 路线 / 复习 / 定时任务占位）、Vault（文件 / 卡片 / 图谱与文件树）、技能（见 0.18.1 条）。设置经原生 `sidebar.settings` 放在图标列底部。
  - 导航状态只在 `shell-client.js / createVaultNavigation`：分区 `home|lesson|plan|vault|skills`（`lesson` 是打开的课堂，图标列上高亮首页）、`plan`、`vault`、`routePath`、`filePath`、`pendingDraft`、`pickerRequest`、`boardFocus`。面板与主区只经它和 `viewRequest`（`focus` 或 `command`）通信；`sessionStorage` 的 `notara-vault-view` 记住分区与视图，旧的只含课堂的记录照旧续课。
  - 面板取代了资料库页与路线页左侧那一列：在 Vault 与计划分区里主区不再画它们，课堂右侧的资料面板照旧。文件树是 `file-tree-client.js / createFileTree`，两处共用。资料库页新建或导入文件后广播 `notara-vault-changed`，面板据此刷新。
  - 切到白板时面板自动收起，只有这次自动收起的才会在离开白板时恢复（`rail-data.js / boardCollapse`）。
  - 空状态文案只在 `empty-state-client.js / EMPTY_STATES` 定义，按钮只对应现在就能用的操作；“去对话里规划”经 `composer-insert.js / insertComposerText` 把草稿插入首页空白课堂的输入框，不发送，插不进时照实提示。

- Native Vault 0.17.8 起，拆书与补卡前按资料引用核对已有卡片，不按文件名判断。
  - CLI `source-cards`（`vault-cli.js / sourceCards`，只读）传资料页或原件的 `path`；资料页会连同它嵌入的原件一起查。
  - 引用位置与图谱同一定义：取 `graph.js / buildVaultGraph` 解析出的 `sources`，只统计 `KNOWLEDGE_CARD_TYPES` 的卡。
  - 各类资料按自己的定位分组：
    - PDF 按页，区域卡带 `rect`；给出 `uncoveredPages`，页数由 `agent-media.js / readPdfPageCount` 只数页、不渲染。引用旧版本的卡记 `otherRevision`，仍算已有、不算空缺。
    - 视频和音频按 `#t=` 时间段，图片按 `#rect=` 区域，Markdown/HTML 资料页按锚点；不推算缺哪一节。
    - 没带位置的引用列在 `wholeFile`，写错的定位列在 `invalid`。
  - `materials` 是引用这份资料的专题与源目录，其中 `uncitedCards` 是它们名下没带这份资料出处的卡。
  - 规则写在 `material-outline.md` 的“先核对已有卡片”：一页有卡不等于每道题都有卡；清单只列空缺，已有卡写“补充”；同一题两张卡交学生决定。
  - Word（.docx）没有预览和定位，只能整份引用；要按页核对先导出为 PDF。

- Native Vault 0.17.7 起，图的名字可以用常用希腊字母。
  - `math-expression.js / NAME_SOURCE` 是图的名字与公式名字的唯一写法，`board-figure.js` 直接引用它：英文字母开头、后接字母数字下划线，或者一个希腊字母（`GREEK_LETTERS`）后接数字或下划线，都可带一撇。
  - 希腊字母不与相邻字母连成一个名字，所以 `2πx`、`σx` 按乘法算。
  - 与英文字母长得像的 ο、ι、υ 和 Α、Β 这类大写不收。
  - `π` 与 `pi` 同为圆周率，是保留字。
  - 滑块标签、带入对话与作答消息直接显示希腊字母。

- Native Vault 0.17.6 按验收后的设计决定 D-4、D-7 调整白板排版与图上作答。
  - **收紧写完的板块**：`board-layout.js / layoutBoard` 中，下一个板块写下第一块时，前一个板块的宽度定为它当时用到的列数（至少一列）。之后补进它的块在这些列里往下排，更宽的块收窄到这个宽度。
    - 板块间距为 `LAYOUT.sectionGap`（72）。
    - `frames` 带 `columns` 与 `titleWidth`，板块标题按 `titleWidth` 截断并有完整 `title`。
    - 正在写的最后一个板块仍按三列排。
  - **定位到最新块**：`board-client.js / land` 在每次打开白板时执行一次（可见、课堂板书面、非阅读模式、没有正在写入的块、已有实测高度）。它按宽度放下最新块所在的板块，并让最新块在视野里。打开“跟随板书”时也先执行一次。
  - **全览**：`fit` 最小缩放到 50%。更宽的白板把最新板块贴在右边，前面的板块排在左边；最新板块本身放不下时从它的左边开始。
  - **图上作答附说明**：带 `ask param|point` 的图有“看到了什么”的可选文本框（`board-visual-client.js / figureInput`）。`board-figure.js / answerFigure` 接受 `note`（`NOTE_LIMIT` 2000 字），作答消息在末尾加“。我看到：…”。`skills/board.md` 写明观察题请学生附一句看到了什么。

- Native Vault 0.17.5 按验收后的设计决定 D-6、D-2 调整开课绑定与工作员模型。
  - **就地绑定**：老师在课堂里调用 `open_learning_lesson` 时走 `teaching-runtime.js / openRouteLessonHere`，学生留在当前课堂。
    - 当前课堂还没对应路线节点、节点也没有学生上过的课堂（`hasStudentTurns`）时，把剧本、前课小结、材料与科目绑到当前课堂（`bindRouteNode`，与计划页开课共用），节点的 `sessionId` 改为当前课堂。只绑过剧本的课堂在节点没有剧本时保留原剧本。
    - 已对应别的节点，或节点已有学生上过的课堂时，不改绑定，返回 `bound: false` 与原因；`repeat` 把当前课堂记为这一节的新节点。
    - 计划页开课仍走 `openRouteLesson`。
  - **工作员默认跟随老师**：没有保存模型的工作员用老师当前请求的模型与推理等级（`solver-runtime.js / teacherRoute`，读会话最新的 `request/header`），教室显示“跟随老师 · <模型>”；不再按名字匹配任何首选模型。
  - **配置范围**：
    - 教室设置可“保存到所有课堂的默认”（`worker-defaults.js`，`$DSH_HOME/notara-workers.json`，按 revision 保存）或“只改本课”（`notara/worker-settings` 事件）。
    - 生效顺序是本课覆盖 → 旧的按课 solver 路由 → 全局默认 → 跟随老师；`inherit: true` 清掉这一层。
  - **调不通标记**：一次提供方拒绝（`solver_model_unavailable`）后，该路由在内存里记为调不通，之后派工直接快速失败，教室写明原因；任何一次保存设置都清掉标记。

- Native Vault 0.17.4 按验收后的设计决定（`docs/evidence/acceptance-0.17.2/decisions.md` 的 D-1、D-3、D-5、D-8）调整显示与提示词。
  - **完整对话**：Vault 播种时写入原生 `ui-chat.transcriptView`（0.21.0 起为 `verbose`，见 0.21.0 条），老师在工具调用之间说的话不再折进过程；已有实例在“设置 → 通用设置”里改。思考行只留“思考”标签（`modern-theme.css` 覆盖原生 `ReasoningRow` 的 summary，上游升级时核对类名）；原生 Skill 行经 `tool.call.toolview` 显示“读取技能：<中文名>”（`skill-display-client.js`，内置技能取教学 manifest 的标题），不露技能 id。
  - **刷新回到课堂**：`shell-client.js / createVaultNavigation` 用 `sessionStorage` 记住本标签页的课堂与左右栏布局，刷新后在首页准备空白课堂之前由 `resume` 重新打开；课堂不存在或是空白时回首页，新标签页仍进首页。`openLesson(ctx, sessionId, view)` 从别处打开课堂并切到指定视图。
  - **资料库**：`media.js / isToolCacheDirectory`（`__pycache__`、`node_modules`）与点目录一样不进 Host 和老师侧的遍历；`lesson-board/*.md` 用导出渲染器在无脚本 iframe 里只读显示，并可“在课堂白板中打开”；文件列表菜单可“新建代码文件”（空文件，扩展名须是代码类型）。
  - **其他细节**：填空含 LaTeX 命令时也预览公式；失败的工作员任务经 `failureCode` 显示原因，模型调不通的任务不给查看入口；森林的阶段牌挂在锚点左侧。
  - **提示词**：学生可见文字不出现工具名、参数名、预设 id 与写法报错，工作员用中文角色名；“认识变化”只说板上内容怎么改，不评价学生作答；对学生认识的判断只进题卡；高亮只用于白板；带 `predict` 的逐帧演示用 `question`，讲解与演示用 `note`；交答案前不在对话里讲答案；关键一步先留给学生建；拆书始终先确认，并写清规模与花费；方法要点单独成技能，不写进梗概；说到复习到期先核对 `next_review`；学生界面没有终端；提示词里的“他”改为“学生”。

- Native Vault 0.17.3 修复真实模型验收（`docs/evidence/acceptance-0.17.2/`）中的 bug。
  - **工作员失败原因**：失败时带上提供方的原因（`solver-runtime.js / workerFailure`；原生子代理不填 `diagnostic` 时读子会话最后的 `turn/end`）。“未配置 / 缺凭据 / 401 / 403”报 `solver_model_unavailable`，要求学生到教室设置换模型，不原样重试、不换预设重试。
  - **有坐标轴的图**：按 `board-figure.js / figureView` 画，轴贴在左边或下边时留余量，刻度数字不被裁掉；点选坐标夹回 `figureBounds`，作答校验仍用 `figureBounds`。已作答、只读重画的图也登记导出快照。导出时没有快照的图写出 `figureText`，带题目的也一样。
  - **小结标题**：日期用 `calendar-data.js / civilDay`，与复习记录同一时区。
  - **白板作答摘要**：与选项同用 `Inline` 渲染。

- Native Vault 0.17.2 起白板有逐帧演示 ```frames（`board-frames.js / parseFrames`：可选 `title`，每帧以 `frame 说明` 开头、下面是普通板书 Markdown 且不能再放代码块，`predict` 只写在两帧之间，2 到 20 帧）。有 `predict` 才是作答题：被盖住的帧要学生交预测（以学生消息发给老师）或选“直接看”才揭开；“直接看”经组件的 `silent` 钩子只写入块标记、不发消息、不启动老师的回合，每轮概况里如实显示“没有预测，直接看了”。揭开后学生自己的预测显示在这一帧下面（`board-frames-client.js / FramesView`）。导出逐帧展开。计算机的环境图、调用栈与算法过程，物理的状态与过程，按 `subject-computing`、`subject-physics` 与 `notara-board` 用逐帧演示。

- Native Vault 0.17.1 起白板正文可以画图：```figure（`board-figure.js / parseFigure`：axes/view、param 滑块、function、curve 隐式曲线、parametric、point [drag]、segment、line、circle、midpoint、intersection、polygon、angle、arrow、text，按声明顺序检查引用与类型；公式一律经 `math-expression.js / compileExpression`，只认四则、乘方、隐式乘法、常用函数与已声明的名字，不 eval；标注是纯文本，不含 < >）与 ```flow（`board-flow.js`：Mermaid 流程图子集，`[ ]` 事件或概念、`(( ))` 待讨论问题、`{ }` 判断、`[?]` 留空，实线确定、虚线推测；`layoutFlow` 自写分层排版，`renderFlowSvg` 输出转义的 SVG，页面与导出共用 `FLOW_CSS`）。带 `ask point|drag|param` 的图与带 `[?]` 的关系图才是作答题，其余只供探索；两者都注册在 `board-components.js / BOARD_COMPONENTS`，与三类作答题同一套校验、指纹与作答消息。JSXGraph 只在第一次显示图时从按需路由加载（`LAZY_FILES['jsxgraph.mjs']`，构建由其 ES 源码打成一个模块，随附 MIT 许可），页面把 JSXGraph 文本设为 SVG 内部文本，不解析 HTML；在图上点选用 `getMousePosition`，画布缩放下坐标仍准确。探索状态不保存，“带入对话”只插入输入框。导出时关系图为 SVG，图取页面上的实时快照，没有快照时用文字描述；Markdown 导出保留代码块原文。`write_lesson_board` 不再接受 `interactive`；旧白板里的抛物线互动图照常显示与调整。各学科技能写明白板用法。

- Native Vault 0.17.0 的白板是讲台兼练习纸（设计：`docs/ui/2026-09-26-whiteboard-lecture-and-practice-design.md`）。`lesson-board` 页头 `sections` 记录板块（Host 分配 `s-` id）；块标记加 `section`、`size`（narrow/wide/full）、`place`（同一板块内 beside/below）与 `answers`。有 x/y 表示学生钉住；没有坐标的块由 `board-layout.js / layoutBoard` 按书写顺序与实测高度分三栏排版，已排好的块不因新增块移动。旧白板的块全部按原坐标钉住，新块的板块排在它们右侧。块正文里的 ```choice/```blank/```order 是作答题，`board-components.js` 是解析、带位置与写法的报错、指纹、作答校验与作答消息文字的唯一来源；写法里没有标准答案。作答经 `answerBoard` 先按当前指纹校验并写入块标记（每题留最近 10 次），再用与原生输入相同的 `createUserMessage({source:{kind:'user'}})` 加 `agent.followup` 作为学生本人消息发出；发送失败可 `resendBoardAnswer`，不重复记录。只有白板页面能作答，老师工具与工作员不能写作答。题干或选项变了，旧作答转为“题目修改前的作答”，不计入新题。老师改写只在目标块正文自其上次所见（每轮 `boardBodyView`）后变过时报 `board_block_changed`，学生作答、拖动与其他块的高亮不阻塞；学生高亮不得改动作答题（`board_component_locked`）。每轮本课背景的白板概况由 `board-data.js / boardOverview` 生成。页面侧 `board-answer-client.js` 的草稿只存本浏览器，每题都有“不确定”和“都不对/我有别的想法”；块工具条有“追问这块”（只插入唯一输入框，不发送）与“放回排版”；白板宽度小于 600px 为阅读模式；画布工具条停靠在画布下方，不覆盖内容；拖动只移动被拖块。常驻规则只写原则，用法在 `notara-board`。

- Native Vault 0.16.25 的性能约束：`vault.js / createVaultStore` 与 `agent-io.js / scan` 按文件身份与新鲜度缓存解析结果（Host 侧 `fileStatKey`：dev、inode、大小、纳秒 mtime/ctime；老师侧用同字段的原生版本号），每次扫描仍逐个 stat，外部改动即时可见，只有变了的文件重读、重算哈希；老师侧命中缓存仍记录原生读取观察。缓存结果经 `deepFreeze` 冻结，调用方不得修改扫描结果。客户端定时刷新统一用 `remote-client.js / visibleInterval`：页面隐藏时跳过，重新显示时补刷一次。大模块不进启动包：`lazy-assets.js / LAZY_FILES` 是唯一名单，构建拷入未跟踪的 `lazy/`，Host 由 `font-route.js / createLazyHandler` 白名单提供，客户端 `loadLazyModule` 首次用到时 import；PDF 阅读器与 worker 走这条路，构建拒绝把 `pdfjs-dist` 打进客户端包。客户端包开启压缩。星图在所在视图不可见时不重画。

- Native Vault 0.16.24 的学习集梗概是固定的学习集层技能 `技能/learning-set.md`（`user-skills.js / OVERVIEW_ID`），页头必填 `subjects`、`coverage`、`level`、`goal`、`deadline`，缺项的文件无效；“待填写/未知/待定”这类占位可以存在于草稿中，但不能启用，也不能作为修订被采用。每轮本课背景都有 `learningSet`（`learningSetOverview`）：`active` 时带上各字段、限长摘要，以及按清单 `subjects` 别名与已启用学科层技能匹配出的 `subjectSkills`，本课未设科目时 `subjects` 取梗概中的值（`subjectsSource`）；`draft` 时标明等待确认；`missing` 时提示老师可以主动起草草稿，推不出的必填项先问学生。一个学习集只有一份梗概，各科要点另写学习集层技能并用 `tags` 区分。技能页中缺梗概时提供“创建学习集梗概”（`OVERVIEW_TEMPLATE`），梗概排在该学习集的第一位。

- Native Vault 0.16.23 起技能分学科层（`$DSH_HOME/notara-skills/`，所有 Vault 共用，只写核心思想）与学习集层（Vault 的 `技能/`，学习集梗概与按主题的方法要点）；0.19.1 起锦囊并进学习集层的主题要点技能，不再新建 `锦囊/` 文件，旧锦囊照旧可读、不迁移（见 0.19.1 条）。`user-skills.js` 是两层的唯一读写入口：新建一律 `draft`；学生在技能页（`skills-client.js / createSkillsPage`，0.18.1 前在“设置 → 技能”）启用或停用；老师修改已启用的技能只生成 `<id>.revision.md`，学生采用后才替换，被替换与丢弃的文本移入同目录 `.trash/`；学习集之间只能由学生发起继承，复制成目标学习集的草稿并记 `inherits`。老师经 CLI `skill-list/skill-read/skill-save` 写，`write-batch` 拒绝 `技能/`。`teacher.js` 只列已启用的技能（`notara-set-*`、`notara-global-*`，描述以“标题：”开头供菜单显示），学习集层技能加载时按 `tags` 附上由 `锦囊/` 生成的索引（标题、位置、何时想起），不手写、不落盘。启用状态变化经 `userSkillChanges` 失效原生目录缓存，页面广播 `notara:skills-changed` 让 `scripts/skill-menu-patch.ts` 的指令菜单重新读取；工作员的 `ask_worker.skills` 可选已启用的用户技能。新增内置 `notara-research`（分级取证、读原文、公众号只读公开可达页、不绕过验证码）与 `notara-skill-authoring`。同版本加入代码工作区：`media.js / CODE_LANGUAGES` 是代码扩展名与编辑器语言的唯一来源，代码文件以 `code` 资产经原有资产读写与版本检查；资料库的 `code-editor-client.js` 只做文本编辑（高亮、按语言缩进、括号、名称补全，Python 用 lang-python 语法树，其余用 legacy-modes 与文件内词补全），外部改动在未修改时自动载入、有未保存修改时只提示；运行与测试用本机工具链。代码与文本文件不参与资料根判定。

- Native Vault 0.16.22 的教学提示词加入学情四问与元方法。常驻 `base.md` 要求开讲或备课前判断学生情况、能力推断（已证实/推断/未知）、需求，以及按主题划分的四档阶段（入门建立、巩固熟练、综合迁移、冲刺查漏）；缺口用可区分的小任务补，不设前测门槛。发散、归纳、寻找联系、化归是通用元方法，各 `subject-*` 写本科怎样落地，物理以状态与过程为主线。备课页/课堂剧本模板的备课说明按这个顺序填写，0.13.0 与 0.16.21 的内置文本精确升级。新增 `notara-exam-prep`（高考、高考模考、考研、公考）：先确认考试身份，按官方文件→真题→院校公开数据→机构分析→经验帖分级取证；考纲原文存 `知识/` 并打 `考纲` 标签，考点覆盖表并入路线，模考按错因讲评；不承诺分数，不进入工作员可选 skills。同版本收口 Bash 写入：主教师的 Vault Markdown 一律用 `write-batch`，不用 `sed -i`、重定向直接写；老师 shell 注入随包 ripgrep `DSH_NOTARA_RG`（`ripgrep-path.js`，解析方式同原生 fs-search），缺失时退回 grep；原生 read/write/edit/glob/grep 的 `tool:*` 提示段随工具一起从主教师提示移除，工作员保留；`write-batch` 拒绝 `lesson-board/`，白板只由 `write_lesson_board` 写；节点规划正文用 `revise-route` 的 `brief` 修改。同版本加入后台调度与番茄钟。后台调度：老师预设挂载原生 `tool-jobs`（`job_output/job_list/job_kill`、任务完成通知），Bash 可 `run_in_background`；`ask_worker` 的 `run_in_background: true` 先同步做完校验、选模型与禁止原样重跑检查，再经 `ctx.jobs.start` 登记为 `subagent` 任务，记录与启动只在任务的 `run` 里发生，登记被拒绝时不留任务。番茄钟：`pomodoro-runtime.js` 由 Host 计时，状态存 `notara/pomodoro` 事件，页面读取时按事件重建计时；到点用原生 `agent.followup` 发插件通知（`notara-pomodoro`），请老师主动鼓励或提醒休息，学生看不到这条通知，也不会多出自己的消息；超过10分钟的过期计时只关闭、不唤醒；课堂顶栏的 `pomodoro-client.js` 只按 Host 给的剩余时间倒计时。无人值守的定时任务（自动备课等）暂不做：子代理无法可靠约束，只能开完全权限。

- Native Vault 0.16.21 在「设置 → 学习界面」开放极简（默认）/手帐两种外观，偏好按浏览器存于 `localStorage`（`appearance-client.js`），切换即时生效并跟随原生深浅色。手帐以极简布局为底：`theme-tokens.js` 换纸墨 token 与 `--nb-*` 纸张 token，`notebook-theme.css` 只在 `body[data-notara-style=notebook]` 下加装饰；老师回复逐块画 32px 横线，白板在深浅色下都保持浅色纸。霞鹜文楷由 Host `font-route.js` 的 `/notara/vault/fonts/wenkai.woff2` 白名单路由按需提供，构建从 `resources/fonts/` 拷入未跟踪的 `fonts/`，不得内联进 `client.js`；极简主题不引用该字体。原生哈希类选择器在上游升级时须重新核对。设置导航使用独立的纵向列表，主侧栏导航规则只匹配直接子元素，避免设置菜单被撑到中部；窄屏设置改成顶部横向导航。首页在目录登记通知稍晚时使用已知创建绑定，不能回退到无关目录；白板监听挂载时补读当前参数流，避免遗漏首段预览。

- Native Vault 0.16.20 学习星图随主题切换：深色为深夜星空，浅色为 Forest 式等距森林（`forest-client.js`）；两者读取同一 `learningStars` 与课程小结投影，共用 `StarMap` 的相机、选中与节点按钮，`star-light.js` 是共同的亮度与拆分树来源。暮色/花园候选与 `notara-star-day` 已删除。森林没有枯死形态，未评估为土堆，父节点覆盖度只由脚下草地表达，不画关系线，完成课程为路边银杏。

- Native Vault 0.16.12 首页与正式会话共用唯一 `nativeConversationBody` 输入组件，首页通过 `prepareHome` 选择本目录原生空白课堂，不复制或覆盖原生草稿；发送后进入同一课堂。首页日期问候与正式空课堂欢迎文字居中。`homeQueue` 从真实到期复习卡与未安排的主线课程投影近期候选（最多8项）；到期卡超过5张时按服务端完整 `total` 合并为一条，点击清除旧筛选并打开到期队列，5张以内仍逐张定位。排期使用原生 `scheduleLesson` CAS。单条待办每6.5秒轮换，悬停、焦点操作、弹窗、隐藏页面和减少动态效果偏好均暂停；可手动切换/暂停。首页不写独立待办本，不把打开卡片推定为掌握。白板与知识面无内容时保持留白，仅保留必要的错误与运行状态。

- Native Vault 0.16.7 将课堂标题、主视图切换与课堂操作整合为 `workspace-client.js / lessonHeader` 的一条顶栏，复用原生 Header 标题和更多菜单。`对话 / 白板 / 教室` 只有一个主 tablist，白板两面和导出保留在画布内部；主视图切换和窄屏切换继续共用唯一原生 composer。

- Native Vault 0.16.6 已接入双面课堂白板：`write_lesson_board` 通过 Host 绑定 `lesson-board/<session hash>.md`，稳定块标记和布局随同一 Markdown 保存；`board` / `mutateBoard` 复用原生会话授权与文件 CAS。课堂工具集合在既有四个专用工具基础上增加 `write_lesson_board`，只读工作员仍不能写入。知识面来自本课板书的实际引用，资料说明不复制教师参考正文。客户端订阅原生 `SessionBinding.eventSource` 的参数增量；暂态文字不等于落盘，取消/拒绝撤掉暂态。白板保留唯一原生输入框，窄屏按工作区实际宽度切换。导出排除未勾选的提示/参考/尝试正文；浏览器下载能力单独验收。

- 普通任务按「读取适用规则 → 核对真实状态 → 最小完整改动 → 比例化验证 → 简短交付」执行；能从仓库、日志、配置或现有测试发现答案时不先追问。
- 诊断类请求只定位原因与证据；除非同时要求修复，否则不改代码。
- 不自动制造 spec、实施计划、多轮确认等仪式；测试与风险成比例——小改动跑相关测试，跨模块、持久化、会话或发布路径再扩大验证。
- 动手前确认所在工作树与 checkout：本机同时存在 Oh-My-Student 主仓、多个 worktree 和迁移目录，别在错误的 checkout 上改或验。
- 依赖某条既有行为前先在源码中核实它真实存在；一条被认为存在其实没有的规则，比已知缺失的规则更危险。
- 探测、独立审查与大规模取证派只读子 Agent；主 Agent 保留用户目标、取舍与最终编辑权，核对子 Agent 的证据与冲突后采纳，不把原始长输出倾倒给用户。至少两个可独立完成、结果可清楚合并的工作流才并行。

## 代码边界

- `examples/native-vault`：Vault 插件（`@notara/vault-native`）。Host 入口是 `index.js` 与 `teacher.js`（工具、权限、持久化接线与学习领域规则），浏览器包由 `client-source.ts` 打成 `client.js`（页面、Slots 和学生可见投影）；两边都引用的纯数据模块不能引用 Node 模块。单元测试与模块同目录（`*.test.js`）。
- `examples/pixel-classroom`：可选的教室像素视图插件。
- `resources/`：随包分发的教学提示词与技能正文（`vault-teaching/`）和字体（`fonts/`）；`scripts/`：构建、DSH 补丁、Vault 启动器与隔离实例。
- `tests/unit`：脚本的纯逻辑；`tests/integration`：真实临时文件/进程接缝；`tests/e2e`：真实浏览器。

职责边界不要求每项都拆成独立服务或类；优先复用 DSH 原生生命周期和已有模块，只有实际领域差额才新增代码。同一合同只在一处定义——注册、校验、权限、展示从同一来源派生，不维护会漂移的多份名单。

## 执行规则

- 只用本仓库 lockfile 中的脚本和依赖，不使用会隐式拉取版本的全局 CLI 或 `npx`。
- 所有运行和 E2E 使用 `scripts/dev-isolated.ts` 的临时 `DSH_HOME`、临时课堂目录和随机端口；不启动、停止或修改其他 checkout、共享端口和真实用户目录。
- 用户明确要求长期试用时，使用同一入口导出的 `startVaultPersistent` / `npm run vault`，默认 `~/.notara/vault-runtime`、端口 `57093`；停止不删除数据，已有目录不重新播种。`npm run vault:open` 使用当前进程有效的登录链接；新浏览器首次登录不能只给去掉 token 的 origin。测试该生命周期仍使用临时目录和首次随机端口。未经用户授权不迁移实际数据。
- Vault 启动器给 DSH 子进程设置 64 KiB HTTP 请求头上限：浏览器会跨端口发送同一主机的历史登录 Cookie，Node 默认 16 KiB 可能在进入鉴权前返回 431。该上限不改变原生认证和 Host/Origin 校验；排查时区分 401、431 与浏览器侧错误，不只依赖 HTTP handler 日志判断请求是否到达。
- 隔离实例只含脚本指定的合成资料，没有用户的插件、课堂和学习数据。Native Vault 使用实例内插件快照，其他构建不得热更新正在验收的实例。报告时写明这是隔离实例与其实际数据根；用户明确要求真实 `~/.dsh` 或既有数据时才换启动方式，并把所用的数据根写进报告。
- 启动与验收前先确认实例归属：本机常同时存在其他 checkout 的实例和上次遗留的旧实例。操作浏览器或汇报地址前，先核实目标进程实际监听的 URL，不在旧实例上验证新改动。
- `.runtime/`、`node_modules/`、`dist/`、`lib/`、测试结果和凭据是本机产物，不提交。
- 不读取或提交 API key、认证 token、真实用户学习数据或完整私密课堂记录。
- 学生可见内容不得泄露内部 agent 名、工具协议、路径、session/run ID、隐藏答案或教师专属判断；界面只展示已实现的功能入口，未实现的功能不留占位入口和误导性说明；唯一例外是计划页的“定时任务”视图，它只说明暂时还不能用，不放任何操作。
- 模型不能填写可由 Host 确定的 ID、路径、时间戳和派生状态；失败必须如实返回，不能用成功文案覆盖失败。

## 插件开发与运行事实

- 插件只有 Vault 插件与可选的像素教室，口径见 `docs/runtime/plugins.md`。
- 插件改动后提升 `examples/native-vault/package.json` 的版本，已有运行目录用 `npm run vault:upgrade` 替换快照；不要直接编辑已安装快照来发布改动。
- 实例启动时加载自己的插件快照，页面加载时取当时的浏览器包：验收插件改动在新启动的实例、新打开的页面上进行，旧进程与旧页面上的现象都不是新版本的证据。

## 官网

- `website/` 是 oh-my-student.com 的静态官网源目录（Vite 多页：首页、`features`、`philosophy`、`install`、`first-lesson`、`faq`）。共用片段在 `website/partials/`，由 `website/vite.config.ts / site()` 在构建时注入，并用 KaTeX 预渲染正文里的 `\( \)`、`\[ \]`。`npm run site:dev`（端口 57180）、`site:build`（输出 `website/dist/`）、`site:preview`（57181）；`tsx website/scripts/check.mts [origin]` 检查各页桌面与手机宽度下的控制台、失败请求、内链和横向溢出。纯官网改动不需要跑教学运行时回归。
- 手写字体 `website/public/fonts/notara-hand.woff2` 是 `resources/fonts/wenkai.woff2` 按全站用字取的子集，改页面文字后执行 `npm run site:font`（需要 `uvx`）。截图由 `npm run site:capture` 在隔离实例里用测试模型和合成资料生成（先 `npm run build:native-vault`），页面上标注“示例资料 · 实际界面”；不从真实 Vault 截图。
- 托管在阿里云 ESA Pages（导入 GitHub 仓库，生产分支 `main`，控制台根目录保持默认 `/`）。ESA 在仓库根目录读取 `/esa.jsonc` 并在根目录执行命令，命令经 `npm --prefix website` 指向子项目；`website/esa.jsonc` 仅是根目录被设为 `/website` 时的兜底副本。`website/package.json` 与它的 lockfile 只含 Vite 与 KaTeX，版本与根目录锁定一致，云端构建不装 DSH 运行时。改动这两处依赖时同步根目录版本。
- 官网文案只写当前版本已实现的功能。边界（模型调用发往所选服务商、费用由服务商决定、Windows 未实机验收、仓库未附开源许可证）与 README、`docs/install.md` 保持一致；理念页正文由作者提供。
- 官网首页与安装页通过 `website/partials/editions.html` 并列展示独立桌面版与 DSH 插件版。桌面版源码私有，公开安装包与版本说明使用 `TongZi2003/Notara-Desktop-Releases`；尚无安装包时只链接发布页，不生成下载地址。既有截图、命令与数据目录明确标为插件版。桌面版发布后同步更新版本入口、安装说明与 FAQ。

## 验证口径

- 验证状态只表达证据，不表达信心：`PASS` 是从修改后的状态实际运行通过，注明证据类型与命令；`FAIL` 是实际运行失败，给出最小复现与影响；`BLOCKED` 是凭据或服务缺失导致无法运行；没跑的层级写 `未运行`。
- 证据分层记账、互不替代：文档与合同检查、类型检查、构建、确定性测试（unit/integration/e2e）、真实模型（验收实例上用真实模型上课）、真实学生体验。静态检查或测试模型的结果不写成真实教学质量通过。
- 交互类改动必须在真实浏览器里验收：构建通过、类型通过、静态审阅和「截图看起来像」都不算修复证据。E2E 断言要覆盖可见行为并捕获控制台异常——iframe 启动阶段的未捕获异常（例如元素已删但事件绑定还在）会中断初始化，后续接线全部静默失效。
- 验收以用户当前看到的页面与版本为准：旧实例、旧课堂绑定、缓存快照上的观察都不是新代码的证据；未能在当前版本上复现并验证，就不报「已修复」。服务或运行时代码改动后，先在新启动的实例上验收，旧进程会给假绿。
- 零断言、空套件、从未触发的分支不算已验证；空态、边界和「没有数据」的场景要单列断言，不由主路径顺带推定。产品级支持以完整真实流程为准——空空间输入、教学、沉淀、关闭、重开续学全链通过才算成立，局部字段合法不等于功能可用。
- 删除 UI 元素时连同其事件绑定、引用与样式一起删；改动初始化路径时先确认无残留引用。防护与清洗收窄到明确边界，误伤正常内容比漏报更严重。
- 评审、审计和计划文档的结论逐条对照原文与当前真实状态核实后再执行，不把历史结论当当前事实。测试断言合同、schema 与可观察行为；提示词正文改动由人读稿审，不把措辞钉成断言。

## 交接与记账

- 锚点用「文件 + 函数/段落名」，不用容易漂移的行号。
- 逐轮开发交接写进 `docs/dev-log/<日期>-<主题>.md`：目标、实际改动、锚点、各层验证结果与命令、未完成项和下一入口；验证日志与截图等证据文件归 `docs/evidence/<主题>/`。
- 规则或产品事实变化与对应代码改动进同一次提交；本文件只收当前仍然成立的规则，过程叙事只进 dev-log。
- 文档与汇报使用代码中的正式名称（工具名、schema 字段、组件名），不沿用旧产品的隐喻叫法。
