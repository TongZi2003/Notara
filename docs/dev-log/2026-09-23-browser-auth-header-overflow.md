# 内置浏览器登录：历史 Cookie 导致请求头溢出

## 根因与边界

正确工作树为 `codex/notara-vault-clean`。本轮目标是修复内置浏览器无法登录长期 Vault 实例；保留全部既有工作树改动和用户学习数据。

有效启动链接已经送到内置浏览器，但页面报 `ERR_HTTP_RESPONSE_CODE_FAILURE`；浏览器控制还曾报告 `ERR_BLOCKED_BY_CLIENT`，错误页本身又被 URL policy 拒绝。重启桌面应用后仍可复现，因此这些表层错误不足以确定根因。

最初诊断只监听 HTTP response `finish`，没有记录到浏览器请求，曾推断请求被浏览器拦截。这一推断不完整。补充 Node HTTP Server 的 `connection` 与 `clientError` 事件后，真实浏览器连接触发 `HPE_HEADER_OVERFLOW`：请求在 Node HTTP parser 阶段就被拒绝，尚未进入 `BrowserAuth.authorizeIndex`。

修复后仅统计头部长度与 Cookie 数量：首次请求携带 71 个 Cookie，其中 69 个是历史 `dsh-auth-*`，Cookie 字段为 15,773 字节；再加其他请求头超过 Node 默认 16 KiB 上限。原生 DSH 为不同 Host:port 生成独立 Cookie 名，但浏览器发送 Cookie 时按主机而不按端口隔离，历史随机端口测试实例的 Cookie 因而累计发送。新登录后为 72 个 Cookie / 16,001 字节。没有输出、提交 Cookie 值或启动 token。

裸地址未登录返回 401 是原生认证边界；此次完整有效入口仍失败的直接原因是 431。不能用调整 SameSite、关闭认证或反复换 token 处理请求头溢出。

## 实际改动

- `scripts/dev-native-vault.ts / bootVault.launch`：只给启动的 DSH 子进程增加 `--max-http-header-size=65536`。同一个入口覆盖持久与隔离 Vault。保留有界请求头预算，不修改系统 Node 配置或已安装桌面应用。
- `tests/integration/native-vault-browser-auth.test.ts`：模拟 170 个历史端口 Cookie，覆盖未认证 401、无效 token 401、有效 token 303、认证首页及 index 200、认证 API 200、跨 Origin API 403、超过 64 KiB 仍返回 431。
- `docs/runtime/vault-launcher.md` 与 `AGENTS.md`：补充症状、端口与 Cookie 作用域差异，以及启动器当前行为。

## 验证

- FAIL（修复前的有效复现）：新增集成测试预期 401，实际 431，说明大请求头阻止鉴权 handler 运行。
- PASS（修复后）：`node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --no-file-parallelism tests/integration/native-vault-browser-auth.test.ts tests/integration/native-vault-persistent.test.ts`，2/2。包含真实 DSH 进程、请求头边界、认证拒绝、持久化重启与迁移回归；没有调用真实模型。
- 初次并行运行两文件时，持久化测试因共享教学资源构建目录发生 `ENOTEMPTY`；大 Cookie 测试通过。改为按文件串行运行后两项通过，未把构建目录竞争归因于认证修复。
- PASS（真实内置浏览器）：相同浏览器存储下，完整有效入口 303 → 无 token 首页 200，Notara 主界面可见；原地刷新通过，新标签直接打开普通地址通过。
- PASS（交付实例）：去掉临时探针、以普通启动器重启后，进程命令确认 64 KiB 参数生效，内置浏览器刷新仍保留登录；无 Cookie 的独立请求仍为 401。浏览器无捕获到的 error，仅有主动重启服务期间的 5 条预期连接重试 warning。
- 临时诊断只记录传输元数据；独立调试文件位于忽略目录 `.runtime/auth-probe/`。正式交付服务恢复普通启动，不加载该探针。
- 未运行：全仓库测试与真实模型教学；它们不属于本次 HTTP 登录修复范围。

## 使用实例

长期地址仍为 `http://127.0.0.1:57093/`，数据根仍为 `~/.notara/vault-runtime`。未迁移、清空或改写课堂数据，未清除其他本机站点 Cookie。之后继续使用 `npm run vault` / `npm run vault:open`。

预防由固定端口减少新增 Cookie、64 KiB 有界请求头容纳浏览器的历史 Cookie、以及大 Cookie/非法凭据/超限请求回归共同完成。请求头上限仍存在，不能宣称任意大小 Cookie 均可支持；也不自动清理其他活跃本机实例的登录状态。
