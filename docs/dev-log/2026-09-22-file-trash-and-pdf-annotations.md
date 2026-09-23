# 文件回收站与 PDF 原版区域标注

## 范围与版本

在 `codex/notara-vault-clean` 完成 Native Vault 0.9.0 代码。合并本轮文件删除、扩大 PDF 阅读区、图层/高亮/批注、图谱卡片定位与移除低质量逐页文本拆卡需求。保留此前 0.8.5 的隐藏面板 `display:none` 修复。

## 文件删除

- `vault.js` 的 `trashFile` / `listTrash` / `restoreFile`：单文件移入 `.trash/<host>/<id>/`，保存原始 payload 与元数据，不提供永久删除或目录递归删除。原路径、文件类型、软链、revision 均检查；移动后再次核对被移动的内容，并发变化时回滚或保留可恢复版本。恢复使用 hardlink 或独占创建复制，不能覆盖现存文件。
- `index.js` 的同名 Remote 方法通过 `storeFor` / `editorFor` 绑定工作区，Host 生成身份与删除时间，`remote-client.js` 为统一方法清单。没有增加模型工具。
- `file-actions-client.js` 的 `useFileActions`：删除确认、回收站列表、恢复与冲突文案。
- `assets-client.js`：文件树右键和“文件操作”可移到回收站；文件列表操作可打开回收站；当前文件有未保存修改时阻止删除。删除后清理已打开内容并刷新；外部移走文件时，保留脏草稿，不展示旧媒体为现存文件。
- `views-client.js` 的 `GraphView`：右键删除作用于菜单目标；移除已删除节点的详情、焦点与菜单状态。

## PDF 阅读与标注

- 删除 `splitPages` / `createPages` / `split=pages` 的主动入口与调用链，包括图谱右键与阅读器按钮。已有低质量卡片没有自动删除。
- `ui-client.js`、`client-source.ts`：PDF 占满资产页可用区域，移除普通文章的最大宽度与大留白；工具栏固定，页面单独滚动，图层面板按需展开。
- `pdf-annotations.js` 的 `createPdfAnnotationStore`：原 PDF 不变；图层与矩形标注记录写入 `.notara/pdf-annotations/<path hash>.json`。文件记录 schemaVersion、path、pdfRevision、layers、annotations；annotation 包含 Host id、layerId、page、normalized rect、note。校验路径/存储目录软链、数量上限和双版本 CAS，写入用临时文件与 rename。
- `pdfAnnotations({path})` / `updatePdfAnnotations({path,expectedRevision,expectedPdfRevision,action,...})` 由 Host 绑定工作区。actions 包含图层和标注的增改删，不新增模型工具。
- `pdf-annotations-client.js`：多图层、四种颜色、图层显隐、框选高亮、批注修改、删除标注、删除空图层。原 PDF revision 改变时隐藏旧标注并拒绝自动重绑。
- `PdfReader`：页面仅按原版绘制，选择区域不再自动抽取文字。创建区域卡片前先保存标注；返回已保存标注时定位到对应页面并滚动到区域。
- `pdf.js` 的 `buildPdfCardContent`：普通 Markdown 卡片保存原始区域嵌入和学生批注，不复制传入的 `quote`。`media.js`、`graph.js` 保留 page、rect、annotationId 和 revision 定位，叶子和中间卡片的来源均可跳回原页标注。
- `live-preview.js` 的 `MediaEmbedWidget` 通过注入的 `renderPdfPreview` 用 canvas 绘制原版裁切区域，不用浏览器 PDF `<object>`。引用 revision 过期时提示核对原文，不显示旧坐标裁切为准确引用。
- 教学 base 与 Vault workflow Skill 明确：公式、图形、表格必须通过页面图像核对；不得逐页复制文字层批量制卡。

## 检查与未验证边界

- PASS：最终 `npm run build:native-vault`，客户端 5,398,100 bytes（Node v24.19.0）。
- PASS：修改的 JS 模块 `node --check`，`git diff --check`。
- 同步更新已有 PDF 卡片与 PDF E2E 断言以匹配原版区域引用合同；这些测试未执行。
- 用户明确要求不继续验收，因此本轮未跑 unit/integration/e2e、浏览器或真实模型，不宣称持久化、恢复和交互已通过行为验收。
- 尚未验证：删除并发/磁盘异常回滚、跨进程标注写入冲突、各种 PDF 旋转页面与移动端图层布局。当前标注存储只在本 Host 串行化同资源写入，不宣称跨进程锁。
- 当前 `http://127.0.0.1:60242/` 仍为 0.8.4 独立快照。没有修改其安装快照、清理其文件或重启它，用户导入资料与未发送草稿保持原位；下次安装/启动 0.9.0 时加载本轮改动。
