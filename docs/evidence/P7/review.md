# G7 — 本地接线 PASS，真实模型验收 BLOCKED（2026-09-12）

P7.1–P7.5 的代码、配置和本地验证已完成。**G7 的完整真实模型门未接受**：当前缺少 DSH 实模与搜索所需的 `DEEPSEEK_API_KEY`，用户提供的备用 OpenCode 凭据未使用。

## 本地已验证

- Memory 保存真实学生依据；一次观察可存，同名不合并，无两对象门槛/自动认证。修订沿原 target；current/prior 从原版本来源投影。浏览器验证学生改稿、真实冲突、重读合并及窄屏。
- 五个主教学配置由 manifest 提供；完整 systemPrompt 在每次 assembly 读取本课配置和临时要求。真实原生 prepared requests 验证同课修改生效、重启恢复；不会把模型自述当证据。
- 原生 helpers 使用真实子会话、toolFilter 与执行 guard。`native-delegation.test.ts` 四条通过，包含实际子任务读取固定资料、结构化命题由 Host 登记同一未学卡，以及 prose-only 产物拒绝。实际工具清单无递归 subagent/教师写入/学情读取。
- 小结提案冻结真实学生输入截止点和当时材料/写入/待确认事实；学生改正文不改变 snapshot。确认用原生同次发布保存 handoff 与 closure；原课课后可聊，更正生成新版本，接续固定明确选定版本。
- 两个小结/接续 Playwright 文件共五条通过：确认→关闭→课后输入→日历日报→固定版接续。接续按钮实际打开可编辑 composer 并从 UI 发送，未用 RPC 绕过输入缺陷。证明范围包含一个 Playwright runner 内的原生协议场景，并非五条都经完整 UI。

## 证据与边界

`../verification/integration.log` 包含 native teaching/delegation/close 与领域用例；`../P5/browser.log` 包含学情编辑；`../P4/browser.log` 包含教法切换。`browser-review.md` 与 `browser-last-run.json` 记录五条接续验收，截图在 `screens/`。

专项 live 入口覆盖教法切换、自然拆书、命题/帮手、主子搜索、收课接续；缺凭据时明确 BLOCKED。最终 live 日志与场景映射见 `../verification/README.md`。本地可控 adapter、漂亮 Skill 正文和 provider 装配均不能替代这些真实模型证据。

## 审查

独立交叉只读审查了 prompt 更新、Memory 身份、helper 继承边界、原子关闭与固定 pin；未发现未修复的代码阻断。没有进入 P8/P9，也未声称真实学生课堂或长期教学效果通过。
