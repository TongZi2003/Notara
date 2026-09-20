# Notara Vault 文件层原型

## 目标

在干净的原生 DSH 插件副本中，完成 Vault 的文件事实源、解析、索引、Live Preview 和原生对话桥闭环。Markdown 文件仍是唯一事实源；对话桥只复用 DSH 原生 composer，不新增发送器或会话实体。

## 实际改动

- `examples/native-vault/vault.js`：新增 Markdown frontmatter、标题、heading、Wiki link、Task 解析；路径安全校验；文件树、全文搜索、frontmatter 查询、反向链接和 revision hash；模板投影、模板实例化、Task 切换和 revision CAS 原子写入。
- `examples/native-vault/index.js`：新增独立 `notaraVault` Host Remote。Vault 根目录固定为当前 DSH workspace 下的 `vault/`；`_templates/` 不进入普通文件树和搜索；Remote 边界手动执行输入校验。插件不依赖旧 StudyForge Host、RecordStore 或旧 Notara 代码。
- `examples/native-vault/client.js`：通过 DSH 原生 `conversation.view` 注册「资产」，从 Host 读取真实 Markdown 文件；提供文件树、搜索、页面投影、双向链接、Task 切换、模板新建、CodeMirror Live Preview 编辑器和原生对话桥。页面或所选内容以 reference chip 带入当前 composer，发送时按 revision 重新读取并拒绝过期引用；聚焦/定时索引刷新外部 Agent 的文件修改，未保存草稿保留并提示冲突。
- `scripts/dev-native-vault.ts`：隔离 workspace 预置两页 Markdown 和一个模板，启动全新的 DSH Web 实例。
- `examples/native-vault/templates/`：新增 `lesson.md`、`source.md`、`card.md` 和 `route.md` 四个文件模板；模板本身使用 frontmatter 的 `name/type` 描述，生成结果仍是普通 Markdown 页面。
- `examples/native-vault/package.json`：插件版本升至 `0.2.3`，声明 Remote 协议依赖和模板文件。

## 验证

- `node --test examples/native-vault/vault.test.js`：12/12 PASS，覆盖解析、路径拒绝、树、搜索、查询、反向链接、Task、模板、revision CAS、Live Preview、对话 reference codec 和外部变更刷新。
- 内置四模板首次访问时只补齐缺失的 `vault/_templates/` 文件；用户已经修改的模板不会被覆盖，也不会出现在普通文件树和页面查询中。
- `node --check examples/native-vault/index.js examples/native-vault/vault.js examples/native-vault/client.js`：PASS。
- Node 24 直接加载 `NotaraVaultRemote`：10 个 Remote marker 均被 Gateway 协议识别；临时 workspace 读取、反向链接和 Task 写入 PASS。
- 隔离 DSH Web 实例已启动：`http://127.0.0.1:56772/?token=4MYx2ypOcVGZ3Fk4M12asentAJ-KP3iF3othQWZ1ZaQ`。通过带 token 的 HTTP 请求确认服务返回 200；浏览器交互留给用户验收。

### Remote 接线回归

首次加载时 DSH 报 `client api: generated Remote notaraVault/list field "input" has no strict codec`。根因是 Host Gateway 支持 `src-json` fallback，而浏览器 Client Remote mount 要求参数 codec 必须是 `strict` 并提供 `schema.parse()`。`client.js` 已改为严格的 JSON object transport codec，详细字段校验仍由 Host 端执行；新增回归测试防止再次写回 `src-json`。

- `node --test examples/native-vault/vault.test.js`：8/8 PASS。
- 模板回归后：`node --test examples/native-vault/vault.test.js` 9/9 PASS。
- Node 模拟 DSH Client `$mount`：10 个 Remote 均通过 strict codec 和 `schema.parse()`。
- 修复后的隔离实例：`http://127.0.0.1:51830/?token=s_DRQZdLwix-5Le6r9RyBHjeKSQSzmybCSeN35lDtMY`，带 token HTTP 返回 200。

## 未完成

- 5 已完成 CodeMirror 版本：使用 Lezer Markdown 语法树、光标感知装饰、标题/Task/Wiki 链接/frontmatter/代码围栏样式、Task checkbox widget、撤销重做和原文保存；客户端 bundle 由 `scripts/build-native-vault.ts` 生成。
- 6 已完成第一版：页面/选区通过 DSH 原生 reference codec 带入当前对话；发送时校验页面 revision，外部修改通过索引轮询和窗口重新聚焦刷新；脏草稿不被覆盖。
