# 首页原生输入框、复习汇总与欢迎文字居中

## 已实现

- `workspace-client.js / Workspace`：首页与课堂使用同一对话区域、同一个 `nativeConversationBody`。`TodayEntry` 只切换输入组件周围的首页内容，原生 Lexical 编辑器、附件、指令、底部操作与草稿保持原生所有权。
- `shell-client.js / createVaultNavigation.prepareHome`：进入首页时通过原生 `connectWorkspace` 复用或准备当前目录的空白课堂。不会向旧课堂发消息，不复制、覆盖或自动提交草稿。切页、重复准备与用户选课会使过期准备结果让位。发送成功后切入同一原生课堂。已移除不再使用的独立首页文本交接实现及其旧测试。
- `today-entry-client.js / createTodayEntry`、`today-entry.css / nv-home-welcome`：日期与问候居中，标题和原生输入框间距25px，移除原生欢迎页在首页位置多余的上下留白。
- `modern-theme.css / nv-lesson-entry-heading`：正式空课堂标题严格居中；桌面课程选项靠右且不推偏标题，窄屏放在标题下一行，弹层不超出视口。
- `home-queue.js / homeQueue`：超过5张到期卡合为“×× 张卡片待复习”，使用服务端完整 `total`，不使用当前分页条数。5张以内逐张展示；待安排课程仍独立参与轮换。
- `calendar-client.js / CalendarView`：汇总入口使用一次性 `reviewFilter: due` 导航请求，清空旧搜索、标签和页码，进入到期队列而非虚构文件路径。
- `board-client.js / Board`：删除板书与知识面空态标题、说明及“等待第一笔”；删除对应空态样式，保留读取失败和实际运行状态。
- 插件版本 `0.16.12`。保留工作树中其余已接受的白板和顶栏改动。

## 验证

- PASS 构建：新隔离启动过程中执行 `buildNativeVault`，产物5586643字节。
- PASS 类型：`npm run typecheck`。
- PASS 单测：`node --test examples/native-vault/home-queue.test.js examples/native-vault/shell-client.test.js examples/native-vault/client-bindings.test.js examples/native-vault/remote-client.test.js`，23/23。
- PASS 浏览器：5张卡+2节待安排课程共7项轮换，6张卡聚合后共3项，12张卡仍准确显示12（首页读取分页上限8）；实际点击进入6张到期卡列表。
- PASS 浏览器：先选“全部”并输入无结果搜索，再从汇总入口进入，搜索清空、过滤恢复“今日到期”，6张卡重新可见。
- PASS 浏览器：首页输入原生草稿，切换计划并回首页后原文保留；Enter发送后进入同一课堂，原生消息与合成回复可见，始终仅1个输入组件。返回首页重新准备空白课堂，未把旧聊天内容放到首页。
- PASS 浏览器：空白板及空知识面均无默认说明、无板书块；空态状态文本为空。
- PASS 居中与响应式：桌面正式欢迎标题中心偏差0px，说明居中；390px窄屏标题中心偏差0px，课程选项弹层在71–365px内。首页与正式页无横向溢出。
- 浏览器断言、控制台结果与截图保存在 `docs/evidence/home-native-composer/`。
- PASS `git diff --check`；静态搜索确认没有残留旧首页输入样式、交接代码引用和白板空态元素。
- 未运行：真实模型教学与真实学生体验。本轮运行使用合成回复，不把界面验证作为教学质量证据。

## 环境

- 工作树 `/Users/yangrundong/DSH-frontend-design`，分支 `codex/notara-modern-ui`，基线 `5a5886f`，保留此前脏工作树内容，未提交。
- 最终新实例 `http://127.0.0.1:62494/`，由 `scripts/dev-isolated.ts / startVaultIsolated` 启动。
- 数据根 `/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-E6vJk0`；合成学习文件在 `workspace/vault/`。
- 没有修改真实用户目录。旧预览 `56195` / `61791` 仍绑定旧插件快照，不能代表最终版本。
