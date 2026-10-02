# Notara 0.23.6：解压就能开课，白板也不挤啦喵

这一版带来 Windows x64 免安装包，修复白板卡片重叠和 Windows 启动状态过早报告成功的问题。安装进度条、完整使用说明与 MIT 许可证也一并准备好啦。

## 选一个适合你的安装包

- **免安装版**：[notara-portable-0.23.6-win-x64.zip](https://github.com/TongZi2003/Notara/releases/download/v0.23.6/notara-portable-0.23.6-win-x64.zip)。包内带有 Node.js、npm、Windows 依赖与构建产物，完整解压后双击「start-notara.cmd」，无需预装 Node.js 或 Git。用「stop-notara.cmd」停止，也能创建带 Notara 图标的桌面快捷方式。
- **快捷安装版**：[notara-0.23.6.zip](https://github.com/TongZi2003/Notara/releases/download/v0.23.6/notara-0.23.6.zip)。双击「install-notara.cmd」，检测并补齐依赖、检查正式版并构建。Git/npm 源码安装方式继续保留。

免安装包体积更大，首次启动仍需初始化数据并配置模型账号。远控仍然可选，ngrok 不会自动开启。适用 Windows 10 1903+ / Windows 11 x64；学习数据默认保存在用户目录的 `.notara/vault-runtime`，与程序文件分开保存。

## 这次修好了什么

- **白板卡片不再被自动排版挤住**：自动卡片会避让手动固定卡片的实际宽高；加宽后的占用范围会计入板块宽度，后续板块随之移开。内容变高时重新计算，保留手动坐标、公式与流程图渲染。
- **Windows 启动状态更可靠**：控制器先成功保存状态，再报告启动完成。文件短暂被占用时有界重试，持续失败则明确报错并清理自身服务，不再先显示成功又消失。
- **安装进度看得见**：旋转字符改为安装阶段进度条。百分比代表已完成的阶段，不冒充下载百分比或剩余时间，完整成功才显示 100%。
- **Windows 入口统一英文名**：使用 `install-notara.cmd`、`start-notara.cmd`、`stop-notara.cmd` 与 `create-notara-shortcuts.cmd`；桌面入口为 `Start Notara` / `Stop Notara`，图标继续保留。压缩包文件名采用标准 UTF-8 编码，避免不同系统语言造成解压乱码。旧版中文桌面入口可手动移除。
- **说明更贴近实际操作**：补全便携版启动、旧数据升级、远控设置、更新与回退步骤；永久删除只需复制粘贴弹窗中的课堂名称，再勾选确认即可喵。
- **补齐 MIT 许可证**：Notara 自有代码采用 MIT；第三方依赖、字体、素材及随包 BusyBox 工具保留原许可证与对应源码。

## 已有用户怎么更新

可先使用「设置 → 更新」检查兼容版本；新版准备好、课堂与后台任务结束后，再点击「重启并更新」。免安装版后续界面更新仍可能需要安装依赖和构建。

手动换包前，停止旧实例，完整备份运行数据及自选的外部学习目录。把新版解压到新的可写目录；免安装版在新程序目录的 PowerShell 中执行：

```powershell
.\runtime\node.exe --import=tsx .\scripts\vault-upgrade.ts
```

自定义数据目录追加 `--root "你的数据目录"`。普通安装包先运行安装入口，再执行 `npm run vault:upgrade`。升级完成后启动，必要时移除指向旧目录的快捷方式并从新目录重建。

首次使用后请保持程序目录位置不变；移动程序目录也需要上述快照升级步骤。完整说明见 [README](https://github.com/TongZi2003/Notara/blob/v0.23.6/README.md) 和 [安装文档](https://github.com/TongZi2003/Notara/blob/v0.23.6/docs/install.md)。

## 验证与兼容范围

发布流程在 Windows 检查原生沙箱、资料 CLI、Unicode 快捷方式、安装器和启动状态故障恢复，并把实际免安装 ZIP 解压到中文及特殊字符路径，在没有系统 Node.js、Git 的 PATH 中验收启动、合成课堂、教师 shell 和关闭。Linux 执行类型、单元、插件、集成和浏览器测试；全部通过后才公开发布资产。

白板专项浏览器回归覆盖加宽后的卡片避让、内容增长、长公式、触控调整尺寸和刷新恢复。依赖仍为 **DSH 0.2.0-rc.1 / Cordis 4.0.4**，本版不更改课堂数据格式。

测试使用临时数据和合成模型，不代表真实 ChatGPT 订阅推理、ngrok 公网连通或真实教学质量已经验收；Windows 10 独立实机流程也未覆盖。最终状态以 [Actions 记录](https://github.com/TongZi2003/Notara/actions/workflows/release.yml) 为准。
