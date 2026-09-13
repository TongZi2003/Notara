# Student workspace cleanup evidence

2026-09-13。DSH 0.1.5-rc.2 / Node 24.13.0，inline implementation and review。

`ui-cleanup-build.log`：正式 build PASS。`ui-cleanup-types.log`：测试 TypeScript PASS。
`matrix.md`：27 个不同 Playwright 场景，以最后一次针对该场景的结果去重，全部 PASS。测试使用独立端口、临时数据、可控模型，不是用户的 58354。

保留失败与恢复顺序：

- `ui-cleanup-e2e` → `ui-composer-final` → `ui-home-final`；`ui-memory-final`；
- `ui-extended` → `ui-extended-final` → `ui-settings-final`；`ui-course-final`；
- `ui-latest` → `ui-workbench` → `ui-workbench-final`；
- `ui-final-detail` → `ui-native-final` → `ui-book-final`。

初始问题包含原生插槽所有权、已移除入口的旧断言、窄屏设置真实布局问题；最终使用实际新入口，未通过扩大超时、强制点击或恢复旧界面掩盖失败。书籍新几何断言验证节点不被裁切、窄屏目录铺满。

`ui-whiteboard-preview.log` 记录同一 58354 的客户端摘要与保留数据状态。匿名 HTTP 401 是原生认证预期；已通过认证的实际浏览器显示新界面。浏览器目检额外发现窄屏目录收缩，修复后运行 `ui-book-final`。截图取自独立夹具；不保存用户的书籍正文或凭据。

未运行真实模型教学质量；不把本地接线与截图证明当作诊断质量或学习效果证据。日报推荐及卡片/书籍整体视图重设计不在本轮完成范围。
