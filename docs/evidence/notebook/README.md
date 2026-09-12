# 原版笔记本界面迁入 DSH

日期：2026-09-12。产品与视觉来源固定为 B@`3831987c0568b66b6b43aacaf999760757922e3c`，只通过 Git 读取，没有运行或修改 B。实现位于 `Oh-My-Student-dsh-migration/dsh`。

## 迁入的页面与操作

| 原版内容 | DSH 中的实际入口 | 验证要点 |
|---|---|---|
| 196px 左栏、学字印、主导航/更多、进行中/最近、纸张开关 | 原生 `sidebar.content` 接缝 | 原生列宽解算、折叠、真实 Session 选择；原生工作区/设置仍可打开 |
| 首页四框与手写问候 | `#studyforge/home`，无 hash 的默认入口 | 实际到期与安排；开始学习开新课；有小结时按固定版本接续 |
| 木书架、题签、纸卡 | `#studyforge/materials` | 原件与保存的卡分开读；112×150 书封、7px 架板；导入后选择原件进入完整阅读页 |
| 原文、目录、书中卡 | 阅读页、返回资料、定位原文 | 原版本与 locator；刷新保持阅读位置；卡片来源可回到发起课 |
| 卡片、背面、红笔、共同编辑 | `#studyforge/cards` | 同一卡的真实数据；背面不自动泄漏；编辑/预览两栏、并发冲突保留草稿 |
| 课程/路线/计划 | `#studyforge/courses` | 日期筛选、父子连线、实际摆位、真实开课；手动纸卡在自动布局上方 |
| 学习集 | `#studyforge/sets` | 实际成员/资料/间隔及并发编辑 |
| 学情纸页 | `#studyforge/memory` 与本课入口 | 同一 MemoryPanel 与真实依据；读取不新增观察 |
| 月历/列表/日报 | `#studyforge/calendar` | 42 格月历、实际排课与到期状态、390px 按钮可读 |
| 字迹与纸张 | `#studyforge/appearance` | 七个原字体离线加载、四方案、字号、题面、横线/方格；刷新后返回来源页 |
| 课堂与本课 | `#studyforge/classroom`、本课右栏 | DSH 原生消息/输入/模型/用量；原版纸面与师/我；概况/资料在前，调整本课可展开 |

浏览器 Back/Forward、设置页刷新返回、来源引用中带 quote 的刷新恢复均有行为检查。导航只存浏览器 history 引用，不另建会话或学习事实。打开页面、查看卡片、回源都不推进复习。

## 原生接缝

DSH rc.2 禁止两个注册者重复声明同一子槽。因此没有在新 Sidebar 中重声明原生的六个 `sidebar.*` 槽。`scripts/patch-sidebar.ts` 为原生 Sidebar 增加一个内容槽，并把原注册者的 render 函数作为 props 委托给新外观；声明权和默认 fallback 仍归原生。卸载本插件后恢复原生 Sidebar。

原生默认侧栏最小宽 264px、默认 280px。`scripts/patch-layout.ts` 增加 `setSidebarDefaultWidth`，让 196px、折叠、恢复与右栏布局共用原生解算器，没有用 CSS 偷改网格而使拖动手柄错位。两个补丁都有固定原产物 SHA-256 和逆变换校验；`postinstall` 自动应用，连续两次执行已验证幂等。DSH 升级必须重新核验。

`assets/notebook` 保留七份原字体字节及各自 OFL 许可。Host 字体路由采用固定允许名单；GET/HEAD、未知文件/方法、卸载清理均测试，不提供任意路径读取。

## 证据口径

构建、strict、工具与字体测试日志，页面截图及浏览器结果保存在本目录的 `logs/`、`screenshots/`。浏览器用真实隔离 DSH、临时数据根和受控模型；不是静态 HTML 模板。失败与定向恢复单独保留，不把第一次失败抹掉。提交中的日志仅去除行末空白和文件末尾空行，原始字节仍保留在忽略的 `.runtime/`。

| 检查 | 结果与证据 |
|---|---|
| `npm run build` | PASS；`logs/notebook-final-build.log` |
| `npm run typecheck && npm run typecheck:tests && git diff --check` | PASS；`logs/notebook-closeout-final-types.log` |
| 工具 schema 单元测试 | 5 PASS；`logs/notebook-final-tools-unit.log` |
| 真实 Host 模型工具装配与字体 HTTP | 5 PASS（工具1、字体4）；`logs/notebook-final-tools-integration.log` |
| 浏览器页面/路由/原件/卡片/编辑/计划/原生生命周期 | 33个不同场景各有最终PASS；`logs/browser-latest-results.json`逐项指向日志；不是一次全量33项全绿 |
| 七页1440/390px、课堂、亮暗主题、本课和字迹设置 | 21张真实浏览器截图；`logs/screenshot-manifest.json`给出文件与SHA-256 |
| 64004最终试用更新 | Client构建已复制、入口已更新，运行目录与构建的client.js哈希一致；无认证请求返回401，不能据此声称前端加载成功；最后可见复核因Mac锁屏未完成 |

恢复轨迹：27项页面回归首次20通过/7失败，定向7项恢复6通过/1失败，剩余阅读页另跑1通过；10项最终界面/生命周期检查9通过/1旧文案断言失败，修文案后又发现测试把“开始学习”错当返回旧课，改用“看上次对话”后1通过。真实UI修复包括窄屏reader宽度、课程手动卡片遮挡、书封被版本按钮挤窄与手机日历按钮换行。测试路径更新对应真实交互变更，没有删掉来源、版本、冲突或窄屏断言。

执行入口（Node 24、本目录锁定依赖）：`npm run test:unit -- tests/unit/tool-schema.test.ts`；`npm run test:integration -- tests/integration/tool-schema-projection.test.ts tests/integration/notebook-fonts.test.ts`；`npm run test:e2e -- <logs/browser-latest-results.json中的spec文件>`。各次原输出完整保留。

真实模型另有一条观察：现有 64004 试用实例更新 Host 后，用户 09:51 的输入已得到 DeepSeek-V41-Flash 正常回复。此观察证明该次请求和工具表被接受，不能代替完整教学验收。

工具 schema 全量检查和对课堂模型建议的逐项裁决见 [tool-schema-review.md](tool-schema-review.md)。

## 明确未验收的范围

- 本轮覆盖 P1–P7 已有页面；P8 的扩展/工作台/包管理等未实现页面不伪装成可用入口。
- 原生模型选择、权限、用量、轨迹、设置内部页继续由 DSH 所有；没有声称旧前端所有像素和所有附加页面已经一比一验收。
- 完整 G7/P9 真实模型教学、真人长期使用和跨平台验收未因这次主题与工具表修复自动通过。
- 接续中的到期卡读取工具、自由日程投影与工具可发现性问题列在 schema 核查报告中，未擅自批量改名或改写权限。

现有试用地址仍为 `http://127.0.0.1:64004/`。10:44更新只触及临时运行目录内的Client插件文件、manifest及其插件入口，保留用户数据、模型配置和真实Session；共享4877/15565未重启。Client SHA-256：`a2f3f23c3d1650c63c82dee5eee957f12d5af92269c4ca842357fcb437df082c`。用户解锁后刷新原有已认证标签页即可继续试用；本轮没有绕过锁屏另取浏览器会话。
