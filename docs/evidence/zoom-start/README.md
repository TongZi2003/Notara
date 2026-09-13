# 关系图缩放与开始页 · 2026-09-13

| 检查 | 结果 | 证据 |
|---|---|---|
| 正式构建、测试类型 | PASS | `logs/zoom-start-build-verified.log`、`start-refine-types.log` |
| 带quote来源拒绝复现 | 修复前 FAIL，修复后 PASS | `logs/book-quote-before.log`、`book-quote-integration-final.log` |
| 目录/题卡固定来源和章节读取 | 7 集成 PASS | `logs/book-quote-integration-final.log` |
| 共用脑图、开始页、设置、拆卡提案、课后小结/接续 | 10个不同浏览器场景最终 PASS | `logs/zoom-start-final-ui.log`（9通过/1旧名称查找失败）＋`zoom-start-recheck-ui.log`（图场景重新通过） |
| 原资料页导入、重名拒绝、版本与刷新 | 3 PASS | `logs/zoom-start-recheck-ui.log` |
| 课堂纸底/表格与确认卡回归 | 1 PASS | `logs/start-ui.log` 中的 notebook-paper-confirmation 场景 |
| 实际PDF只读预检 | PASS | `logs/book-quote-pdf.log`；0写入，字体警告保留 |
| 64004插件快照与实际模块刷新 | PASS | `logs/zoom-start-deploy.log`、`zoom-start-refresh.log` |
| 64004新浏览器预览 | PASS | 实际讲义图展开及50%缩放，开始页、设置可见，console error为空；未发送消息 |
| 真实模型拆卡质量、物理触控板手势 | 未运行 | 自动化使用testModel，Ctrl-wheel事件路径已测 |

合计14个不同浏览器场景最终通过，不把重复执行相加。旧无障碍名称选择器失败日志保留，构建以最后完整执行为准；原始日志在忽略的 `.runtime/`，此目录日志仅规范行末空白。`screenshots/` 全部来自隔离测试，不包含真实学生对话。开始页导入测试真实丢弃Host成功回话两次，验证相同操作重试不复制、保留后来的课程修改；另测上传中切课仍归原课、对话粘贴不被资料导入消费。
