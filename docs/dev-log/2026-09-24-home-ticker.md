# 首页：一个对话入口和单条待办轮换

## 目标与实现

按用户最终修正：首页上方只有一个对话入口，下方仅展示一条近期学习待办，自动向上轮换。保持白底、浅灰按钮；不再展示独立待办本、大标题、推荐网格或长清单。

- `examples/native-vault/today-entry-client.js / createTodayEntry`：单输入框，Enter 开课、Shift+Enter 换行，保留中文输入法保护。待办每6.5秒轮换，可手动前后切换和暂停；悬停、焦点、页面隐藏、离开首页、排课弹窗和减少动态效果偏好时不自动切换。
- `examples/native-vault/today-entry.css / nv-home`：克制的输入框和轻量单行待办区，短距离向上进入动画；窄屏以容器宽度适配。
- `examples/native-vault/shell-client.js / Today`：复用原生开课链，按当前目录读取 `reviewQueue` 和 `routes`。读取成功的部分可独立展示，失败显示重试。复习进入原卡详情；排课弹窗调用 `scheduleLesson`，保存后刷新投影并通知其他视图。
- `examples/native-vault/home-queue.js / homeQueue`：只读投影，交替呈现到期卡片与待安排主线课程，并保持各自原有顺序。首页最多轮换8个近期候选；全量复习与日程仍在“计划”。已排期、开课、有小结与条件分支不当作待安排项。
- 插件版本 `0.16.9`。保留既有白板、知识面与统一课堂顶栏改动。

## 验证

- PASS 构建：`npm run build:native-vault`。修正首次构建发现的括号错误后，重新构建通过。
- PASS 类型：`npm run typecheck`。
- PASS 确定性测试：`node --test examples/native-vault/home-queue.test.js examples/native-vault/shell-client.test.js examples/native-vault/launch-client.test.js examples/native-vault/client-bindings.test.js`，23/23。
- PASS 浏览器：空态仅一个输入框、零待办；合成数据为3张到期卡+2节待安排课程，同时只有1个待办按钮；自动轮换、手动切换和暂停；错误路线不会掩盖可读复习卡，并显示部分读取失败提示。
- PASS 浏览器：安排“椭圆的定义与标准方程”后，待办由5项变4项；同一课程出现在当日日历，源Markdown中 `scheduledOn` 已保存。点击“中点弦的斜率”进入对应复习详情，不改复习档位。
- PASS 浏览器：首页 Enter 将合成提示交给原生新课堂，用户消息可见；写板书时进入既有审批流程。本轮不以此宣称真实教学质量通过。
- PASS 窄屏：390px视口，页面宽390px、首页334px、输入268px、待办292px，无横向溢出。完成后已恢复视口。
- PASS 控制台：本轮浏览器捕获错误0条。截图和采样记录见 `docs/evidence/home-ticker/`。
- 未运行：真实模型、真实学生教学体验。

## 隔离环境与交付

- 工作树：`/Users/yangrundong/DSH-frontend-design`；分支：`codex/notara-modern-ui`，保留既有未提交改动。
- 通过 `.runtime/start-board.ts` 调用 `scripts/dev-isolated.ts / startVaultIsolated`，使用测试模型和合成资料；未修改真实用户目录。
- URL：`http://127.0.0.1:56195/`。
- 数据根：`/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-I6AxSo`；学习文件在其 `workspace/vault/`。
- 没有未完成的本轮首页实现项。后续视觉调整入口为 `createTodayEntry` 和 `today-entry.css`；轮换是近期提醒，全量管理继续复用计划页。
