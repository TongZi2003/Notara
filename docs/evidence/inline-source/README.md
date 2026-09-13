# 原生输入引用标签 · 2026-09-13

| 检查 | 结果 | 证据 |
|---|---|---|
| 构建、测试类型 | PASS | `logs/inline-source-build.log`、`inline-source-types.log` |
| 引用框移除，原生标签仍在输入卡片内 | PASS | `source-roundtrip`位置断言与`screenshots/inline-source-chip.png` |
| 课堂资料图、文字、四种PDF旋转、Word、固定版本卡、失败重试、图片排队/插话 | 7浏览器 PASS | `logs/inline-source-ui.log` |
| 64004插件及模块表更新 | PASS | `logs/inline-source-deploy.log`、`inline-source-refresh.log` |
| 64004实际页面 | PASS | 新预览选择原讲义后，原生引用标签在输入卡片内；重复框0个，console error为空；核验后关闭预览，原页保留 |

自动化使用隔离testModel，没有给真实课堂发消息。UI去掉的是重复提示，不是引用功能；生命周期同步保留。日志只规范尾部空白，原始产物留在忽略的`.runtime/`。
