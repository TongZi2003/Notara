# Notara 插件

0.21.0 起本仓库只有 Native Vault 一套运行时。旧工作台的插件体系（`notara.apiVersion=1` 包、插件页安装、世界书、数学工作台等工作台与 `.studyforge/plugins/` 登记）随旧工作台退役，代码与说明留在 git 历史。

## 当前插件

| 包 | 源码 | 作用 |
| --- | --- | --- |
| `@notara/vault-native` | `examples/native-vault` | Vault、课堂、白板、教室、复习与教学资源；Host 与浏览器端同一个包 |
| `@notara/vault-native/teacher` | 同上 | 教学者预设挂载的教学技能与课堂工具 |
| `@notara/vault-native/windows-posix-executor` / `windows-posix-tool` | 同上 | Windows 教师的原生 BusyBox ash、原生权限处理与模型命令说明；仅教师预设隔离 shell |
| `@notara/vault-native/git-bash-executor` | 同上 | 保留的脚本文件执行器，供 POSIX 显式测试入口使用 |
| `@notara/pixel-classroom` | `examples/pixel-classroom` | 可选的教室像素视图，填 `notara.classroom.view` 子槽 |

## 怎样装进一个实例

- `scripts/dev-native-vault.ts / installPluginSnapshot` 把构建后的 `@notara/vault-native` 复制成 `<数据目录>/vault-plugin` 快照，依赖链接到执行它的代码目录；播种和 `npm run vault:upgrade` 都走这一步。
- `vaultPatch` 生成 `home/cordis.patch.yml`：教学者预设一行（`@deepseek-ai/dsh-agent-preset`，内容取 `examples/native-vault/teacher-preset.js`）并设为默认，再插入 Vault 插件和可选测试模型。Windows 的 `teacher-shell` group 单独隔离 `shell`，包含 BusyBox 执行器与原生 Bash 工具适配器；普通预设保留原生 PowerShell。
- 新实例仅在带 `pixelClassroom` 选项时安装像素教室（`npm run pixel-classroom` 与相关 E2E）；升级会保留已有实例安装的像素教室。
- 已有运行目录固定插件快照：改了插件要提升 `examples/native-vault/package.json` 的版本，再用 `npm run vault:upgrade` 替换快照（见 `vault-launcher.md#版本更新`）。
