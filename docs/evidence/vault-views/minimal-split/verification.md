# Vault 简约布局与分屏验收

2026-09-21；工作树 `/Users/yangrundong/.codex/worktrees/notara-vault-clean/DSH`；分支 `codex/notara-vault-clean`；`@notara/vault-native@0.4.0`；Node `v24.13.0`。

## 验证结果

| 层级 | 实际结果 | 命令 / 证据 |
|---|---|---|
| 单测 | PASS 50/50 | `node --test examples/native-vault/graph.test.js examples/native-vault/vault.test.js examples/native-vault/live-preview.test.js`；`unit.log` |
| 类型 | PASS | `npm run typecheck`；`typecheck.log` |
| 完整构建 | PASS | `npm run build`；`build.log` |
| Vault 构建 | PASS | `npm run build:native-vault`；最终隔离启动构建 4,355,300 bytes 的 client.js |
| 浏览器交互 | PASS 4/4，1.2m | `./node_modules/.bin/playwright test tests/e2e/native-vault-minimal.spec.ts tests/e2e/native-vault-layout.spec.ts tests/e2e/native-vault-pdf.spec.ts tests/e2e/native-vault-views.spec.ts`；`e2e.log` |
| SDK 补丁重入 | PASS | `node scripts/patch-sdk.ts` 两次执行均通过原始摘要校验 |
| 发布文件清单 | PASS | 插件目录内 `npm pack --dry-run --json`；`pack.json`，包含打包后的所有 UI 与 Host 依赖 |
| 格式 | PASS | `git diff --check` |
| 真实 Edge 视觉检查 | PASS | 先检查 55594 的资产页，再核对新实例 57308 的图谱页面；用户随后已开始操作 |
| 真实模型 / 教学效果 | 未运行 | 没有教学模型凭据，不把原生输入与文件引用验证写成 AI 教学效果验证 |

## 浏览器覆盖

- 去掉 Reader tab 和重复状态横幅；文件栏默认收起，模板弹窗创建真实 Markdown，属性默认折叠。
- 唯一原生 composer；资产/图谱/卡片单屏隐藏输入框，对话分屏显示。交换、调宽、关闭后 DOM 身份和未发送草稿保留。
- 左右分页独立选择，包括原生轨迹；从右侧来源带入对话时保留右侧来源。
- 图谱中心 1/2 跳、标签 AND、子卡片数与可点击名称，详情没有全文摘要。
- 快速换节点后带入正确文件及其子卡片清单。引用与拆分意图停留在草稿，没有自动提交。
- PDF canvas/文字层、框选摘录、生成 Markdown、页码/区域来源恢复、按页提取、同名跳过、补齐缺页。
- Markdown 按标题摘录，来源标题前新增内容后仍能定位，卡片父子关系和外部文件变化重建。
- 窄屏详情、对话分屏、模板弹窗；无横向裁剪偏移。
- 外部修改、草稿保留、失效来源、空 vault、过滤无结果。
- 每个用例监测 pageerror 与 console.error；最终通过，没有未捕获异常。

`red.log` 保留最初独立 Reader tab 尚存在时的失败基线。源码抽取后更新了两条结构断言的读取路径；旧 Reader 测试迁移为资产页流程，保留原文件与定位断言。

## 截图

- `split-chat-graph.png`：原生输入与图谱详情分屏，正确文件及子卡片清单。
- `split-chat-cards.png`：原生对话与卡片分页。
- `graph.png`、`cards.png`：图谱详情和卡片来源过滤。
- `pdf.png`：资产页 PDF 与按页补拆。
- `narrow.png`：窄屏节点详情。

测试截图中的原生模型缺少凭据提示来自隔离环境的初始会话，不是教学模型成功证据。

## 留给用户的最终实例

- URL：`http://127.0.0.1:57308/`，已在 Edge 打开；进程 PID `65755` 的 LISTEN 地址已用 lsof 核实。
- 数据根：`/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-gOpt84`。
- DSH_HOME：该目录的 `home/`；资料：`workspace/vault/`，仅合成向量讲义和三张示例卡片。
- 由 `scripts/dev-isolated.ts / startVaultIsolated` 新启动。旧 50183 与用户已开始体验的 55594 保持运行，没有清理或改写数据。
- 没有读取真实 `~/.dsh`，没有提交/合并分支。

## 实际边界

布局当前在会话存活期间记忆；页面刷新重新采用默认单屏。文件和卡片仍由磁盘恢复。PDF 引用使用文字层，扫描 PDF 不做 OCR，序列化会明确指出无文字层。子卡片来自直接拆分边，标签只改变图谱展示，不改变子卡片事实计数。
