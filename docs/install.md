# 安装和使用 Notara

适用源码版本：Notara 0.23.7 / DSH 0.2.0-rc.1。支持 Node 24 或更新版本；Windows shell 需要 Windows 10 1903+ / Windows 11 和 x64 Node。画廊、图标与安装改进见[本版说明](releases/native-vault-0.23.7.md)，免安装包与白板排版见[0.23.6 说明](releases/native-vault-0.23.6.md)，历史运行时验证范围和真实账号验收边界见[0.23.3 说明](releases/native-vault-0.23.3.md)。

## Windows x64 免安装版

下载 Release 中的 `notara-portable-版本号-win-x64.zip`，完整解压后双击「start-notara.cmd」。包内包含 Node.js、npm、Windows 依赖与构建产物，无需先安装系统 Node.js、Git 或运行安装脚本。运行要求仍为 Windows 10 1903+ / Windows 11 x64；首次启动需要初始化数据目录，模型账号和可选的 ngrok 仍需自行配置。

用「stop-notara.cmd」停止；需要桌面入口时运行「create-notara-shortcuts.cmd」。便携包的程序体积较大，课堂与资料仍保存在用户的 `.notara/vault-runtime`，并不写入程序包。

已有旧版本数据、移动或重新命名程序目录时，先停止服务并保留数据备份，在新程序目录的 PowerShell 中执行：

```powershell
.\runtime\node.exe --import=tsx .\scripts\vault-upgrade.ts
```

自定义数据目录在后面加 `--root "你的数据目录"`。再双击启动；移动目录后需要重新创建快捷方式。自动更新仍通过设置页面进行，更新下载的代码可能需要安装依赖和构建。普通安装包、Git/npm 安装方法继续保留。

## Windows 压缩包快捷安装

1. 从 [GitHub Releases](https://github.com/TongZi2003/Notara/releases/latest) 下载 `notara-版本号.zip`（不要选择自动生成的 Source code 包）。
2. 完整解压到可写的文件夹，例如 `D:\学习工具`；程序位于解压出的 `D:\学习工具\notara`，之后保持该位置。
3. 双击 **install-notara.cmd**。脚本检测 Node.js 24+、npm、Git for Windows 的 Bash，已有可用依赖直接使用，缺少的通过 WinGet 安装；Windows 请求权限时由你确认。
4. 等待检查官方最新正式版、安装 npm 依赖并构建。百分比表示已到达的安装阶段，不代表下载字节数或剩余时间。成功后自动创建桌面「Start Notara」「Stop Notara」，双击启动即可。安装本身不启动服务，ngrok 仍是设置里的可选功能。

WinGet 由 Windows 的 App Installer 提供；若缺失，按脚本给出的官方链接安装 App Installer，或按下方原有步骤手动安装 Node.js 和 Git，再运行脚本。Windows 自动安装命令使用固定包 ID 和官方 WinGet 源，参数参见 [Microsoft WinGet 安装文档](https://learn.microsoft.com/en-us/windows/package-manager/winget/install)。不会修改系统执行策略。

安装器只取官方非预览 Release，并校验压缩包 SHA-256、文件清单和版本；包内版本更高时保留包内版本，不降级。程序与依赖先在临时目录准备，构建通过才替换当前解压目录。检查更新或下载失败会明确报错，不会假报最新版；重试前修复网络即可。临时构建需要额外磁盘空间，安装期间不要启动同一目录的 Notara。

若只想安装包内版本，在该目录打开 PowerShell，运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-install.ps1 -SkipLatest
```

这只跳过 GitHub 检查，npm 依赖仍需能下载或已缓存。`-NoShortcuts` 跳过桌面入口，`-CheckOnly` 仅检测，`-NoUI` 不显示结果弹窗，`-PlainProgress` 使用纯文字进度。窗口太小或输出重定向时自动使用文字显示。安装日志保存在程序目录的 `.runtime/install-logs`；失败时显示错误及日志路径，返回非零退出码，不显示成功或 100%。

源码仓库、已修改的程序文件以及程序子目录中的额外文件会被拒绝覆盖，请使用下方源码方式或重新解压到新目录。安装失败通常可修复原因后重试；若断电留下 `.notara-install-journal.json`，请保留它及所指向的 `backup`，在新的空目录重新解压安装，避免覆盖恢复材料。现有学习数据与插件快照不由快捷安装器迁移；已有用户更新后仍按本页的备份与 `vault:upgrade` 步骤升级快照。

## 准备环境

- 安装 [Node.js](https://nodejs.org/en/download) **24 或更新版本**，安装包包含 npm。
- 安装 Git；Windows 使用 [Git for Windows](https://gitforwindows.org/)，之后打开 Git Bash。
- 准备一个在 DSH 模型设置中可配置的模型账号或 API Key。先配置主教师即可，工作员模型可以以后再设。

也可以使用自己的 ChatGPT 订阅：首次引导选择“稍后配置”，随后到“设置 → ChatGPT 账号”登录并授权使用订阅额度。模型与额度由账号决定，步骤见[ChatGPT 账号接入](runtime/chatgpt-account.md)。

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

Windows 安装依赖后，双击项目目录中的 **create-notara-shortcuts.cmd**，桌面会出现带黄色便笺 N 图标的「Start Notara」和「Stop Notara」。也可直接双击项目目录中的 **start-notara.cmd** / **stop-notara.cmd**。快捷方式创建与读取支持中文、emoji 和阿拉伯文路径，无需更改系统语言设置。图标随发布包提供，并由文件清单校验。

若刚才已用 `npm run vault` 启动，先在那个终端按 `Ctrl+C` 停止，再改用启动快捷方式。

- 启动：后台运行 Notara 并打开当前登录入口；重复启动会复用已运行的实例。
- 关闭：等待该后台实例正常停止，保留课堂和资料；已经停止时可重复点击。浏览器标签页不自动关闭。
- 无需保持终端窗口；关闭浏览器不会停止后台服务。ngrok 不会随启动快捷方式自动开启。
- 若服务原本通过下方命令在其他终端启动，关闭快捷方式会提示回原终端按 `Ctrl+C`，不会强制结束其他进程。
- 移动项目目录后，删除原位置对应的两个旧快捷方式，在新目录重新创建。脚本拒绝覆盖其他安装目录的同名快捷方式。

源码方式首次使用需安装 Node.js、Git for Windows，并执行一次 `npm ci --no-audit --no-fund`；Release 用户可以用上方快捷安装自动完成。缺少环境或依赖时启动入口显示错误，不会自动开启远控。仅 PowerShell 本次启动使用进程级脚本执行参数。

命令行方式仍然可用：

```sh
cd Notara-Vault
npm run vault
```

服务运行时保持终端打开。按 `Ctrl+C` 正常停止；下次执行同一命令继续使用已有资料和课堂。服务已运行、浏览器关闭或换了浏览器时：

```sh
npm run vault:open
```

登录链接带有临时认证信息，不要分享。直接访问不带认证的地址可能提示 401，此时使用上面的命令即可。

ngrok 远控是可选功能：正常启动后，在 **设置 → 远控设置** 保存域名和访问凭据，再手动启用。无需远控时不用安装或配置 ngrok。具体设置、后台启动与停止脚本见[远控服务](runtime/remote-access.md)。

默认数据目录是用户目录下的 `.notara/vault-runtime`，默认端口 `57093`。它与克隆的代码目录分开，里面包含课堂、资料、模型配置和认证材料。

使用其他数据目录或端口：

```sh
npm run vault -- --root /你的数据目录 --port 47093
npm run vault:open -- --root /你的数据目录
```

Windows Git Bash 可写成 `C:/Users/你的用户名/NotaraData`，含空格的路径加双引号。不要把旧版 StudyForge 工作台的 `.trial` 直接当 Native Vault 数据目录。

## 升级和回退

### 界面更新（0.22.0 起）

启动器每次启动及每 30 分钟检查一次 GitHub 正式发布。发现兼容版本后，在独立代码目录下载、校验 SHA-256 并安装本机依赖，期间可以继续上课。右上角会出现与当前主题一致的更新提示，可关闭且不抢输入焦点，切页或折叠侧栏不会隐藏。关闭后同一次启动、同一版本不重复提醒，刷新页面也保留关闭状态；下次完整启动或发现另一个新版本可再次提醒。已经是最新版时不弹提示；检查失败会提供重试入口。“设置 → 更新”始终可以手动检查与更新。

新版准备好后，等课堂与后台任务结束，点击“重启并更新”。服务会在原端口恢复，页面刷新后继续同一课堂。新版安装或启动失败会尝试恢复原版本。下载失败不会停止正在运行的课堂，稍后可以重新检查。不同 DSH、Cordis 或持久数据格式的版本要求备份后手动升级。

代码缓存位于 `~/.notara/releases/`，当前代码入口记录在数据目录的 `notara-release.json`。保留正在使用的代码缓存；以后从原代码目录执行 `npm run vault`，会自动进入已安装的新代码。要回到指定代码目录，停止服务后在该目录执行 `npm run vault:upgrade`，再启动；涉及数据格式变化时仍按下述完整恢复步骤操作。

### 手动升级与旧版本首次接入

0.22.0 之前的用户先执行一次下面的手动升级，才能使用界面更新。

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
| Windows shell 下载或校验失败 | 确认网络和代理可访问 frippery.org，再重试启动；使用完整的新版 Release ZIP 可直接使用包内已校验的 BusyBox。不要改用 WSL 的 bash.exe 或关闭沙箱。 |
| 模型一直没有回复 | 核对模型配置、余额和网络。需要诊断时在“学习界面”开启调试记录；分享报错时去掉凭据和私密课堂内容。 |

Windows 的详细路径与端口说明见 [Windows 安装说明](runtime/windows-native-vault.md)。启动与认证机制见[启动说明](runtime/vault-launcher.md)。
