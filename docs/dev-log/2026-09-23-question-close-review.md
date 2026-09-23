# 一题讨论收束时记录评估

用户确定在一道题讨论结束时记录，并询问保存位置。0.14.3具备评估写入与排期计算，但提示只说“需要保存时”，没有明确收束触发。本轮0.14.4仅更新课堂规则与教学Skill，不增加逐消息hook、运行时事件或新的事实源。

工作树 `/Users/yangrundong/.codex/worktrees/notara-vault-clean/DSH`，分支 `codex/notara-vault-clean`；保留先前所有未提交改动。

## 改动

- `resources/vault-teaching/base.md / 观察与掌握`：一题收束、转入下一题前主动记录，同段讨论一次，纯讲解无学生表现为尚未观察。
- `skills/method-distillation.md / 记录评估与复习档位`：主教师判断自然收束；复用本题卡，缺卡时按真实题面建一题一卡；有真实认知变化先补学生理解，再取最新revision调用record-review。两次写入分别核对，不把正文更新当评估落盘。同段讨论不因课后总结重复记录；不强制补测，服从学生明确不保存的要求与原生权限。
- `skills/vault-workflow.md / record-review`：触发、revision顺序和保存位置同口径。页头review_history保存逐次评估，复习字段同文件计算；正文学生理解保留详细演变。
- `examples/native-vault/package.json`：0.14.4，标准构建同步教学副本；AGENTS与日历复习合同同步。

## 验证与交付

证据目录 `docs/evidence/question-close-review/`。资源登记/副本一致与真实Host合成模型装配测试均沿用现有测试，不新增措辞断言。合成模型能证明最新版Skill正文被加载及命令可保存，不能证明模型每次都会主动识别题目收束。无UI或运行时代码变更，本轮不重复浏览器测试；真实模型自然触发尚未验证。

- PASS：标准构建；`node --test examples/native-vault/teaching-resources.test.js` 2/2；`node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/native-vault-review.test.ts` 1/1；`git diff --check`。均来自本轮修改后的资源。
- 原服务 `http://127.0.0.1:57093/` 已冷启动到0.14.4，数据根 `/Users/yangrundong/.notara/vault-runtime`。两处插件链接、安装资源与源文件一致；7个会话身份不变且空闲。PID45687，launcher PID45672，exec session40462；操作前重新核实这些时效信息。
- 快照vault-plugin-0.14.4，备份pre-question-close-review-1790126714108保存原配置与链接，原0.14.3快照保留。0.14.4读取历史方式与0.14.3一致，未批量改写已有卡片或课堂。
