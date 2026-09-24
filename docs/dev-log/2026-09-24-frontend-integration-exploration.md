# 前端接入探索

用户确认当前白灰主题，要求开始探索接入现有插件。保留先前边界：白板视觉只是机制占位。

只读核对 Native Vault 0.14.9 源码工作树 `codex/notara-vault-clean@5a5886f`，与原型设计工作树同基线；主仓 main 仍为旧提交。未运行构建、测试、浏览器或新服务，未修改生产源码/现有实例/真实资料。

新增 `docs/ui/2026-09-24-native-vault-integration-audit.md`，包含实际入口、令牌映射、数据复用、缺口和实施顺序；校正旧设计说明中的主题入口与首页新课交接假设。

关键判断：独立 Vault 没有启用旧 StudyForge 主题；可直接注册原生 theme override 并调整插件样式。原生发送键前景硬编码白色，需要跟浅灰背景一起处理。现有 conversation.workspace 保留原生输入单挂载，可重组布局。今日/资料库/计划已有大部分 RPC；白板仍缺正式 Markdown 课堂绑定与本课引用范围。`ensureTeachingSession` 不能保证新课，原生 connectWorkspace 和 input.submit 已核实存在。

下一入口：先在基于 5a5886f 的实现分支迁移真实插件主题，独立验收后再接导航与 Today，最后完成白板正式合同。详见审计文档。状态：源码核对完成；实际接入与运行验证未执行。
