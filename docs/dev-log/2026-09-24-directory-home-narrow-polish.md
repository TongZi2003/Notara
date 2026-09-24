# 目录选择、首页入口与极窄分屏

用户本轮要求：移除难看的工作区展示，找一处选择目录，侧栏只列该目录会话；随后补充首页上半部太单薄，以及极窄对话面板需要自适应字号。

工作树 `/Users/yangrundong/DSH-frontend-design`，分支 `codex/notara-modern-ui`。保留前轮全部未提交改动，插件版本 0.15.1；未合并、未更新正式用户运行目录。

## 实现锚点

- `shell-client.js / Sidebar`：品牌下方的目录选择按钮，底部工作区树删除。弹窗列出已登记目录，可填写新目录路径，也可浏览文件夹。通过 `workspaces.create` 和 `uiWorkspace.openWorkspace` 接入原生目录与会话；浏览依照 Host 能力使用 `listDirectory` 或 `pickDirectory`。选择错误保留输入并显示失败，关闭选择器后忽略过时结果。
- `shell-client.js / selectedVaultDirectory, directoryLessons`：按原生 `WorkspaceView.sessionIds` 匹配，而非路径前缀；同名会话不混淆，排除空白、后台与归档记录。今日的“继续学习”采用同一范围。新课明确继承该目录，当前会话清空时保留仍存在的选定目录。
- `today-entry-client.js / createTodayEntry` 与 `today-entry.css`：补上辅助句、三种开口方式、资料库/路线/复习各自用途；学习起点只填入空草稿，有内容时禁用，不代发；Enter、Shift+Enter、输入法组合沿用明确提交边界。组件样式跟随组件卸载，不遗留全局 style。
- `modern-theme.css`：侧栏目录控件、选择弹窗及路径省略；删除旧 Today hero/launcher 死样式。以每个 `.nv-pane` 为命名容器，在 420px 以下缩放原生标题、输入字号、边距与工具行，保留全部操作。页面窄不等于窗口窄，桌面分屏也触发。
- `client-source.ts` 注入 TodayEntry 与目录 Dialog；`ui-client.js` 补文件夹图标；`shell-client.test.js` 补目录成员过滤、归档/空白/后台排除、当前与保留目录优先级、空目录及多目录开课合同。

## 验证与发现

- **PASS 构建**：`npm run build:native-vault`，最终 client 5,544,507 bytes。
- **PASS 类型**：`npm run typecheck`；客户端 JS 的视觉行为仍以浏览器为准。
- **PASS 54 项单元/接缝**：`node --test examples/native-vault/{shell-client,launch-client,client-bindings,remote-client,canvas-client,lesson-data,review-data}.test.js`。
- **PASS 最终真实浏览器 11 项**：两个独立目录各开课后只列自身会话；空目录不显示其他目录课堂；切回后旧课草稿仍在；今日最近课堂范围一致；选择器无横向溢出；学习起点只填未发送草稿且不覆盖原内容；极窄面板仍可实际发送。
- **PASS 极窄实际字号**：桌面分屏左区 248.75px，原生标题 26→18px、输入 14→13px，输入卡片宽 218.75px，没有横向溢出。截图和实际计算值见证据。
- **未运行**：真实模型教学质量、Windows/macOS 原生文件夹选中完整流程、远程 browse Host 完整流程。本机系统选择器调用有返回但没有完成选中目录，不能当作完整验收；目录路径登记与已登记目录切换已真实完成。

两个开发中问题均由真实运行发现并修正：重复声明已有 `conversation.hero.workspace` 会使插件退回原生界面，因此最终没有新增/抢占该声明，直接使用现有服务 API；命名容器查询名称后缺空格导致字号未变，已修复并用实际 computed style 复测。中间失败保留于 `checks-51356.json`，不把构建通过当浏览器通过。

## 预览与证据

- 最终预览 `http://127.0.0.1:59173/`，父进程 56830；数据根 `/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-bcIObf`。
- 入口为 `scripts/dev-isolated.ts / startVaultIsolated({testModel:true})`；原资料与第二目录均是该临时根中的合成样例，回复为测试回声。
- 用户正在点评的旧预览 62824 本轮暂保留，其他由本轮替换的失败验收实例已停止；正式数据及共享服务未动。
- 证据目录 `docs/evidence/directory-home-polish/`；`*-final.png` 与 `checks-final.json` 对应最终构建；构建、类型、测试日志分别存档。鉴权 URL 只留在 `.runtime/modern-preview.json`。

白板仍不在实现范围，需先讨论最终设计。
