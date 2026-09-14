# Notara 插件接入

产品设计与执行记录分别见 [设计](../../../docs/superpowers/specs/2026-09-14-notara-plugins-design.md)、[计划](../../../docs/superpowers/plans/2026-09-14-notara-plugins.md)、[验收](../../../docs/dev-log/2026-09-14-Notara-plugins-v1.md)。

首版支持 npm 包中的 `notara.apiVersion=1`，提供 skills、workbenches、teaching、subjects。完整的可安装示例在 [出题与复盘](../../examples/plugins/study-kit/README.md)。本地目录及 `.tgz`/`.tar.gz` 均通过插件页检查后确认安装。

Host Remote 为 `studyforgePlugins/{prepare,installPackage,list,setEnabled,uninstallPackage,workbenches,openWorkbench,saveNote}`；安装/卸载方法不能命名为 install/uninstall，它们是原生客户端服务保留名称。`PluginView.state` 是加载结果，`enabled` 是请求设置；首次安装可成功保存记录但state=failed，界面不得显示成已启用。

插件文件、独立 pnpm profile 和版本放在工作区 `.studyforge/plugins/`，安装登记和工作台固定版本仍使用现有原生存储。停用和卸载撤掉入口及原生加载，保留历史引用所需快照与已保存成果。不要编辑快照中的文件来发布更新；更改开发源、提升包版本并重新安装。

HTML 工作台只能通过宿主注入的 `Notara.saveNote({title,body})` 请求展示完整确认区。确认之后使用现有 CardService 保存 note，不推进复习。宿主绑定课堂与操作号；工作台不能任意选择学生、覆盖旧卡或调用 Remote。`Notara.onSaved` 接收已保存的标题。工作台默认跟随主题；颜色、字体、字号与圆角 token 见示例 README。

带 `dsh.bundle.patch` 的包按可信本机代码处理，通过独立 Include 挂在顶层 Loader；运行中原生变更延后至重启。自包含 HTML 与 Node 代码不共享权限模型。首版不加载原生客户端 bundle，也不接受未实现的 worldbooks/agents 等贡献字段。

## 原生斜杠菜单接缝

`scripts/patch-input-source-filter.ts` 为锁定的 DSH 0.1.5-rc.2 提供 `inputTriggers.registerSourceFilter`。它按会话过滤 source roster，菜单、键盘路由与 lexicon 共用过滤结果；注销恢复原生行为。`skill-draft.ts` 仅在学习课堂过滤重复的原生 skill source，产品同名技能通过真实标题与原生 reference codec 选择。原生技能执行、工具展示与其他会话来源保留。

补丁校验上游原始 SHA256、唯一替换锚点及反向还原摘要；由 `patch-sdk.ts` 在 postinstall 应用，重复运行不改变结果。升级 DSH 必须重新核对接缝，不能忽略未知摘要。
