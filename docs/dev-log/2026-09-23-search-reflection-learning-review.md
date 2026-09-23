# 找卡片、教学沉淀与学习复盘接入

用户确认先按意图找卡片、老师反思后按对象沉淀、综合近期学习给方向建议三项分工。版本0.14.5，工作树 `codex/notara-vault-clean`，保留所有先前未提交改动。

## 改动锚点

- `resources/vault-teaching/skills/material-search.md`：从自然语言展开结构、方法与经历线索，再原生检索和正文核对；可交给只读 `general` 独立上下文。保留 ID，不引入假想向量引擎或新增子代理身份。
- `skills/teaching-reflection.md`：审视老师的原判断、具体引导与学生承担的认知工作，再决定更新小结、画像、锦囊、路线或提出教学规则修订建议。待检验假设留在小结，无新发现不强造问题和文件。
- `skills/learning-review.md`：近期课堂逐步取证，跨已知授权学习集综合优势、困难、兴趣、目标与知识联系，给少量有依据的优先方向和下一步任务，选定后才交路线规划。
- `manifest.json`：常用菜单显示找卡片和学习复盘，教学反思进入更多技能；与原生 provider 共用登记，共23项资源。
- `base.md`、`method-distillation.md`、`route-planning.md`、`worker-orchestration.md`：按需发现和职责衔接，不常驻加载三份正文。
- `teaching-runtime.js / requestSummary`：收课请求增加简短教师反思要求，仍并入既有小结，不新建记忆生命周期。
- `teaching-context.js / scopeLine`：移除过期的 `scope=all`，明确按已知授权目录原生检索，未覆盖范围保持未知。
- `teaching-resources.test.js`、`tests/integration/native-vault-reflection-skills.test.ts`：检查登记、分组、原生调用装配和普通助手隔离，不钉死教学措辞作为质量断言。
- 当前合同：[找卡片、教学沉淀与学习复盘](../migration/2026-09-23-search-reflection-and-learning-review.md)。

## 保留的能力边界

当前教学预设没有挂载个人文件 Skill provider，写 `.dsh/skills` 不会自动生效；不修改安装快照来伪造自改进。涉及内置 Skill 的改进先保存修订建议，真正应用需后续产品更新。跨集也没有自动枚举工具，`lesson-log`仍是当前集索引；复盘只能对实际取得的范围下结论。

两名只读子代理分别核对原生资源发现/快照边界，以及菜单/跨集合同和四类合成审稿场景。主线程采纳了修订表格与只读资源口径统一、简化菜单描述、按认知贡献表达帮助情境三项调整。审稿不等于模型行为验证。

## 验证

- FAIL（实现前）：资源测试在新 `teaching-reflection` 未注册处失败，确认新增能力尚不存在。
- PASS：标准 `scripts/build-native-vault.ts` 构建；`node --test examples/native-vault/teaching-resources.test.js examples/native-vault/teaching-context.test.js examples/native-vault/teaching-runtime.test.js`，17项。
- PASS：`node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --no-file-parallelism tests/integration/native-vault-reflection-skills.test.ts`，1项真实Host/合成模型验证。三份Skill分别用原生调用进入请求，未选的正文不提前加载，普通助手不取得教学目录。
- PASS：真实内置浏览器隔离验证（临时数据根 `/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-WNmfw0`，63985）：两个常用入口直接显示，教学反思在更多技能；选择仅写草稿，中文“复盘”可检索，合成模型请求仍为0，console error/warn为空。没有运行完整Playwright套件。
- PASS：日常57093实例冷启动到0.14.5，两处包链接和安装资源与源一致，7个原有session身份完整、均空闲。真实浏览器刷新后看到新版菜单和最终描述，输入框仍为空，console error为空。
- PASS：`git diff --check`。
- 未运行：真实模型召回、反思与方向建议的教学效果；全仓库测试。当前完成的是资源/调用/界面接线，不宣称真实课堂质量已验证。

## 交付实例

日常地址 `http://127.0.0.1:57093/`，数据根 `/Users/yangrundong/.notara/vault-runtime`，插件快照 `vault-plugin-0.14.5`；原0.14.4快照保留，配置与原链接备份为 `pre-reflection-skills-1790134330181`。更新不读取完整私人课堂、不改课程与卡片正文，不发送真实模型消息。下一入口是输入框的指令菜单。
