# P5后端准备（2026-09-12，G5未接受）

本阶段还需P4真实来源往返与P5界面验收，不能将下列后端证据当成G4/G5。

- Card/Knowledge同身份写者、省略字段保留、作者正文/系统历史分开、真实来源/关系、版本冲突与原operation重放。
- 持久提案、学生改稿、逐项确认；提交未知只允许原稿重试，明确未写的失败可显式重读/rebase。receipt与结果同记录保存；native plugin notice回原课，不当学生作答。
- ReviewService在同一卡记录原子写history/schedule；真实occurrence日、较旧确认只补历史、初/涉不计次、不同判定要求更正。CardChangeView只读精确前后revision，按session选operation，隐藏卡背不泄露旧答案。
- Host已有真实Remote、native读/改/提案/复习工具、版本读取从native工具历史推导、本课输出与全库搜索真实读者。客户端相关入口仍在实施。

证据日志（暂在忽略的`.runtime/`）：

| 日志 | 结果 |
|---|---|
| p5-domain-final.log | 41领域集成PASS：12卡/8知识/11确认/3复习/7变更 |
| p5-native-learning.log | 人建→模型旧读冲突→重读续改→输出/检索→记档→重启PASS |
| p5-native-confirmation.log | 原生提案重启后确认；卡只保存一次；知识同ID收录；plugin回执不成为E，PASS |
| p5-current-contracts.log | 47同源schema PASS |
| atomic-regression.log | 40相关回归PASS，含旧存储6项和两次真实SIGKILL |
| atomic-native.log | 新原子写入4项及上述2条native流程PASS，跨卡/骨架SIGKILL前后只出现完整旧态或完整新态 |

存储调整是为实际批量建卡/骨架改径：领域记录现在处于一个native storage-domain单元，schema和操作归属仍按collection保留；Session/原件bytes不搬入该单元。没有自写fs journal。详见`docs/runtime/storage-decisions.md`。

剩余：模型批量路径的模式授权由P7接上；P6组织/骨架业务仍在实施；系统只处理receipt时的工具过滤由P7完成。实模和真实搜索仍BLOCKED，不能冒称实模教学已验。
