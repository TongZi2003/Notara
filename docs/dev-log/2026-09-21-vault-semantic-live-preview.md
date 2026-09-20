# Vault 属性与双向链接渲染

## 目标与原因

用户在原生 Vault 中看到 YAML 属性和 `[[路线/向量路线]]` 原文。此前的逐行正则装饰主要是着色，没有实现属性块和页面导航；此前“完整 Live Preview”的交付说法不成立。

## 实际改动

- `examples/native-vault/frontmatter.js` / `parseFrontmatter`：抽出浏览器与 Host 共用的现有扁平 YAML 解析器；补齐空属性块、CRLF 和独立结束分隔行识别。未引入新的文档实体或存储。
- `examples/native-vault/live-preview.js` / `vaultPreviewField`：使用 CodeMirror StateField 直接提供跨行属性块装饰，按 Lezer Markdown 语法树渲染行内格式。预览展示页面属性和标签；编辑属性或选区覆盖属性块时恢复源码。源码不被预览操作改写。
- `WikiLinkWidget`：`[[路径]]` / `[[路径|别名]]` 显示为可点击文字，复用文件树的页面打开回调；未保存草稿阻止切页，不存在的页面提示后保留当前页面。围栏代码、缩进代码、行内代码和转义文本不创建导航控件。
- `TaskWidget`：修正原控件重复写回同一 checkbox 状态及位置变化后可能复用旧偏移的问题。粗体、斜体、删除线和行内代码使用不同语义样式。
- `client-source.ts` / `CodeMirrorMarkdown`：接入新装饰模块，首次光标放在属性块之后，文件同步不再误报用户编辑；去除重复的类型/状态卡片。主题继续使用 DSH 变量，保存仍走原有 revision CAS。
- 插件版本 `0.2.4`，发布文件包含 Host 所需的 `frontmatter.js`。客户端由 `build:native-vault` 生成。

## 验证

- PASS：Node 24 `node --test examples/native-vault/live-preview.test.js examples/native-vault/vault.test.js`，19/19。新增 7 项测试执行真实 CodeMirror EditorState/Decoration 转换与控件命令，涵盖属性预览、编辑/多选区、非法与空属性、链接导航、代码排除、行内语义、Task 切换与偏移。
- PASS：`npm run build:native-vault`。
- PASS：插件目录 `npm pack --dry-run --json --ignore-scripts`，确认共享解析文件进入分发包。
- 浏览器交互与真人体验：未运行，遵从用户自行验收的约定；状态测试不代表浏览器交互已验收。
- 全仓 typecheck：本轮未运行，本轮没有处理旧插件的类型基线问题。

## 边界

本轮处理属性、Wiki 页面链接及上述行内语义。表格、公式、嵌入与完整 YAML 支持仍不能宣称达到 SilverBullet 全功能水平。后续体验以用户实际验收为准。
