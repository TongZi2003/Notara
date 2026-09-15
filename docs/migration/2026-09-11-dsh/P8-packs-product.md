# P8：Creator、版本包与课堂表现 Implementation Plan

> **For agentic workers:** 使用superpowers:executing-plans；G7 PASS后执行六项，交G8。Creator不是可选旧草稿，是B已实施功能，必须承接其合同和未解决体验场景。

**Goal:** 保留制作、共同改稿、真实预览、安装与课堂图示/模具能力，能力装卸不伤学生事实。
**Architecture:** DSH插件提供代码能力；Host按持久purpose/grants隔离Creator，包内容与运行注册分离；课堂图示不自动成为学习事实。
**Tech Stack:** TS、DSH plugin API、受限预览/VM、Playwright、显式版本数据。
## 全局约束
B/bin/{execution_profile,creation_authoring,creation_preview,creation_tools,pack_registry,visual_schema,visual_molds}.py为来源。runtime统一TS，学生作品仍可含HTML/CSS/SVG/JS等内容。禁止用宽泛iframe或任意shell替换已有安全边界。

## P8.1：不可变包、预设绑定和能力生命周期
**文件：** packages/contracts/src/packages.ts；packages/domain/src/packages/package-service.ts；packages/host/src/packages/capability-manager.ts；packages/client/src/packages/PackageLibrary.tsx；tests/integration/package-binding.test.ts。
**输入：** P1用途/包digest、DSH插件生命周期、材料/知识/组织服务；**输出：** inspect/prepare/install/enable/disable/uninstall，精确版本绑定。
- [ ] 默认学习主目录只发布五个预设（UI-FIRST-RELEASE.md），不打包恢复旧全模式主菜单；搜索作为主入口及委派能力共用同一搜索资源/服务。自制预设版本仍可明确安装绑定，Creator留制作入口。
- [ ] 公共资源与预设来自不可变安装版本，绑定课保存所用版本；包更新不追溯替换已开课，学生显式切换另留binding revision。
- [ ] 新包manifest分别列内容与DSH能力依赖，局部别名由Host解析为新ID；不读取旧包账或搬旧哈希格式。
- [ ] 全量预检路径/引用/冲突后事务发布；书/卡/计划贡献归属明确，移除一个包不能误删另一计划块。
- [ ] 插件停用/卸载撤销注册和导航入口，保留学习事实/学生派生卡/已绑定历史版本；删除内容是单独学生动作。
- [ ] 测版本A课→安装B→旧课仍A/新课B，禁用/重启/卸载、部分安装失败恢复、学生已学卡/学情/知识仍在。
- [ ] 运行 npm run test:integration -- tests/integration/package-binding.test.ts、access/confirmation回归/typecheck；提交。

## P8.2：Creator原生对话与按文件共同编辑
**文件：** packages/domain/src/creation/draft-service.ts；现有Host composition/tool-fs接线与实际需要的作品工具；packages/client/src/creation/{Workbench,DraftEditor}.tsx；tests/integration/draft-version.test.ts；tests/e2e/coauthor-creator.spec.ts。
**输入：** creation purpose/grants、独立native session、包版本；**输出：** 作品浏览和按文件版本的读写；check/preview/install在P8.3使用整作品快照。
- [ ] 从工作台明确创建Creator对话，绑定一个draft和所选reference；学习与制作入口分开，不默认给学情/全库/学习写工具。
- [ ] 人和模型编辑同一作品；原生tool-fs/fs-observation-policy负责read-before-edit和同文件stale guard。普通修改只比较所改文件及真正读取的依赖版本，A文件无关修改不让B基线过期；不对每次编辑inventory全树或强制全workspace digest。
- [ ] 陈旧写入保留人类草稿，重读合并；坏/缺manifest也有稳定可编辑版本，能由人修复。
- [ ] 核验P1.5原生文件接线能否落实作品和已授予reference范围；原生fs-sandbox读取不受限，不能直接裸开放。实际部署需要的越界/软链/写目标检查保留；不以未纳入威胁模型的同机恶意进程假设、未知Node原语缺口将整个平台先判不可用。
- [ ] 测“人建→Creator续写→人改→冲突→合并”，无学习写权限、越界read/write、同文件版本及实际依赖一致、切课迟到不串draft。
- [ ] 运行 npm run test:integration -- tests/integration/draft-version.test.ts、npm run test:e2e -- tests/e2e/coauthor-creator.spec.ts、typecheck；提交。

## P8.3：独立制作/审读、真实预览与安装票据
**文件：** packages/domain/src/creation/preview-service.ts；packages/host/src/creation/preview-runner.ts；制作/审读复用P7原生委派接线；resources/creator/；tests/integration/creator-preview.test.ts；tests/live/creator-natural.test.ts；tests/e2e/creator-install.spec.ts。
**参考：** B/bin/creation_preview.py、creation_authoring.py；dev/tests/creation-preview-report.sh、topic-authoring-transaction-c05.sh。
**输入：** 验收时冻结的整作品snapshot/digest、授权reference、实际renderer/安装器；**输出：** draft_author/review/preview、真实preview report与同版本install ticket。
- [ ] author/review按任务需要调用原生subagents，不为每次小修改固定两模型流水线；任务输入只收目标/所需材料/当前作品，不复制父课档案。编辑阶段按文件版本，只有check/preview/install冻结整作品版本。
- [ ] preview实际执行产物并观察DOM/控制台/交互/截图；test case与规则来自真实用途，不由被测产物自己声称PASS。
- [ ] check、preview、install都绑定同一digest；任意文件变更使旧报告/票据过期，不能用旧成功装新代码。
- [ ] 错误给具体字段/合法下一步，保留用户原对象，禁止通过换产物类型/删要求取得成功。是否继续修复由Skill根据新证据/可修复性决定，不规定两次升级或固定重试次数；保留失败原因，重复无进展时给出具体缺口。
- [ ] 真实自然请求制作一个现有支持类型的互动/预设，学生手动改稿→模型续改→预览→安装→课堂使用。B的Creator多次失败作为回归，不预称已解决。
- [ ] 运行 npm run test:integration -- tests/integration/creator-preview.test.ts、npm run test:e2e -- tests/e2e/creator-install.spec.ts、npm run test:live -- tests/live/creator-natural.test.ts、typecheck；提交原始失败和恢复。

## P8.4：课堂图示、受限交互与模具
**文件：** packages/domain/src/visuals/{visual-service,mold-service}.ts；packages/host/src/visuals/visual-policy.ts；packages/client/src/visuals/{VisualFrame,VisualMold}.tsx及VM适配；tests/integration/visual-policy.test.ts；tests/e2e/visual-mold.spec.ts。
**输入：** B当前inert文档语义、native消息、主题变量；**输出：** 安全课堂图示和学生明确保存的可复用模具。
- [ ] 模型HTML先解析为受控文档，脚本在无网络/文件能力VM执行，初始节点和后续DOM操作共用白名单；不直接innerHTML执行原始模型代码。
- [ ] 支持当前SVG/轻量表单交互；限制URL/eval/计时器/外链，错误可修。图示学科含义颜色保留，纸面/字体变化不重置操作。
- [ ] 图示用于讲解探索，不自动回传轨迹、记复习或改学情。明确提交的widget与探索图示分开。
- [ ] 学生选择保存模具后才产生可复用对象；模具引用/参数/版本检验，换参和preview不是学习证据。
- [ ] 测数学SVG属性、slider实际变化、XSS/外链/VM越权、主题切换、刷新回放、存模具再用和内容改稿。
- [ ] 运行 npm run test:integration -- tests/integration/visual-policy.test.ts、npm run test:e2e -- tests/e2e/visual-mold.spec.ts、typecheck/build；提交。

## P8.5：互动件、讲义与学生提交
**文件：** packages/contracts/src/widgets.ts；packages/client/src/widgets/{WidgetFrame,HandoutRenderer}.tsx；packages/host/src/widgets/submission-service.ts；resources/widget-sdk/；tests/integration/widget-submission.test.ts；tests/e2e/handout-widget-v2.spec.ts。
**输入：** 包/实际DSH客户端注册、来源/普通卡、send/receipt；**输出：** ready/resize/theme/preview/submit桥和六类讲义容器。
- [ ] widget的session/instance/token/来源/shape校验；学生先看将回传的摘要与轨迹再提交，工具结果不冒充逐字学生原话。
- [ ] 已提交历史只读，未完成互动可继续答；回到原课/对象，不能发到当前另一个课；重复提交幂等，关闭iframe旧消息拒绝。
- [ ] 母题/边界/骨架/方法/自测/诊断容器保留，隐藏答案/整栏原文锚稳定；可检验栏目配普通未学卡，对照物不生成复习。
- [ ] 课堂已产出内容进入P2真实投影，模型围栏/声明仅为呈现意图，不直接变事实。
- [ ] 测正常/伪造/迟到/重试、主题/resize、隐藏解/原文/卡、刷新后继续，使用合成现有范式。
- [ ] 运行 npm run test:integration -- tests/integration/widget-submission.test.ts、npm run test:e2e -- tests/e2e/handout-widget-v2.spec.ts、typecheck；提交。

## P8.6：当前纸面设置、公开导出与新数据恢复
**文件：** packages/domain/src/{history/data-history.ts,export/export-service.ts}；packages/host/src/history/git-adapter.ts；packages/client/src/settings/SettingsScreen.tsx及实际需要的历史/导出弹层（不强制各成一级页面）；tests/integration/export-history-v2.test.ts；tests/e2e/notebook-settings.spec.ts。
**输入：** 最新笔记本主题、原生历史/学习事实、事务；**输出：** 设置/公开投影/版本健康与显式恢复。
- [ ] 按UI-FIRST-RELEASE.md保留纸面/字迹/三色笔、数学复制与P5.7红笔修订，界面层级/常驻操作精简；不得以“保留主题”为由还原旧繁复布局。改动视觉不表示掌握。模型/effort、token与调试开关复用P2入口；DSH认证设置原生处理，不自存密钥。日报定时设置复用P6.5入口，不另建全局timer或日报Agent。
- [ ] 公开导出与课堂私有回看/显式Raw JSON调试分开；公开投影不含内部prompt/tool/身份/路径/未公开答案，调试开关不放宽导出。卡片当前正文不含删除线历史；复制差异是独立动作，富文本转义与来源可读性保持。
- [ ] 新数据自动版本记录只提交白名单学习事实，DSH auth排除；用execFile参数数组，标题不是shell。事务成功与Git版本失败分开，保留补账状态。
- [ ] 撤回/恢复需明确影响预览，通过领域一致性校验生成新revision；不git reset硬抹历史，不恢复被明确删除的关联对象造成悬挂。
- [ ] 测主题切换不重置图示、复制数学、公开隐藏内容、Git失败补账、并发恢复/来源依赖、文件坏状态。
- [ ] 运行 npm run test:integration -- tests/integration/export-history-v2.test.ts、npm run test:e2e -- tests/e2e/notebook-settings.spec.ts、P8回归/typecheck/build；交G8。
**G8：** Creator真实闭环、用途隔离、同版本预览安装、图示/模具/互动、事实保留和当前产品呈现全部有证据。
