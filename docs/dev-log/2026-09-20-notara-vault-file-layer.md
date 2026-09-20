# Notara Vault 文件层原型

## 目标

在干净的原生 DSH 插件副本中，先完成 Vault 的文件事实源、解析与索引闭环。Live Preview 编辑器和 DSH 对话桥接属于后续独立设计，本轮不实现、不留入口。

## 实际改动

- `examples/native-vault/vault.js`：新增 Markdown frontmatter、标题、heading、Wiki link、Task 解析；路径安全校验；文件树、全文搜索、frontmatter 查询、反向链接和 revision hash；模板投影、模板实例化、Task 切换和 revision CAS 原子写入。
- `examples/native-vault/index.js`：新增独立 `notaraVault` Host Remote。Vault 根目录固定为当前 DSH workspace 下的 `vault/`；`_templates/` 不进入普通文件树和搜索；Remote 边界手动执行输入校验。插件不依赖旧 StudyForge Host、RecordStore 或旧 Notara 代码。
- `examples/native-vault/client.js`：通过 DSH 原生 `conversation.view` 注册「资产」，从 Host 读取真实 Markdown 文件；提供文件树、搜索、页面投影、双向链接、Task 切换和模板新建。没有 textarea、Live Preview 或对话带入入口。
- `scripts/dev-native-vault.ts`：隔离 workspace 预置两页 Markdown 和一个模板，启动全新的 DSH Web 实例。
- `examples/native-vault/package.json`：插件版本升至 `0.2.0`，声明 Remote 协议依赖和客户端 Remote 运行时依赖。

## 验证

- `node --test examples/native-vault/vault.test.js`：7/7 PASS，覆盖解析、路径拒绝、树、搜索、查询、反向链接、Task、模板、revision CAS 和原子写入。
- `node --check examples/native-vault/index.js examples/native-vault/vault.js examples/native-vault/client.js`：PASS。
- Node 24 直接加载 `NotaraVaultRemote`：10 个 Remote marker 均被 Gateway 协议识别；临时 workspace 读取、反向链接和 Task 写入 PASS。
- 隔离 DSH Web 实例已启动：`http://127.0.0.1:56772/?token=4MYx2ypOcVGZ3Fk4M12asentAJ-KP3iF3othQWZ1ZaQ`。通过带 token 的 HTTP 请求确认服务返回 200；浏览器交互留给用户验收。

## 未完成

- 5. Live Preview 编辑器：后续单独设计编辑模型、渲染和光标/选区同步。
- 6. DSH 对话桥接：后续单独设计资产引用、对话带入、Agent 修改后的刷新和权限边界。
- 本轮没有把 5、6 的半成品能力塞进文件层。
