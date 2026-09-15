# Notara 教室插件、创作者与旧插件退役

## 目标与已确认边界

实现用户批准的组合稿：原生对话保留唯一输入框与消息流，教室工作台只呈现成员、任务、世界书、参与规则。主教师组织材料并派发，同学只用教师供料独立回应。后续反馈要求姓名完整、减少解释文案、空白默认、常用教室可选、AI与面板共同创作，并正式退役其余旧插件。

产物根为仓库根目录，分支codex/dsh-native-migration。保留原仓、B、4877和既有9月11日脏文档。CLAUDE原9增3删单独保留，不混入本次提交。

## 实际实现

- `contracts/src/classroom.ts`：成员、触发器、动作、配置、任务、候选、课堂状态与学生投影。任务保存角色/材料快照和原生子会话引用，不复制聊天生命周期。
- `host/src/plugins/classroom-runtime.ts`：DSH原生spawn/continuable、队列、取消、持久化、结算和继续。同学最终工具面与执行入口都封闭，不继承父对话。公开回复只投影一次，私有备课回教师；重启补投不重新调用模型。
- `host/src/plugins/classroom-policy.ts`：只计真实学生输入对应的完成教学回合，系统通知和子任务结算不计数。每N轮和成功笔记保存生成教师候选，每教学回合一项自动参与；冲突候选跳过，不未来补发过时插话。
- `host/src/classroom-service.ts`：read_classroom / ask_classmate / continue_classmate / update_classroom_context。职责仍归教师判断，主模型读取并选择材料再spawn。
- `client/src/plugins/ClassroomWorkbench.tsx`：成员座位、真实运行状态、角色与任务详情、世界书/规则表单，点名进入原生草稿不自动发送。姓名不被flex压缩；空闲采用转笔/发呆/看向窗外等装饰文案，真实运行才显示思考中。
- `client/src/debug/ClassroomNotes.tsx`及`ToolActivity.tsx`：公开署名回复与普通界面私有信息隐藏；完整原生子代理导航只在调试模式注册，防备课绕路泄露。
- `contracts/src/creation.ts`及`host/src/creation/`：classroom作品和worldbook.json，AI与面板共用文件级版本冲突保护；当前作品绑定由宿主负责，模型不填目标路径、事务标识或版本。read_classroom_draft / save_classroom_draft按原生成功读取保护更新。文件系统拒绝原生工具直接写worldbook.json，安装再做同源schema校验。
- `client/src/creation/`：教室类型、可选模板、同一座位/配置编辑器、AI编辑入口、保存与安装。保存中禁用表单，空条目报校验问题而不是冲突；回到创作对话显式核对原生制作身份并显示对话。
- `examples/plugins/worldbook/`：包名保留，版本1.1.1；默认空白。日常自习、推理讨论、变式训练三份模板由用户选择，不默认启用。创作Skill与插件绑定并仅在教室创作者作用域提供；删除旧情境学习Skill。新作品发布普通worldbooks包，沿用目录/tgz安装器。

## 重要语义

本轮停止会取消任务并暂停，下一条真实学生消息可以恢复安排；关闭「本课启用」会持续停用。跨课只经教师选择的小结，不直接复用旧child。已有任务保留当时配置，已有课堂保留包版本。规则/世界书不是学生学情或掌握证据。

## 验证与修复记录

- PASS：build、测试类型、84同源合同；classroom/worldbook 7项单元测试。
- PASS：classroom-plugin、classroom-creation、plugin-learning、creation-workspace合计6个不同集成场景；后续创作者修改逐次定向重跑，不把重跑次数计为新场景。前一阶段native-input-evidence与plugins-install的专项亦通过。
- PASS：真实进程下公开/私有结果、空工具且不含父全文/私有提示、继续同child、重启恢复、旧背景升级保留、失败和陈旧版本拒绝、真实轮次/笔记事件去重、原生文件写入不能绕过教室草稿接口。
- PASS（浏览器）：711px并排教室姓名完整；1个原生composer、教室内0个，点名仅一枚@chip且发送前child调用数为0。发送后公开署名出现一次，私有备课标记未出现在DOM，展开准备过程仍隐藏；原生子代理导航收进调试模式。现代课堂与手帐创作者实页分别检查。
- PASS（浏览器）：新建世界书条目后继续表单编辑、保存、AI返回后看到小林与保留条目；空内容保存显示校验提示且草稿保留。
- PASS（真实模型的窄场景）：DeepSeek-V41-Flash / high，在一份单独创作验收作品中按自然语言把同桌改成小林并保留讨论约定。实际调用read_classroom_draft → save_classroom_draft → read_classroom_draft，工具拒绝0次；读取文件核验姓名与条目。不是完整教学效果或所有自动规则的实模证据。

保留初次失败：prompt assembly调用UI trace reader导致递归等待，改为纯阶段投影；缺Remote注入导致空白工作台；座位flex压缩名字；原生空白预设选择把第一份验收作品切回教学者，发送失败，补openCreator核对并用独立新作品完成实模验证；创作Skill发现最初按cwd区分而非原生作用域，修正到原生creator agent层，并补正向/反向目录测试；第一次作用域实现遗漏Cordis skills注入，改为显式依赖子插件。

## 日常环境与退役

58354使用经归属核验、idle检查、home/classroom备份和失败回滚的更新通路。每次重启前后sf_records哈希一致。旧20张卡、2份资料和原学习事实逐记录核验保留。

卸载退役9个旧插件：函数实验台、论证工作台、老师黑板、错解诊所、几何作图台、史料侦探局、时空地图、多智能体研讨室、情境模拟器。正式安装集合只保留教室与数学工作台；旧插件快照及已有成果未清除。旧示例源码作为回归样本保留，不列为当前推荐产品。验收中临时安装的教室作品也已卸载，创作草稿仍保留。

旧默认背景清为空文档，覆盖历史包中未保存的默认城邦种子；未清除自定义学习事实。关键临时证据在dsh/.runtime/classroom-real-model-result.json、classroom-retirement.json、notara-unify-deploy.json（不提交运行态或凭据）。

## 未验收与下一入口

在线市场/URL自动导入、任意自定义hook、多人长课质量与高并发压力未实现或未验收。真实模型的课堂子任务教学质量尚需日常试用；本轮实模只证明创作者读写闭环。继续从创作者的教室作品选择模板，编辑、安装，再在新课堂启用和点名。
