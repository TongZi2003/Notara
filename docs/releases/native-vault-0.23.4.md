# Notara 0.23.4：桌面入口换回自己的图标喵

Windows 的「启动 Notara」和「关闭 Notara」快捷方式现在使用 Notara 的黄色便笺 N 图标。之前没有指定快捷方式图标，Windows 显示的是 PowerShell 的默认图标。这次把它补好了喵。

下载 [notara-0.23.4.zip](https://github.com/TongZi2003/Notara/releases/download/v0.23.4/notara-0.23.4.zip)，或查看 [0.23.4 发布页](https://github.com/TongZi2003/Notara/releases/tag/v0.23.4)。正式安装包由发布流程通过检查后提供。

## 本版改动

- 图标提供多尺寸 ICO，适配 Windows 桌面不同的显示尺寸。启动和关闭仍是两个独立入口，功能保持原样。
- 图标资源随安装包分发，并纳入发布文件的 SHA-256 清单，避免解压或安装后丢失图标。
- 图标更新无需重建学习数据；已有用户安装新版后，可从程序目录重建桌面快捷方式。

## 安装与重建快捷方式

完整解压 Release ZIP，双击 **安装 Notara.cmd**，安装完成后使用桌面上的「启动 Notara」和「关闭 Notara」。已有依赖的用户也可在正确的程序目录双击 **创建桌面快捷方式.cmd**，创建或重建这两个入口。

移动了程序目录时，先移走属于旧目录的同名快捷方式，再从新目录创建；创建器会拒绝覆盖另一安装目录的入口。源码、Git 与 npm 安装方式继续保留，详见 [安装说明](https://github.com/TongZi2003/Notara/blob/v0.23.4/docs/install.md)。

旧的「Notara 手机入口」是 ngrok 地址入口，与本次桌面图标修复无关。远控仍在设置中按需开启，默认关闭；旧地址是否可用取决于对应远控服务与地址配置。

## 兼容与验证范围

本版运行时功能未改，继续包含 0.23.3 的 Windows 管道与资料写入修复。依赖仍锁定 **DSH 0.2.0-rc.1 / Cordis 4.0.4**，Node.js 下限为 24。

发布前的本地构建、快捷方式图标与重复创建检查、发布清单测试和测试代码类型检查已通过。Windows 发布流程新增快捷方式图标检查，正式发布继续受 Windows 原生沙箱回归、Linux 全量检查与发布包构建门禁保护；任一检查失败都不会公开安装包。完整测试状态见本版 [Actions 记录](https://github.com/TongZi2003/Notara/actions/workflows/release.yml)。

真实 ChatGPT 订阅推理、ngrok 公网连通、真实教学质量与 Windows 10 独立实机流程仍未验证。本次修复不改变这些验证边界。
