# Notara 0.24.3 · 订阅模型动态目录

本版让订阅接入在新增配置或成功登录时获取模型目录，修复 OpenCode Go 新型号缺少协议，以及 ChatGPT/Codex 被随包旧型号名单限制的问题。

## 模型发现与刷新

- 每次打开新增配置，为选中的内置提供方获取一次目录；同一草稿内切换回来复用结果。已有配置和启动优先读取有效缓存，需要更新时点击「获取可用模型」。
- 成功登录获取一次当前目录；同账号并发请求合并。网络超时、断网或无效目录会保留上次有效列表并提示失败，允许手动重试。
- OpenCode Go 合并官方实时型号与 Models.dev 的逐模型协议，能识别 `deepseek-v4.1-flash` 等新增型号并使用对应接口。未知型号仍需受支持的协议信息，不按名称猜协议。
- OpenCode Zen、Kimi Coding、MiniMax Coding Plan、Z.AI/智谱 Coding Plan、通义 Token Plan 和小米 Token Plan 使用对应公开目录；目录支持不等于当前套餐一定有调用权限。
- GitHub Copilot 与 OpenAI Codex 获取当前授权账号的目录。账号缓存分别保存，退出或切换账号使旧请求失效；公开元信息请求不发送凭据。
- 显式协议、模型限制与自定义服务地址保持优先级。Go 的稳定课堂会话请求头兼容继续仅用于官方 Go 地址。

## ChatGPT 账号

「设置 → ChatGPT 账号」在授权完成后获取官方可见模型，显示返回数量与名称，并支持「查看可用模型」「刷新可用模型」。新型号直接采用账号接口返回的列表，无需等待 Notara 内置名单更新。

重新授权会清除旧目录并取消旧请求；退出账号或授权失效不再显示旧模型。有效空目录不会借用别的账号或旧名单。原生 ChatGPT 账号与「模型 → OpenAI Codex」仍是独立连接，各自使用对应授权和接口，实际型号与额度由服务端决定。

## 下载与升级

- Windows x64 免安装包：`notara-portable-0.24.3-win-x64.zip`，完整解压后运行 `start-notara.cmd`，附带 `.sha256` 校验文件。
- 普通安装包：`notara-0.24.3.zip`，完整解压后运行 `install-notara.cmd`。
- 更新清单：`notara-update.json`。

本版与 0.24.1、0.24.2 使用相同的 dataVersion 5。已有 0.24.2 可通过「设置 → 更新」检查并在课堂空闲时重启更新。手动换程序目录时先停止服务、保留运行根与外部学习目录备份，再在新目录执行 `npm run vault:upgrade`；便携版执行 `./runtime/node.exe --import=tsx ./scripts/vault-upgrade.ts`，自定义数据根追加 `--root`。

0.24.0 及更早版本跨越 dataVersion 5 时仍需备份后手动升级。0.24.2 的白板操作设置、编辑与恢复修复继续保留。

## 验证范围

本地类型检查、单元测试、订阅目录与 Go 三种协议集成、原生 ChatGPT 回归及 Chromium 设置页面测试通过。匿名在线检查确认官方 Go 目录包含 `deepseek-v4.1-flash`，并为其取得 `openai-completions` 协议；其余公共订阅目录也完成在线检查。

用户已在独立验收实例完成真实 ChatGPT 授权：返回 7 个模型，包含 GPT-6.1-Sol、GPT-6-Sol、GPT-6-Luna，并用 GPT-6-Luna 成功完成一轮对话。其他型号的实际调用不由这一轮验收推定。

OpenCode Go 的真实订阅调用尚未验收，本轮未使用朋友的 API Key。正式安装包仍经过 Windows 安装、恢复与便携启动检查，以及 Linux 类型、单元、集成、浏览器检查；打包时独立解压核对全部 ZIP 条目 CRC、长度和发布摘要。
