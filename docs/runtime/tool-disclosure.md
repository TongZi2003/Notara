# 主课堂工具的常驻门面

当前实现采用「常量 wire + method 门面」。请求里的 `tools` 数组在整课生命周期内不再变化，因此请求前缀对前缀缓存始终稳定；旧实现「目录 → load_tools → 下一步换 schema」会让每次加载重写可见工具集、作废前缀，已退役为兼容回执。

## 门面契约

wire 上常驻 11 个门面工具加内建白名单（`read`/`read_image`/`glob`/`grep`/`web_search`/`web_fetch`/`skill`/`subagent`/`send_message`/`interrupt_agent`/`list_subagent_models`），合计 22 个左右，不随已装 board 或插件数量增长。

每个门面只声明 `{method, input}`：`method` 是 `oneOf` 各分支上的 `const` 判别字段，`input` 原样嵌套被包装工具自己的参数 schema——参数合同只有一份定义，门面不复制、不放宽。分发表 `TOOL_FACADES` 定义在 `packages/contracts/src/tool-facades.ts`，host 分发、历史扫描和前端标签共用这一份。

分发是透明的：`open({method:'material', input:{…}})` 在注册表内调用 `read_material` 的原 `execute`，`render`/`presentationMeta` 转发回内层定义，来源依据 meta、实体引用和图片块照常落地。被包装工具仍注册在案、按原名可直接调用——模型按目录里的旧名直呼也能执行（注册表与 guard 是权威），已恢复的旧会话和既有测试不受影响。

## 守卫与历史

- `installToolAccess` 的 pre-execute 绑定和 `tools/execute` 包装对 facade 调用照常生效；按名挂钩的 guard（helperForbidden、register_cards 诊断门、load_tools 主课堂限定）先经 `resolveFacadeTool` 解析出内层名再套用原判定。
- `observedVersion` 扫描 `tool/call` 时同样把门面调用解析回内层名，「先读后改」的版本绑定不变；提案 origin 仍按 `native` + sessionId + callId，幂等不受门面影响。
- 帮手（helper）会话的 wire 不含门面，原有按名白名单和禁再委派规则不变；帮手经门面绕道时按解析出的内层名命中同一禁令。
- 创作会话与教室同学任务同样看不到门面。

## 发现与说明

系统提示附一节静态「本课能力」速查表：每个门面的 method、对应内部实现名与一句用途说明。它在注册表内容不变时逐字节稳定；新装的板级能力不再改变 wire，只在这节文字里体现。

`load_tools` 仍注册在案但不出现在 wire：旧会话的惯性调用会收到成功回执清单，不产生任何展示变化。

## 验证口径

单测覆盖 `resolveFacadeTool` 的名字/参数解析与映射唯一性（`tests/unit/tool-disclosure.test.ts`）；集成测试沿用原名直接调用的既有断言，并对主课堂 wire 断言 facade 常驻。schema 体积与缓存效果以后续真机证据为准，不从静态结构推断。
