# 发布 Native Vault 0.14.9

## 目标与范围

用户明确要求整理并发布本地改动，让使用 Windows 的新用户能够安装 Native Vault。目标远端为 `TongZi2003/Notara` 的 `codex/notara-vault-clean`，不直接合并或覆盖 main。远端发布前功能分支为 `e126b57`，本地既有未发布提交为 `77ffe9b`。

本次包含：原生 Bash 与独立人格既有提交、默认大肥鱼人设补全、旧工作台卡片公式及教法配色修复、Native Vault Windows 目录链接修正、安装说明与第一课教程草稿。个人宣发稿、口述整理和开发史不在软件发布范围内，继续保留本地。

## 安装入口与 Windows 配套

- README 首选入口改为 Native Vault 的 `npm run vault`；明确 `trial` 和默认 `dev:isolated` 对应保留的旧工作台。
- 新增 `docs/runtime/windows-native-vault.md`：Node 24+、Git for Windows / Git Bash、首次模型配置、持久目录与认证恢复。
- `scripts/dev-native-vault.ts` / `seedVault` 的工作区及 DSH profile 插件目录链接补齐 `dirLink` 参数，Windows 使用 junction，其他平台使用目录链接。
- `docs/runtime/vault-launcher.md` 明确运行目录固定插件快照；更新源代码不会自动替换旧快照，不能以删数据或新建空空间冒充数据升级。
- Native Vault 版本0.14.9；旧工作台 UI 修复保留在共享仓库中，不以其浏览器结果代替 Native Vault 验收。

## 审查与验证

环境为 macOS、Node24.13.0。调用 `scripts/dev-isolated.ts` 的测试使用临时目录、随机端口、合成模型与资料，结束后清理。未访问真实课堂数据或启停既有实例。

- 独立只读审查：覆盖工具权限、批量保存、人格装配和旧界面修复，未发现阻断发布问题。指出批量JSON总大小会先于单字段标称上限生效，属于已返回明确失败的边界；历史0.14.8模型证据不能充作0.14.9新一轮真实模型验收。
- PASS：`npm run build:native-vault`，构建后人格源与资源副本一致。
- PASS：`npm run build`。
- PASS：`npm run typecheck:tests`。
- PASS：`node --test examples/native-vault/*.test.js`，265/265。
- PASS：`npm run test:integration -- tests/integration/native-vault-teaching.test.ts tests/integration/native-vault-memory.test.ts tests/integration/native-vault-solver.test.ts tests/integration/native-vault-persistent.test.ts --maxWorkers=1`，23/23，168.87秒。覆盖文件读写、模型实际请求装配、子代理权限、冷恢复、课堂连续性和持久化登录。
- 同一代码状态下旧工作台浏览器：3/3通过，详见 `2026-09-23-card-preview-teaching-rendering.md`；后续没有修改这些UI文件。
- PASS：`npm run test:e2e -- tests/e2e/native-vault-teaching.spec.ts`，1/1，37.6秒。新快照的教学设置、重开、路线、标签与锦囊投影通过浏览器检查，无捕获的浏览器异常。
- PASS：安装/教程文档的本地链接目标检查；人格源与生成资源字节一致；四个 Vault 目录链接均显式使用 `dirLink`。
- Windows / Linux 实机、0.14.9新一轮真实模型和长期真实学生教学：未运行。本次不以静态Windows参数修复宣称实机通过。

## 发布内容检查

使用逐文件暂存，不使用 `git add -A`。本地SSH身份已核实为目标仓库所有者账号。既有未发布提交的45个文本文件已筛查常见凭据格式，未发现候选；4张既有截图经人工查看，仅包含合成课堂、设置与模型输出，没有API密钥或登录URL。本轮新增截图来自合成UI用例。临时运行数据、完整课堂日志、凭据和个人文稿不进入新增提交。

具体构建与测试原始日志位于本地 `.runtime/release-0.14.9/`，不作为产品源码提交。发行说明位于 `docs/releases/native-vault-0.14.9.md`。
