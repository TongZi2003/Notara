# P1–P7 执行进度

用户授权：执行P1–P7；子Agent不可用时主Agent inline继续。计划为2026-09-11 v2.3，固定产品B@3831987，实施R/dsh，P0/G0已接受a45d9f5/13b5c2e。P8/P9不在本轮范围。

本轮从2026-09-11深夜开始，当前日期2026-09-12。计划v2.3及相关台账原有dirty来自用户文档任务，保留、不混入实现提交。任务实现在依赖就绪后按序，阶段由主Agent审查。

| 阶段 | 任务 | 状态 | 接受证据 |
|---|---|---|---|
| P1 | P1.1 | 完成；主Agent已修核精确版本/空套件失败 | 2026-09-12-DSH-P1.1.md；typecheck/旧依赖保全PASS |
| P1 | P1.2 | 完成；主Agent接手修正初稿 | 14单测/13合同/typecheck/build PASS；p12-*日志 |
| P1 | P1.3 | 完成；主Agent inline | 6集成/2原生浏览器回归/typecheck/build；p13-* |
| P1 | P1.4–P1.5 | 完成；G1 PASS，外部账号项单列BLOCKED | 20集成/14单测/2浏览器/strict/build，2live通过+2账号受阻；P1/review.md |
| P2 | P2.1、P2.3/P2.6后端 | 完成，随G2接受 | P2/backend-integration.log；原生课名缓存追加回归见native-title-regression.log |
| P2 | P2.2/P2.4/P2.5及P2.6/P2.7界面 | 完成；G2 PASS，Trajectory保留原生入口、Raw默认关闭 | P2/review.md；25集成/21相关单测/14不同浏览器场景，精确P2暂存快照build/strict |
| P3 | P3.1–P3.4 | 完成；G3 PASS | P3/review.md；23集成/16 DOCX单测/11浏览器/正式build、Remote、strict |
| P4 | P4.1–P4.4 | 完成；G4本地PASS | P4/review.md；六条真实来源往返，固定版本消息/附件/失败恢复，本地检索与真实保存联验 |
| P5 | P5.1–P5.7 | 完成；G5本地PASS | P5/review.md；卡/知识同身份、持久确认、真实发生日复习、共同编辑/红笔/首学/未知写入重试 |
| P6 | P6.1–P6.6 | 完成；G6本地PASS | P6/review.md；学习集/混合路线/精确计划/共同编辑/日历日报/原文逐层阅读；最终UI返工定向复验 |
| P7 | P7.1–P7.5 | 代码与本地接线完成；G7实模验收BLOCKED | P7/review.md；真实原生请求/子会话/Memory/原子收课/固定版接续通过；专项live缺外部凭据 |

最终命令、日志、截图与源码摘要见 `verification/README.md` 和各阶段 `review.md`；本地可控模型、真实浏览器、真实外部模型三类证据分开。

已核接缝：rc.2 storage-domain.update在原生write chain里比较/发布；JSON single布局损坏报错，per-record会把坏文件当缺失，学习事实不能采用后者。实际跨记录批量卡/骨架/收课现在走同一个原生storage单元的原子发布，跨进程独占与SIGKILL前后恢复已有验证，不自写fsync/journal。Session与原件bytes仍归原所有者。
