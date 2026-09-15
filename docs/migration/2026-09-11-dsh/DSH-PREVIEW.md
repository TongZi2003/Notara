# DSH 对话预览与课程资料接入

核验日期：2026-09-11，DSH固定发布0.1.5-rc.2 / fb2c4b9e698e30edb738bca4cf0618587db7d203。依据官方源码、说明及R已安装包声明；本轮未新增运行验收，不重判P0。

## 核实的原生机制

- 每个Session拥有自己的右侧Surface，可开多资源标签、分栏和浮动；换课保留各自状态。资源标签以kind/contentId识别，同地址默认聚焦已有标签。见[右栏说明](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/client/ui-sidebar-right/README.md)。
- 统一入口ctx.sidebarRight.openResource/openTab；标签内用tab.actions，目标保持其所属Session。顶层控制器需要已挂载的真实会话；openResourceIn/adopt不属于公开ISidebarRight，不可拿来绕过挂载。见[控制器实现](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/client/ui-sidebar-right/src/client/service.ts)。
- fileAddressFor(sessionId,cwd,path)产生携带实际Session的文件地址；hostFileOf只取地址里的Session，不借当前tab/全局选择补权限。原件可在共享workspace里，同书不按课复制。见[文件资源接口](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/api/workspace-files/README.md)。
- 官方document preview管加载/renderer/滚动/换行/重读，内容renderer走documentPreviews与相应slot。预览不注册教学工具或把浏览内容发给模型。见[文档预览说明](https://github.com/deepseek-ai/deepseek-harness/blob/fb2c4b9e698e30edb738bca4cf0618587db7d203/packages/client/ui-sidebar-documentpreview/README.md)。

## 当前边界，不能想当然

原生右栏布局是内存状态，刷新回到折叠默认，不承诺持久恢复分栏和所有标签。文件预览的源码line导航仅文本/代码落实；MD不提供行锚，PDF/图片/HTML不消费源码行导航，字节renderer不保证重挂载滚动恢复。这是扩展定位适配需要补的部分，不能把line当PDF页码。

workspaceFiles普通文件读取本身不强制workspace containment，读取权限来自实际filesystem backend；目录listing的范围不能代表所有读取都受限。因此StudyForge须让该Session实际使用的读取后端执行学生账户边界，并验证直接调用read/readAll/readRelated也不可绕过，而不只检查我们生成的地址。

原生controller当前不公开完整layout snapshot。使用其公开actions/active和slot hooks；不维护另一套activeTab、pane tree、开闭列表来与它双向同步，也不把私有类方法当公共API。需要刷新的持久定位依靠已保存的SourceAnchor和课程/消息引用重新打开；不假称原生已恢复布局。

## 课程资料采用的接法

~~~text
确认的路线/本课材料引用 + 已接受消息引用 + 实际课堂产出
                     ↓
              本课资料只读投影
                     ↓ 点击
     resolveForSession(真实sessionId, 稳定引用)
                     ↓
     DSH资源地址 + 经schema验证的导航locator
                     ↓
   native openResource → Session标签/分栏 → renderer
~~~

1. 一课零或多份混合资料。materials表示教学安排/明确关联的引用，不是对话文件白名单，不是右栏已打开标签的镜像。
2. 原资料稳定materialId/versionId/locator保留于学习事实；Host解析为该Session可读的不可变版本文件，并通过官方helper生成地址。新课引用同版本只产生新Session地址，不复制原件。
3. 本课资料可以列表提示“本课用到什么”，其打开/聚焦/关闭/分栏交DSH。关闭标签不移除课程引用；移除课程引用不删除原件/消息/学习证据。
4. PDF/图片/MD/DOCX通过原生renderer扩展补locator与选择；卡片注册StudyForge资源/标签类型并走同一侧栏，卡浏览的当前版与消息/证据所需历史版明确区分。不得把含隐藏答案的原始卡文件交普通全文预览。
5. 当前输入来源由native active tab及该renderer报告的可验证位置取得；显式selection优先。打开两个窗格不自动把两份文件都发给模型，无active来源就不伪造当前位置。
6. 发送的文本/来源/locator仍走P2唯一send冻结后进入native消息；浏览、切tab、分栏都不创建学习证据或改变system prompt。
7. 从资料屏预览但没有真实课堂时，不为预览创建占位课、不借别的Session冒充授权；资料屏保留自己的阅读入口。选择“开课/带入本课”才进入对应真实Session。
8. 开计划课只用合法引用初始化资料入口及默认原生预览，之后可自由打开其他本人资料。P6继承/计划重点不因此变权限限制。

## 任务与验收

- P1.4：原生文件Remote读权限与实际backend验证。
- P2.2：保留DSH rightbar/session槽；P2.4区别切课与浏览器刷新。
- P3.1–P3.2：稳定版本→Session文件地址；复用正式preview owner/renderer；学生标题不泄露Host绝对路径。
- P4.1：本课资料投影与NativePreviewAdapter，撤回独立DeckService.select/openTabs；P4.3读native active与renderer位置，验证多窗格；P4.4冷启动按锚重开。
- P6.2/P6.4：materials仅教学引用，默认预览走native；支持零/混合，不硬绑定单文件。
- G4：同课PDF+卡+MD三个原生标签、重复打开聚焦、分栏比较、A/B切换、旧tab异步回调、刷新后按来源重开、浏览零消息、选区发送只带正确来源。源码核实不代替这些新产品实测。

上述调整已回写v2相关分册。任务总数不变；P0仍不修改。
