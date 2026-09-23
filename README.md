# Notara · Native Vault

Notara 是建立在 DeepSeek Harness 上的学习工具：带着资料开始讨论，将题目、理解变化和课堂小结保存为 Markdown 文件，再通过资产、图谱、路线和日历继续学习。

**新用户使用本分支的 Native Vault，启动命令是 `npm run vault`。** `npm run trial` 启动的是保留的旧版 StudyForge 工作台，有独立“教法”页与“普通卡／知识”列表，不是这里介绍的新界面。

## 安装并开始学习

准备 Git 和 Node.js **24 或更新版本**（包含 npm）。本机验证使用 Node 24.13.0 / macOS；其他系统的实机验证边界见[发布说明](docs/releases/native-vault-0.14.9.md)。

**Windows 用户请安装 Git for Windows，并在它附带的 Git Bash 中执行下面的命令。** 主教师会使用 Bash 处理文件，启动环境需要能找到 `bash`；不要用只提供 WSL 跳转的 `bash.exe` 代替 Git Bash。详细步骤见 [Windows 安装说明](docs/runtime/windows-native-vault.md)。

在一个新目录安装：

```sh
git clone --branch codex/notara-vault-clean --single-branch https://github.com/TongZi2003/Notara.git Notara-Vault
cd Notara-Vault
node --version
npm ci --no-audit --no-fund
npm run build
npm run vault
```

启动后会自动打开浏览器。首次配置自己的模型；最初只需一个可用的主教师模型，就能从一道题开始。看到“对话、资产、图谱、卡片、路线、日历、教室”等分页，就是 Native Vault。无需按旧说明另装数学工作台和世界书。

在对话中输入题目和自己的尝试，或者在资产页导入讲义并带入对话。输入框的“指令”提供拆书、备课、路线规划、作文批改等入口；教法和学科关注收在“更多技能”里，也能按中文关键词搜索。可参考[第一次学习的操作脚本](docs/tutorials/01-first-lesson.md)。

服务运行期间保留终端窗口。以后进入代码目录运行 `npm run vault` 即可继续；关闭终端只停止服务，不删除学习数据。若服务已运行，但另一个浏览器需要重新登录：

```sh
npm run vault:open
```

默认数据目录为用户目录下的 `.notara/vault-runtime`，默认端口为 `57093`。登录入口由启动器生成，不要把带 token 的登录链接转发给别人。自定义目录、端口与认证说明见[启动说明](docs/runtime/vault-launcher.md)。

## 已经装过旧版怎么办

保留旧代码目录和 `.trial` 等旧数据目录，另建上面的 `Notara-Vault` 目录运行新版。新版首次创建空 Vault，**不会自动迁入旧版课堂和卡片**；不要把旧版数据目录直接用作新版 `--root`。原始 PDF 和普通 Markdown 资料可以先带入新版，旧格式学习记录需另行迁移。

如果已经使用 Native Vault，请先看[版本更新的边界](docs/runtime/vault-launcher.md#版本更新)。现有运行目录固定了创建时的插件快照，单纯 `git pull` 不会自动替换它；不要为了升级删除数据目录。

## 开发与验证

依赖以 `package-lock.json` 为准，DSH 系列锁定为 `0.1.5-rc.2`。构建与常用检查：

```sh
npm run build
npm run build:native-vault
npm run check:contracts
npm run typecheck
npm run typecheck:tests
npm run test:unit -- <文件>
npm run test:integration -- <文件>
npm run test:e2e -- <文件>
```

浏览器测试经 `scripts/dev-isolated.ts` 创建临时数据根、独立端口和合成资料；不使用真实学习目录。`npm run dev:isolated` 仍是旧 Host 的开发测试入口，不能作为 Native Vault 的长期试用入口。

当前迁移合同位于 [`docs/migration/`](docs/migration/README.md)，运行说明与验收记录位于 [`docs/`](docs/)。本次变化见 [Native Vault 0.14.9 发布说明](docs/releases/native-vault-0.14.9.md)。
