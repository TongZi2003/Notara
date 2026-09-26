# 资产菜单与整文件带入

## 实际改动

- 资产文件树右键改为固定定位的菜单列表，加入“将整个文件带入对话”；顶栏按钮明确为“带入整个文件”。无会话时通过原生新课入口获取会话，失败显示明确提示。
- PDF/媒体的嵌入操作改为“复制并带入对话”：继续复制 Markdown 嵌入标记，同时把当前页或选区带入当前对话。
- 图谱对 `card`/`insight` 叶子节点隐藏拆分动作，只保留“带入对话”；有子卡片或资料节点仍可“带入对话拆分”。

## 验证

- Native Vault 单测：300/300 PASS。
- `npm run check:contracts`：96/96 PASS。
- `npm run build:native-vault`：PASS。
- 真实浏览器 `tests/e2e/native-vault-minimal.spec.ts`：1/1 PASS，覆盖右键菜单、整文件带入、图谱标签批量带入和分屏。
- `npm pack --dry-run`：`@notara/vault-native@0.16.17` 内容完整。

## 未完成

- 本轮尚未提交或推送。
- 真实模型教学质量仍未验证。
