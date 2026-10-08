# 安装和使用 Notara 🐾

先把小书桌安顿好，再抱着第一道题来找老师吧。第一次使用按「下载并打开 → 接好模型 → 选学习目录 → 发出问题」走就可以，不用一口气研究所有开关喵。

适用源码版本：Notara 0.24.4 / DSH 0.2.0-rc.1。支持 Node 24 或更新版本；Windows shell 需要 Windows 10 1903+ / Windows 11 和 x64 Node。长对话保护与历史回读见[0.24.4说明](releases/native-vault-0.24.4.md)，订阅动态模型目录见[0.24.3说明](releases/native-vault-0.24.3.md)，白板操作设置与稳定性修复见[0.24.2说明](releases/native-vault-0.24.2.md)，自由白板、桌面学习 Skill 原文同步和 PDF 改进见[0.24.1说明](releases/native-vault-0.24.1.md)，分支白板见[0.23.11 说明](releases/native-vault-0.23.11.md)，弹窗键盘修复见[0.23.10 说明](releases/native-vault-0.23.10.md)，自动恢复、关闭和单个桌面入口见[0.23.9 说明](releases/native-vault-0.23.9.md)，历史运行时验证范围和真实账号验收边界见[0.23.3 说明](releases/native-vault-0.23.3.md)。

🐾 0.24.1 纳入自由白板、PDF 书签与范围读取、中文字体和扫描页修复、窗格调换与一层课堂分组；读书和绘图资源随包分发。新白板的数据格式标识为 5：从 0.23.12 或更早版本升级前，停止服务并备份运行目录和外部学习目录，然后在新版目录执行 `vault:upgrade`。更新器会要求手动升级；旧程序不能安全读写新版自由白板，回退时也必须恢复升级前的数据备份。

0.24.2保留相同数据格式，增加鼠标模式独立滚轮映射、底部缩放滑条与数值框，并修复编辑草稿、PDF定位、设置发布和更新恢复。升级0.24.1安装同样应先停止并备份；采用新目录后执行下方快照升级命令。

0.24.3 增加订阅动态模型目录，新增内置接入或成功登录时获取一次，已有配置读取缓存并可手动刷新。与0.24.2使用相同数据格式，可在「设置 → 更新」检查并在课堂空闲时重启更新。

0.24.4 增加长对话预算保护、分层摘要和本课堂原文搜索/分页回读，并修复 ChatGPT 重放与远控设置；浏览器标签页标题统一为 Notara「拾页」。数据格式保持 Version 5；可在「设置 → 更新」检查并在课堂空闲时重启更新。真实模型质量边界见[版本说明](releases/native-vault-0.24.4.md)。

## Windows x64 免安装版

想少折腾环境，可以从 [0.24.4 发布页](https://github.com/TongZi2003/Notara/releases/tag/v0.24.4) 获取 `notara-portable-0.24.4-win-x64.zip`，完整解压后双击「start-notara.cmd」。包内已经收好 Node.js、npm、Windows 依赖与构建产物，无需先安装系统 Node.js、Git 或运行安装脚本。运行要求仍为 Windows 10 1903+ / Windows 11 x64；首次启动要布置数据目录，请稍等一下，模型账号和可选的 ngrok 仍需自行配置。

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
4. 等待检查官方最新正式版、安装 npm 依赖并构建。百分比表示已到达的安装阶段，不代表下载字节数或剩余时间。成功后自动创建桌面 Notara「拾页」，双击启动即可；关闭使用页面左下角的红色按钮。安装本身不启动服务，ngrok 仍是设置里的可选功能。

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

## OpenCode Go

在模型设置中填服务地址、API Key 和模型 ID，并选择该模型使用的接口协议。模型与协议以 [OpenCode Go 官方目录](https://opencode.ai/docs/go/#endpoints) 为准：OpenAI Completions/Responses 使用 `https://opencode.ai/zen/go/v1`，Anthropic Messages 使用 `https://opencode.ai/zen/go`。例如 GLM 使用 `openai-completions`，GPT 使用 `openai-responses`，MiniMax 使用 `anthropic-messages`。

Notara 对这两个官方服务地址自动发送稳定的 `x-opencode-session` 和自身客户端标识。同一课堂的续聊、重试、压缩和标题生成沿用课堂 ID，新课堂使用自己的 ID；无需手工配置该请求头、安装其他插件或另开代理。服务商配置名可以自定义。OpenAI SDK 在所填地址后追加 `/chat/completions` 或 `/responses`，Anthropic SDK 追加 `/v1/messages`；按对应协议填写地址，避免重复拼接。

兼容处理只作用于官方 Go 服务地址，其他 API 与订阅接入继续使用原有请求头。OpenCode Go 的额度、支持的模型和使用要求以服务商为准。

0.24.3 支持动态目录。使用内置 `opencode-go` 提供方时，模型发现会合并 Go 的实时型号列表与 [Models.dev](https://models.dev/) 的逐模型协议信息，新增型号不再依赖 Notara 随包目录更新。这个内置路由可填写 `https://opencode.ai/zen/go` 或 `https://opencode.ai/zen/go/v1`，每个模型自动使用对应接口地址；显式协议、自定义端点和其他提供方继续按原设置工作。

每次新增内置接入获取一次目录；重新打开已有配置与启动只读取本地有效缓存，不定时刷新。需要更新时点击获取模型按钮。网络超时、目录无效或断网时保留上次有效目录，并在本次刷新中提示失败；可用型号仍在 Go 列表中但元信息暂时缺项时，保留已知协议。全新型号若尚无受支持的协议元信息，仍需明确配置协议。Go 目录刷新只请求公开信息，不发送 API Key，也不保存凭据。推理等级采用目录明确声明且当前 SDK 能表达的选项；陌生模型的特殊思考开关或预算格式仍需对应适配。

### 其他订阅目录

离线缓存可供已有路由继续读取；全新的配置草稿若首次获取失败，会显示获取错误，需要成功获取一次后再从目录选择模型。

OpenCode Zen、Kimi Coding、MiniMax Coding Plan、Z.AI/智谱 Coding Plan、通义 Token Plan 与小米 Token Plan 使用各自对应的公开模型元信息，保留现有协议、认证与服务地址。公开目录描述服务商支持的型号，不代表当前套餐账号一定有权限或额度；通义的套餐接口没有普通的 `/models`，不能拿套餐 Key 调用普通 API 的管理目录。

ChatGPT/Codex 与 GitHub Copilot 获取当前授权账号的可用目录，账号授权只发送到对应官方服务或原生 OAuth 选择的企业端点；公开元信息请求不携带凭据。每次成功登录也会获取一次目录，退出账号会清除当前缓存选择。自定义服务地址继续使用原有的获取模型入口，不会被替换为官方地址。

原生「设置 → ChatGPT 账号」使用 OpenAI 的 `/v1/models`，保留服务端返回的可见型号与顺序；`openai-codex` 使用其原生 OAuth 和 Responses 接口。这两种连接的可用型号可能不同。比如 GPT-6-Sol、GPT-6-Luna、GPT-6.1-Sol，只要相应账号接口返回，就能显示与选择，无需等待 Notara 的内置型号名单更新。

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
4. 当前统一使用混合教法，老师会根据理解情况调整提问、讲解、复述和结构分析。想偏重某种讲法，直接告诉老师，或在“教学设置”的本课临时要求中说明。“这一步先讲给我听”或“先别揭答案，让我试试”，都可以呀。

第一次操作示例见[从一道题开始](first-lesson.md)。模型连接失败时先别着急，在模型设置核对服务商、地址、模型名和凭据就好；文件和已有课堂不会因此被清空，小书桌还在原处等你。

## 日常打开和停止

Windows 安装依赖后，双击项目目录中的 **create-notara-shortcuts.cmd**，桌面会出现一个带书页 N 图标的 **Notara「拾页」**。关闭使用页面左下角、设置上方的红色按钮，弹窗中左侧取消、右侧红色确定；点击空白处或按 Esc 取消。也可直接双击项目目录中的 **start-notara.cmd** / **stop-notara.cmd**。快捷方式创建与读取支持中文、emoji 和阿拉伯文路径，无需更改系统语言设置。图标随发布包提供，并由文件清单校验。

若刚才已用 `npm run vault` 启动，先在那个终端按 `Ctrl+C` 停止，再改用启动快捷方式。

- 启动：后台运行 Notara 并打开当前登录入口；重复启动会复用已运行的实例。
- 关闭：页面确认后停止所属服务与自动恢复，保留课堂和资料；正在生成的回复与后台任务也会停止。浏览器标签页不自动关闭。
- 无需保持终端窗口；关闭浏览器不会停止后台服务。ngrok 不会随启动快捷方式自动开启。
- 若服务原本通过下方命令在其他终端启动，`stop-notara.cmd` 会提示回原终端按 `Ctrl+C`；页面关闭可通过该服务自己的管理程序退出，不会按进程名批量结束 Node。
- 创建时只整理确认属于同一安装目录和数据根的旧启动、关闭入口。移动项目目录后，确认并移开指向旧位置的同名 Notara「拾页」，在新目录重新创建；脚本拒绝覆盖其他安装目录的同名入口。
- 服务意外退出后可自动恢复已保存的课堂；默认十分钟内最多三次，清理或启动失败则停止恢复。电脑关机或整个管理进程退出时，请再次启动。主动关闭不会触发恢复。

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
