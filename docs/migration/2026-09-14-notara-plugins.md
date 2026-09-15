# Notara 插件系统第一版实施计划

> 按用户要求使用 executing-plans 在当前线程实施；子智能体只读侦查，不代写代码。

**Goal:** 外部独立安装插件、实际使用技能与工作台、保存笔记、完整停用卸载并保留成果。

**Architecture:** DSH/pnpm 解析独立快照，Cordis Loader 负责原生加载；产品层持有安装记录、能力登记与学生界面。技能使用原生 provider，HTML 通过窄消息桥提请保存到现有卡片库。

**Tech Stack:** Node v24.13.0、DSH 0.1.5-rc.2、Cordis 4.0.2、TypeScript 6.0.3、React、Zod、原有 Vitest/浏览器验证。

## 全局约束

- 唯一实现目录 仓库根目录；保留其他线程脏文档，主 Agent 统一提交。
- 不升级依赖，不碰 B/旧仓/4877/共享测试数据库；测试临时根使用 .runtime 或既有隔离脚本。
- 未知能力拒绝；世界书、动态课堂、新增帮手执行与在线市场后续另做。
- 文案和两主题遵循 `docs/ui/themes.md`；保存笔记须确认，身份/时间/操作号由宿主绑定。
- 规范：`docs/migration/2026-09-14-notara-plugins-design.md`。

## 1. 包合同与安装生命周期

文件：新建 `packages/contracts/src/plugins.ts`、`packages/host/src/plugins/{package-source,plugin-manager,native-loader}.ts`、`packages/host/src/plugins-service.ts`；接入 `packages/host/src/index.ts`。

接口：`prepare(source)` 返回固定 candidate；`installPackage(candidateId, expectedVersion, trustNative)` 提交；`list()` 返回安装及运行态；`setEnabled(ref, expectedVersion, enabled)`、`uninstallPackage(ref, expectedVersion)` 串行执行。每个版本保留包名、版本、digest、快照、贡献与来源。

- [x] 写 `tests/integration/plugins-install.test.ts`：先通过真实 Remote 验证当前没有安装接口的失败。
- [x] 实现本地目录/压缩包准备、pnpm 独立 profile、manifest 校验、不可变快照、幂等与版本冲突。
- [x] 实现串行启停、原生 Loader 状态、重启恢复与失败升级保留旧版。
- [x] `npm run build`；`npm run test:integration -- tests/integration/plugins-install.test.ts`。

## 2. 技能、教法与作品共用安装

文件：`teaching/task-skills.ts`、`teaching/teaching-context.ts`、`teaching/subject-context.ts`、`creation/artifact-service.ts`、`creation-service.ts`。

接口：安装登记提供 active contributions 和按固定版本读正文；provider 的 `SkillProviderControl.invalidate()` 在安装/启停/卸载后调用。正文仅按需加载。

- [x] 外部技能加入既有 provider 与任务候选；移出示例对应的内置出题技能。
- [x] 外部教学/科目使用固定版本引用；既有课堂读取旧版本。
- [x] 创作者非 Markdown 作品生成标准包走同一安装；原引用和讲义发布保留。
- [x] 检验安装后原生 slash 注入、停用后缓存刷新、草稿过期提示、旧课堂版本。

## 3. 插件管理页与可登记工作台

文件：新建 `packages/client/src/plugins/`；修改 `client/index.tsx`、`shell/NotebookSidebar.tsx`、`theme/notebook.tsx`、`classroom/{workspace-layout,LearningWorkspace}`。

接口：管理页消费 Plugins Remote；工作台以登记 id 加入可见集合，布局存储继续只表示界面，不写课堂事实。

- [x] 管理页完成包选择/开发目录、安装预览、启停更新卸载与如实状态。
- [x] 通过统一刷新事件更新加号、slash、教法和工作台入口。
- [x] 工作台支持已登记视图、关闭恢复/拖拽/多栏、失效视图裁剪与重启布局恢复。

## 4. 窄消息桥与示例包

文件：`plugins/PluginWorkbench.tsx`、示例 `examples/plugins/study-kit/`；保存使用既有 CardService。

- [x] HTML nonce/contentWindow 校验、主题发送、权限与严格消息合同。
- [x] 原生确认区显示完整笔记，可编辑/取消；确认保存幂等、课堂绑定正确，保存不记掌握。
- [x] 示例提供“出一组题”技能与“学习复盘”工作台，附独立安装说明与 SDK 用法。

## 5. 完整验收与交付

- [x] 单元：非法包/路径、未知能力、插件布局与基础视图保持。
- [x] 集成：真实 pnpm 安装、重复/冲突、失败升级、原生加载失败、技能注入、重启/停用/卸载、旧版本保留。
- [x] 浏览器：现代/手帐管理页、安装→加号与slash→工作台→确认笔记→停用→卸载→资料仍可查看，窄屏与主题。
- [x] 执行 `npm run build`、`npm run typecheck:tests`、对应 unit/integration；既有 creation、task-skills、workspace 用例按影响回归。
- [x] 通过后受控更新58354并实页验证；写 dev-log、更新 CLAUDE 的对应状态并提交本轮变更。

验收结果与限制见 `docs/migration/2026-09-14-Notara-plugins-v1.md`。浏览器验证使用真实 IAB；没有将测试适配器等同真实模型教学质量。斜杠来源去重接缝与历史技能标题投影是在实页验证发现问题后补入的必要修复。
