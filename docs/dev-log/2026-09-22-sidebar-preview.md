# 侧栏预览启动

- 从 `codex/notara-vault-clean` 的最新 `@notara/vault-native@0.6.0` 启动，通过 `scripts/dev-isolated.ts` 的 `startVaultIsolated({testModel:false})` 建立独立实例；未操作其他进程或用户数据。
- 侧栏首次加载合并插件包失败。相同资源通过服务端 HTTP 返回 200；在当前启动进程使用 `.runtime/iab-small-batches.mjs` 将原生组合资源 URL 分组上限由 3 KiB 调为 768 字节后，侧栏加载成功。此为临时兼容启动方式，未修改依赖磁盘文件；未进一步区分具体触发因素是组合 URL 长度还是包大小。
- 当前启动元信息保存在忽略目录 `.runtime/sidebar-preview.json`，包含数据根与进程归属，不含登录凭据。
- PASS：监听进程工作目录与隔离根一致；认证后的页面返回 200；Codex 右侧浏览器实际显示教室、大肥鱼、解题者与模型待配置状态。已关闭初次失败的诊断标签页，保留可用页面。
- 此实例带合成 Vault 资料，未启用合成模型。未配置真实模型，未发送教学消息；未改用户 API key。
