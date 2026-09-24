# 自由画布、区域流式板书与黑板视觉

> 后续更正：用户明确要白色点阵、手写风格字形、**文字流式**和多色高亮，不要深色黑板或逐笔动画。下面的黑板颜色及截图是已撤回的中间版本；当前方向与验收见 `2026-09-24-whiteboard-text-stream-highlights.md`。

## 目标与最后确认

用户要求设计白板，先讨论再接正式插件。本轮明确选择“自由画布，内容块可拖动”，要求像 HyperKnow 一样在指定区域流式板书，随后要求画布“更像是黑板”。连续纸面只用于导出阅读，不再作为课堂主布局。

工作树：`/Users/yangrundong/DSH-frontend-design`，`codex/notara-modern-ui`，HEAD `5a5886f`。保留已有未提交修改。本轮没有修改正式插件、构建产物、版本、真实学习数据或其他 checkout，没有提交。

## 实际改动与锚点

- `docs/ui/whiteboard-study.html`：独立交互设计稿入口；两面白板、唯一示例输入框、历史/数学/空课堂、导出弹层。
- `docs/ui/whiteboard-study.js / installCanvasBlocks / startBlockDrag / applyCamera / focusBlock`：内容块自由定位，拖动与键盘微调，平移/缩放/全览、教学焦点与用户视角分开。
- `advanceStreaming / streamBlock`：在合成课堂的指定区域增量写出新文本，保留已有文字；支持暂停/继续；换区域时按跟随状态调整视角。合成示例不是实际模型 token 流。
- `setFollow / jump / setReference`：用户移动画布即暂停跟随，提供回到板书位置；资料定位、板书引用与原草稿连续。
- `renderSources / exportSheet / markdownFor / download`：本课示例资料图、来源回跳、移除画布坐标后按阅读顺序导出；未勾选的个人修订/额外提示与参考解释从输出中移除。
- `docs/ui/whiteboard-study.css / Chalkboard direction`：深灰绿整块板面，浅色笔迹，去掉纸卡背景；外围仍白灰。只在选中、拖动或写入时显示轻量边界。字体不加模糊粉笔特效。
- `docs/ui/whiteboard-study-materials/`：5 份明确标识的合成材料；非史料核验结果。
- `docs/ui/2026-09-24-whiteboard-free-canvas-design.md`：记录用户最后选择、空间/流式/视角/Markdown/导出边界与真实接入缺口。

旧 `notara-whiteboard.*` 和旧原型未覆盖，也未将其固定卡片排版当作定稿。

## 验证

- **PASS · 语法**：Node v24.13.0，`node --check docs/ui/whiteboard-study.js`。
- **PASS · 自由画布真实浏览器**：22 项观察断言，见 `docs/evidence/whiteboard-study/browser-checks.json`。覆盖指定区域流式、保留既有内容、另一块不改写、真实指针拖拽、键盘微调、暂停/继续、手动视角不被拉走、换区、草稿、来源回跳、折叠修订、导出阅读序与范围、数学推导、390/320/250px 外壳边界及小屏同一输入框发送。控制台 error/warn 均为 0。
- **PASS · 最新黑板视觉与流式复验**：4 项，见 `chalkboard-checks.json`；验证板面颜色、内容块透明底、唯一输入框、指定区域可见流式光标，并截图检查。黑板 CSS 改动后再次完成流式并重置演示，控制台无 error/warn。
- **发现并修复**：原 `overflow:hidden` 容器在内容变化时发生浏览器内部滚动，导致教师目标区离开视口。改为 `overflow:clip`、关闭滚动锚定并在应用视角时清零滚动；复验换区时 scrollTop/scrollLeft 均为 0，目标区位于画布内部。
- **未运行**：下载后独立 HTML 的离线浏览器兼容性、生产构建/typecheck/unit/e2e、真实模型、真实学生教学、语音、跨刷新保存和真正增量 Markdown 写入。

这些结果只证明设计稿交互，不证明正式插件接线、资料真实性或课程质量。手机证据来自真实浏览器中的定宽 iframe，不是实体手机。

## 预览与服务

原静态服务 `55927` 在本轮中途已不再监听。新独立静态服务：`http://127.0.0.1:58449/docs/ui/whiteboard-study.html`，PID `74050`，服务根为设计工作树，进程会话 `47562`。仅静态文件，不启动 DSH 或接触用户 Vault。没有停止其他运行实例。

截图与记录在 `docs/evidence/whiteboard-study/`：最新看 `chalkboard-overview.png`、`chalkboard-streaming.png`；其他浅色画布截图是本轮中间版本。浏览器交付标签为 19。

## 未完成与下一入口

下一步围绕可见稿调整板书密度和教师放置策略，再讨论正式接入。生产必须沿用 Markdown 内容事实源、唯一原生会话与输入框，并补连续课堂笔记绑定、真正区域增量、版本冲突/中断恢复和本课实际材料范围。不要直接复制本稿的合成状态或示例坐标当作最终生产合同。
