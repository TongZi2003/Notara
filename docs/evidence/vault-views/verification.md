# Vault 视图验收 — 2026-09-21

> 本文保留 0.3.0 的历史验收。当前 0.4.0 简约布局、资产阅读与原生分屏验收见 [minimal-split/verification.md](minimal-split/verification.md)。

分支 `codex/notara-vault-clean`，插件 `@notara/vault-native@0.3.0`，Node `v24.13.0`。样式使用 DSH 原生令牌。

## 结果

| 层级 | 结果 | 命令与证据 |
|---|---|---|
| 文件派生、持久化及 Live Preview | PASS，43/43 | `node --test examples/native-vault/graph.test.js examples/native-vault/vault.test.js examples/native-vault/live-preview.test.js`；`unit.log` |
| 类型 | PASS | `npm run generate:remotes` 后 `npm run typecheck`；`typecheck.log` |
| 插件构建 | PASS | `npm run build:native-vault`；`build.log` |
| SDK 补丁重入 | PASS | `node scripts/patch-sdk.ts` 连续执行两次；原始摘要校验通过，支持旧补丁升级 |
| 可见 Chromium 浏览器 | PASS，3/3，56.7s | `./node_modules/.bin/playwright test tests/e2e/native-vault-views.spec.ts tests/e2e/native-vault-pdf.spec.ts tests/e2e/native-vault-layout.spec.ts --headed`；`e2e.log` |
| 插件打包清单 | PASS | 在 `examples/native-vault` 执行 `npm pack --dry-run --json`；`graph.js`、构建后的 `client.js` 与全部运行依赖文件包含在清单中 |
| 补丁格式 | PASS | `git diff --check` |
| 真实模型 / 真实学生教学质量 | 未运行 | 本次验收没有调用教学模型，不据此声称教学效果通过 |

## 浏览器实际覆盖

- PDF canvas 与文字层渲染；框选真实文字，生成磁盘 Markdown 卡片。
- 卡片库空态、搜索无结果、来源过滤、层级分组、打开 Markdown。
- 文件外部新增后自动更新；PDF 来源定位到第 2 页并恢复选区。
- 图谱点击详情、双击编辑、右键按页拆卡；原生右侧栏打开与收起。
- 父卡继续拆分写 `parent:`；派生角色从叶子变中间卡片，子卡计数更新。
- Markdown 标题摘录；前文插入后仍定位同一标题；卡片编辑器中的来源链接跳回段落。
- 标签切换保留未保存草稿、阅读页码及已固定节点。
- 按页拆卡跳过同名，删除一页卡片后可补齐，已有卡片不覆盖。
- 详情 pane 复用 PDF 阅读器；拖动调整宽度；图谱滚轮缩放、空白拖拽平移、节点拖动固定。
- 浏览器刷新后从文件重建卡片与关系。
- 600px 窗口下详情独立占满视图区；裁剪外壳无横向 `scrollLeft`，页面未向隐藏侧栏偏移。
- 失效来源显示读取失败；删除临时 vault 全部文件后，图谱、卡片库和阅读器均显示正确空态。
- 浏览器 `pageerror` 与 `console.error` 监控：最终记录为空数组，见 `runtime-checks.json`。

## 隔离范围

三个用例各自通过 `scripts/dev-isolated.ts` 的 Vault 入口启动新实例，使用随机端口、临时 DSH_HOME 与仅含合成资料的临时工作区。

主流程实例：

- URL：`http://127.0.0.1:63682`
- 根目录：`/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-PKIjv5`
- DSH_HOME：上述目录下 `home/`
- vault：上述目录下 `workspace/vault/`
- 验证结束后实例已停止，临时目录由 fixture 清理。以上 URL 仅为证据，不是留给用户使用的常驻服务。
- 未操作真实 `~/.dsh`、真实学习资料或其他 checkout 的实例。

## 截图

- `implemented-graph.png`：图谱关系及详情。
- `implemented-cards.png`：层级分组与父卡来源过滤。
- `implemented-reader.png`：PDF 阅读器及按页补拆结果。
- `implemented-narrow.png`：窄屏节点详情。

实现与边界说明见 `docs/dev-log/2026-09-21-vault-views.md`。
