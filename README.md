# Notara

Notara 是基于 DeepSeek Harness 的学习工具。带着一道题或一份讲义开始讨论，把题目、自己的理解变化和课堂小结保存在 Markdown 文件里，再从计划、Vault 和技能页继续学习。

当前版本 **0.21.1**，依赖 **DSH 0.2.0-rc.1**。旧版 StudyForge 工作台已退役。

## 安装

准备 [Node.js 24 或更新版本](https://nodejs.org/en/download)和 Git。Windows 请安装 [Git for Windows](https://gitforwindows.org/)，在它附带的 **Git Bash** 中执行命令。

```sh
git clone https://github.com/TongZi2003/Notara.git Notara-Vault
cd Notara-Vault
node --version
npm ci --no-audit --no-fund
npm run vault
```

浏览器会自动打开。首次使用时配置一个可用的教师模型，在首页选择学习目录，就可以输入一道题和自己的想法。服务运行时保持终端打开；以后在同一代码目录执行 `npm run vault` 继续。完整步骤、模型配置、升级和常见问题见[安装说明](docs/install.md)。

默认学习数据保存在 `~/.notara/vault-runtime`，服务端口为 `57093`。关闭终端只停止服务，不删除资料或课堂。服务已经运行、需要重新打开登录入口时，执行 `npm run vault:open`。

## 第一次学习

可以直接输入：

> 我想学会解方程 x²−3x+2=0。我知道怎样展开乘法，但不理解乘积为零为什么用“或”。请一次问一个问题，先让我试一试。

左侧图标列分别是首页、计划、Vault 和技能。题目卡片和讲义在 Vault 中查看，课堂内可切换对话、白板和教室。输入框的“添加文件或调用指令”菜单提供教学技能。详细操作见[从一道题开始](docs/first-lesson.md)。

默认界面收起权限快捷选择、性能用量和日志类指令，代码工作工具默认关闭。需要排查问题时，在“设置 → 学习界面”开启“显示调试记录”。这只调整显示与原生代码工具设置，不改变沙箱和写入审批。

## 升级

先停止服务，并**完整备份学习数据目录**。从 0.21.0 以前升级时，DSH 会将打开过的课堂迁到旧版无法读取的新格式。

```sh
git pull --ff-only
npm ci --no-audit --no-fund
npm run vault:upgrade
npm run vault
```

升级器切换插件安装链接，保留旧快照、课堂、资料、模型配置及已有像素教室；失败时回滚本次安装改动。自定义数据目录需要给升级和启动命令都加 `-- --root /你的数据目录`。完整备份和回退方法见[安装说明](docs/install.md#升级和回退)。

## 开发与验证

```sh
npm run build:native-vault
npm run typecheck
npm run typecheck:tests
npm run test:plugins
npm run test:unit
npm run test:integration -- --maxWorkers=1
npm run test:e2e:vault
```

测试使用独立端口、临时数据目录和合成资料。仓库保留 Native Vault、像素教室和启动器的相关测试；设计草稿、研究材料、真实验收记录和测试产物不进入发布文件。依赖版本见[上游锁定记录](docs/runtime/upstream-lock.json)，本次变更见[0.21.1 发布说明](docs/releases/native-vault-0.21.1.md)。Windows 实机验收尚未完成。
