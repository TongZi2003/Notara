# 教学记忆加载机制设计

## 目标

把已讨论的学生画像、锦囊和原则性教法 Skill 落到 DSH 原生 Agent 的加载与渐进披露机制。此轮交付设计，不实现运行代码。

## 工作树与范围

- `main`：`f84a29b`，只读核对，开始时干净。
- `codex/notara-vault-clean`：`6592886`，保留已有 Vault/UI/脚本/测试未提交改动。
- 本轮仅新增本文件与 `docs/migration/2026-09-21-teaching-memory-loading.md`，未提交，未启动或操作已有实例。

## 实际工作

- 两个只读子 Agent 分别探查原生 prompt/session/skills 接缝与 Vault 文件/搜索/图关系接口，主 Agent 核对关键接线。
- 确认旧 Host 每轮平铺最多 40 条学情和 40 条知识，当前独立 Vault 只有客户端 Remote，缺少模型工具与跨集检索接线。
- 设计共同教学规则、当前原则性教法 Skill、L0 读取入口、L1 候选索引、L2 正文/经历/证据的加载顺序。
- 拟定两个只读工具 `learning_find` / `learning_read` 的范围、分页、定位、版本与失败合同；工具尚未实现。
- 用户新增确认：保留苏格拉底、费曼、结构分析等原则性教法 Skill。锦囊中的情境教法继续和方法、个人经历一体，不新增第三类学情。
- 标记旧方法蒸馏 Skill 将所有教法排除出锦囊的冲突；只在设计中提出修订，未改旧正文。
- 第三个只读子 Agent 独立审查后，主 Agent 核对原生 `ctx.fs` 读取链，明确跨集的独立根与授权适配；将压缩恢复写为待验证目标，首批不引入持久缓存，移除 L0 的索引版本常驻，并区分当前输入引用和语义上的换题。

## 代码锚点

- `packages/host/src/teaching/teaching-context.ts`：`installTeaching`。
- `packages/host/presets/studyforge-learning/agent.cordis.yml`：原生教学组合。
- `scripts/dev-native-vault.ts`：`bootVault`。
- `examples/native-vault/index.js`：`NotaraVaultRemote` / `apply`。
- `examples/native-vault/vault.js`：`createVaultStore` / `searchDocuments` / `parseMarkdownDocument`。
- `examples/native-vault/graph.js`：`buildVaultGraph`。
- `resources/teaching/skills/studyforge-method-distillation.md`：教法排除规则。

## 验证

- PASS（文档/源码核对）：读取上述入口、原生 system-prompt 类型与当前资源，区分既有接缝和待实现能力。
- PASS（格式）：`git diff --check`；补充 Python 内联脚本检查新增设计的代码围栏、尾空白、决策锚点与 7 个源码路径。
- PASS（设计审查）：独立审查提出的跨集接线、压缩表述、缓存、L0 版本与任务定位问题已按实际接口收敛；这是文档层核对，不是运行验收。
- 类型/构建/unit/integration/e2e/live：未运行，本轮未改运行代码；不声称加载行为或教学效果通过。

## 下一入口

从设计第 11 节的实施顺序进入：精简教学预设与 L0，再接当前集的有界检索/读取、跨集权限与锦囊图谱投影，最后用真实请求验证渐进披露。
