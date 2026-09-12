# 原件预览接缝（固定 rc.2）

实施使用 npm 锁定的 DSH `0.1.5-rc.2`、`pdfjs-dist 6.3.289`、`docx-preview 0.4.0`（Apache-2.0），原有依赖版本保持不变。以下 API 从实际安装包公开声明及实现核对；最终浏览器验收单列于 P3/G3。

## 身份与权限

`MaterialService` 管 `materialId/versionId`、版本摘要、不可变原件及当前指针。`resolveForSession` 校验真实原生 Session 的 workspace/purpose/read grants 后，调用官方 `fileAddressFor(sessionId,cwd,path)`；同书同版本不按课复制。DSH 地址是传输引用，来源事实仍用固定版本及 locator。

资料页的 `bytes/get/list/read/docxIndex/skeleton` 使用已认证 Host 的唯一学生 workspace，调用方不能提供另一个 workspace/root。阅读不创建 Session、不写课堂状态。原生文件 Remote 继续经过 P1 的实际文件读取授权；预览标题使用资料名，不展示 Host 绝对路径。

## 原生与新增部分

- `ctx.sidebarRight.openResource`、`sidebarRightTabs` 与 `sidebar.right.pane.tab` 负责课堂标签/分栏/所属 Session。回调必须保持发起 Session；不能在异步解析后借用别课。切课保留原生内存布局，浏览器刷新不承诺恢复全布局。
- `ctx.documentPreviews.register` + `sidebar.right.tab.document` 是公开格式扩展。正式 `DocumentPreviewProps.content` 提供 text pages 或完整临时 bytes；没有将原件 bytes 存进 Session JSON 的理由。
- 原生 document owner 的加载、重读与标签生命周期保留。单纯资料页阅读没有 Session，不能把原生 Session 预览强行挂到那里，也不为阅读新建占位课。
- Markdown 使用公开纯 React `MarkdownText`，沿原生 GFM/KaTeX、安全协议与原始 HTML 展示策略。PDF 的窄 adapter 使用公开 PDF.js API，并在两个入口复用；不依赖浏览器内置 PDF 插件。DOCX 使用公开 `renderAsync`，不用实验 parser 节点定义身份。
- CSS/KaTeX 字体和 PDF worker 随 Client 构建。CSS 由插件生命周期释放；worker 使用本地源码创建的 Blob URL，不从 CDN 加载。

## 坐标与原文

- PDF：物理页从 1 开始；canonical rect 在 crop box、rotation=0 的视口中归一化。显示旋转/缩放不改源坐标。原文读取返回实际页图；无文本层不虚构 OCR，裁区也不附带全页文字冒充选区文字。
- 图片：原件字节不改，规范坐标基于应用 EXIF 后的图像。返回裁图经过真实解码/裁切，附实际尺寸及同版本引用。
- 文本/Markdown/代码：原文行从 1 开始，列为 0-based UTF-16、末端不含。选区引用的 quote 必须等于固定版本实际区间。
- DOCX：主文档 WML 段落/表格结构 path 为 blockId，重复文字不改变身份；offset 为 UTF-16。XML namespace、编码、ZIP 解压上限经过校验。页眉/脚注等暂只预览，不伪造 Word 页码；DOM 对应不完整时不能按相似文字猜位置。

P3 证明导入、读取和预览；四格式的实际选择/发送/重启/来源回跳由 P4 完整验收。视觉显示不能替代定位证据。

## 模型读取

`list_materials/read_material/preview_region` 挂到原生 tools registry。读取使用真实调用 Session 的授权；图像经原生 `attachments.saveImage` 形成 durable image reference，进入下一模型请求，不把 base64 文本当作看图。模型不支持图像时明确拒绝。

rc.2 工具只支持有限 JSON Schema。`tools/tool-schema.ts` 从同源 Zod 生成结构 schema，数值/长度等剩余约束在模型可见描述中保留，并继续由完整 Zod 在执行前与输出渲染前校验。异构 tuple/未知结构不静默放宽；注册失败会让 Host 插件初始化失败，不隐藏到未观察的子插件里。
