# 课堂顶栏合并

用户反馈：课程标题和下方「对话 / 白板 / 教室」像两条顶栏，需要合并。

工作树：`DSH-frontend-design`，分支 `codex/notara-modern-ui`。保留此前所有未提交改动；插件版本提升至 0.16.7。

## 实际改动

- `examples/native-vault/workspace-client.js / lessonHeader、choosePrimary`：课程标题、主视图切换、教学设置、小结、对话/资料面板开关整合进同一条栏。复用原生 Header 的标题和菜单生命周期，不创建第二个输入框。
- `examples/native-vault/modern-theme.css / nv-class-topbar`：桌面端 58px 单行布局，左侧标题、中间视图、右侧操作；窄屏在同一栏内部换行，移除重复的主视图栏。教学者标识、打开外部程序和原生重复侧栏按钮退出课堂主栏。
- 白板内部继续保留「课堂板书 / 知识视图」、保存状态、导出；它们属于当前画布操作。主视图切换到对话或教室时聚焦单面，返回白板时可展开唯一原生对话。

## 验证

- PASS：`npm run build:native-vault`，客户端 5,593,886 bytes。
- PASS：`npm run typecheck`；`git diff --check`。
- PASS：`node --test examples/native-vault/client-bindings.test.js examples/native-vault/shell-client.test.js examples/native-vault/launch-client.test.js`，19 项通过。
- PASS：新版隔离实例真实浏览器。1155px 下只有一个主顶栏和一个主视图 tablist；主栏 58px，画布从 y=200.5 上移至 y=114.5，增加约 86px 可用高度。
- PASS：对话→教室→白板切换保留草稿；教学设置对话框和原生更多菜单可打开；对话面板开关有效，唯一 composer 未重复。
- PASS：390px 下标签均在视口内、无横向溢出；窄屏切换仍保留唯一 composer 和草稿。控制台无 error。
- 未运行：真实模型。此轮仅调整布局与导航，不将合成模型验证写成教学质量通过。

证据：`docs/evidence/classroom-header/desktop.png`、`checks.json`。

预览：`http://127.0.0.1:56423/`。通过 `scripts/dev-isolated.ts` 导出的 `startVaultIsolated` 启动，合成数据根为 `/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-ETAWzg`，未修改真实 Vault 或其他 checkout。旧白板预览仍保留，本轮没有停止用户正在查看的旧实例。
