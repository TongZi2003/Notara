# 原生工具面缩减与 Bash 意图

## 用户目标

普通文件操作归回 DSH 原生能力；教学规则通过 Skill 渐进披露，确定性复习/排期使用脚本；Bash 每步需标记用途以便后续对话美化。保留 Vault 文件事实源、现有界面、原生批准与真实课堂绑定。

## 实际改动

- `agent-tools.js` / `VAULT_TOOL_CONTRACTS`：专用注册由 15 项变为 3 项，加上 `solver-runtime.js` 的 `ask_solver` 共 4 项。删除退役 12 项的注册与 `executeTool` 分发，不留兼容别名。
- `presets/notara-teacher/agent.cordis.yml`：挂载原生 Bash；解除教学模式对 write/edit/bash 的旧禁用。写入继续沿 `tools/pre-execute` 的原生批准渠道，Bash 整条审批；解题者零工具。
- `teaching-runtime.js`：剧本绑定用已读路径，开课用路线 path/nodeId；Host 自行解析作用域与版本。通过 `shellEnv` 注册当前执行的 `DSH_NOTARA_*`；原生 `DSH_SESSION_ID` 不由模型填写。
- `file-operations.js` / `createRouteInVault`：Host 与 CLI 共用节点生成与路线创建规则。
- `vault-cli.js`：8 个确定性命令，help 按需展开单一 schema，JSON stdin；UI 与 CLI 共用复习/日历计算及原生文件 IO/CAS。PDF 图片落当前工作区缓存，以源 revision 区分。
- `resources/vault-teaching/`：新工作流 Skill，清理所有退役工具指引。base 要求 Bash description 使用 `[notara:<intent>] 中文说明`，意图表放 Skill。标识是未来展示线索，不作为批准或成功凭据。
- `teaching-context.js`、composer PDF 引用与迁移索引同步入口；专用插件版本 `0.8.0`。
- 迁移原工具面测试到新合同，包括原生读写/批准/CAS与按需读取；不恢复旧工具以迎合测试。

## 验证

- PASS：`npm run build:native-vault`（Node 24，仓库锁定依赖）。
- PASS：`node --test examples/native-vault/agent-tools.test.js examples/native-vault/vault-cli.test.js examples/native-vault/teaching-runtime.test.js examples/native-vault/teaching-context.test.js`，23 项。
- PASS：一次新隔离 Host 的合成模型定向流程：真实出站工具清单含原生读写/Bash和4项专用工具、不含退役入口；原生 Bash 能读取注入环境调用 CLI help；原生 write 创建真实卡片；Bash record-review 保存到相同 Vault 并绑定课堂；3 次操作均通过原生批准。使用 `startVaultIsolated({testModel:true})` 和 `tests/fixtures/vault-http.ts`，临时实例已停止。
- 未运行：完整 integration/e2e 套件、真实模型教学质量与真实学生体验。前述合成模型接线证据不代表模型会自发正确选择工具或遵守意图格式。
- 退役工具指引扫描：当前 base/教法/Skills 无旧 12 项工具或 `scriptRef` 指引；`git diff --check` 通过。构建快照版本为 `0.8.0`。
- 已在侧栏打开独立新版预览 `http://127.0.0.1:62058/`，数据根 `/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-XCqSQ3`，启动进程 `58697`；合成资料，未启用合成模型、未调用真实模型。启动元信息在忽略目录 `.runtime/sidebar-preview-v08.json`。此前 `0.7.0` 预览保持原状。

## 后续入口

工具与 Skill 当前合同见 `docs/migration/2026-09-22-native-tools-and-skills.md`。后续聊天美化读取原生 Bash 的 description 前缀，解析失败时保留正常回退；本轮没有提前实现新的轨迹渲染层。
