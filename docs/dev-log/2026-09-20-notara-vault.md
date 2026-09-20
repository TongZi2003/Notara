# `@notara/vault` 第一轮实现

## 目标

按已确认的组织架构建立独立资产层：Markdown vault 内核、文件树/搜索/反向链接、版本化 Host 写入、原生画布资产面板和对话引用。旧版课程、卡片、路线 RecordStore 没有接入新资产事实源。

## 实际改动

- `packages/contracts/src/vault.ts`：定义 vault 路径、读写、搜索和查询合同，以及文档、摘要、树、搜索命中和链接投影。frontmatter 通过 Typert 可验证的标量/字符串数组值表达，常用 `type`、`tags`、`learned`、`mastery`、`next_review` 可以直接使用。
- `packages/domain/src/vault/vault-kernel.ts`：实现相对路径校验、frontmatter/标题/标签/任务/双链解析、revision、全文搜索、有限 frontmatter 查询、树和 backlinks 投影。没有文件系统依赖。
- `packages/host/src/vault-service.ts`：新增 `studyforgeVault` Remote。根目录固定为当前 workspace 的 `vault/`；跳过符号链接、拒绝越界路径和非 Markdown 文件；保存使用临时同目录文件 + rename，并按内容 revision 拒绝旧草稿覆盖。
- `packages/client/src/vault/VaultPanel.tsx`、`vault.css`：新增原生「资产」workspace view，支持文件树、搜索、frontmatter、Markdown 预览、编辑、保存、反向链接和“带入对话”。`notara-vault` 引用发送前会重新读取并核对 revision。
- `packages/client/src/classroom/workspace-layout.ts`、`LearningWorkspace.tsx`、`client/index.tsx`：把资产面板接入画布的可选视图，默认空课堂仍从对话开始，没有重新启用旧插件工作台。
- `examples/plugins/vault/`：加入 `@notara/vault` 的轻量 Skill/文档包；它声明能力，不复制 native panel 或建立 iframe 工作台。

## 关键修正

- 初版路径函数曾把反斜杠归一化；测试发现这会制造跨平台路径语义漂移，现改为直接拒绝反斜杠、`.`、`..`、绝对路径和 NUL。
- 初版 frontmatter 的 `Record<string, unknown>` 无法通过 Typert Remote 边界；现把远程字段收窄为 JSON 标量或字符串数组，未知常量仍保留在 Markdown 内容中，合同可生成且可验证。
- 资产树使用 Host 返回的 `projectTree`，client 不再维护另一份树投影。

## 验证

| 层级 | 结果 | 证据 |
| --- | --- | --- |
| 合同检查 | PASS | `npm run check:contracts`，96 个同源 JSON schema |
| 类型检查 | PASS | `npm run typecheck` |
| 构建 | PASS | `npm run build` |
| vault 内核单测 | PASS | `npm run test:unit -- tests/unit/vault-kernel.test.ts tests/unit/workspace-layout.test.ts`，8/8 |
| Host 集成测试 | PASS | `npm run test:integration -- tests/integration/vault-service.test.ts`，2/2 |
| 浏览器验收 | PASS | `npm run test:e2e -- tests/e2e/vault-panel.spec.ts`，1/1；隔离实例真实验证树、搜索、保存、刷新读回、反向链接、版本冲突保留草稿和对话引用，控制台无错误 |
| 全量测试类型检查 | FAIL（既有） | `npm run typecheck:tests` 仍有 `teaching-rounds.test.ts`、`tool-disclosure.test.ts`、`journey.test.ts` 的 4 个既有类型错误；新增 vault 测试错误已清除 |

## 未完成边界

当前是第一轮垂直切片。路线/复习只是从 frontmatter 和链接投影出来，还没有独立视图；Agent 专用写入 facade、外部 Obsidian vault 直连、任意 JavaScript 查询、Kanban/Excalidraw/Markmap 视图尚未加入。真实模型教学质量不由这轮资产层验证代替。

## 提交

- `df91072`：vault 设计记录
- `08ecc9c`：实现计划
- `d0866bb`：合同、纯内核和 Host Remote
- `b57a20e`：原生资产面板和 `@notara/vault` 插件包
