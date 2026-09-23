# Bash 学习步骤展示

## 目标与实际改动

在 `codex/notara-vault-clean` 中把 Bash 的学习目的显示为正文三级标题，保留简约的原生主题与原生批准机制。`@notara/vault-native` 升为 0.8.1。

- `examples/native-vault/bash-display-client.js`：`bashStep` 从原生 `argsRaw` 读取 `[notara:<intent>] 中文说明`，剥离标记及可选 Markdown 标题前缀，按纯文本输出；`createBashStep` 渲染 H3、实际状态和可展开的命令/文本输出，保留 `inspect` 入口。
- 同文件 `installBashDisplay`：通过公开 slot registry 装饰 rc.2 的 Bash 注册，保留原生 locale、注入与 store；未标记、缺调用参数和参数不完整时调用原生组件。监听注册变化并随作用域释放；若未来原生 Bash 声明子 slot，则保留原生展示。
- `examples/native-vault/client-source.ts`：挂载上述展示。既有 `ask_solver` 投影不变；没有更改会话、工具执行或权限。
- `docs/migration/2026-09-22-native-tools-and-skills.md`：将意图字段的设计状态更新为已接入显示。

普通工具返回标作“已返回”，不等同于记录成功、后台任务完成或掌握情况。非零 shell 退出在 rc.2 中可能是 `isError:false`，单独检查其退出标记；失败和中断明确显示。整轮结束后的过程折叠仍由 DSH 原生组件负责。

## 参考来源

参考 [aa2246740/dsh-better-display](https://github.com/aa2246740/dsh-better-display) 0.3.0 的步骤/详情分层、真实状态与公开 slot 接线方式，针对当前需求独立实现。未安装或迁入整个 Reader，未拷贝其组件代码或样式。

本轮读取：`src/client/ToolActivity.tsx`（文件 SHA `cc732e739c689e54f604b60ab33369d5a19a1952`）、`src/client/tool-activity.ts`（`7157ee952cd00a8850ac5180b633c80b989c4a42`）、`src/client/official-slots.tsx`（`f2d6e6d3d4a123b697e740ec27f4f0071200ae6b`）、`docs/official-rendering-bridge.md`。这些是读取到的文件对象 SHA，不作为仓库 commit 标识。

## 验证

| 层级 | 结果 | 证据 |
| --- | --- | --- |
| 定向测试 | PASS | `node --test examples/native-vault/bash-display-client.test.js`，4/4：标题/状态、失败/中断、历史/不完整/普通调用回退、纯文本转义及默认隐藏命令输出 |
| 构建 | PASS | `npm run build:native-vault`，使用 Node v24.19.0 |
| 补丁格式 | PASS | `git diff --check` |
| 真实浏览器 + 合成模型 | PASS | 新 Host 的实际 Bash 流程：H3、详情开合、原生批准、非零退出失败提示、原生回退及终端详情；控制台无 error/warn |
| 真实模型、教学质量、完整回归 | 未运行 | 本轮仅验证展示与原生接缝 |

浏览器证据见 `docs/evidence/bash-learning-display/browser-check.md`。

## 运行与下一入口

通过 `scripts/dev-isolated.ts` 的 `startVaultIsolated({testModel:true})` 启动，使用新 0.8.1 插件快照和合成资料，未操作真实学习数据或旧预览。

- URL：`http://127.0.0.1:50004/`。
- 数据根：`/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-sPVEJ8`；实际 Vault 在其 `workspace/vault` 下。
- 启动 PID：68262；进程信息在忽略目录 `.runtime/sidebar-preview-v081.json`。
- 侧栏停留“对话美化 · 示例”，原生过程已展开、执行详情折叠；“学习步骤展示 · 合成演示”保留批准、失败与普通 Bash 回退的检查记录。
- 为兼容 IAB 沿用当前进程的 `.runtime/iab-small-batches.mjs` 加载钩子；未修改磁盘上的依赖快照。

尚未迁入参考项目的独立 Reader、完整多工具展示、动效与 MCP Apps。本轮交付为原生对话中的 Bash 学习步骤渲染。
