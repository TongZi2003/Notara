# 图谱右键与标签样式

## 实际改动

- `examples/native-vault/canvas-client.js` 的 `Board`：右键不再调用 `onSelect`，只通知菜单入口。旧版已在浏览器复现右键后延迟打开节点详情。
- `examples/native-vault/views-client.js` 的 `GraphView`：菜单单独保存目标路径，`menuNode` 与详情的 `node` 分离；聚焦、带入对话、PDF 拆页、资产定位和原始资产操作均使用菜单目标。带入对话时从目标节点计算子卡片，不沿用当前详情。
- 同文件节点标签：改为有间距、浅色背景的圆角按钮，减淡井号，保留点击标签筛选与选中态。
- Native Vault 升至 0.8.4 并重新构建。原生会话、权限与文件事实源未改动。

## 验证与边界

- PASS：`npm run build:native-vault`；`node --check examples/native-vault/canvas-client.js`；`node --check examples/native-vault/views-client.js`。
- 已观察：新实例图谱正常加载，右键显示目标菜单，当次快照没有详情面板。用户表示样式“看见了，没问题”。
- 按用户“可以不用验收了”停止后续验证；未完成延迟检查、已打开详情时的右键回归、菜单各动作及标签筛选回归，不把这些写为通过。未运行完整测试与真实模型。
- 首次 0.8.4 预览在 IAB 组合脚本加载阶段失败，停止仅本轮失败实例后，将临时进程加载钩子的组合 URL 上限从 768 降为 384 字节，新隔离实例可以加载。未修改磁盘依赖或旧预览实例。

## 当前预览

`http://127.0.0.1:60242/`，0.8.4 合成示例；数据根 `/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-PLgUpL`，Vault 在 `workspace/vault`；启动 PID 86865。使用 `scripts/dev-isolated.ts` 的 `startVaultIsolated({testModel:true})`，进程加载钩子为忽略目录中的 `.runtime/iab-tiny-batches.mjs`。
