# 安装和使用 Notara

适用版本：Notara 0.21.1 / DSH 0.2.0-rc.1。macOS 使用 Node 24.13.0 验证；Windows 的启动与 Git Bash 支持已实现，尚无完整实机验收。

## 准备环境

- 安装 [Node.js](https://nodejs.org/en/download) **24 或更新版本**，安装包包含 npm。
- 安装 Git；Windows 使用 [Git for Windows](https://gitforwindows.org/)，之后打开 Git Bash。
- 准备一个在 DSH 模型设置中可配置的模型账号或 API Key。先配置主教师即可，工作员模型可以以后再设。

打开终端，核对三条命令都有输出：

```sh
node --version
npm --version
git --version
```

第一条应为 `v24` 或更新。安装或切换 Node 后，请重新打开终端。

## 第一次启动

```sh
git clone https://github.com/TongZi2003/Notara.git Notara-Vault
cd Notara-Vault
npm ci --no-audit --no-fund
npm run vault
```

依赖安装完成后，启动器会构建插件、创建学习数据目录并打开浏览器。首次启动和首次加载 PDF 等功能可能需要等待。

1. 首次引导中配置模型；也可以稍后在左下角“设置 → 模型”添加或选择模型。按你的服务商填写配置，不把 API Key 发到课堂对话里。
2. 看到左侧“首页 / 计划 / Vault / 技能”图标列后，在首页面板选择学习目录。默认目录已由启动器准备；也可以选择自己的资料目录。
3. 在输入框写一道题和自己的尝试，发送。老师回复后，可以继续讨论，也可以切到白板。
4. 想选讲法时，打开空白课堂的“课程选项”；课中通过教学设置调整。教法只是基调，老师可根据理解情况临时换讲法。

第一次操作示例见[从一道题开始](first-lesson.md)。模型连接失败时，先在模型设置核对服务商、地址、模型名和凭据；文件和已有课堂不会因连接失败被清空。

## 日常打开和停止

```sh
cd Notara-Vault
npm run vault
```

服务运行时保持终端打开。按 `Ctrl+C` 正常停止；下次执行同一命令继续使用已有资料和课堂。服务已运行、浏览器关闭或换了浏览器时：

```sh
npm run vault:open
```

登录链接带有临时认证信息，不要分享。直接访问不带认证的地址可能提示 401，此时使用上面的命令即可。

默认数据目录是用户目录下的 `.notara/vault-runtime`，默认端口 `57093`。它与克隆的代码目录分开，里面包含课堂、资料、模型配置和认证材料。

使用其他数据目录或端口：

```sh
npm run vault -- --root /你的数据目录 --port 47093
npm run vault:open -- --root /你的数据目录
```

Windows Git Bash 可写成 `C:/Users/你的用户名/NotaraData`，含空格的路径加双引号。不要把旧版 StudyForge 工作台的 `.trial` 直接当 Native Vault 数据目录。

## 升级和回退

1. 在运行服务的终端按 `Ctrl+C`，确认已停止。
2. 完整复制 `.notara/vault-runtime` 到另一个备份目录；使用自定义目录时复制实际目录。保留隐藏文件，勿只备份 `workspace`。备份包含凭据，请留在自己的设备上。
3. 在代码目录执行：

```sh
git pull --ff-only
npm ci --no-audit --no-fund
npm run vault:upgrade
npm run vault
```

自定义目录的后两条为：

```sh
npm run vault:upgrade -- --root /你的数据目录
npm run vault -- --root /你的数据目录
```

`vault:upgrade` 会识别旧版使用的带版本号快照，切换两处插件链接，保留原快照和已安装的像素教室。原课堂、资料和模型凭据保留；旧版的完整对话显示和欢迎提示种子值会迁到新版设置。当前版本可在“设置 → 学习界面”底部查看。

从 **0.21.0 以前**升级后，第一次打开旧课会迁移会话格式。若需要回退，应停止新版、恢复旧代码及其依赖，再将整份备份恢复到**原数据目录位置**。备份中的安装链接可能引用原位置，不能直接把备份文件夹作为另一个运行实例启动。只换回插件快照不足以回退已迁移的课堂。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 提示需要 Node 24，但 `node --version` 显示 24 | 系统可能有多套 Node，npm 脚本找到了另一套。安装依赖后用 `npm exec --offline -- node --version` 核对，并让 Node 24 的目录位于 PATH 前面。 |
| 页面 401 或浏览器没有打开 | 服务运行时执行 `npm run vault:open`；自定义实例带上相同的 `--root`。 |
| 端口被占用 | 检查是否已有实例。新实例可以显式指定空闲端口；不要删除学习目录。 |
| 提示必须升级插件 | 停止服务、完整备份、运行 `npm run vault:upgrade`。单独拉取代码不会替换快照。 |
| Windows 找不到 Bash | 安装 Git for Windows、重新打开 Git Bash；特殊安装位置使用 `NOTARA_GIT_BASH` 指定 `bash.exe`。 |
| 模型一直没有回复 | 核对模型配置、余额和网络。需要诊断时在“学习界面”开启调试记录；分享报错时去掉凭据和私密课堂内容。 |

Windows 的详细路径与端口说明见 [Windows 安装说明](runtime/windows-native-vault.md)。启动与认证机制见[启动说明](runtime/vault-launcher.md)。
