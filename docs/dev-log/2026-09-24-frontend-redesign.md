# Notara 前端重设计：设计稿与原型

## 目标与工作树

用户要求基于 vault-clean（`native-vault-v0.14.9`）的实现设计新前端，本轮交付设计文档和可交互原型，不改运行代码。视觉先做现代简约，再补一份手写手帐样例。用户确认的问题有四个：开发工具感重、8 个分页太散、缺少首页 / 今日视图、视觉不够好看。

- 工作树：`/Users/yangrundong/DSH-frontend-design`
- 分支：`design/notara-frontend`，从标签 `native-vault-v0.14.9`（`5a5886f`，等于远端 `codex/notara-vault-clean`）新建
- 没有动主仓 `main`（它与该标签已分叉），也没有动 codex 的 vault-clean worktree

## 实际改动与锚点

- `docs/ui/notara-frontend-redesign.md`：设计文档，覆盖以下内容：
  - 现状与问题
  - 信息架构：侧栏为今日 / 资料库 / 计划 / 课堂；列出原 8 个分页的去向
  - 各页面的模块与数据来源
  - 两套视觉令牌、字阶与装饰规则
  - 入口与现有 Remote 方法的对照表
  - DSH 接缝与仓库先例
  - 分期与验收口径
- `docs/ui/notara-frontend-prototype.html`：单文件原型，数据全部合成，不依赖外部资源。
  - 交互统一通过事件委托（`data-act`）绑定，路由为 `#/today`、`#/library/*`、`#/plan/*`、`#/lesson/*`。
  - 手帐主题只在 `data-sf-style=notebook` 下生效，入口为 `?style=notebook` 或设置里的「界面主题」。
  - 右下角「原型」面板提供示例数据 / 空白学习空间、主题、深浅色、调试模式等开关，只属于原型。
- `docs/evidence/frontend-redesign/`：
  - `verify-prototype.mjs`：浏览器验收脚本。
  - `verification.json`：本次运行结果。
  - 28 张截图：两套主题各 14 张，现代主题额外包含空态和空课堂。

## 设计依据（已在源码核实）

- 今日页的每个模块都能用现有接口组装：
  - `notaraVault` 的 `reviewQueue`、`calendar`、`routes`、`lessonLog`、`dailyNote`。
  - 原生 `sessions.list`。
- 不带 sessionId 时，`teaching-runtime.js` 的 `editorFor` 会回落到启动工作区。因此全局页在单 Vault 安装下可以直接读取。
- 可复用的接缝都在仓库里有先例：
  - `sidebar.content`：`scripts/patch-sidebar.ts`，用法见 `packages/client/src/shell/NotebookSidebar.tsx`。
  - `main` + `sidebar.panellist`：`packages/client/src/shell/register-slots.tsx`。
  - `conversation.chat.node` 是 keyed 槽，rc.2 `dsh-client-ui-chat` 中有 `system-prompt` / `context` 两个 key，可以按 `ask_worker` 遮蔽 `tool.call.toolview` 的方式处理。
- `conversation.hero.workspace` 只是工作区选择弹层，不是内容区，所以今日页不放进 hero，改用独立的 `main` 页面。
- 权限选择器的中文标签是「仅可查看 / 工作区内修改 / 完全权限」（见 `dsh-client-ui-permission-presets` README）。

## 验证

证据类型为真实浏览器（Chromium，Playwright 1.63.0，headless），对象是原型本身。

- **PASS**：`node docs/evidence/frontend-redesign/verify-prototype.mjs http://127.0.0.1:58945`，结果 143/143，控制台错误、页面异常、失败请求均为 0。
  - 服务：worktree 根目录上的 `python3 -m http.server 0 --bind 127.0.0.1`，实际监听 58945 端口，已用 `lsof` 核实归属。它只是一个静态文件服务，保留给用户预览；这个端口不属于任何 DSH 实例。
  - 该 worktree 没有 `node_modules`，所以用 `PLAYWRIGHT_FROM=/Users/yangrundong/DSH/package.json` 从主仓解析 Playwright；两个 checkout 锁定的是同一版本 1.63.0。
  - 覆盖范围：
    - 两套主题各自走一遍今日 → 课堂 → 资料库 → 计划的全流程。
    - 字体：手帐加载了 WenKai；现代主题不下载它。
    - 课堂：发送消息、指令菜单与更多技能、教学设置、教室、伴随面板切换与拖动调宽。
    - 资料库：卡片的类型 / 标签 / 复习状态筛选；图谱节点、详情与悬停高亮；带入当前课堂。
    - 计划：路线抽屉、日历、复习的自评保存与撤销。
    - 其他：深色、调试模式、主题切换；今日输入框直接开课；空白学习空间下各页空态。
    - 尺寸：1024 与 900 宽度无横向溢出；390 宽度下侧栏抽屉、伴随面板覆盖层、输入框边界与发送按钮命中测试。
- **PASS**：`node --check` 检查原型内联脚本。
- **未运行**：typecheck、build、unit / integration / e2e、真实模型。本轮没有产品代码改动；原型的通过不代表产品实现已经验收。

## 验收中修正的问题

- 图谱节点只有圆点和文字能点中，两者之间的空隙点不中。已给每个节点加覆盖圆点与标签的透明命中区，设计文档同步写入这一要求。
- 手帐字号变大后，侧栏课堂行在隐式 grid 列里撑出容器，日期被裁掉。已给 `.side-lessons`、`.rows`、`.link-list`、`.stack` 显式设置 `minmax(0,1fr)` 列，并补了对应断言。
- `.graph-canvas svg` 选择器误伤了图例里的小图标。已收窄为 `.graph-canvas>svg`。
- 公式里的 Unicode 下标在衬线斜体下会回退到其他字体，间距不齐。已统一换成 `<sub>`。
- 验收脚本的一处断言写错了：侧栏「资料库」会回到上次停留的子视图，这是预期行为。已改为先断言保留子视图，再切到「文件」检查空态。

## 未完成与下一入口

- 设计文档 §7 中有四项需要在 rc.2 实现时核实：
  - `conversation.chat.node` 的 props 能否区分节点类型，隐藏后滚动锚点是否受影响。
  - 输入框里的权限选择器能否按槽位隐藏。
  - 有没有原生提交接口（决定今日输入框是否直接发送）。
  - 新课堂是否默认使用 `notara-teacher` 预设。
- Bash 步骤展开内容只在调试模式可见，这是相对 0.8.2 的行为变化，需要用户确认。
- 实现入口：按设计文档 §8 从 P1 外壳开始，改 `examples/native-vault`（提升插件版本），并在 `startVaultIsolated` 新实例上验收。
