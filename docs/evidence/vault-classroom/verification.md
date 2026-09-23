# 大肥鱼与解题者首版验收

日期：2026-09-21。工作树 `codex/notara-vault-clean`，基于 `6592886` 加现有未提交改动；插件版本 `0.6.0`。本轮未提交或部署到用户已有实例。

## 范围与证据类型

固定主教师人格、独立解题模型、原生独立子会话、任务与路由持久化、取消和显式分析回看。完整世界书、公开同学、可续接角色不在此次首版中。

所有 Host/browser 使用 `scripts/dev-isolated.ts` 的 `startVaultIsolated({testModel:true})`：临时根 `/private/var/folders/.../notara-vault-native-*` 下的 `home` 与合成 `workspace/vault`，随机端口，测试结束停止并删除本次实例。未使用用户 Vault、真实课堂或其他 checkout 进程。主 Agent 最后复验 Node 为 `v24.19.0`。

模型来源：测试 adapter 的教师模型 `vault-test` 与独立解题路由 `gpt-5.6-sol` 都是合成回复。日志验证请求实际选中了哪条路由，不代表真实 GPT 解题质量或已接入外部 GPT 服务。

## 验证结果

| 层级 | 结果 | 命令与可观察证据 |
| --- | --- | --- |
| 构建 | PASS | `node node_modules/tsx/dist/cli.mjs scripts/build-native-vault.ts`；同一构建由隔离启动脚本重复调用，最终 client 4,432,174 bytes，Session 扩展信封接缝检查通过 |
| 包内容 | PASS | 在 `examples/native-vault` 运行 `npm pack --dry-run --json --ignore-scripts`，核对版本 0.6.0 与 solver runtime、两个角色资源均进入包 |
| Node 单元/文件接缝 | PASS，152 项 | `node --test examples/native-vault/*.test.js`；主 Agent 从最终实现状态运行 |
| Host 集成 | PASS，11 场景 | `npm run test:integration -- tests/integration/native-vault-solver.test.ts`；真实 Host、native spawn、原生 session 与合成 adapter 请求捕获 |
| 主 Agent 定向复验 | PASS，1 项，另 10 项按名称筛选跳过 | 上述命令追加 `-t '教室 RPC'`；父请求装配含大肥鱼身份，普通预设无解题者工具 |
| 既有记忆集成 | PASS，1 项 | 验证 Agent 运行 `npm run test:integration -- tests/integration/native-vault-memory.test.ts`，共享 fixture 未影响跨集教学记忆接缝 |
| 真实浏览器 | PASS，2 个不同流程 | `npm run test:e2e -- tests/e2e/native-vault-classroom.spec.ts`，首条配置流程通过；第二条最后定向重跑 `--grep '解题默认'` 通过（16.7s），控制台异常数组 `[]` |
| 全仓测试类型检查 | FAIL，既有问题 | `tsc -p tsconfig.tests.json --pretty false`；`teaching-rounds.test.ts`、`tool-disclosure.test.ts`、`journey.test.ts` 的既有字段类型错误，新文件未出现在错误清单 |
| 真实外部模型 | 未运行 | 隔离环境未配置真实 GPT 路由，环境中未提供外部模型凭据；未读取用户凭据或会话进行替代验收 |

Host 场景核对：精确模型选择与歧义拒绝；模型配置 CAS 与冷恢复；子工具面为空、不含父私密标记；分析进入父下一次模型请求；默认任务投影不含题目/分析/childId；取消后的迟到结果和同输入自动重派被拒；新用户输入可重新委派；按任务查询真实父子绑定；跨课堂及普通预设不能借用 taskId；运行中可查看；冷重启后仍能定位原记录。

浏览器核对：固定两个角色、只有一个原生 composer；教室设置保存与刷新恢复；默认对话的工具过程展开后仍只显示状态；任务点开真实 one-shot 子会话，可以看到题面与分析，只读提示出现、编辑输入框隐藏；原生父课堂导航可返回并继续输入；取消另一个任务后状态真实变为已停止，已创建的子会话仍能打开回看。原生 composer 链保留隐藏的草稿实例，不以 DOM 中完全没有输入节点作为只读判据。

## 截图

以下均为合成资料/合成模型的真实浏览器截图：

- [教室与任务入口](classroom-tasks.png)
- [原生子会话中的完整分析与只读提示](solver-record.png)
- [返回课堂后的简洁工具状态](teacher-status.png)

## 初始失败与修正

- 新增单元测试最初因实现缺失失败；新增角色资源尚未同步到本地构建目录时读文件失败，构建同步后通过。
- 独立审查复现原生 `dispose()` 抛错时“日志 completed，工具返回失败”矛盾；调整为完成资源释放后才写成功回执，并增加失败分支验证。
- 首次浏览器测试错误地假定原生 UI 使用中文、只读时卸载 composer、工具过程默认展开。分别根据实际英文提示、保留但隐藏的 composer、原生折叠按钮修正；不是通过删除只读或默认不内联解答的断言来通过测试。
- 模型默认选择、恢复默认（不是关闭）、失效模型可重新选择、轮询旧响应不覆盖新配置均已对齐代码语义。

## 尚未证明

真实 `gpt-5.6-sol` 的连通性、解题正确率、拆解与课堂表现，及长期使用效果未验收。当前解题者接收老师整理的文字题面与选定片段；不自行读取 Vault 或跨集画像，不自动保存产物。是否存在真实同名模型取决于 DSH 已配置的 provider 列表，缺失时如实提示，不以教师模型代替。
