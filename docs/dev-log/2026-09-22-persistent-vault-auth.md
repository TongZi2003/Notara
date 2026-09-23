# 持久化 Vault 启动与认证入口

## 问题与实现

之前的试用服务沿用临时测试启动器：随机端口、临时 DSH_HOME、退出删除根目录，并只向用户展示普通 origin。DSH 的浏览器 Cookie 绑定主机、端口和持久签名密钥；新实例或新浏览器没有完成启动 token 交换便会收到 401。正常重启只更换启动 token，不会撤销同 home/authority 的有效 Cookie。

- `dev-native-vault.ts / startVaultPersistent`：一次初始化、固定端口、数据根锁、停止与启动失败不清理数据，现有配置不重置；正式实例不播种示例笔记。隔离模式仍保留原有清理与随机端口行为。
- `dev-isolated.ts / startVaultPersistent`：长期与测试实例共用本仓库启动入口。
- `vault-launcher-state.ts`：校验运行登记与当前启动链接；通过当前链接验证进程后才打开，不复用失效 token，不替换正在运行但状态不明的实例。私有 launcher 文件权限 0600。
- `vault.ts`、`package.json`：`npm run vault` 启动或复用；`npm run vault:open` 重新打开当前登录入口。默认浏览器得到完整有效登录链接，日志不输出 token。
- `migrate-vault-runtime.ts / relocateVaultRuntime`：显式离线迁移，原目录备份、旧绝对路径保留链接，只更新内部 workspace 路径元数据；不改课堂日志，不解析密钥，不移动外部学习文件。

## 验证

- PASS：`npm run test:integration -- tests/integration/native-vault-persistent.test.ts`。真实 DSH 进程与 HTTP，合成模型；验证三个进程启动（首次、同目录重启、迁移后启动）、同端口、旧 Cookie 200、旧启动 token 401、新 token 303、重复启动锁、settings/Markdown 保留、session 身份保留与迁移后续课、launcher 0600。
- PASS：启动器相关 TypeScript 源文件定向语义检查（Node 类型、strict），0 diagnostics；`git diff --check`。
- PASS：用户现有实例迁移前签发的 Cookie，在长期目录的新进程上仍返回 200；真实工作区登记与模型配置原样迁移，未重填密钥。
- PASS：针对实际长期实例执行 `npm run vault -- --no-open`、`npm run vault:open -- --no-open`，均复用 57093 上同一服务，没有创建新进程。
- BLOCKED：内置浏览器自动化仍报告 `ERR_BLOCKED_BY_CLIENT`，未能在那里完成首次认证。Edge 操作被用户切换窗口打断，未宣称新的浏览器 UI 登录验收通过。这不替代已完成的原生 Cookie/进程生命周期测试。
- 未运行：真实模型教学和全仓库测试。只读子代理路由返回 502，主线程完成源码核验和实现。

## 当前实例与回滚材料

- 地址 `http://127.0.0.1:57093/`，数据 `/Users/yangrundong/.notara/vault-runtime`，迁移后服务 PID 39689。
- 原目录备份 `/private/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-sTbwIE.pre-persistent`，旧根路径指向新目录，供原生历史 cwd 与冻结插件引用解析。
- 已停止具有删目录回调的过期包装进程，当前包装只调用持久化 runtime.stop()，不会删除数据。
- 不要再运行旧 `.runtime/launch-live-v011.mjs` 或临时升级脚本启动用户课堂；使用受版本控制的 `npm run vault`。
