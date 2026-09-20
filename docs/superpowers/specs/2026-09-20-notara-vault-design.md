# `@notara/vault` 第一轮设计

## 目标

建立一个与旧版课程、卡片、路线 RecordStore 隔离的 Markdown vault 能力，作为 Harness 的资产层。第一轮必须能让用户在画布中浏览、搜索、阅读和编辑 vault 文件，并把当前文件内容作为引用带入当前对话。

## 边界

资产事实只存在于当前 DSH workspace 下的 `vault/` Markdown 文件。Host 负责路径安全、解析、索引、版本和写入；client 负责画布中的资产面板。会话、世界书、子 Agent、运行轨迹和权限仍属于 Harness 会话层，不写入 vault 事实。

第一轮包含：

- 相对路径安全校验和 Markdown 文件树；
- YAML frontmatter、标题、标签、任务和 `[[双向链接]]` 解析；
- backlinks、全文搜索和有限的声明式 frontmatter 查询；
- 带 expected revision 的原子保存和冲突拒绝；
- 文件变化后的索引刷新；
- 画布资产面板：树、搜索、阅读、frontmatter、编辑、backlinks、带入对话；
- `type: route`、`type: card`、`next_review` 等字段作为查询视图数据，不建立第二份路线或复习事实。

第一轮不包含：任意 JavaScript 查询、Excalidraw/Kanban 编辑器、旧版课程/卡片 RecordStore 迁移、Agent 专用写入通道、真实用户 Obsidian vault 直连。

## 结构

新增 `packages/contracts/src/vault.ts` 定义 Remote 输入输出和文件投影；新增 `packages/domain/src/vault/vault-kernel.ts` 处理纯 Markdown 解析、路径校验、索引投影、搜索和查询。新增 `packages/host/src/vault-service.ts` 提供 `StudyForgeVault` Remote，并在 Host `apply()` 注册。新增 client vault view，使用原生 workspace view 接入画布，不依赖 generic iframe workbench。

Remote 第一轮方法为 `list`、`read`、`save`、`search`、`query` 和 `links`。模型不能填写 workspace/session identity、实际文件系统路径或版本；这些由 Host 绑定并返回。

## 数据流

```text
vault/*.md
  -> Host 安全读写
  -> VaultKernel 解析与索引
  -> StudyForgeVault Remote
  -> VaultPanel 画布资产面板
  -> 当前对话引用
```

保存必须携带读取时的 revision。revision 不匹配时返回可识别的冲突结果，面板保留用户编辑内容并要求重新读取。保存成功后 Host 更新索引并返回新的文件投影，client 刷新树、当前内容和 backlinks。

## 验证

确定性测试覆盖 frontmatter round-trip、双链/backlinks、路径越界拒绝、搜索/query、版本冲突和空 vault。浏览器验收覆盖文件树、阅读/编辑/保存、刷新后读回、冲突提示和“带入对话”。构建、类型检查和测试结果写入对应 dev-log，并区分静态、确定性和浏览器证据。
