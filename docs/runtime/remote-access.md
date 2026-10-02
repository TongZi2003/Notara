# Native Vault 远程访问

远程访问是可选功能，通过你的 ngrok 账号提供带密码的 HTTPS 入口。默认关闭；没有安装 ngrok 也能正常使用本地 Notara。Notara 登录和模型提供方授权仍在运行服务的电脑上完成。

## 在设置页面启用

1. 在运行 Notara 的电脑上安装 ngrok，并从 ngrok 控制台取得域名和 Authtoken。
2. 用 `npm run vault` 正常启动，在 **设置 → 远控设置** 填写域名（不含 `https://`）、远程访问用户名和密码。密码至少 12 位、不含空格。此密码不同于 ngrok Authtoken。
3. 填写 ngrok Authtoken；如果已经用 `ngrok config add-authtoken` 配置过本机 ngrok，可以留空。程序不在 PATH 时，在「高级设置」中填写可执行文件完整路径；端口冲突时可调整代理和 ngrok 管理端口。
4. 点击「保存设置」。这一步不会启动远控。点击「启用远控」，成功后页面显示 HTTPS 地址；在另一台设备打开该地址并输入远程访问用户名和密码。
5. 点击「关闭远控」只关闭隧道和认证代理，本地课堂继续运行。完整关闭和重启 Notara 后，保存的配置保留，但必须重新手动启用远控。

页面提供的配置保存在实例数据根下的 `.notara/remote-access/settings.json`，Authtoken 单独保存在同目录的 `ngrok.yml`。Windows ACL 仅授权当前用户和 SYSTEM；密码与令牌不会回显到页面、浏览器持久存储或日志。保存时留空表示保留原有值。只把远程访问密码交给允许使用此实例及其模型账号的人。

页面会显示配置、ngrok 安装、端口或启停错误；启用失败时，本地课堂继续可用。若页面显示当前启动器不支持，请升级源码和插件快照，并通过 `npm run vault` 完整重启。直接运行底层 Host 的调试入口不提供远控管理桥。

## 命令行设置（可选）

原有后台脚本仍可使用。命令行配置独立于页面配置；这一路径使用 ngrok 自己保存的认证令牌：

```powershell
ngrok config add-authtoken <你的-ngrok-令牌>
npm run vault:remote:configure
```

按提示填写 ngrok 分配的主机名、远程用户名和密码、ngrok 程序路径及本地端口。远程密码需为至少 12 位可打印 ASCII 字符；`${` 会被 ngrok Traffic Policy 解释为表达式标记，因此用户名和密码都不能含有这个序列。

配置默认保存在 `%USERPROFILE%\.notara\remote-access\config.json`，Windows ACL 仅授权当前用户和 SYSTEM。也可指定一个仓库外的私有文件：

```powershell
npm run vault:remote:configure -- --config "D:\Notara private\remote.json"
```

配置文件、控制状态、日志以及运行时生成的 ngrok 策略和配置叠加文件都会放在该文件所在目录。不要将密码、配置文件或临时策略提交到仓库。

请使用专用配置目录，例如上例中的 `D:\Notara private`。程序目录及其祖先目录、盘根和用户主目录不能作为私有配置目录；目录链接会按真实目标校验。Windows 私有目录权限会向下继承，因此不能把配置文件直接放在包含程序的上级目录，以免改变程序和依赖文件的权限与元数据。

## 命令行启动与停止

同时启动本地 Vault 和远程入口：

```powershell
npm run vault:remote:start
npm run vault:remote:stop
```

只启动本地 Vault，不要求先配置远程访问：

```powershell
npm run vault:local:start -- --port 57093
npm run vault:local:stop
```

对已由 `npm run vault` 启动的 Vault 单独启用或关闭远程入口：

```powershell
npm run vault:remote:only
npm run vault:remote:only:stop
```

查看控制器状态：

```powershell
npm run vault:remote:start -- --root "D:\My Notara Data" --config "D:\Notara private\remote.json"
npm run vault:remote:stop -- --root "D:\My Notara Data" --config "D:\Notara private\remote.json"
node --import tsx ./scripts/remote-vault.ts status --root "D:\My Notara Data" --config "D:\Notara private\remote.json"
```

每个控制器只管理启动时指定的数据根目录。若之后的命令传入了不同 `--root`，Notara 会拒绝该操作；请使用原目录，或为另一份数据指定不同的私有 `--config`。重复启动会复用现有控制器，重复停止可安全执行。`remote:only:stop` 只关闭隧道，保留本地 Vault；完整停止只关闭本控制器启动并拥有的 Vault，外部启动的 Vault 会继续运行。页面与命令行通过运行目录锁保证同一实例只有一个远控入口；需要切换控制方式时，先从原来的入口关闭。

如果远程配置、身份验证、端口或隧道就绪检查失败，同时启动的本地 Vault 仍可用。先在服务器电脑完成 Notara 登录和需要的模型提供方 OAuth 授权。远程设备打开状态命令显示的 `/login` 地址，输入独立设置的远程用户名和密码；通过后，页面会自动完成 Notara 的一次性本地登录并进入 Vault，无须再输入另一个 Notara 密码。模型提供方 OAuth 使用单独的本机回调监听器，不经过公网入口。

## 实现与审计

DSH 服务和认证代理均只监听 `127.0.0.1`；ngrok 仅转发到代理。ngrok Traffic Policy 和本地代理都会验证远程凭据，代理还校验公开 `Host` 与浏览器 `Origin`，转发时去掉远程 Basic Auth。请求 Cookie 会继续转发；响应 `Set-Cookie` 保留值、`Path`、`HttpOnly`、`SameSite` 等原有属性，并确保恰有一个 `Secure` 标记，以适配 HTTPS 公网入口。代理只在预期的 DSH 客户端源码接缝匹配时修改信任逻辑；上游内容不符时拒绝服务，不会退化为未认证隧道。ngrok inspection API 也绑定 loopback，使用私有配置叠加层指定端口，不更改原有 authtoken 配置；停止远程入口时清理临时策略和叠加文件。

提供的 ZIP 按不可信源数据处理，没有执行其中的脚本。提取文件清单及逐文件 SHA-256 与 ZIP 对应成员一致。原脚本中的 Cookie、WebSocket、重定向和 loopback 身份改写行为经审阅后保留；审计发现隧道 Basic Auth 缺少应用代理的第二道校验、自定义 ngrok API 端口未传入配置、客户端源码接缝变化时未安全失败等问题。当前实现补上这些约束，并在本地无法确认隧道目标或认证时保持 fail-closed。

验证在当前独立源码 checkout 中执行，使用临时 Vault 数据根、合成模型适配器、随机 loopback 端口、伪造上游和 stub 更新检查器。测试不会启动 ngrok 或公网隧道，也不使用真实 ngrok 凭据、用户运行目录或桌面安装目录；因此没有声称已验证真实公网连通性。
