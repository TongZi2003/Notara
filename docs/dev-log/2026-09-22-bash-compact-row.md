# Bash 用途改为紧凑折叠行

- 目标：按用户反馈取消粗体三级标题、“已返回”及单独的“查看执行详情”，像原生上下文注入一样用小字直接展开。
- 实现：`examples/native-vault/bash-display-client.js` 的 `createBashStep` 将用途变为单个 13px、400 字重的折叠按钮，带方向箭头；点击该行展开/收起原有命令、输出及原始记录入口。处理中、失败和中断仍有简短状态，普通返回不额外显示。移除旧标题样式，原生回退、批准和执行逻辑不变。
- 发布：Native Vault 0.8.2，生成 `client.js`，更新迁移合同与 AGENTS 的当前展示事实。
- PASS：`node --test examples/native-vault/bash-display-client.test.js`（4/4）、`npm run build:native-vault`、`git diff --check`。Node v24.19.0。
- PASS（真实浏览器、合成模型）：新实例打开“紧凑学习步骤 · 示例”，默认仅显示“记录这次作答并安排复习”的折叠按钮，没有 H3、成功状态或单独的详情按钮；点击后实际命令/输出可见，再次点击 `aria-expanded=false`。截图检查为普通小字；浏览器 error/warn 为空。
- 未运行：真实模型与完整回归；本次仅改显示。
- 新隔离预览：`http://127.0.0.1:53642/`，数据根 `/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-qifn6N`（Vault 在 `workspace/vault`）。由 `startVaultIsolated({testModel:true})` 启动，PID 75143，旧实例与真实数据未改动。侧栏保留新版合成示例。
