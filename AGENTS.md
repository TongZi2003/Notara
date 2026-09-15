# DSH 仓库开发规则

本仓库是可独立运行的 DSH 原生 StudyForge 插件与课堂运行时。所有相对路径从本仓库根目录计算；本仓库不依赖母仓库的 `AGENTS.md`、`CLAUDE.md` 或旧 Pi 运行时才能构建和测试。

## 当前事实源

- DSH 依赖版本以 `package-lock.json` 和 `docs/runtime/upstream-lock.json` 为准，所有 `@deepseek-ai/dsh-*` 必须保持同一 `0.1.5-rc.2` 系列。
- Node 下限为 `>=24.0.0`；本机验证使用 Node `v24.13.0`。
- 旧 StudyForge 产品基线只作为 `docs/migration/` 中记录的历史行为来源，不是运行时依赖；不要读取本机绝对路径来替代仓库内证据。
- `docs/migration/` 保存当前迁移合同、Notara 规格和验收边界；`docs/runtime/`、`docs/ui/` 与 `docs/evidence/` 保存实现、运行和验证记录。

## 代码边界

- `packages/contracts`：运行时 schema、DTO 和共享类型。
- `packages/domain`：学习领域规则、记录与投影，不依赖客户端。
- `packages/host`：原生 DSH Host、工具、权限和持久化接线。
- `packages/client`：原生 DSH 页面、Slots 和学生可见投影。
- `tests/unit`：纯逻辑；`tests/integration`：真实临时文件/进程接缝；`tests/e2e`：真实浏览器；`tests/live`：真实模型或外部服务。
- `examples`：可独立构建的示例插件和插件源。

职责边界不要求每项都拆成独立服务或类；优先复用 DSH 原生生命周期和已有模块，只有实际领域差额才新增代码。

## 执行规则

- 只用本仓库 lockfile 中的脚本和依赖，不使用会隐式拉取版本的全局 CLI 或 `npx`。
- 所有运行和 E2E 使用 `scripts/dev-isolated.ts` 的临时 `DSH_HOME`、临时课堂目录和随机端口；不启动、停止或修改其他 checkout、共享端口和真实用户目录。
- `.runtime/`、`node_modules/`、`dist/`、`lib/`、测试结果和凭据是本机产物，不提交。
- 不读取或提交 API key、认证 token、真实用户学习数据或完整私密课堂记录。
- 学生可见内容不得泄露内部 agent 名、工具协议、路径、session/run ID、隐藏答案或教师专属判断。
- 模型不能填写可由 Host 确定的 ID、路径、时间戳和派生状态；失败必须如实返回，不能用成功文案覆盖失败。

## 验证口径

文档检查、合同检查、类型检查、构建、确定性单测/集成/E2E、真实模型和真实学生体验分别记账。没有运行的层级写 `未运行`，外部凭据或服务不可用写 `BLOCKED`，不把静态检查或测试模型结果写成真实教学质量通过。
