# Vault 多类型媒体资产与引用层

## 目标

把 Vault 从只扫描 Markdown 扩展为 Markdown 页面和媒体资产的统一文件层，先完成目标中的前两层：文件识别/保存/打开/嵌入，以及带 revision 的 Markdown 引用。文本抽取、OCR、字幕和全文派生索引留在第三层。

## 实际改动

- `examples/native-vault/media.js`：集中维护媒体扩展到 MIME/媒体类型的映射，支持 PDF、图片、HTML、视频、音频和未知附件；统一生成与解析 `#page`、`#t`、`#rect`、`#anchor` locator。
- `examples/native-vault/vault.js`：Vault 文件树同时索引 `.md` 和二进制资产；新增 `readAsset`、`saveAsset`，读写都使用安全相对路径、原子替换和内容 revision。Markdown 页面仍是查询、反向链接和模板的事实源，媒体文件不进入 Markdown 查询。
- `examples/native-vault/index.js`：新增 `notaraVault/readAsset` 与 `notaraVault/saveAsset` Remote。资产上传限制 50 MiB，类型已知时校验扩展名与 MIME 一致。
- `examples/native-vault/live-preview.js`：`![[资产路径]]` 使用 CodeMirror 语法树变成媒体预览控件；PDF 的 `#page=N` 直接传给预览器。HTML 使用空 sandbox iframe，避免把脚本带入 Harness 主页面。
- `examples/native-vault/client-source.ts`：文件树展示媒体文件；支持导入媒体、图片/PDF/HTML/视频/音频预览、PDF 页码切换、复制嵌入标记、媒体 reference 带入对话；媒体引用发送时只传路径、MIME、revision 和 locator，不把二进制内容塞进对话。
- `scripts/dev-native-vault.ts`：隔离实例增加 HTML 和 SVG 媒体样本。
- 插件版本升至 `0.2.5`，发布包加入 `media.js`。

## 验证

- PASS：`node --test examples/native-vault/vault.test.js examples/native-vault/live-preview.test.js`，22/22。
- PASS：媒体分类、PDF 页码/视频时间 locator 往返、二进制列表、data URL 读取、revision guarded asset save。
- PASS：`npm run build:native-vault`，bundle 1,050,541 bytes。
- PASS：生成客户端、Host、开发脚本和媒体模块 `node --check`；`git diff --check`。
- 浏览器交互与真人体验：未运行，遵从用户自行验收的约定。

## 当前边界

- 第二层已支持文件路径、revision、PDF 页码、视频时间、图片区域和 HTML anchor locator。
- OCR、PDF 文本抽取、视频字幕、HTML DOM 文本索引尚未实现；它们属于第三层派生索引，不能成为事实源。
- 当前上传默认把文件放到 `媒体/`，未提供覆盖已有资产的 UI；Host 已保留 revision CAS，后续编辑器可复用。
