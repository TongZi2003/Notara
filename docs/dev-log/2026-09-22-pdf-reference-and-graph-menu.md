# PDF 引用发送与图谱右键

## 目标与实际改动

- 用户在 `57093` 的 0.11.0 课堂发送 PDF 引用时看到 `quoteFromItems is not defined`，并报告图谱右键不可用。
- `client-source.ts / pdfReferenceText`：补回 `pdf.js` 的 `quoteFromItems` 导入。此前 esbuild 会成功打包，直到引用 codec 序列化时才抛错。
- `canvas-client.js / Board`：右键和 Control+点击在取消默认事件、拖拽捕获之前退出；点击/双击也排除上下文菜单手势，菜单事件停止冒泡。
- `views-client.js / GraphView`：上下文手势不触发左键关闭菜单，打开菜单时取消尚未执行的详情计时器。
- `canvas-client.js / CANVAS_CSS`：窄视图将详情放在画布下面，限制详情高度，不再隐藏整个画布。原页面分屏的窄图谱只显示详情这一状态已在用户页面观察到。
- Native Vault 升至 0.11.1，重新构建 `client.js`。

## 验证

- PASS：新增 `client-bindings.test.js` 在修复前准确报告缺失的 `quoteFromItems`，修复后通过。检查真实入口的未绑定标识符，不用字符串断言函数导入。
- PASS：新增 `canvas-client.test.js` 的右键、Control+点击两例修复前失败，修复后通过；普通左键仍选择节点。
- PASS：`node --test examples/native-vault/client-bindings.test.js examples/native-vault/canvas-client.test.js examples/native-vault/remote-client.test.js`，11/11。
- PASS：`npm run build:native-vault` 与 `git diff --check`。
- 已观察：合成 Remote 数据的真实浏览器组件页中，右键显示菜单且不选择节点；480px 视图打开详情后画布仍可见且能再次右键；真实打包引用 codec 读取合成 PDF 第 2 页，返回正确页码和该页文字，不再抛缺失函数错误。
- 上述页面只是组件验证，不能记作原生课堂完整 E2E。临时 fixture 的 scope.effect 适配器还曾产生一条 `endsWith` 错误（无 label 的 effect）；适配器已调整但未重新开启测试页。用户询问临时页面后已关闭该页和对应服务。未宣称控制台零异常。
- FAIL（既有测试漂移）：合跑 `vault.test.js` 时 22 项中 21 通过，`declares strict client codecs...` 仍在单个 `client-source.ts` 内匹配 `saveAsset`，而方法清单此前已移入 `remote-client.js`。本轮没有改动这条旧断言；单独的 Remote 合同测试通过。
- BLOCKED：完整原生隔离实例在内置浏览器的本地登录跳转被拦截；用户正在使用 Edge，未继续抢占窗口。只读子代理调用也因上游 502 未完成，主线程独立定位并修复。
- 未运行：真实模型授课、完整仓库测试、更新后的用户课堂发送操作。

## 当前服务

- 原地址仍为 `http://127.0.0.1:57093/`；新服务 PID `24274`，版本 0.11.1。
- 保留同一运行数据根 `/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-sTbwIE` 和原工作区登记、模型配置；没有重新播种资料或复制用户学习文件。
- 本轮先复制到新的 `vault-plugin-0.11.1` 快照，再停止该实例旧服务子进程、切换插件登记并在相同端口重启。原 `vault-plugin` 快照保留，旧 cordis patch 另存 `pre-v0111-cordis.patch.json`，未原地改写旧插件快照。
- 原启动包装进程的停止处理会删除整个 runtime，所以没有终止它；新的受控启动包装只停止服务，不删除数据。后续不要用旧包装进程的 SIGTERM 来关闭已投入使用的实例。
- PASS：读取新服务实际 boot HTML 中广告的带 revision 插件 URL，HTTP 200；返回脚本包含 PDF helper 定义、上下文手势保护和保持画布可见的窄布局。
- 下一入口：用户刷新原课堂页面，继续使用已有 PDF 引用草稿；不要把本轮临时组件页当成产品入口。
