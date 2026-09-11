# G2：PASS（2026-09-12）

固定 DSH rc.2 / `fb2c4b9`、Node 24.13.0。主 Agent 复核并 inline 修正；没有扩大到 P8/P9。

| 验收面 | 证据 | 结果 |
|---|---|---|
| 原生唯一课程身份、课名、metadata、重启 | native-title-regression.log：6 项，包含关闭 StudyForge Host 的纯原生复现 | PASS |
| 依据、用量、关闭事实、实际产出投影 | final-domain.log：19 项；输出按所属课过滤/对象去重，草稿有独立身份，跨来源顺序保全 | PASS |
| 原生 composer/Queue/Steer/Stop、事件与草稿隔离、Markdown/TeX、刷新/断网/Host重启 | final-browser.log：13 项原生浏览器测试 | PASS |
| 面板持续打开时第二回合的累计用量 | staged-usage-browser.log：3 项（其中新增一项）；切换前后与刷新读回一致 | PASS |
| 可独立提交与构建 | staged-build.log、staged-test-types.log、staged-unit.log：P2 精确暂存快照 build/生成 Remote/strict/21 单测 | PASS |
| 同源契约、全部当前生产及测试类型 | final-contracts.log：16；final-types.log、final-test-types.log | PASS |
| 实际屏幕 | 主 Agent 查看宽屏/390px 本课面板；screens/ 保存截图 | PASS |
| 真实外部模型/搜索 | 缺外部凭据；本阶段均为原生 runtime 加可控 adapter | BLOCKED |

浏览器共覆盖 14 个不同场景；3 项用量复核包含原 13 项中的 2 项，不重复计数。final-unit.log 的 34 项包含已并行准备的 13 项 DOCX 测试；G2 的单测计数采用干净暂存快照里的 21 项。

设计调整：保留 DSH 原生 Trajectory 常驻；StudyForge Raw 默认关闭，且能从 Raw 打开 Trajectory。rc.2 公开 list 槽 API 无法移除其他插件注册的标签，同 ID shadow 会重复。根据用户允许调整设计的授权，不为开关重建原生 Conversation header/registry。普通 Chat 不展示内部提示和路径，Raw 与 Trajectory 仍保存原始记录。

产出 View 目前只接收真实投影合同；P5/P7 才把卡/知识/学情/小结写者接到界面。没有通过假数组冒称产出查询已接通。课程资料的实质预览、来源与组织仍由 P3/P4/P6 验收。

课名修正只更新原生缓存，没有第二名称字段。SDK 全文件摘要固定且升级需重新核验，详见 `../../runtime/native-title-checkpoint.md`。

下一入口：继续 P3–P7。当前 P3 资料版本、读取、DOCX、预览在工作区实施，G3 未接受。
