# Notara 0.23.3：把 Windows 的修复补齐喵

本版修复 Windows 教师命令与资料写入、空白课堂草稿恢复和 ChatGPT 登录端口问题，也补上管理员启动环境中的管道权限缺口。相关 Windows 云端预检已通过喵。

依赖继续锁定 **DSH 0.2.0-rc.1 / Cordis 4.0.4**，Node.js 下限为 24。下载入口为 [notara-0.23.3.zip](https://github.com/TongZi2003/Notara/releases/download/v0.23.3/notara-0.23.3.zip)与 [0.23.3 发布页](https://github.com/TongZi2003/Notara/releases/tag/v0.23.3)；正式资产由标签发布流程完成最终检查后提供。0.23.2 未正式发布，本版合并其修复，保留原标签与历史说明。

## Windows 教师命令与资料写入

Windows 教师使用固定版本的原生 BusyBox ash，避开 Git Bash/MSYS 在 Low 完整性受限令牌下的初始化失败。教师命令继续经 DSH 原生沙箱执行；普通会话继续使用原生 PowerShell。中文、空格路径、长脚本、heredoc 和管道有回归用例覆盖。

教师 shell 支持 POSIX ash 语法，依赖 Bash 数组或 GNU 扩展的脚本需要调整。源码首次启动会下载并校验固定 shell，缓存齐全后可离线复用。发布包包含可执行文件、完整对应源码、GPLv2 许可证与来源说明。

六种 Vault CLI 写命令使用每次调用独立的本地写入桥：`write-batch`、`record-review`、`undo-review`、`create-route`、`revise-route` 和 `schedule-lesson`。工作区、课堂和调用身份由 Host 绑定，保留内容校验、版本冲突检查与文件 ACL。调用结束或取消时撤销写入能力，再等待已开始的写入完成。

原子文件替换保留完整 DACL 与完整性标签。只读模式、越界路径、重解析路径和过期请求继续拒绝；前台、后台及取消流程会清理临时脚本和写入能力。清理失败会如实返回错误。

## 管道权限：补上管理员环境中的缺口

本地 Windows 测试通过后，云端 hosted runner 仍在 heredoc 和 CLI 管道中失败。源码与原生探针确认：BusyBox 的 `pipe()` 调用 CRT `_pipe()`，后者以空安全描述符调用 `CreatePipe`，新管道因此使用 token 默认 DACL。管理员环境的默认 DACL 依靠 Administrators 提供写权限，没有当前用户的允许写 ACE；受限 token 禁用了管理员组的允许权限，而 SDK 新增的临时能力 SID 只参与另一侧限制检查，无法单独满足正常身份的写权限检查。

0.23.3 的修复向**新受限 token 的默认 DACL**补入其用户 SID 的允许 ACE，让当前用户满足正常身份检查，保留原默认 DACL 条目、Low 完整性、限制 SID 与工作区授权。修复不额外增加 shared logon SID 或 Everyone 的写 ACE，也不修改系统 ACL 或用户安装的 Git。云端原生回归已通过，前一候选失败的五项用例均已恢复。

模拟 hosted 管理员默认 DACL 的本地探针已验证：管道、heredoc 与命令替换恢复，越界写入和删除仍被拒绝；使用不同临时能力 SID 的另一受限 token 仍无法打开该管道。这记录该受控环境的结果，不承诺收窄宿主原本已有的共享授权。

机制依据见 [BusyBox 固定版本源码](https://github.com/rmyorston/busybox-w32/blob/169694ebd/win32/mingw.c#L1107-L1112)、[微软 SECURITY_ATTRIBUTES 文档](https://learn.microsoft.com/en-us/windows/win32/api/wtypesbase/ns-wtypesbase-security_attributes)与[受限 token 权限检查文档](https://learn.microsoft.com/en-us/windows/win32/secauthz/restricted-tokens)。上游 [DSH discussion 8485](https://github.com/deepseek-ai/deepseek-harness/discussions/8485) 也记录了默认 DACL 导致管道创建失败的独立问题。

## 草稿与登录，少一点打断

- **空白课堂草稿恢复**：重载时等待原生学习目录与课堂登记就绪，保持原课堂身份。教学设置的未保存草稿留在原课堂；切换目录、导航退出或取消恢复时释放等待订阅。点击「新的一课」可继续使用当前目录已有的空白课堂。
- **ChatGPT 登录回调**：只监听 `127.0.0.1`，避开 Fetch 标准禁用端口。遇到端口分配冲突时，先关闭监听再有界重试；取消与超时均释放监听，保留原授权协议与令牌处理。

## 安装和升级

Windows 需要 **Windows 10 1903+ / Windows 11 和 x64 Node.js 24+**。正式发布后，完整解压 Release ZIP，双击 **安装 Notara.cmd**，按提示安装环境与依赖。安装本身不启动服务，完成后再使用桌面或包内的「启动 Notara」「关闭 Notara」。

Git 与 npm 安装方式继续适用于 Windows、macOS 和 Linux。Windows 用户仍可在 Git Bash 中执行源码安装与启动命令。教师 CLI 写入要求本地、支持 Windows ACL 的学习目录；UNC/SMB 共享及工作区内部重解析路径会拒绝。详见[安装说明](https://github.com/TongZi2003/Notara/blob/v0.23.3/docs/install.md)与 [Windows 说明](https://github.com/TongZi2003/Notara/blob/v0.23.3/docs/runtime/windows-native-vault.md)。

已有数据保存在实际运行目录中，与程序目录分开。手动升级前，先停止旧实例，完整备份实际数据目录，包括隐藏文件，再在源码目录执行：

```sh
git pull --ff-only
npm ci --no-audit --no-fund
npm run vault:upgrade
npm run vault
```

Release ZIP 用户先在新包目录安装依赖，再执行后两条命令。自定义数据目录须给升级与启动都加 `-- --root "/你的数据目录"`。已有目录使用固定插件快照，单独拉取源码或新建课堂不会替换它；快捷安装器也不迁移已有数据或快照。备份收好，我们再继续喵。

## 验证结果

本轮 Windows 云端预检与本地复测分别记录如下。运行检查使用隔离端口、临时数据目录、合成资料与测试模型；专项与全量套件有重叠，数量不累加。

| 验证 | 结果与范围 |
| --- | --- |
| Windows 云端原生回归 | 16/16 通过，6 个文件；前一候选失败的五项管道与 CLI 用例已通过。 |
| 云端脚本单元测试 | 71/71 通过，15 个文件。 |
| 云端插件测试 | Vault 565 项、像素插件 4 项，共 569 项通过，无跳过。 |
| 云端构建与类型检查 | 双插件构建、源码与测试类型检查通过。 |
| 默认 DACL 专项 | 云端实际受限 token 的 6 种 Win32/CRT 管道变体及 ash 管道、heredoc、命令替换通过。 |
| 本地脚本单元测试 | 71/71 通过。 |
| 本地插件测试 | 567 项通过，2 项因本机文件符号链接权限不可用而跳过。 |
| 本地类型检查 | `typecheck` 与 `typecheck:tests` 均通过。 |
| 本地全量集成 | 全部 71/71 通过，22 个文件；分两批执行，生命周期用例使用独立临时目录，保留全部断言。 |
| 本地全量浏览器回归 | `npm run test:e2e:vault` 完整 43/43 通过，耗时约 14.6 分钟。 |
| 本地服务端压力 | 12 个并发课堂、262 个请求，通过所列场景。 |
| 本地跨 token 探针 | 模拟 hosted 默认 DACL 时，本 token 管道可用；另一临时能力 SID 的受限 token 被拒绝。 |
| 本地浏览器压力 | 4 页、32 轮、696 个响应，保留 60 份资料与 12 个课堂，控制台和页面异常为 0。 |
| 前一候选解压包基线 | 清单、vendor 哈希、插件快照与离线缓存通过；创建、修改、受限写入和关闭通过，复用了已有 Node 依赖。 |

Windows 云端预检见 [Actions 运行记录](https://github.com/TongZi2003/Notara/actions/runs/36985150356)。正式发布还须通过标签流程中的 Windows 原生回归、Linux 全量检查与发布包构建；任一失败都不会公开安装包。此前解压包基线复用了 Node 依赖，不代表新电脑完整环境安装验收。

本轮尚未验证真实 ChatGPT 订阅推理、ngrok 公网连通、真实教学质量或 Windows 10 独立实机流程。自动化结果只覆盖所列场景。发布包不包含学习数据、认证材料或私密测试产物；第三方依赖与素材遵循各自许可，仓库本身仍标记 `UNLICENSED`。
