# `@notara/vault`

这是 Notara 资产层的插件包描述。运行时能力由 DSH Host 的 `studyforgeVault` Remote 和画布中的原生「资产」视图提供；这个包不创建 iframe 工作台，也不维护第二份资产数据库。

当前第一轮支持：

- workspace 内 `vault/` 目录中的 Markdown 文件树；
- YAML frontmatter、标题、标签、任务和 `[[双向链接]]`；
- 全文搜索、有限的 frontmatter 查询和反向链接；
- 带版本检查的保存、冲突拒绝和文件变更刷新；
- 选中文件后带入当前 Harness 对话。

常用 frontmatter 字段可以包括 `type`、`tags`、`source`、`learned`、`mastery` 和 `next_review`。路线、卡片和复习视图都从这些文件投影，不另存一份路线或学习事实。

当前运行时只访问当前 StudyForge workspace 下的 `vault/`，不会直接打开用户的 Obsidian vault。Agent 修改文件时必须先读取当前版本，保持 Markdown 修改小而可审阅，并让 Host 处理路径和版本边界。
