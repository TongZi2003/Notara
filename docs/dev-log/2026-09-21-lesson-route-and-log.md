# 路线 bench 与课堂小结设计

## 目标与最新裁决

路线保留独立 bench，与对话/思维图/资料并列并可分屏；课堂默认无剧本，用户要求备课时生成资料。有剧本则 append 本次小结到原文，无剧本才生成独立小结；lesson_log 统一索引文件中的小结块。

## 实际改动

- 新增 `docs/migration/2026-09-21-lesson-route-and-log.md`，规定路线视图、可选剧本、明确前课接续、两种小结落点、统一日志、保存后原生归档、错误与重试。
- 更新 `docs/migration/2026-09-21-teaching-memory-loading.md`，加入可选剧本/前课进度加载顺序及新设计引用。
- 新增本记录；未改运行源码、未提交，保留 `codex/notara-vault-clean` 既有脏工作树。

## 核对与锚点

- 两个只读子 Agent 核对原有路线/接续与归档/日志接缝；第三个核对 Vault 的 bench、分屏和原生课堂导航，主 Agent 复核关键实现。
- `RouteDeclSchema.stance` 只是重点，不是完整剧本；已有 `templates/lesson.md` 与 `route.md` 可扩展。
- `continuationBrief` / `handoffCutoff` 提供明确接续版本与真实截止点的既有原则，不整包迁回旧提案审批。
- `archiveSession` 当前只改原生注册表，没有总结因果链；`lesson_log` 尚未实现。
- `createVaultWorkspace` / `VIEW_IDS` 可接独立路线；`conversation.workspace` 不能重复注册；`ctx.sessions.open` 为原生跳转，路线节点到 session 的绑定待接。
- 稳定小结块、统一元数据解析、CAS 追加和跨集来源权限都明确为待实现，不因有 Markdown 编辑器就声称完成。
- 独立审查后，补齐路线关系与知识图计数的投影边界；区分 session 固定的小结目标与单次保存操作幂等身份；路线“再学一次”新增实际课节点、复用剧本，保留旧节点的唯一 session 绑定。

## 验证范围

- PASS（文档层）：源码核对、独立一致性审查及主 Agent 修订；Python 内联检查文档围栏、空白、关键裁决和源码锚点；`git diff --check`。
- 没有启动任何本地服务或读取真实学习数据。
- 类型、构建、单测、浏览器、真实模型：未运行，本轮仅设计。
- 下一入口：按新设计第 10 节实现并验证，特别覆盖有剧本不产生额外小结文件和同剧本多次课堂的精确索引。

## 同日补充：图谱标签与邻接

按用户“简单加进去”的要求，在 `docs/evidence/vault-views/design.md` 增补标签组聚合/展开、一阶/两阶邻接和换中心、组合筛选与空态、多标签去重及真实边汇总；教学记忆设计同步引用。仅修改设计，未修改图谱代码或运行产品测试。
