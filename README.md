# Notara 🐾

Notara 用于围绕题目、讲义和学习问题展开讨论，并记录你的学习过程。你可以先写下自己的小尝试，再和教师一起把疑惑一点点拆开分析。

Notara 底层基于 **DeepSeek Harness**。保存的解题卡片、学生理解和课堂小结会乖乖留在本地的 Markdown 文件里，对话记录由本地运行时另行保存。下次回来，沿着计划、Vault 和技能页就能接着学啦。

当前版本为 **0.23.6**，依赖 **DSH 0.2.0-rc.1**。本次更新修好啦 Windows 启动状态异常、优化了白板卡片避让排版、加入了安装阶段进度条，并带来全新的 Windows x64 免安装包与 MIT 许可证喵！

## 🌟 主要功能

- **带着自己的想法讨论**：挑选适合的教法，让教师从你卡壳的地方切入。教师还可以按需召唤题目研究员、课时备课员、核验员、通用工作员和出题员来协同协助。
- **把学习过程留下来**：题卡会同时收纳题面、参考理解与你的作答思路，课堂小结连接前后进展。讲义和卡片都以本地文件保存，随时可在 Vault 中翻看、修改、检索与建立关联。
- **沿着计划稳稳前行**：用路线组织课程，在日历上安排节奏。复习依据实际检验过的关键一步记录；档位会决定下次复习间隔，不代表已经全面掌握知识。
- **在白板上并肩梳理**：课堂支持在对话、双面白板与教室之间切换；像素教室是可选插件。白板支持公式、图形和作答，卡片长宽与布局可保存；超宽的独立公式支持横向滚动。
- **沉淀专属学习方法**：在技能页管理学习集与学科技能，教师提出的修订建议，由你自主决定采用还是丢弃。界面提供极简风与手帐风两种视觉，并遵循深浅色设置。

## 🚀 安装与启动

### Windows x64 免安装版（推荐）

如果希望省去安装环境与本地构建的等待，可以直接抱走 [notara-portable-0.23.6-win-x64.zip](https://github.com/TongZi2003/Notara/releases/download/v0.23.6/notara-portable-0.23.6-win-x64.zip)。面向 **Windows 10 1903+ / Windows 11 x64** 系统喵。

1. 下载并完整解压到一个普通可写文件夹中（千万不要直接在压缩包里点运行，耳朵会吓耷拉的！）。
2. 双击「启动 Notara.cmd」。不需要预先安装 Node.js、npm 或 Git，也不用敲任何安装脚本。
3. 浏览器打开后，配好模型账号并选定学习目录。若使用 ChatGPT 订阅或手机远控，按需补充设置即可。
4. 想休息时，双击「关闭 Notara.cmd」正常停止。需要桌面入口时，双击「创建桌面快捷方式.cmd」，就能生成「启动 Notara」和「关闭 Notara」两个图标啦。

免安装包打包了运行时、依赖库、构建成品与教师命令工具，下载体积会稍大一些。首次启动需要初始化本地数据小窝，启动快慢取决于机器性能，耐心等它伸个懒腰就好。程序文件与学习数据分开存放，默认运行数据保存在当前用户的 `~/.notara/vault-runtime`，正常停止服务会保留数据；重要资料仍建议定期备份。

解压后建议保持路径固定。移动或重新命名程序目录前，请先停止旧实例；接入已有旧版本数据时，也需要先停止旧版。然后在新程序目录的 PowerShell 中执行快照升级命令，再按需重新创建桌面快捷方式：

```powershell
.\runtime\node.exe --import=tsx .\scripts\vault-upgrade.ts
```

使用自定义数据目录时，在命令尾部追加 `--root "你的数据目录"` 即可。

### Windows 快捷安装

从 [0.23.6 发布页](https://github.com/TongZi2003/Notara/releases/tag/v0.23.6) 下载 [notara-0.23.6.zip](https://github.com/TongZi2003/Notara/releases/download/v0.23.6/notara-0.23.6.zip)。完整解压到可写目录，双击运行里面的 **安装 Notara.cmd**。桌面入口带有暖黄色的便笺 N 图标。

安装器会自动检查 **Node.js 24+、npm 和 Git Bash**。若缺少组件，将通过 Windows **WinGet** 自动补全（系统弹出权限确认时轻点允许即可）。随后安装器会检查最新正式版，展示带有阶段百分比的进度条，完成依赖拉取与构建，并在解压出的 `notara` 目录准备好环境。百分比表示安装阶段，不代表下载进度或剩余时间。

安装完成后双击桌面生成的快捷方式即可启动；安装本身不会启动服务。若电脑缺少 WinGet，请按脚本提示安装 App Installer，或使用下方源码方式。注意：GitHub 自动打包的 Source code 源码压缩包不适用快捷安装器喵。详细参数与报错排查见[安装说明](docs/install.md#windows-压缩包快捷安装)。

### Git 与 npm 源码运行

支持 Windows、macOS 与 Linux。请先准备好 [Node.js 24 或更高版本](https://nodejs.org/en/download) 与 Git 环境。Windows 请使用 [Git for Windows](https://gitforwindows.org/) 附带的 **Git Bash** 执行：

```sh
git clone https://github.com/TongZi2003/Notara.git Notara-Vault
cd Notara-Vault
node --version
npm ci --no-audit --no-fund
npm run vault
```

启动器会自动唤起浏览器。首次进入完成教师模型配置并选定学习目录，就能立刻开始写题。服务运行时请保持终端开启；按 `Ctrl+C` 即可退出。完整细节见[安装说明](docs/install.md)。

Windows 原生环境要求 **Windows 10 1903+ / Windows 11 与 x64 Node**。教师的命令工具使用原生 BusyBox ash，并遵循 DSH 沙箱限制；其他普通预设的命令工具使用原生 PowerShell。BusyBox ash 支持 POSIX shell 语法，不等同于完整 GNU Bash。详情见 [Windows 说明](docs/runtime/windows-native-vault.md)。

### 日常启动与关闭

Windows 用户在完成依赖准备后，日常使用根目录的 **启动 Notara.cmd** 与 **关闭 Notara.cmd** 即可。双击 **创建桌面快捷方式.cmd** 会自动生成带图标的桌面入口，已验证中文、emoji、阿拉伯文及含空格、`&` 的路径。

启动入口会在后台运行服务并开启登录页；浏览器关闭不会中断服务。收工时请使用「关闭 Notara」让该入口管理的实例平稳停止。若通过 `npm run vault` 在终端启动，请回原终端按 `Ctrl+C` 停止。

默认学习数据存放在 **`~/.notara/vault-runtime`**（Windows 通常位于 `C:\Users\你的用户名\.notara\vault-runtime`），默认端口为 **`57093`**。默认程序目录与数据目录分开保存，运行所需依赖仍会关联程序目录；自选的外部学习目录可以位于其他位置。

服务已在后台运行、需要重新调出页面时，可以再次双击「启动 Notara.cmd」。已安装系统 Node/npm 的用户也可以在程序目录执行：

```sh
npm run vault:open
```

免安装版也可在程序目录的 PowerShell 中直接使用包内 Node：

```powershell
.\runtime\node.exe --import=tsx .\scripts\vault.ts --open
```

若使用了自定义数据路径，启动与重新打开时带上相同的 `--root` 参数。下面是源码或普通安装环境的写法：

```sh
npm run vault -- --root "/你的数据目录"
npm run vault:open -- --root "/你的数据目录"
```

免安装版的 PowerShell 命令则为：

```powershell
.\runtime\node.exe --import=tsx .\scripts\vault.ts --root "D:\NotaraData"
.\runtime\node.exe --import=tsx .\scripts\vault.ts --open --root "D:\NotaraData"
```

上面第一条是前台启动，保持终端开启；停止时按 `Ctrl+C`。第二条在服务已运行时使用。

## 📖 从一道题开始

你可以直接在输入框对老师说说自己的疑惑：

> 我想学会解方程 x²−3x+2=0。我知道怎样展开乘法，但不理解乘积为零为什么用“或”。请一次问一个问题，先让我试一试。

左侧主导航包含**首页、计划、Vault 和技能**。讲义和题卡在 Vault 中查看，课堂内可随时切换**对话、白板与教室**。输入框旁的菜单能调用各项教学技能，空白课堂的「课程选项」可调整教法。详细操作见[从一道题开始](docs/first-lesson.md)。

白板卡片支持从右下角用鼠标拖拽或触控调整宽高。自动排版会避让手动固定的卡片，并在内容高度改变时重新计算；手动固定的坐标会保留。卡片固定高度不足以显示全部内容时，可在卡内滚动；超宽的独立公式可横向滚动。课堂板书中有所属板块的固定卡片，可点击「放回排版」清除自定尺寸与位移，重新参与自动排版。

课堂支持归档与永久删除。若只是暂时收纳，点击「归档」即可。

永久删除时，只需将红色警示框中「」内的课堂名称原样复制粘贴到输入框，不要带上外层引号；再勾选确认复选框，点击「永久删除」就可以了喵。

删除会同时处理弹窗列出的关联对话记录，不能撤销，也不会进入 Vault 回收站。Vault 资料、白板、路线、卡片和共享附件仍会保留。

## 🤖 连接自用 ChatGPT 账号

在 **设置 → ChatGPT 账号** 点击 **Continue with ChatGPT** 进行官方授权。成功后可点击「查看可用模型」查看接口返回的模型目录；实际使用时，在对话的模型选择器中选择该账号下的模型，工作员模型则在教室设置中选择。

可用模型与额度以该授权连接实际返回的目录和服务端限制为准，不保证与 ChatGPT 或 Codex 官方客户端的列表完全一致。

初次授权必须在运行 Notara 的电脑本机完成。访问凭据保存在本地实例的 `DSH_HOME/notara-chatgpt/accounts.json`，由操作系统文件权限保护；当前实现没有额外的静态加密，请勿公开或提交该文件。Notara 不会导入你在 ChatGPT 中的历史对话。具体步骤见 [ChatGPT 账号接入说明](docs/runtime/chatgpt-account.md)。

## 🌐 可选的远控访问（ngrok）

想用平板窝在沙发上或手机在外继续看题？可以按需开启远控支持。**远控功能默认关闭**；只在本机使用时完全不必配置。远程使用期间，服务电脑需保持开机、联网且不进入休眠喵。

1. **安装 ngrok**：按 [ngrok Windows 官方下载页](https://ngrok.com/download/windows) 安装客户端。Windows 可在 PowerShell 执行：

   ```powershell
   winget install ngrok -s msstore
   ```

2. **准备凭据**：登录 [ngrok 控制台](https://dashboard.ngrok.com/)，在 [Domains](https://dashboard.ngrok.com/domains) 找到分配的域名，在 [Your Authtoken](https://dashboard.ngrok.com/get-started/your-authtoken) 复制令牌。
3. **填写远控设置**：进入 Notara 的 **设置 → 远控设置**：
   - **ngrok 域名**：填入控制台分配的域名主机名，不带 `https://` 或末尾路径。
   - **远程访问用户名与密码**：自行设置远程设备登录时的账号与强密码。用户名为 1–64 个非空格可打印 ASCII 字符，不能包含 `:` 或 `${`；密码为 12–128 个非空格可打印 ASCII 字符，不能包含 `${`。英文字母、数字及符合上述限制的符号都可以，中文和空格不可以喵。
   - **ngrok Authtoken**：首次配置时贴入刚才复制的令牌；如果 Notara 已保存令牌，或本机 ngrok 已配置令牌，可以留空。安装后若提示找不到 ngrok，请重新启动 Notara，或在远控设置中填写 `ngrok.exe` 的完整路径。
4. **保存与启用**：点击 **保存设置**，随后点击 **启用远控**。待状态亮起「已启用」后，将页面显示的完整 **远程地址** 复制到平板或手机浏览器，输入刚配置的账号密码即可进入。
5. **停用服务**：在页面点击 **关闭远控** 即可切断通道。重启 Notara 后配置会保留，但仍需手动点击一次启用。

凭证与令牌保存在本机，访问密码只应交给你允许使用此实例的人。远程访问者会使用该实例保存的模型账号和学习数据；关闭远控不会停止本地课堂。排障手册见[远控服务指南](docs/runtime/remote-access.md)。

## 🔄 更新与备份

当前版本会在**每次启动时**及运行期间每隔 **30 分钟** 检查 GitHub 正式发布。检测到兼容版本后，会在页面右上角呈现可关闭的更新提示。

新版下载、校验和依赖准备完成后，等当前课堂与后台任务结束，再点击「重启并更新」；也可在 **设置 → 更新** 随时手动检查。免安装版的首次启动省去安装构建，但界面更新仍可能需要下载依赖和构建。

手动更新前，请先停止服务，**将整个运行数据目录（包含隐藏文件）完整复制备份**；自选的外部学习目录也要另行备份。备份可能含模型凭据，请妥善保管。源码用户在代码目录敲：

```sh
git pull --ff-only
npm ci --no-audit --no-fund
npm run vault:upgrade
npm run vault
```

普通压缩包或免安装版需要手动更新时，把新版完整解压到新的可写目录，保留原程序和数据备份。先移除指向旧程序目录的「启动 Notara」「关闭 Notara」桌面快捷方式，以免创建新版入口时发生同名冲突。普通包运行「安装 Notara.cmd」，再在新程序目录的 Git Bash 中执行 `npm run vault:upgrade`；免安装版直接使用前文的包内 Node 快照升级命令。两种方式都要指定原来的数据目录（使用默认目录时无需额外参数），升级完成后再启动，并按需创建新的桌面入口。

从 **0.21.0 以前的版本升级后**，首次打开旧课会迁移会话格式。如果要回退到旧版，需要停止新版、恢复旧代码及对应依赖，并将升级前的完整备份恢复到原数据目录位置；仅换回插件快照不够。详情参考[安装说明中的升级与回退](docs/install.md#升级和回退)。

## 🛠️ 开发者验证

本地测试指令集：

```sh
npm run build:native-vault
npm run build:pixel-classroom
npm run typecheck
npm run typecheck:tests
npm run test:plugins
npm run test:unit
npm run test:integration -- --maxWorkers=1
npm run test:e2e:vault
npm run test:stress
npm run test:stress:browser
npm run site:build
npm run release:bundle
```

运行浏览器测试前需安装对应浏览器：`npm exec -- playwright install chromium`；Linux CI 还需准备浏览器系统依赖。

打包便携包请在 Windows x64 系统下运行 `npm run release:portable`，切勿混用非 Windows 原生依赖喵。

测试使用隔离目录、合成资料和测试模型。自动化测试不等于真实订阅推理、ngrok 公网连通或真实教学质量验收；具体结果以版本说明和 [Actions 记录](https://github.com/TongZi2003/Notara/actions/workflows/release.yml)为准。

## 📜 数据与许可证

学习资料和课堂默认保存在本机。模型调用会将所需的对话、资料内容和工具结果发送给你所配置的 AI 服务商；费用与额度由服务商决定。本地保存不等于这些内容不会随模型请求发出。

Notara 自身源码采用 **[MIT License](LICENSE)** 开源。第三方依赖组件、图标、字体及工具链保留其原有的开源许可说明。

更多操作指南详见 [安装文档](docs/install.md) 与 [第一课体验指南](docs/first-lesson.md)。
