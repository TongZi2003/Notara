# Windows：安装 Native Vault

本说明用于在 Windows 上安装 Native Vault。0.23.2 起教师使用 Windows 原生 BusyBox ash，避免 MSYS 初始化与受限令牌不兼容。需要 Windows 10 1903+ / Windows 11 和 x64 Node；真实模型与账号验收仍须单独记录。

## 压缩包快捷安装

下载官方 Release 的 `notara-版本号.zip`，完整解压后双击 `安装 Notara.cmd`，程序安装在该脚本所在目录。缺少 Node.js 24+、npm 或 Git Bash 时自动通过 WinGet 安装，随后检查最新正式版、安装项目依赖、构建并创建启动/关闭桌面快捷方式。系统权限提示由用户确认。ngrok 不随安装启用。

详细参数、网络失败处理与目录保护见[快捷安装说明](../install.md#windows-压缩包快捷安装)。以下 Git Bash 源码安装流程继续保留。

## 1. 准备环境

安装 [Node.js](https://nodejs.org/en/download) 24或更新版本，以及 [Git for Windows](https://gitforwindows.org/)。Git 安装器附带 Git Bash，后面的命令在 **Git Bash** 中执行。安装完成后重新打开终端，使新的 PATH 生效。

```sh
node --version
npm --version
git --version
bash --version
```

第一行应为 `v24` 或更新版本，四条命令都应能正常显示版本。若 Node 版本较旧，先更新再安装项目。

## 2. 在新目录安装

在准备存放代码的位置打开 Git Bash，执行：

```sh
git clone https://github.com/TongZi2003/Notara.git Notara-Vault
cd Notara-Vault
npm ci --no-audit --no-fund
npm run vault
```

启动器会打开默认浏览器，首次进入配置自己的教师模型。看到左侧“首页、计划、Vault、技能”四个图标，就是 Native Vault。

Git Bash 窗口需要保持打开；关闭它会停止本地服务。以后在 `Notara-Vault` 目录再次运行 `npm run vault` 即可继续。

### 桌面一键启动与关闭

完成依赖安装后，双击项目目录里的 `创建桌面快捷方式.cmd`，在当前用户桌面生成 `启动 Notara.lnk` 和 `关闭 Notara.lnk`。也可以直接双击项目中的 `启动 Notara.cmd` / `关闭 Notara.cmd`。

启动入口使用后台控制器，服务就绪后打开当前认证入口；退出启动窗口或关闭浏览器都不会停止服务。关闭入口等待控制器及它管理的本地服务停止，保留全部学习数据；默认不开启 ngrok。重复启动复用实例，重复停止安全。若服务由另一个终端启动，关闭入口提示使用原终端的 `Ctrl+C`，不会按进程名批量结束 Node。

快捷方式绑定创建时的代码和数据目录；项目搬到另一个位置后，删除这两个旧快捷方式，再在新位置重新创建。脚本支持中文、空格路径；不需要管理员权限，也不修改系统执行策略。创建脚本使用 Windows 已有的 PowerShell 和快捷方式接口。

高级用法：在 PowerShell 中使用 `scripts/windows-launcher.ps1 -Action Shortcuts -RuntimeRoot "D:\Notara Data" -ControllerConfig "D:\Notara Private\control.json" -Port 47093` 创建绑定自定义目录的两个快捷方式。`-ShortcutDirectory` 可以指定其他输出文件夹；`-NoUI` 适合自动化运行，启动时的 `-NoBrowser` 只跳过打开浏览器。

老师处理资料使用 `busybox-w32` 的 Unicode x64 版本 `FRP-6075-g169694ebd`，仍由 DSH 原生 Windows 沙箱执行。启动器校验 `vendor/windows-posix/` 中的固定版本；源码安装首次运行会从官方站点下载，失败会明确报错，后续有完整缓存即可离线启动。新发布包包含可执行文件、完整对应源码、GPLv2 许可证及来源说明，校验值固定在 `scripts/windows-posix.ts`。

教师工具支持 POSIX shell、中文、长脚本、heredoc、管道，以及内置 `ls/cat/grep/sed/printf`。这不是完整 Bash，不应依赖 Bash 数组或全部 GNU 命令选项；模型收到的工具说明会明确这一点。普通会话仍使用 DSH 原生 PowerShell。Git Bash 可以继续作为安装终端，但 `NOTARA_GIT_BASH` 不再选择 Windows 教师的执行器。

教师 CLI 写入需要本地、支持 Windows ACL 的学习目录；UNC/SMB 网络共享，以及工作区内部的目录联接和其他重解析路径，会明确拒绝。遇到目录保护错误时，请在普通本地目录中使用，不通过关闭沙箱或放宽权限绕过。

## 3. 数据与登录

默认数据在 Windows 用户目录下的 `.notara\vault-runtime`，通常为 `C:\Users\你的用户名\.notara\vault-runtime`。原始文件、课堂和配置保存在其中；停止服务不会删除。不要为升级或排障直接删除该目录，也不要把包含模型凭据的整个运行目录发给别人。

若服务已经启动，但页面提示需要认证，在同一目录执行：

```sh
npm run vault:open
```

使用它自动打开的入口，不手动删掉登录参数。默认端口 57093 无法使用时，启动器会说明原因：可能被旧实例占用，也可能落在 Windows 预留的端口段里（装了 WSL2、Hyper-V 或 Docker 的机器常见，用 `netsh interface ipv4 show excludedportrange protocol=tcp` 查看）。首次启动时可以明确指定一个空闲端口，例如 `npm run vault -- --port 47093`；以后沿用登记的端口。

旧版课堂与题卡不自动迁入新格式，先保留原目录。已有 Native Vault 运行目录的插件不会因 `git pull` 自动更新：停止服务后运行 `npm run vault:upgrade`，详见[版本更新](vault-launcher.md#版本更新)。

## 4. 常见启动问题

- 提示 Windows shell 下载或 SHA-256 校验失败：检查网络、代理和代码目录的写权限后重试；不要关闭校验或沙箱。使用完整新版 Release ZIP 可以复用包内依赖。
- PowerShell 提示禁止运行 `npm.ps1`：改用上面的 Git Bash；无需为此放宽系统执行策略。
- 提示 Node 版本不足：重新打开终端，再核对 `node --version`，确保不是仍在使用旧安装。
- `EPERM` 或链接创建失败：本版 Vault 目录链接已统一使用 Windows junction，避免依赖创建目录符号链接的管理员权限。若仍失败，保留错误与失败路径用于定位，不通过删除学习数据重试。

验证范围与已知限制见对应版本的发布说明及安装说明；隔离启动验证不等于完整真实课堂验收。反馈问题时附报错和版本即可，不需要提供 API Key、登录 token 或整个数据目录。
