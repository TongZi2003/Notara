# 隐藏资产页的 PDF 穿透到分屏对话区

## 现象与原因

用户在 `http://127.0.0.1:60242/` 提供截图：左侧图谱与右侧对话分屏时，已打开过的 PDF 页面仍绘制在对话输入区后方。

`examples/native-vault/workspace-client.js` 的 `Workspace` 原先给非活动面板设置 `visibility:hidden`。`examples/native-vault/client-source.ts` 的 `PdfReader` 对已渲染 PDF stage 设置 `visibility:visible`，覆盖祖先继承的隐藏状态，导致未选中的资产页仍可绘制其 PDF。

## 修改

`Workspace` 将未活动面板改为 `display:none`，活动面板为 `display:flex`；保留同一个 keyed section 和其子组件，原生对话及编辑器不因分页切换卸载或重建。移除隐藏面板的绝对定位叠层。Native Vault 升为 0.8.5，重新构建客户端。

## 验证及当前页面

- PASS：`npm run build:native-vault`。
- 按用户此前“可以不用验收了”的要求，没有继续运行浏览器回归、完整测试或真实模型。
- `60242` 仍是 0.8.4 的独立快照；本轮未热改其已安装快照或重启，保留用户当前导入的 PDF 与未发送草稿。0.8.5 修复会在下次安装/启动新版时生效，不把当前旧页面记为已修复。
