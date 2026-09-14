# Notara 插件接入

产品设计与执行记录分别见 [设计](../../../docs/superpowers/specs/2026-09-14-notara-plugins-design.md)、[计划](../../../docs/superpowers/plans/2026-09-14-notara-plugins.md)、[验收](../../../docs/dev-log/2026-09-14-Notara-plugins-v1.md)。

支持 npm 包中的 `notara.apiVersion=1`，提供 skills、workbenches、teaching、subjects、worldbooks。完整独立包：[出题与复盘](../../examples/plugins/study-kit/README.md)、[世界书](../../examples/plugins/worldbook/README.md)、[函数实验台](../../examples/plugins/function-lab/README.md)、[论证工作台](../../examples/plugins/argument-studio/README.md)。本地目录及 `.tgz`/`.tar.gz` 均通过插件页检查后确认安装。

Host Remote 为 `studyforgePlugins/{prepare,installPackage,list,setEnabled,uninstallPackage,workbenches,openWorkbench,saveNote}`；安装/卸载方法不能命名为 install/uninstall，它们是原生客户端服务保留名称。`PluginView.state` 是加载结果，`enabled` 是请求设置；首次安装可成功保存记录但state=failed，界面不得显示成已启用。

插件文件、独立 pnpm profile 和版本放在工作区 `.studyforge/plugins/`，安装登记和工作台固定版本仍使用现有原生存储。停用和卸载撤掉入口及原生加载，保留历史引用所需快照与已保存成果。不要编辑快照中的文件来发布更新；更改开发源、提升包版本并重新安装。

HTML 工作台只能通过宿主注入的 `Notara.saveNote({title,body})` 请求展示完整确认区。确认之后使用现有 CardService 保存 note，不推进复习。宿主绑定课堂与操作号；工作台不能任意选择学生、覆盖旧卡或调用 Remote。`Notara.onSaved` 接收已保存的标题。工作台默认跟随主题；颜色、字体、字号与圆角 token 见示例 README。

带 `dsh.bundle.patch` 的包按可信本机代码处理，通过独立 Include 挂在顶层 Loader；运行中原生变更延后至重启。自包含 HTML 与 Node 代码不共享权限模型。不加载原生客户端 bundle，也不接受未实现的 agents 等贡献字段。

## 世界书与工作台草稿

`notara.worldbooks` 使用与技能相同的 `id/title/description/entry` 声明；entry 是 `{entries:[{title,content,keywords,enabled,always}]}` JSON，安装时完整校验。每份自动提供动态世界书工作台，不增加基础视图。条目最多60个，每条2000字，文档JSON上限50000字符。

用户编辑副本独立存于 `worldbook`，启用存于 `worldbookuse`，默认每课关闭；包更新不覆盖副本、卸载不删除。世界书改动使用expectedVersion防止并发覆盖；导出可保留本地草稿。首次打开只读种子，首次保存才创建副本。

世界书通过 `system-prompt/assemble` 的原生 `contexts` 接入。输入只取已被原生inbox claim的真实用户消息，工具/回执/排队尾部不会替换触发文本；按输入id固定一轮。NFKC和大小写不敏感的字面关键词匹配，最多8条/6000字符，完整条目选取，省略数明确。原生动态上下文表达当前背景，历史快照保留，不追溯抹除，不新增学生消息或学情。

HTML声明 `permissions:["draft","save-note"]` 后可调用：

```js
const draft = await Notara.loadDraft(); // JSON值，无草稿时null
await Notara.saveDraft({ parameter: 2, observation: '我的观察' });
Notara.saveNote({ title: '实验笔记', body: '正文' }); // 宿主完整确认
```

草稿绑定课堂、工作台、固定digest，JSON上限64000字符，SDK串行保存并携带revision，失败保留当前输入；不自动重写卡片。Remote用JSON文本承载草稿（锁定Typert不能编码外部递归JSON类型），宿主重新解析并用Zod校验。消息仍检查opaque iframe来源/nonce/严格字段/权限。

新增Remote：`readWorldbook/saveWorldbook/useWorldbook/previewWorldbook/readDraft/saveDraft`。世界书是用户背景、草稿是工作中内容；两者都不推进复习。世界书语义检索尚未实现。

## 七个学习插件与课堂工作文档

`examples/plugins/` 另有七个可独立安装的包：`blackboard`、`error-clinic`、`geometry-lab`、`evidence-detective`、`time-atlas`、`seminar-room`、`scenario-simulator`。源码在 `examples/plugin-sources/`，执行 `node_modules/.bin/tsx scripts/build-learning-plugins.ts` 生成自包含HTML、技能、货签及种子。用各目录的 `npm pack` 打包；安装仍走原生包通路。KaTeX字体离线嵌入，地图使用Natural Earth公共领域陆地数据，不表示历史疆域。

工作台可声明 `document:{kind,seed}`，kind 为 blackboard / clinic / evidence / atlas / simulation，seed 为包内JSON。必须同时声明 `document` 权限，安装时使用 `PluginDocumentSchema` 全量验证。文档按课堂、工作台和固定digest隔离，首次保存物化，后续expectedVersion进行CAS。老师使用渐进工具 `read_workbench` / `update_workbench` 共编；无id的读取只列目录，不提前固定全部版本。HTML每3秒读取更新，未保存编辑不会被覆盖；模拟运行保留开始时规则快照，规则变更后必须重新开始。

SDK按声明权限开放：

| 权限 | 接口与边界 |
| --- | --- |
| document | `loadDocument()`、`saveDocument(revision,document)`，返回revision与document；不写学情 |
| sources | `pickSource()`、`openSource(link)`；宿主选择/验证原文、卡片或课堂，来源自带版本与可选页码 |
| compose | `compose(text)` 追加原生输入草稿，保留已有内容，等待学生发送 |
| worldbook-context | `worldbook(query)` 只返回本课堂启用且命中的背景 |
| seminar | `seminars/startSeminar/followSeminar/stopSeminar`，实际原生独立子会话 |

这些Remote统一为 `notaraWorkbench` namespace，客户端必须显式inject `remote.notaraWorkbench`。每次请求验证工作台启用状态、权限、digest和课堂绑定，iframe不持有直接Remote。笔记仍使用原有 `save-note` 完整确认通路。

研讨室最多三位独立发言者：同伴、质疑者、助教。模型继承父课堂；三者仅获得用户填入的材料，参考标准只给助教，toolFilter为空。原生负责会话、inbox和运行，产品记录角色与childId绑定。状态结合实际活动、日志和待处理inbox重建，追问会恢复父课堂并续同一child，停止逐个执行，停用插件会请求停止。它会消耗当前模型额度；模拟适配器验收不代表真实教学质量。没有实现任意外部帮手贡献字段。

## 原生斜杠菜单接缝

`scripts/patch-input-source-filter.ts` 为锁定的 DSH 0.1.5-rc.2 提供 `inputTriggers.registerSourceFilter`。它按会话过滤 source roster，菜单、键盘路由与 lexicon 共用过滤结果；注销恢复原生行为。`skill-draft.ts` 仅在学习课堂过滤重复的原生 skill source，产品同名技能通过真实标题与原生 reference codec 选择。原生技能执行、工具展示与其他会话来源保留。

补丁校验上游原始 SHA256、唯一替换锚点及反向还原摘要；由 `patch-sdk.ts` 在 postinstall 应用，重复运行不改变结果。升级 DSH 必须重新核对接缝，不能忽略未知摘要。
