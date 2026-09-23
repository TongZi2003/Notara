# Vault 教学迁移实施记录

目标：完成总合同 A+B+C，仅迁功能与教学资源，不导入旧学习数据。工作树 `codex/notara-vault-clean`，起点 `6592886`；保留此前 Vault/UI 未提交修改，未改主分支，未提交或合并。

## 实际改动与入口

- 基础教学：`teaching-runtime.js` 的 `installTeachingRuntime`，默认原生教学预设；同课教法、目标、临时要求，首发前可设。`teacher.js` 在预设作用域注册资源，普通助手不加载教学目录。
- 持久化：`teaching-state.js` 的 `appendTeachingEvent`，三类扩展事件带 ignorable 信封；rc.2 append 接缝由 `patch-session-extension.ts` 保证，真实 JSONL 冷读与实例重启均验证。
- 模型 IO：`agent-tools.js` 单点合同，`agent-io.js` 调原生文件服务、路径校验与 CAS；`agent-media.js` 真实渲染 PDF 页/选区/图片，不支持视觉时如实报错。Remote 与模型按真实会话的注册工作区定位同一 Vault。
- 记忆：`learning-data.js` 画像/锦囊候选与有界原文；`teaching-context.js` L0 最多 1200 字符，不逐轮扫描全库。设置与冻结的任务背景单独计量。跨集只查已接入范围，仍由原生文件服务读取。
- 路线与日志：`lesson-data.js` 共享解析；`openRouteLesson` 重复开课复用会话，“再学一次”新增节点。开课固定资料引用、剧本片段和明确前课进度。
- 收课：`prepareTool` 在输入入日志后、批准前固定总结截止点；`writeSummary` 原文追加或独立保存，再验块并原生归档。旧操作重试不倒退正文，新输入阻止隐藏会话；首存后落点固定，跨集解绑不误写同名文件。
- 界面：路线独立分页、统一画布、锦囊节点、标签分组；设置小图标、原生单输入框、分屏；草稿刷新恢复。小结在资产编辑器显示正文，内部块元数据不进入日常预览。
- 启动：`startVaultIsolated({testModel:true})` 捕获实际请求并支持重启；实例内插件快照避免并行构建导致热重载。Node 使用本机 24.19.0。

## 验证与已处理失败

最终分层证据、命令和截图见 [验收报告](../evidence/vault-teaching/verification.md)。主要首次失败已保留原因：Cordis 初始化返回 Service 导致卸载；未知事件缺 ignorable 导致冷读拒绝；assembly 过早冻结截止点导致永不归档；HTML 按钮误放 SVG 导致节点不可见；共享构建产物导致实例热重载；草稿适配缺少 Map.has 影响图谱跳到资料。均按实际失败补接缝或浏览器复验。

独立审查发现的跨集小结目标、未注册根目录和缺文件重试问题已修复。复审确认没有新的阻塞问题。原始审查记录保留在 `.runtime/teaching-implementation/`，不是运行依赖。

## 剩余边界

真实模型 API Key 未配置，实际教学质量、三个任务 Skill 的真实模型正常任务以及语义主动召回质量尚未验收。合成适配器只验证装配与运行接线。全仓测试类型检查还有三份未改旧测试的既有错误，产品类型检查和构建独立通过。用户真实 Vault、旧学习数据及共享服务未操作。
