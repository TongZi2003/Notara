# 知识视图统一为手写风格画布

用户要求知识视图也按已选白板方式渲染。范围为 `DSH-frontend-design` / `codex/notara-modern-ui` 的独立设计稿；未改正式插件，保留已有工作树修改，未提交。

## 改动

- `docs/ui/whiteboard-study.js / renderSources`：去掉旧卡片树，资料名称、类别、使用说明和比较依据作为可拖动的内容区域直接落在画布上。
- `surface / applyCamera / fitCanvas / zoomBy / startBlockDrag`：两面共享平移、缩放、全览、拖动与高亮工具条，保留各自视角和位置；输入框仍唯一。
- `drawEdges`：按节点实际位置计算引用箭头和比较线。节点仍对应本课资料，不是概念或掌握状态。
- 新引用加入时，未手动摆放的节点按当前资料数量重新布局；用户拖过的节点保留位置。修复了初始单节点位置与新增节点重叠的问题。
- `docs/ui/whiteboard-study.css / Both faces share`：点阵、楷体字体栈、局部颜色及轻量关系线，与板书面一致；资料读取弹层和回跳行为保留。

验证与截图见 `docs/evidence/whiteboard-study/knowledge-canvas-checks.json`、`knowledge-canvas.png`。语法与浏览器交互验证仅覆盖合成设计稿；生产接线、真实模型、真实教学与跨刷新保存未运行。

- **PASS · 语法**：Node v24.13.0 `node --check docs/ui/whiteboard-study.js`，以及 `git diff --check`。
- **PASS · 浏览器**：13 项。包括点阵/手写/高亮一致、3 节点不重叠、唯一工具条/输入框、移动后连线更新、打开来源与回跳、草稿保留、真实文字选择高亮、独立缩放与切换保留、空资料、跨示例资料范围、零控制台异常，以及交付状态复核。
- **未运行**：本轮未重跑实体移动端、导出离线文件、实际模型与生产插件测试。知识面的新资料当前按演示引用直接加入；真正模型增量流与持久化仍待生产接线。

预览仍为 `http://127.0.0.1:58449/docs/ui/whiteboard-study.html`。下一入口继续讨论可见画布布局，再按 Markdown 课堂笔记与唯一原生会话边界接入插件。
