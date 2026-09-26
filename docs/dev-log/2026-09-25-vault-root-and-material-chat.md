# Vault 根目录与资料带入对话

## 目标

修复用户直接选择 Vault 文件夹时 Markdown、PDF 和其他媒体被错误读取到空 `vault/` 子目录的问题；为资料页和图谱页补上进入当前对话的统一入口。

## 实际改动

- `examples/native-vault/vault.js` 的 `resolveVaultRoot` 兼容旧 `workspace/vault` 布局，并识别已选中的直接资料根。旧 `vault/` 有资料时优先保留；直接根已有 Markdown、媒体或约定资料目录时使用直接根。
- Agent IO、Remote、PDF 批注、教学脚本绑定和 CLI 都复用同一个资料根解析，符号链接仍按原生路径安全规则拒绝。
- Host 注入 `DSH_NOTARA_VAULT_ROOT` 与 `DSH_NOTARA_VAULT_PREFIX`，每轮教学上下文带入解析后的资料根；教学资源不再假设固定 `vault/` 前缀。
- 图谱新增 `taggedCardNodes`，标签多选使用交集语义，只选择 `card` 与 `insight`；标签筛选旁显示图标按钮，批量引用通过原生输入引用链路写入当前对话草稿。单节点右键带入仍保留。
- 资料媒体引用改用资料根相对路径，插件版本提升到 `0.16.17`。

## 验证

- `node --test examples/native-vault/*.test.js`：298/298 PASS。
- `npm run check:contracts`：96/96 PASS。
- `npm run build:native-vault`：PASS。
- `npm run test:e2e -- tests/e2e/native-vault-minimal.spec.ts`：1/1 PASS；真实浏览器确认标签筛选图标按钮、批量卡片引用、批量提示、单卡片带入和分屏仍可用。
- 使用临时目录和合成 Markdown/PDF/符号链接验证；未读取真实用户 Vault。

## 未完成

- 本轮尚未提交或推送。
- 真实模型教学质量未验证；浏览器验证使用隔离实例与现有合成课堂。
