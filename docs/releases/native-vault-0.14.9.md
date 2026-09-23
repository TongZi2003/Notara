# Native Vault 0.14.9

发行日期：2026-09-23。安装分支：`codex/notara-vault-clean`，固定版本标签：`native-vault-v0.14.9`。

## 这次发布的内容

- 主教师普通文件读取、检索与写入统一使用原生 Bash；工具进度显示中文用途。批量保存支持逐文件成功/冲突回执，部分失败只需处理失败项。只读工作员继续保持只读工具范围。
- 主教师和各工作预设可分别设置人格，保存后可恢复；默认大肥鱼人设补充了互动方式、教学习惯与表达边界。首次介绍放在最终可见答复中，避免只出现在折叠的执行进度里。
- 保留的旧工作台修复卡片列表的 LaTeX 预览，以及教法页深色主题下的文字对比度。此项不改变独立 Native Vault 的页面结构。
- README 首选安装入口改为 `npm run vault`，说明旧 `trial` 与新 Vault 的区别，并提供第一课教程草稿。
- 补齐 Vault 工作区与 DSH 配置目录的 Windows junction 参数，并增加 [Windows / Git Bash 安装说明](../runtime/windows-native-vault.md)。

## 给第一次使用新版的同学

安装 Node.js 24 或更新版本与 Git，在新目录执行：

Windows 使用 Git for Windows 附带的 Git Bash，先确认 `node --version` 与 `bash --version` 可用。

```sh
git clone --branch codex/notara-vault-clean --single-branch https://github.com/TongZi2003/Notara.git Notara-Vault
cd Notara-Vault
npm ci --no-audit --no-fund
npm run build
npm run vault
```

配置自己的教师模型后，可以从一道题开始。默认数据放在用户目录下的 `.notara/vault-runtime`，关闭服务不会删除；之后仍用 `npm run vault` 启动。需要重新登录已运行的服务时执行 `npm run vault:open`。

## 更新与平台边界

- 从旧工作台切换时保留原目录，新版首次启动为空白学习空间。旧卡片、课堂和复习状态不自动迁移。
- 已有 Native Vault 运行目录固定了插件快照；`git pull` 不会自动替换它。试用新版本可以创建另一份空运行目录，详见[版本更新](../runtime/vault-launcher.md#版本更新)。
- 本次本机验证环境为 macOS、Node 24.13.0。Windows / Linux 未作为本次实机验收环境，不用本机结果代替其他平台验证。
- 课堂质量仍与资料、模型和实际讨论有关；保存卡片或完成一次运行不等于证明学生掌握。教程中的模拟作答需要明确标注。

本次发布检查记录见[开发记录](../dev-log/2026-09-23-publish-native-vault-0.14.9.md)。

本轮本机检查：265项单元、23项集成、新版课堂1项浏览器流程通过；旧工作台对应渲染修复的3项浏览器检查通过。构建、测试类型检查与文档本地链接检查通过。历史0.14.8真实模型记录仅作为历史证据，未重新运行0.14.9真实模型教学。
