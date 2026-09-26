# Native Vault 极简主题润色（0.16.15）

日期：2026-09-24。工作树：`/Users/yangrundong/DSH`，分支 `design/minimal-polish`，基线 `b132d15`。插件版本 0.16.14 → 0.16.15；未提交、未合并、未更新真实用户实例。证据目录 `docs/evidence/minimal-polish/`。

## 目标

先以注入样式层（demo.css）给用户看润色效果，用户认可后把同一视觉正式写进主题源码。方向仍是白底浅灰，不改布局、功能与文案；范围只限 `examples/native-vault`，不动原生包、`node_modules` 与 `scripts/patch-*.ts`。

## 实际改动与锚点

- **设计 token**：`modern-theme.js / pairs` 调整 interactive hover/hover-solid/active 与 button-info fill/hover 的明暗色对，新增 `--dsw-specific-bubble` 与 `--dsw-specific-bubble-highlight`（用户气泡由淡蓝改中性灰，深色 `#252b34`）；`overrideTokens` 写入 body 内联样式，CSS 不再用 `!important` 覆盖。
- **尺度变量**：`modern-theme.css` 顶部 `body[data-notara-ui=modern]` 定义 `--nv-r-sm/md/lg/xl`（8/10/14/20）、`--nv-shadow-sm/md/lg` 与 `--nv-shadow` 别名、`--nv-thumb`、`--nv-focus`；深色值在 `body[data-notara-ui=modern][data-ds-dark-theme]`。各组件字面量圆角替换为尺度变量。
- **侧栏**：`.pI_x6G_sidebarCol` 的 border-right 改透明（原生布局列边框，非 resize 手柄），浮动 `.nv-sidebar` 自身保留唯一边界；导航/课堂行 36px、`border-radius:var(--nv-r-md)`、`nav` 行距 2px；`.nv-new-lesson` 用 button-info 色对；`.nv-brand-mark`/`.nv-directory-button` 归尺度；`.nv-shell-heading` 收紧到 64px。
- **分段控件**：`modern-theme.css` 一条共享规则覆盖 `.nv-shell-tabs`/`.nv-route-views`/`.nv-class-views`（`body[...]` 前缀用于胜过晚注入的 `.nv-workspace-tabs` 模块样式）；删除 `routes-client.js / ROUTE_CSS` 中旧的 `.nv-route-views` 皮肤与 `.nv-class-views button` 旧规则；`board-client.css / .nb-tabs` 直接改为槽 13px、项 28px/10px。
- **表单字段**：`modern-theme.css` 对 `.nv-workspace/.nv-dialog/.nv-sidebar` 内的 select/text-input/textarea 统一 32px 高、md 圆角、layer-1 底、l1 边、focus 时 l4 边 + `--nv-focus` 光晕，排除 `.cm-editor`、`[data-composer-card]`、`.nb-board`；select 用 SVG chevron 背景图；对话框内 36px；checkbox `accent-color` 用 label-primary。`client-source.ts / STYLE` 的 `search`/`templateInput`/`assetPage` 对齐同一边框与 10px 圆角，`templateInput` 改用 `backgroundColor` 长属性使 chevron 不被 inline `background` 清掉。
- **按钮与链接**：新增 `.nv-quiet`（info 底、md 圆角、32px、disabled 半透明）与 `.nv-link`（默认无下划线、悬停下划线）两个类，全部 `STYLE.quiet` 调用点改挂 `nv-quiet`，`STYLE.quiet` 从 `STYLE` 删除；`STYLE.link` 只留 inline reset，下划线使用点加 `nv-link`（卡片标题等自带 `textDecoration:'none'` 的保持原样并显式给链接色）；`.nv-directory-actions` 按钮同样挂 `nv-quiet`；`.nv-menu .nv-quiet` 在 `modern-theme.css` 中回退为菜单行外观（透明底、左对齐、悬停 interactive-bg-hover）；工作区/侧栏按钮统一 `:focus-visible` 描边。锚点：`views-client.js / btn`、`calendar-client.js / button`、`routes-client.js / btn`、`shell-client.js`、`classroom-client.js`、`file-actions-client.js`、`teaching-client.js`、`assets-client.js`、`pdf-annotations-client.js`、`client-source.ts`。
- **卡片与筛选**：`views-client.js / CSS` 的 `.nv-card-source` 改 flex 换行；`.nv-card`/`.nv-worker-card` 走 `--nv-card-radius`（lg），`.nv-card` padding 18px，`.nv-card-kind` 6px；`.nv-card-filters` 筹码 28px/md/12px，选中用 button-info-fill；`views-client.js / Frame` 增加 `flush` 标志，卡片页工具行 `.nv-view-top-flush` 去掉与筛选行之间的分隔线（保留筛选行下沿一条）。
- **复习页**：`calendar-client.js` 的 `.nv-review-filters` 去掉与搜索行之间的分隔线，`.nv-review-search` 收紧上间距；`.nv-review-row` 选中态 md 圆角；`.nv-calendar-modes` 按钮 md 圆角。
- **菜单与对话框**：`.nv-menu`/`.nv-popover-panel` lg 圆角、6px padding、l1 边、中档阴影，菜单项 sm 圆角、32px；`.nv-dialog>section` xl 圆角、大阴影；`VOzbGW_panel`/`VOzbGW_navCell` 归尺度。
- **首页输入框**：`today-entry.css` 中 `.nv-home .wSkVaW_root` 背景改透明，去掉深色模式下圆角输入卡背后的深色矩形；hero 输入卡 `data-phase=hero [data-composer-card]` 用 `--nv-input-radius`（xl）；`.nv-home-schedule` 的输入/按钮用 `--nv-r-md`；欢迎标题字距 −.01em、`time` 等宽数字；`.nv-home-controls`/`.nv-home-task` 等半径归尺度。
- **其他**：`.nv-board-tool-row` 颜色改 `--dsw-alias-label-caption`；工作区标题字距 −.005em；`.nv-session-row time`/`.nv-review-row`/`.nv-month-day` 用等宽数字。
- **版本**：`examples/native-vault/package.json` 0.16.15；`AGENTS.md` 当前事实行同步版本号。`client.js` 为重新构建的分发产物。

## 验证

| 层级 | 结果 | 命令与证据 |
| --- | --- | --- |
| 构建 | PASS | `npm run build:native-vault`，最终 client.js 5,593,384 bytes；`docs/evidence/minimal-polish/after/build.log` |
| 单元 | PASS，288/288 | `node --test examples/native-vault/*.test.js`；`after/unit.log` |
| 类型检查 | PASS | `npm run typecheck`；`after/typecheck.log` |
| e2e `tests/e2e/native-vault-review.spec.ts` | FAIL，既有问题 | `npm run test:e2e -- tests/e2e/native-vault-review.spec.ts`；`after/e2e.log`。用例按文本 "Notara Vault" 点击时命中侧栏目录按钮并打开「选择学习目录」弹窗，`.nv-dialog` 遮罩拦截随后的发送按钮点击；在未修改的基线构建（stash 验证，client.js 5,589,109 bytes）上以同样方式复现，与本次改动无关 |
| 浏览器计算样式断言 | PASS，25/25 | `node docs/evidence/minimal-polish/checks.mjs docs/evidence/minimal-polish/after`；`after/checks.json`。覆盖侧栏分割线透明、侧栏 20px 圆角、分段选中白底+投影、卡片 14px、select chevron、链接悬停下划线、筛选筹码 12px、菜单项透明底/左对齐、用户气泡 `#f3f4f6`、深色 `--nv-thumb`/首页输入框透明底、`data-ds-dark-theme` 等 |
| 截图对照 | PASS（上一轮构建） | `docs/evidence/minimal-polish/{before,demo,after}/*.png` 与 `compare.html`。after/*.png 摄于最终修饰轮（删注释、筹码 12px、schedule 半径、菜单行）之前的构建，用户明确放弃重摄；最终构建由 checks.json 覆盖。after↔demo 像素差 0.07–2.65%，与 before↔after、before↔demo 的差幅一致，为会话行时间/图谱布局等动态噪声 |
| 控制台 | PASS | `after/console.json`：errors/pageerrors 均为 0，`darkApplied:true` |
| 真实模型/真实学生体验 | 未运行 | 本轮使用合成 fixtures 与 Vault 测试模型，不做教学质量结论 |

## 运行环境

- 隔离实例：`http://127.0.0.1:60185/`（令牌只在 `.runtime/modern-preview.json`，不入证据）；数据根 `/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-JB5P76`。
- 启动入口 `.runtime/minimal-polish-launch.ts`（`startVaultIsolated({testModel:true})`），nohup 后台常驻；样例由 `scripts/fixtures/vault-modern-samples.mjs` 写入隔离根。
- 本轮前两个同方式实例（50795、61381）已停止并经 `lsof` 确认端口释放；其他 checkout/共享服务未触碰。

## 未完成与下一入口

- 全部改动未提交、未合并，等用户确认润色稿后由用户定稿。
- `tests/e2e/native-vault-review.spec.ts` 的既有失败待另行修复（点击目标应改成目录选择器内的目录项或消歧后的元素，而非首条 "Notara Vault" 文本）。
- 桌面真实浏览器逐页人工复核建议按 `compare.html` 进行；`.runtime/` 下的探针脚本与 diff 遮罩为临时工具，不进提交。
