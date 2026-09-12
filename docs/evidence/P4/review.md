# G4 — PASS（2026-09-12，本地原生链）

P4.1–P4.4 已实现。来源读取与消息发送复用 DSH 原生 Session、资源 Tab、队列与附件；只读打开不改变本课材料，也不产生学习记录。

## 接受依据

- `source-roundtrip.spec.ts` 六条 Chromium 路径通过：真实文本选择、四方向 PDF 框选、重复段落 Word 跨块、固定卡 v1、发送失败保留原引用再试、图片附件与原生排队/steer。
- `native-source-context.test.ts` 验证实际原生请求和重启历史仍绑定原件 v1，来源引用不是学生作答。
- `global-learning-search.test.ts`、`search-sources.test.ts` 与 native-learning 验证真实保存后检索、来源解析和阅读授权；外网使用原生 web/provider。
- `book-workspace.spec.ts` 与 `source-only-study.spec.ts` 验证 P5/P6 保存的普通卡沿同一路径回到固定原文，查看不记档。

完整日志：`browser.log`（P4 六条与 P5/P6/P7 五条合跑）；底层集成见 `../verification/integration.log`，命令、最终结果与失败恢复见 `../verification/README.md`。

## 返工

发送冻结完整引用；页面/版本切换清理旧选区，已冻结消息不改。原生 admission 失败恢复原请求，重试不重复接受。初始资料预览等待原生资源注册就绪，并保留已经恢复的有效标签。

## 限制

复杂 DOCX 无法可靠映射时可预览但不能伪造稳定文本锚；扫描 PDF 不伪造 OCR。可控 adapter 验证真实进程与协议，不证明外部模型阅读质量；真实搜索仍单列 BLOCKED。
