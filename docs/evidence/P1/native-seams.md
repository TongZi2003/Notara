# P1 原生接缝勘查（不是阶段验收）

2026-09-12；DSH固定0.1.5-rc.2。P1.4只读勘查由Helmholtz返回，主Agent核对安装声明。后续必须写实际行为测试，不能将本文件当G1 PASS。

## 存储

公开`Context`+`Storage`、`JsonStorageBackend`、`DomainFacility`、`defineDomain/domainTable`可直接装配；主Agent实际临时目录探针证实：native table.update并发以版本1竞争只有一个成功，close/reopen保存成功；single JSON损坏报`malformed-medium`。首次探针错误使用`ctx.dispose()`导致退出1，核对官方测试后改`ctx.fiber.dispose()`，复跑退出0。P1.3仍须验证产品操作幂等、进程退出和单写者锁。

JSON per-record会把坏文档读成缺失，不适合作当前学习事实源。single原子写已具temp/fsync/rename，不重复实现。storage-domain在open验证schema，写者须在put/update transform中验证新内容；原生update在write chain内运行，适合版本比较。

## 文件和composition

- `FileSystem`只提供write/edit intents，没有read-intent。`LocalFileSystem.resolve`异步，`contains`同步，读取依真实FsTarget；可在正式composition替换fs provider，用此公开类补读写授权。
- workspaceFiles的`read/readBytes/readAll/readRelated/stat/list`使用session.header.cwd取得根，再调用fs.resolve；cwd只是解析，不是containment。读取authorization需落在这个backend。
- 原生tool-fs走同一fs，grep/glob走subprocess rg，须另由`ctx.tools.guard`同步、单调deny控制。需要核realpath/祖先软链，不能只用字符串前缀。原生bash同样不限制读，本产品composition不裸开放任意shell来绕过文件边界。
- native `agents.create({sessionId,meta:{cwd,agentPreset},setup})`与`agentPresets.mount(agentCtx,id)`可绑定用途composition；`workspaceRegistry.create`/`attachSession`使用可信cwd。已有消息后不能切composition，P7换教法只换配置/prompt。
- 原生typert已提供composition-owned `lookups.configure('workspaceFileScope', ...)`，实际wire键为`workspaceFileScopeId`。Host从native `sessionQuery.observeSession`取得header与agentPreset projection，返回携带session授权的虚拟文件根；fs不按cwd合并不同会话的grants。原生workspaceFiles方法、序列化和change feed均保留，工具调用使用AsyncLocalStorage传递同一绑定。
- rc.2 `dsh-code-runtime-worker-thread`公开声明model code具bash-equivalent trust；PTC不是读取隔离。产品learning/creation都由registry guard拒绝`run_code`及任意shell，不能只检查PTC里已知工具的参数。

安装声明锚：`node_modules/@deepseek-ai/{dsh-fs/lib/types/index.d.ts,dsh-fs-local/lib/types/index.d.ts,dsh-tools/lib/types/index.d.ts,dsh-agent/lib/types/index.d.ts}`。源码锚：官方commit fb2c4b9e698e30edb738bca4cf0618587db7d203 的`packages/{api/workspace-files,fs/tool-fs,fs/tool-fs-search,preset/agent-presets}`。

## 原生能力

`ctx.web.search/fetch`沿provider真实结果。`ctx.subagents`的start/startContinuable/sendMessage/interrupt持有原生子生命周期；独立spawn仍可能继承composition，角色隔离必须看实际出站内容。`ctx.systemPrompt.section({name,order,text:动态函数,complete?})`每次assemble求值；`ctx.skills.registerProvider`返回disposer，provider负责invalidate，官方catalog/get处理来源与按需读取。尚未运行这些组合的产品验收。

本机OpenCode1.18.18的`auth list`显示OpenCode Go已配置；未输出或复制密钥。用户提供另一备用OpenCode密钥，仅当前额度耗尽时使用。当前shell无API_KEY类环境变量；后续live先复用获授权的现有配置，日志不记录凭据。
