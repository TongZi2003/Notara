# 新课入口版式重排

用户认为上一版布局粗糙。本轮只调整新课入口的构图与层级；工作树 `/Users/yangrundong/DSH-frontend-design`、分支 `codex/notara-modern-ui`，插件版本0.15.3，未合并或更新正式环境。

- `lesson-entry-client.js / LessonEntry`：删除正文中的重复品牌标志；标题与说明左对齐，课程选项和标题同排，展开选项不再向下推挤输入框。缺目录时仍显示原生选择入口。
- `modern-theme.css / .nv-lesson-entry`：将新课主区上移，限制书写区宽度，校准标题和输入边线；加大原生输入的书写高度，以细分隔线区分底部工具栏，保持白底浅灰与克制圆角。样式只作用于 `data-phase=hero`，不改已开始课堂的正文布局。
- 窄面板保留18px标题、13px输入；选项浮层按面板宽度收缩，全部控件留在可见范围内。沿用原生输入组件，没有新聊天生命周期。

验证：`npm run build:native-vault` PASS（5,549,665 bytes）；`npm run typecheck` PASS；`git diff --check` PASS。真实浏览器4项检查通过：标题与输入左边线一致、选项展开不复制输入框、约249px宽时浮层不越界、窄面板实际发送成功并退出欢迎状态。捕获JS error为0。未另跑纯逻辑单测；真实模型和教学质量未运行。

证据 `docs/evidence/lesson-entry-layout/`，包括最终宽/窄截图、选项截图、`checks.json` 与构建/类型日志。最终隔离预览 `http://127.0.0.1:60908/`，父进程64328，数据根 `/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-Pmyr5Y`，仅合成资料和测试回声模型。中间60353实例已停止，旧用户点评页保持不动。
