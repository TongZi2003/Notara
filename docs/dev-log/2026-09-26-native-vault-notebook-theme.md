# Native Vault 手帐主题（0.16.21）

日期：2026-09-26。工作树：`/Users/yangrundong/DSH`，分支 `design/minimal-polish`，基线 `f9d0003` 加未提交工作区（含 0.16.20 学习森林）。插件版本 0.16.20 → 0.16.21。未提交、未合并、未更新真实用户实例。

## 目标

用户要求把手帐主题同步到与黑白极简主题相同的完成度，确认采用设计原型的手帐（`docs/ui/notara-frontend-redesign.md` §5.4，`docs/ui/notara-frontend-prototype.html`），不采用旧工作台 `packages/client` 的四套字迹方案。此前 Native Vault 只有极简主题，没有任何手帐层。

用户确认的设计：
- 手帐是在极简布局之上叠加的外观层。
- 在「设置 → 学习界面」切换，默认极简。
- 霞鹜文楷按需加载。
- 覆盖全站界面。

中途在侧栏、首页、课堂三块完成后做过一次截图检查点，用户认可后再铺开到其余页面。

## 实际改动与锚点

- `examples/native-vault/theme-tokens.js`（新）：
  - `MODERN_TOKENS` 从 `modern-theme.js` 迁来，内容不变。
  - `NOTEBOOK_TOKENS` 覆盖极简的每一个 token（纸色、墨色、链接蓝、学生便签气泡、文楷字体栈），另加 `--nb-*` 纸张 token（便签、胶带、横线、页边线、印章、荧光笔、装订孔、波浪线、阴影），浅色和深色各一套。
  - `themeTokens(style)`：未知值一律回到极简。
- `examples/native-vault/appearance-client.js`（新）：`createAppearance` 用 `localStorage` 键 `notara.vault.appearance` 保存 `minimal | notebook`。读取或写入存储出错时，本页内的选择仍然生效。
- `examples/native-vault/font-route.js`（新）：
  - `createFontHandler` 只放行 `/notara/vault/fonts/wenkai.woff2`：只允许 GET/HEAD，`max-age=31536000`、`nosniff`；其他路径 404，其他方法 405，文件缺失也返回 404。
  - `installFontRoute` 注入 `webServer`，写法照 `pixel-classroom` 和 `packages/client` 的字体路由。`index.js / apply` 调用它。
- `examples/native-vault/modern-theme.js / installModernTheme(ctx, appearance)`：
  - 对同一来源重新调用 `overrideTokens`，原地替换 token 层，切换时不会闪回原生配色。
  - 按偏好挂上或撤下 `style[data-notara-theme=notebook]` 与 `body[data-notara-style]`；卸载插件时两者都会清理。
- `examples/native-vault/notebook-theme.css`（新）：
  - `@font-face` 指向 Host 路由。字重只声明 400，这样加粗仍由浏览器合成。
  - 所有规则以 `body[data-notara-style=notebook]` 开头，压过各组件后插入的同级样式。
  - 覆盖的界面：侧栏、页面标题与分段控件、控件与表单、菜单、对话框、设置弹窗、首页、课堂顶栏、对话、输入框、白板、文件树、索引卡、标签筛选、图谱、森林、星图图例、路线、日历、复习、减少动态效果。
  - 对话横线：原生 markdown 容器 `._markdown_*` 自带 24px 行距，所以段落、列表、标题各自写死 32px 行距并各自画线，段间空行用 `padding-bottom:32px`。
- `examples/native-vault/shell-client.js / installStudentProjection`：学习界面新增“外观”单选（极简 / 手帐），附说明“第一次切换需要下载约 7.6 MB 的字体”。基础样式 `.nv-appearance*` 放在 `modern-theme.css`。
- `examples/native-vault/assets-client.js / Tree`：选中的文件加上 `aria-current="true"`，供读屏识别，也给手帐的荧光笔样式一个钩子。原来这一项只有行内样式。
- `scripts/build-native-vault.ts`：
  - `inlineFonts` 跳过以 `/` 开头的路由地址。
  - 构建产物必须保留 `url("/notara/vault/fonts/wenkai.woff2")`，否则构建失败。
  - 构建时把 `wenkai.woff2` 拷到 `examples/native-vault/fonts/`。
- `.gitignore` 忽略 `/examples/native-vault/fonts/`；`package.json` 的 `files` 加入 `font-route.js`、`fonts`，版本升到 0.16.21。
- `examples/native-vault/client-source.ts`：创建外观偏好，传给主题和设置。
- 测试：
  - 单测：`theme-tokens.test.js`、`appearance-client.test.js`、`font-route.test.js`，其中一项把 CSS 里的字体地址和路由常量绑在一起，并断言极简 CSS 不引用 woff2。
  - E2E：`tests/e2e/native-vault-notebook.spec.ts`。
- 文档：`AGENTS.md` 外观一行、`docs/ui/themes.md` 新增 Native Vault 一节。

## 验证

| 层级 | 结果 | 命令与证据 |
| --- | --- | --- |
| 单元 | PASS，351/351 | `node --test examples/native-vault/*.test.js`；新增的三份测试文件都先见红（模块不存在），再实现 |
| 构建 | PASS | `npm run build:native-vault`，`client.js` 5,809,105 字节（只多了 CSS；字体未内联，由构建守卫保证） |
| 类型检查 | PASS | `npm run typecheck` |
| 合同检查 | PASS，96 | `npm run check:contracts` |
| 发布包 | PASS | 在 `examples/native-vault` 下运行 `npm pack --dry-run --json`：`@notara/vault-native@0.16.21`，含 `font-route.js`、`fonts/wenkai.woff2` |
| 真实实例字体路由 | PASS | 隔离实例上：`curl` 请求 `wenkai.woff2` 返回 200、`font/woff2`、7,926,440 字节；`kalam.woff2` 返回 404 |
| e2e 手帐 | PASS，1/1 | `npm run test:e2e -- tests/e2e/native-vault-notebook.spec.ts`（见下方“最终复跑”），含控制台错误断言 |
| e2e 回归 | PASS，3/3 | `npm run test:e2e -- tests/e2e/native-vault-minimal.spec.ts tests/e2e/native-vault-star-map.spec.ts`，极简主题下无回归 |
| 浏览器逐页检查 | 已人工查看 | 浅色、深色、801px 下的资料库/计划/设置/对话框拼图，以及白板、横线截图，在 `docs/evidence/notebook-theme/`。这些迭代截图是把磁盘上最新的 CSS 注入已启动实例拍的；E2E 的截图来自重新构建、重新启动的实例 |
| 真实模型 / 真实学生体验 | 未运行 | 合成资料与测试模型，不做教学质量结论 |

## 运行环境

- 预览：`startVaultIsolated({ testModel: true })` 的隔离实例，灌入 `scripts/fixtures/vault-modern-samples.mjs` 的合成资料，并通过 `teacher-replies.json` 设定测试模型的回复。启动脚本在会话临时目录，不进仓库。
- 预览会写入 `.runtime/modern-preview.json`，这是本机产物，已被 gitignore。

## 已知限制与下一入口

- 横线按块对齐，没有逐行基线测量。单个段落里如果有高于 32px 的行内公式，该段后续几行会有轻微偏移，下一个块会重新对齐。
- 设计稿里的“已记录”印章没有做：Native Vault 目前没有“评估已保存”的回执界面，不能凭空加装饰。
- 课堂列表、卡片等使用的 rc.2 哈希类（`Sixlwa_bubble`、`hWmORq_body`、`VOzbGW_*`、`wSkVaW_*`）在上游升级时须重新核对，这一点与极简主题相同。
- 窄屏课程森林里，阶段路牌和课名会挤在一起。这是森林布局本身的问题，与主题无关。
