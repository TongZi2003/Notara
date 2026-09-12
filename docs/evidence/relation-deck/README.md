# 关系图工作台验证（2026-09-13）

- `build.log`、`types.log`：正式构建及测试类型检查PASS。
- `unit.log`：20项单元PASS。
- `tools-and-deck.log`：工作台与工具展示3项PASS。
- `sources.log`：来源6项及source-only1项PASS；覆盖PDF四旋转、实际翻页、文本/Word/图片选择、固定卡片版本、原生失败重试与队列。
- `final-layout.log`：末次自适应列宽与节点定位后，工作台/PDF 2项定向PASS。
- `creation.log`：制作会话原生Files入口1项PASS。
- `deploy.log`、`refresh.log`：64004原进程快照更新、新client路径与三个模块state=2。
- `lesson-deck-spread.png`、`lesson-map-narrow.png`：末次宽/窄屏；`source-pdf-rotations.png`：PDF回跳截图。

合计11个不同浏览器场景最终PASS，定向重跑不重复计数。真实页面另外由主Agent目检，实际讲义两份原文与图并排；未发真实课堂消息、未确认待定目录。失败与修正过程见仓根 `docs/dev-log/2026-09-13-DSH-relation-deck-and-tool-sentences.md`。
