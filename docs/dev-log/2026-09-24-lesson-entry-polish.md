# 新课入口去除原生欢迎品牌

用户标注空课堂的「探索未至之境 / 预览版 / Notara Vault / 教学者」区域要求修改。本轮把它统一为 Notara 新课入口；工作树仍为 `/Users/yangrundong/DSH-frontend-design`、分支 `codex/notara-modern-ui`，插件 0.15.2，未合并或更新正式环境。

## 改动

- `lesson-entry-client.js / createLessonEntry`：轻量 Notara 标识、「新的一课」标题与一句引导；目录和教学模式折叠到“课程选项”。缺少目录时直接呈现原生选择控件。
- `scripts/patch-conversation-views.ts / changes`：增加 `conversation.hero.intro` 狭窄接缝，唯一声明归原生 ConversationRoot。只替换 HeroShell 与选项区，原生输入、附件、引用、提交及 composer seat 均保留；无插件时 fallback 为原介绍和原选项。没有重复声明或借用 brand-mark 槽塞入整块界面。
- `client-source.ts` 注册新课介绍；`modern-theme.css` 设置普通与窄面板字阶、间距。宽屏标题28px，约249px面板缩至18px，输入仍为13px。旧鱼形标志及预览标识不再出现在插件新课入口。

## 验证

- **PASS SDK 接缝安装及幂等性**：连续两次 `node scripts/patch-sdk.ts` 通过摘要门禁和精确锚点检查。
- **PASS 构建**：`npm run build:native-vault`，client 5,547,247 bytes。
- **PASS 类型**：`npm run typecheck`。
- **PASS 19 项相关测试**：`node --test examples/native-vault/{shell-client,launch-client,client-bindings}.test.js`。
- **PASS 浏览器 7 项**：新介绍替换旧欢迎词；唯一原生输入；默认折叠重复目录；展开后原生选项可用；资料引用带入保留草稿；极窄面板无溢出且字号实际缩小；首次发送后介绍消失并进入同一原生对话。捕获 JS error 为0。
- **未运行**：无目录首次启动分支的完整浏览器流程、Windows、真实模型教学质量。测试回复来自隔离回声模型，不能当教学质量证据。附件按钮和原输入生命周期保留，本轮未另跑系统文件上传选择流程。

## 证据与实例

证据 `docs/evidence/lesson-entry-polish/`，含宽屏/窄屏截图、`checks.json` 和构建/类型/测试日志。预览 `http://127.0.0.1:53002/`；父进程59840；数据根 `/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-66ph07`。经 `startVaultIsolated({testModel:true})` 启动，只有合成资料。旧点评页面保留，未在其安装快照上热改。

白板未接入，继续保持用户要求的先讨论边界。
