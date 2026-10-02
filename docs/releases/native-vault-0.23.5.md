# Notara 0.23.5：让桌面入口认得每一种名字喵

本版修复 Windows 在中文、emoji 和阿拉伯文目录中创建、读取桌面快捷方式的问题。「启动 Notara」和「关闭 Notara」也会使用黄色便笺 N 图标，大小切换时依然清楚。入口换好了，我们继续学喵。

下载 [notara-0.23.5.zip](https://github.com/TongZi2003/Notara/releases/download/v0.23.5/notara-0.23.5.zip)，或查看 [0.23.5 发布页](https://github.com/TongZi2003/Notara/releases/tag/v0.23.5)。正式资产由 Windows 与 Linux 发布检查通过后提供。

## 为什么需要这次修复

0.23.4 候选的本机图标检查通过，但英文 Windows 云端环境无法保存中文路径的快捷方式，发布被门禁阻止。旧候选未公开安装包，原标签保留；本次使用新的 0.23.5 标签，不移动失败标签。

本地原生探针进一步确认：Windows Script Host 在接收快捷方式文件名后，会将当前 ANSI 代码页无法表示的字符转成 `?`。这也影响 emoji 或其他语言的目录；Node 向 PowerShell 传入的 Unicode 参数本身保持完整。

现在使用 **IShellLinkW** 与 **IPersistFile.Load/Save**，从读取到保存都明确使用 Unicode。归属检查、重复创建和拒绝覆盖其他安装的同名入口继续保留，不需要修改系统语言或代码页。机制见微软的 [IShellLinkW 文档](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ishelllinkw)与 [IPersistFile.Save 文档](https://learn.microsoft.com/en-us/windows/win32/api/objidl/nf-objidl-ipersistfile-save)。

图标包含 16、24、32、48、64、128 和 256 像素七个尺寸，随 Release 分发，并纳入发布文件的 SHA-256 清单。

## 安装与重建快捷方式

完整解压 Release ZIP，双击 **安装 Notara.cmd**，安装完成后再使用桌面启动入口。已经安装好依赖的用户，可在正确的程序目录双击 **创建桌面快捷方式.cmd**，创建或重建两个入口。

移动程序目录时，先移走旧目录对应的同名快捷方式，再从新目录创建。图标更新不需要重建学习资料；已有学习目录与固定插件快照的升级步骤仍见 [安装说明](https://github.com/TongZi2003/Notara/blob/v0.23.5/docs/install.md)。Git 与 npm 安装方式继续保留。

旧「Notara 手机入口」是 ngrok 地址入口，与桌面图标无关。远控仍在设置里按需开启，默认关闭；旧地址是否可用取决于远控服务及地址配置。

## 验证与兼容范围

本地 PowerShell 5.1 探针已实际验证六种 ASCII、中文、emoji 和阿拉伯文文件或目录的快捷方式保存与读取；目标路径、参数、工作目录、描述、含逗号的图标路径及窗口样式均保真。该专项验证使用临时文件，没有读取学习资料，也不代表云端发布检查已通过。

正式发布沿用 Windows 原生沙箱与 CLI 回归、Linux 全量检查和发布包构建门禁，并新增完整 **5** 项 PowerShell 5 快捷方式流程校验：源码编码、安装状态防护、Unicode 启停与资料保留、图标与重复创建及防覆盖、外部实例保护。任一失败都不会公开安装包，状态以本版 [Actions 记录](https://github.com/TongZi2003/Notara/actions/workflows/release.yml)为准。

本版运行时功能和数据格式未改，继续包含 0.23.3 的 Windows 管道、资料写入、课堂草稿与登录端口修复。依赖仍为 **DSH 0.2.0-rc.1 / Cordis 4.0.4**，Node.js 下限为 24。0.23.3 的历史测试与压力结果见 [上一正式版说明](https://github.com/TongZi2003/Notara/blob/v0.23.3/docs/releases/native-vault-0.23.3.md)，不记作本版已通过的结果。

真实 ChatGPT 订阅推理、ngrok 公网连通、真实教学质量与 Windows 10 独立实机流程仍未验证。本次修复不改变这些边界。
