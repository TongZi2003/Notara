# 章节拆卡接线证据 · 2026-09-13

范围：选章节→原生课堂请求→题卡提案→学生确认→原章节投影。原生 queue/steer 管理发送，inline/subagent 是老师的执行选择；无第二套任务系统。

| 检查 | 结果 | 日志/场景 |
|---|---|---|
| 正式构建、测试类型 | PASS | `logs/node-cards-build.log`、`node-cards-types.log` |
| 同源合同 | 84 PASS | `logs/node-cards-contracts.log` |
| 任务恢复、队列取消、调用截面、节点数/去重/固定版与来源codec | 20 PASS | `logs/node-cards-unit.log`（17）、`node-cards-source-codec.log`（3） |
| 实际书籍/章节写者与教学/回执 | 9 PASS | `logs/node-cards-integration-final.log` |
| 空闲时章节拆卡完整链 | PASS | `logs/node-cards-e2e-complete.log` |
| 忙时原生 queue→steer，章节、确认、重启、回原文；图片来源与内联确认回归 | 3 PASS | `logs/node-cards-native-final.log` |
| 保存后切回关系图的可见回看 | PASS | `logs/node-cards-map-final.log`；同一核心场景末次定向验证与截图 |
| 资料书图、课堂工作台、固定旧卡、内联确认 | 4 PASS | `logs/node-cards-e2e-verified.log`；其中新拆卡测试当时因按钮旧名字失败，已在后续完成日志恢复 |
| 中文公式资料与图片浏览 | PASS | `logs/node-cards-native-steer.log` 的第二个测试；第一个测试的失败在后续修复 |
| 64004最终插件更新 | PASS | `logs/node-cards-deploy-final.log`、`node-cards-refresh-final.log`；原进程及课堂资料保留 |
| 真实模型本轮拆卡/委派质量 | 未运行 | 浏览器使用隔离原生 runtime 与测试适配器，不支持语义/教学质量结论 |

7 个不同浏览器场景有最终 PASS，表中重复运行不重复计数。截图 `screenshots/` 来自隔离真实浏览器。任务来源不会显示在排队/待插话气泡中，但仍保留在原生消息里；任务转换为插话后完整来源和挂点保持。

## 失败与恢复

初次测试原件第三行只有4字却给到列5，真实来源校验正确拒绝，修正fixture。重启后需要从原生最近课程重新选择原课；随后发现同一卡同时以章节节点和课上产出显示，产品显示合并后通过。回原文按钮实际名为“打开原处”，修正测试定位。

入库日志只规范行末空白，原始命令输出仍保留在忽略的 `.runtime/`。

插话初测按15秒等候，但fixture长回复还未结束当前步；改为有界慢回复。过程暴露真实待插话气泡未清理来源；尝试包装整个chat父视图时触发重复children声明，插件装配失败。撤回该方式，仅增加带原生回落的待插话显示接缝，最后三项重新通过。失败日志保留在 `logs/`，中途基于旧构建启动的运行已中止，不计验证结论。
