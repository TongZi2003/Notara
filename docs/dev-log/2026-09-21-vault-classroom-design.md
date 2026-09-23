# Vault 教室编排探查与方案

## 目标与选择

承接 Vault 教学迁移，梳理教室的子代理编排。用户确认同时管理公开同学/助教和教师后台检索、核验、备课，公开发言与后台结果分开。当前交付为设计建议，未修改运行代码。

## 实际工作

- 在 `codex/notara-vault-clean` 工作树保留全部已有修改，主分支仅作只读参考。
- 两个只读子代理分别核对旧教室链路和 rc.2 subagent 接口，报告在忽略目录 `.runtime/classroom-design/`。
- 主 Agent 核对 `ClassroomRuntime.startRequest/publish`、当前 preset/工具过滤、`vaultScopes`、原生 `applyChildComposition/coldResume` 与旧面板引用关系。
- 新增 `docs/migration/2026-09-21-vault-classroom-orchestration.md` 并登记迁移索引：角色/任务分离、公开/后台去向、任务读取范围、原生续接与取消、学生投影、教学与归档接缝。

## 主要裁决

- 采用原生子代理加课堂任务管理；不复活旧提案、插件安装绑定、卡片记录和双回合编排。
- 子代理建议后台保留 generic、角色单独工具。采纳两类任务分离，但要求教学 preset 中所有委派统一登记并校验范围；不能按工具名或模型填写的 label 判断身份，也不能留下不受管理的后台路径。
- 原生冷恢复只保证 descriptor 中的部分配置。课堂的读取范围、取消和发布资格必须另有可重建的 session 事实，并在恢复时生效。
- 旧笔记保存触发阶段不迁入；教学环节使用教师明确标记的检查点，普通文件写入不是阶段完成。

## 验证

- 已核对：目标 checkout、相关源码与依赖接口；两个只读报告的关键结论。
- PASS（文档检查）：`git diff --check -- docs/migration/README.md`；Node 脚本检查三个文档的行尾空白、本地链接存在性与 TODO/TBD 占位，均通过。
- 未运行：类型、构建、unit/integration、浏览器、真实模型；本轮无运行代码改动。
- 未启动或操作服务，未读取用户学习数据或凭据，未提交。

## 下一入口

从新方案的「任务边界」实现，再接当前 Vault bench 与学生投影。先保证供料、读范围、取消和恢复，再迁参与规则与情景资源；保留上一轮教学验收记录，不能以其代替教室验收。
