# Vault PDF 阅读器与选区卡片

## 目标

修复媒体文件点击崩溃，并把 PDF 升级为专用阅读器：页码导航、canvas 渲染、文字层、矩形框选、框选文字提取为普通 Markdown 卡片。沿用主产品 `packages/client/src/materials/pdf/` 的 pdf.js + Blob worker 方案。

## 实际改动

- `examples/native-vault/client-source.ts`
  - `open()`：媒体路径上 `vault.read()` 抛出的 `vault_markdown_required` 回退到 `readAsset()`，读取失败只显示页面提示，不再冒泡崩溃。
  - `vault`：`ctx.remote.notaraVault` 用 `useMemo` 固定引用。此前每次渲染返回新 proxy，`syncExternal` effect 依赖它导致无限 `list()` 循环（实测约 3500 次请求），浏览器连接池耗尽（`ERR_INSUFFICIENT_RESOURCES`），`readAsset` 被饿死——这是「点了就卡死」的真正根因，PDF 渲染本身 1 秒内完成。
  - `PdfReader`：`getDocument({ data })` 渲染到 canvas，`TextLayer` 生成透明定位 span；拖拽层把矩形换算为页面归一化坐标，对 textDiv 做命中测试得到真实摘录；页码输入、缩放、上一页/下一页。worker 源码以 Blob URL 注入 `GlobalWorkerOptions.workerSrc`。
  - `open(path, notice)` 与 `openedRef`：`selected` effect 跳过已被编程打开的 path，避免重复 `open` 清掉「已提取」提示；`createPdfCard` 先 `refresh()`（不指定 preferred，不触发选中切换）再 `open(path, notice)`，提示是最后写入者。
  - `createPdfCard`：`templates` 未加载时按需 `vault.templates({})` 拉取，避免竞态误报「找不到知识卡片模板」。
- `examples/native-vault/media.js`：`pdf-region` locator，`#page=N&rect=x,y,w,h` 归一化坐标往返。
- `examples/native-vault/pdf.js`：`buildPdfCardContent`（填充 `card.md` 模板，剔除 `template:`/`name:` 标记，写入文件、revision、页码、`pdf-region` 嵌入与摘录）、`cardPathFor`、`quoteFromItems`（按阅读顺序合并选区内文字项）。
- `examples/native-vault/vault.js`：`canonicalLink` 对已知媒体扩展名的目标不再补 `.md`，媒体嵌入不再产生 `媒体/x.pdf.md` 幽灵页面链接。
- `scripts/build-native-vault.ts`：`pdfjs-dist/build/pdf.worker.mjs` 以 `loader:'text'` 内联进 bundle。
- `scripts/dev-native-vault.ts`：导出 `startVaultIsolated()` 供 e2e 复用；示例 vault 播种两页 `媒体/向量讲义.pdf`；workspace 记录写 `realpath` 修复 macOS `/var` 与 `/private/var` 别名导致的会话挂载失败。
- `examples/native-vault/pdfjs-worker.d.ts`：worker 文本导入声明。
- `tests/e2e/native-vault-pdf.spec.ts`：真实浏览器全流程验收 + `/api/notaraVault/list` 请求数上限回归（<40）。
- `scripts/fixtures/vault-pdf-probe.mjs`：手动诊断探针（URL 作参数，打印渲染/选区/卡片状态与页面错误）。
- `examples/native-vault/package.json`：版本 `0.2.6`，发布包含 `pdf.js`。

## 锚点

- `examples/native-vault/client-source.ts`：`open`、`openedRef`、`PdfReader`、`createPdfCard`、`syncExternal` 的 `useMemo` vault
- `examples/native-vault/pdf.js`：`buildPdfCardContent`、`quoteFromItems`、`cardPathFor`
- `examples/native-vault/media.js`：`mediaLocatorSuffix`、`parseMediaTarget`
- `examples/native-vault/vault.js`：`canonicalLink`
- `scripts/dev-native-vault.ts`：`startVaultIsolated`、`samplePdf`

## 验证

- PASS：`node --test examples/native-vault/vault.test.js examples/native-vault/live-preview.test.js`，26/26（Node v24.13.0）。
- PASS：`tsx scripts/build-native-vault.ts`，bundle 4,288,797 bytes（含 pdf.js 与 worker 文本）。
- PASS：`git diff --check`。
- PASS：`./node_modules/.bin/playwright test tests/e2e/native-vault-pdf.spec.ts`——隔离实例中打开 `向量讲义.pdf`、canvas+文字层渲染、拖框、`已框选` 提示、提取卡片、卡片打开且磁盘文件含源路径/revision/页码/pdf-region 嵌入/真实摘录；无 pageerror，`list` 请求 <40。
- PASS（探针）：`vault-pdf-probe.mjs` 对运行中实例复测，框选 `[0.06,0.06,0.84,0.14]` 摘录到三行正文，卡片落盘。
- FAIL（仓库既有问题）：`npm run typecheck` 仍被 DSH session-projection 与 StudyForge Remote 既有类型错误阻塞，本轮未新增诊断。
- 未运行：`tests/live` 模型层。

## 当前边界

- 摘录来自 pdf.js 文字层；扫描件（无文字层 PDF）会得到空摘录，卡片仍保留定位，后续可接 OCR。
- 卡片用 `expectedRevision: null` 保存，同名卡片拒绝覆盖并提示。
- `rect` 是页面归一化坐标，精确到文字层命中；不同 DPI/缩放不影响存储值。
