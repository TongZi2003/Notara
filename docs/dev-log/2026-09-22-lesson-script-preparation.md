# 课堂剧本、渐进备课与资料树

## 目标与范围

用户授权先核对现状差距再实现。在 `/Users/yangrundong/.codex/worktrees/notara-vault-clean/DSH` 的 `codex/notara-vault-clean` 实施 Native Vault 0.10.0，保留此前所有未提交内容，不提交或合并。沿用用户暂停验收的决定，只做源码审阅、语法/资源检查与构建。

设计与差距表：[课堂剧本与备课资料结构](../migration/2026-09-22-lesson-script-preparation.md)。可复用的是原生课堂、剧本绑定、路线、同文档追加小结、lesson_log 与后台解题者；本轮补的是正文结构、渲染、渐进读取、备课规范和可复用资料层级。

## 实际改动与锚点

- `lesson-script.js` 的 `teacherBlocks` / `lessonScriptIndex`：编辑器和模型目录共用纯解析；独占一行的 details、排除 YAML/围栏/教师标题、排除文末课堂日志；程序生成 section key。未闭合教师块保持折叠并报告格式问题。
- `lessonOutline` / `readLessonStage`：不含答案的分页目录，revision 约束的单阶段正文及 Unicode 分页。`bodyRead: false` 表示正文没有提供给模型，生成目录仍需在 Host 读取文件。
- `teaching-runtime.js` 的 `scriptSnapshot` / `system-prompt/assemble`，`teaching-state.js` 的 `scriptSnapshotValue`：绑定只保留出处，旧截断正文不再投影到设置和本轮背景。当前目录从真实文件重建；跨学习集保持原绑定范围，不替换成当前集同名文件。
- `vault-cli.js` 的 `lesson-outline` / `lesson-section`：继续通过原生批准后的 Bash 调用，无新增专用模型工具；Host 的 `DSH_NOTARA_LESSON` 提供绑定范围/版本，已绑定剧本变更后要求核对重绑。
- `live-preview.js` 的 `teacherPanels` / `TeacherDetailsWidget` / `TeacherEditingWidget`：按编辑器和位置保存折叠/编辑状态；默认折叠，展开用只读嵌套 CodeMirror，编辑回到同一源码。重复块相互独立，正文变动映射位置，折叠区域提供 atomic ranges；只读预览禁止任务勾选、避免公式翻回源码。析构释放嵌套编辑器和 PDF 任务。未执行的 HTML 保持文本。
- `resources/vault-teaching/`：补充备课流程、动态备课说明、语义资料整理、数学/理科建模/人文语言 Skill；常驻正文只保留入口。数学补探索与证明、模式特征、边界与迁移，固定 Skill 不根据一次自评自动升级。
- `solver-runtime.js` 的 `SOLVER_TASKS` / `NotaraSolver.ask`：一个枚举驱动 schema 和校验，solve/plan/draft/review 使用同一个高级模型零工具助手；主教师显式交接必要材料、核对并保存，无新增角色按钮。模式保存在原生扩展事件和子会话输入，默认教室界面仍仅显示任务状态。
- `graph.js` 的 `buildVaultGraph` / `childMaterialsOf`：source 原书层级、topic 教师专题；原书层级只来自 PDF/source，专题引用不冒充原书章节；显式 parent 避免 PDF 把章节层级铺平。子资料和子卡片分开列出，资料节点无复习生命周期。
- `media.js` / `vault-cli.js#pdfPage`：整页与区域引用都保留 revision；PDF 辅助命令返回真实 locator 与 embed。无效坐标不降成整页，图谱与编辑器明确提示；资产页直接打开无效位置时提示用户核对原文件。
- 模板：更新 `lesson.md`，新增 `lesson-script.md`，完善 `source.md`，新增 `topic.md`。`seedTemplates` 仍不覆盖用户同名文件；新增课堂剧本模板可进入已有 Vault。
- `package.json` 升至 0.10.0，并把共享解析模块加入发布清单；`client.js` 和教学资源通过既有构建生成。

## 检查结果

- PASS（构建）：`PATH=/Users/yangrundong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run build:native-vault`，客户端 **5,416,925 bytes**，rc.2 ignorable 接缝检查成功。
- PASS（语法）：17 个相关 JS 源码/测试文件运行 `node --check`，包含解析、运行时、CLI、图谱和编辑器。
- PASS（资源）：manifest 14 个教法/Skill 条目无重复 ID、引用文件存在、打包正文与源资源逐项一致，发布清单包含 `lesson-script.js`。
- PASS（格式）：`git diff --check`。
- 已准备但未执行：阶段读取/版本/分页/教师标题隔离用例，重复教师块状态映射用例，跨页资料树与卡片计数用例；更新旧快照与 CLI 清单相关断言。
- 未运行：unit/integration/e2e、真实浏览器、真实模型及学生体验。不能据此声明折叠交互、跨集命令、资料跳转或真实备课质量已验收。

## 运行边界与下一入口

未启动或重启服务，未修改正在使用的安装快照、导入文件或未发送草稿。已有课堂固定旧插件版本；当前打开的页面不代表本轮新代码。

下一次恢复验收时先安装/启动新版本，优先检查：同一剧本折叠/展开/编辑与公式、文件变化后的阶段版本拦截、跨集同名剧本、PDF 多页单元来源与图谱子资料列表；随后以真实模型备课检查材料准确性、教学主线和实际 token 使用。测试先于教学效果结论。
