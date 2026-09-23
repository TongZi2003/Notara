# Windows：安装 Native Vault

本说明用于第一次从旧工作台切换到 Native Vault。保留旧目录和学习数据，另建一个新代码目录。Windows 尚未完成本项目的实机验收，以下为按实际启动代码整理的安装路径。

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
git clone --branch codex/notara-vault-clean --single-branch https://github.com/TongZi2003/Notara.git Notara-Vault
cd Notara-Vault
npm ci --no-audit --no-fund
npm run build
npm run vault
```

启动器会打开默认浏览器，首次进入配置自己的教师模型。看到“对话、资产、图谱、卡片、路线、日历、教室”等分页，就是 Native Vault。`npm run trial` 是旧工作台，请使用上面的 `vault` 入口。

Git Bash 窗口需要保持打开；关闭它会停止本地服务。以后在 `Notara-Vault` 目录再次运行 `npm run vault` 即可继续。

## 3. 数据与登录

默认数据在 Windows 用户目录下的 `.notara\vault-runtime`，通常为 `C:\Users\你的用户名\.notara\vault-runtime`。原始文件、课堂和配置保存在其中；停止服务不会删除。不要为升级或排障直接删除该目录，也不要把包含模型凭据的整个运行目录发给别人。

若服务已经启动，但页面提示需要认证，在同一目录执行：

```sh
npm run vault:open
```

使用它自动打开的入口，不手动删掉登录参数。默认端口57093被占用时，先确认是哪个旧实例；也可以在首次启动时明确指定一个空闲端口，例如 `npm run vault -- --port 57094`。

旧版课堂与题卡不自动迁入新格式，先保留原目录。已有 Native Vault 运行目录的插件也不会因 `git pull` 自动更新，详见[版本更新](vault-launcher.md#版本更新)。

## 4. 常见启动问题

- 找不到 `bash`：确认使用 Git for Windows 附带的 Git Bash，而非 WSL 启动器；从这个终端运行服务。
- PowerShell 提示禁止运行 `npm.ps1`：改用上面的 Git Bash；无需为此放宽系统执行策略。
- 提示 Node 版本不足：重新打开终端，再核对 `node --version`，确保不是仍在使用旧安装。
- `EPERM` 或链接创建失败：本版 Vault 目录链接已统一使用 Windows junction，避免依赖创建目录符号链接的管理员权限。若仍失败，保留错误与失败路径用于定位，不通过删除学习数据重试。

当前验证覆盖 macOS 的构建、隔离启动和持久化，以及 Windows junction 参数的代码核对；没有将其写成 Windows 实机通过。反馈问题时附报错和版本即可，不需要提供 API Key、登录 token 或整个数据目录。
