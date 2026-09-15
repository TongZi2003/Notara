# Notara 插件系统第一版

## 目标与范围

落实用户确认的“DSH 包管理/Loader + 产品安装管理/扩展登记”。子 Agent 仅只读核查，全部文档、代码和测试由主 Agent inline 完成。分支 `codex/dsh-native-migration`，起点品牌提交 `b220b18`；保留根 CLAUDE 原有 9+/3− 与其他线程 2026-09-11 文档。

设计：`docs/migration/2026-09-14-notara-plugins-design.md`。
计划：`docs/migration/2026-09-14-notara-plugins.md`。

## 实际实现

| 范围 | 锚点与结果 |
|---|---|
| 标准包与快照 | `contracts/src/plugins.ts`、`host/src/plugins/package-source.ts`：npm name/version + notara apiVersion/能力；目录或 tgz；DSH plugin/pnpm 独立 profile，关闭安装脚本、路径/符号链接/大小校验、固定候选与资源摘要 |
| 生命周期 | `plugin-manager.ts`、`native-loader.ts`、`plugins-service.ts`：安装、启停、更新、卸载、真实状态、串行变更、重复提交、同版本异内容拒绝、失败更新回滚、重启恢复；原生变更遇运行中课堂延后至重启 |
| 已有作品 | `creation/package-publication.ts`、`artifact-service.ts`、`plugins/legacy-artifacts.ts`：技能/HTML/模式/教法经相同包安装；旧作品仍可管理、卸载/重装，固定历史引用保留；原文与讲义仍走资料发布 |
| 技能 | `teaching/task-skills.ts`：原生 provider 失效通知、外部模式/教法与版本引用；出题技能移出内置集合进入示例包；taskLabels 只供历史显示，不重新暴露已卸载技能 |
| 学生界面 | `client/src/plugins/PluginManager.tsx`：独立插件导航、安装预览、紧凑列表/详情、双主题、窄屏、权限与实际加载状态 |
| 工作台 | `workspace-layout.ts`、`LearningWorkspace.tsx`、`PluginWorkbench.tsx`：登记视图、独立拖拽/关闭/恢复、动态布局过滤、隔离 HTML、主题/手写字体、nonce + contentWindow 消息校验、完整笔记确认与 CardService 幂等保存 |
| 引用显示 | `materials/source-display.tsx`、`plugins/skill-labels.ts`、`classroom-trace-service.ts`：只把原生确认已加载的技能引用显示为标题；不改持久会话和模型请求 |
| 斜杠菜单 | `scripts/patch-input-source-filter.ts`：锁定 rc.2 原始摘要、可逆且幂等的原生 source roster 接缝；在 reducer/键盘选择之前过滤学习课堂的重复 native skill source，保留原生执行与其他会话行为 |
| 示例 | `examples/plugins/study-kit/`：“出一组题”技能 + “学习复盘”工作台；可独立 npm pack 或从开发目录安装；SDK 与主题 tokens 在 README 中 |

新增 Host 对现有锁定 dsh-app-boot 的依赖与 DSH peer 声明；lockfile 大部分差异为依赖从 dev-only 变为生产依赖。逐项比较 version/resolved/integrity，**版本与解析来源变化为零**。

## 验证证据

| 检查 | 结果 | 实际证据 |
|---|---|---|
| 编译与 Remote | PASS | `npm run build`；最后客户端变更另跑 `npm run build -- --client-only`；均退出0 |
| 测试类型 | PASS | `npm run typecheck:tests` |
| 单元 | PASS，6个不同用例 | `plugin-contract.test.ts`、`plugin-skill-labels.test.ts`、`workspace-layout.test.ts` |
| 真实 DSH 集成 | PASS，7个不同用例 | `plugins-install.test.ts` 1、`plugin-workbench.test.ts` 2、`plugin-legacy.test.ts` 1、`artifact-install.test.ts` 2、`task-skills.test.ts` 1；分批运行，变更后定向重跑 |
| 原生加载边界 | PASS | 信任确认、Loader 实际激活/卸载、失败升级恢复旧版、运行中课堂延迟停用、重启后生效、首次加载失败显示failed且可卸载 |
| 模型协议接线 | PASS，测试适配器 | 先预热原生技能缓存，再安装外部技能；slash 调用的真实请求含插件正文；非真实商业模型教学质量验证 |
| IAB 页面交互 | PASS | 目录安装、tgz 重装；＋与 / 同一技能；回车只插入草稿；工作台确认保存、关闭恢复、移动、独立布局刷新恢复；停用后技能/工作台消失；卸载后笔记全文仍能打开且关联原课堂 |
| 两主题/窄屏 | PASS | 实页现代1280布局、手帐工作台字体与原生确认区、802px手帐管理列表/详情；临时视口已恢复；截图在本轮工具记录 |
| 原58354 | PASS | 原数据原端口受控更新，页面有“插件”；1份原文、15张卡片保留；sf_records.json更新前后SHA256相同，见下 |
| 全量浏览器文件测试、跨平台、真实模型教学效果 | 未运行 | 本轮以真实IAB操作完成对应交互验证；不把模型适配器或类型检查当教学质量证据 |

学习记录前后 SHA256：`602983440b56f4801539942b5bc65735d7cb4fd93250b4c05f41d94fe47533e9`。

实际预览：`http://127.0.0.1:58354/#studyforge/plugins`。更新只针对已核验的本线程预览；原仓、B、4877与其他服务未操作。独立验证课堂与笔记不进入真实预览。

## 失败与修复记录

1. RED：新增真实接口用例最初报 `studyforgePlugins/prepare HTTP 404`。
2. 构建暴露 CSS 声明位置、ambient const enum 与 Remote 显式 exports 要求；按现有项目规则修复，没有放松编译器。
3. Native Loader 首次加载失败：缺少 clientModules/loader 的显式 inject；补齐后原生激活、失败更新回滚通过。
4. IAB 冷启动发现 `install` 与原生客户端服务保留方法冲突；改为 installPackage/uninstallPackage，之后真实浏览器完整流程通过。
5. 只读审查发现旧 target 作品卸载后 prepareCreate 撞旧记录；按真实记录存在与否选择更新/创建，重装清 removed，并增加 legacy 回归。
6. 用户消息与思维图出现内部技能编号：限定原生 skill-invocation 证据做显示投影；测试适配器的模拟回答会按其既有逻辑回显原始请求，未用显示过滤改变模型正文。
7. 实页发现 native /skill 与产品 / 候选重复；新增 roster 接缝而非隐藏菜单 DOM，原生菜单和键盘使用相同有效来源；重复应用补丁与实页回车选择通过。

## 首版限制与下一入口

- 在线市场、世界书、动态课堂、新增帮手执行合同未实现，未知贡献声明会被拒绝。
- 原生浏览器插件目前明确拒绝；自包含 HTML 工作台已支持。
- 主包/贡献资源摘要已验证，未做 pnpm 依赖文件逐字节防篡改。可信 Node 插件与 HTML 沙箱边界不同，安装前已明示。
- 原生代码变更需要重启时，安装器不自行重启应用。后续沿已实现的安装、能力登记和保存桥增加插件，不改核心学习事实生命周期。
