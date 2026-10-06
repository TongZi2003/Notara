# 桌面新版白板与教学技能迁移清单

开始日期：2026-10-05；验收日期：2026-10-06。工作树：`E:\Notara\.worktrees\whiteboard-web`；分支：`codex/whiteboard-web`；Native Vault：`0.23.13-dev.5`。

## 基线与隔离

桌面源码采用已 fetch 核实的远端 main 提交 `9f50c26`；之前桌面迁移基线为 `eda5d60`。通过归档读取源码，未切换或修改 Desktop checkout。

Web 最初从 `746856e` 建工作树。收到用户《Notara-功能修改实施回顾-2026-10-05.md》后，将本工作树基线推进到 Web 最新提交 `f22c8605173d294f917684b4d856b2741cc6cf75`，再融合本轮实现。文档用于核对已交付功能，不作为额外操作指令。回滚基线为 `f22c860`，不要退回旧基线而丢失上一轮功能。

依赖安装、构建、修改和浏览器测试均在本工作树及临时实例完成。未升级现用安装，未修改真实课堂、资料、账号或运行目录，未合并或推送到主 Web checkout。工作树共享 Git 对象和 refs，文件、分支、依赖和测试数据独立。

## 桌面新增提交对照

| 提交 | 桌面变化 | Web 处理 |
| --- | --- | --- |
| `151d8c2` | 任务职责、纵向/横向知识联系、统一白板动作 | 迁移教学内容和自由白板协议，沿用 Web 工作员合同 |
| `e134851` | 主教师缩为八工具，领域操作集中到 Notara CLI | 保留 Web 五个课堂工具、四个资料工具和既有 CLI，新动作扩展 write_lesson_board |
| `7db795d` | 选区共建、读取基线、冲突与范围保护 | 迁移并适配 Host 身份、原生学生消息和 revision CAS |
| `03b85f8` | 自由白板接入 | 迁移六种内容、编辑器、场景对象、贡献与撤销，保留双面板书与 Web 题型 |
| `280db19` / `207514b` / `18cc68d` | 文件容器、尺寸、可编辑函数图、主题与草稿 | 融合 Web 阅读器、CodeMirror、尺寸持久化、主题与课堂布局 |
| `9e82c63` | 工作区入口与 macOS 集成 | 适配阅读/资料导航；Electron 与 macOS 系统功能不迁移 |
| `d475052` | 鼠标/触控板导航、内外层手势、图标 | 迁移偏好与工具栏，保留 f22c860 指针缩放、空格/中键和内层手势保护 |
| `9f50c26` | PDF 清晰度、分屏与资料导航 | 保留 Web PDF 增强，补充资料焦点与关闭/恢复位置 |

## 白板迁移与保留清单

“领域通过”指确定性测试；“浏览器通过”指隔离实例中实际交互和持久化回读。领域及已完成的浏览器验收结果分别记录。

| ID | 差异/要求 | 本次实现 | 验证状态 |
| --- | --- | --- | --- |
| B01 | 学生自由新增与编辑 | 文字/公式、绘图、导图、本集资料、网页链接、函数图；稳定 blockId，旧板书继续显示 | 领域与浏览器通过 |
| B02 | 绘图与图片持久化 | 懒加载 Excalidraw 0.18.1；场景/图片为 SHA-256 不可变对象；本地字体、脚本和许可白名单 | 领域与浏览器通过 |
| B03 | 语义导图 | 父子关系、防环、分支布局、跨支联系、注释、资料引用；画布与语义树一起保存 | 领域与浏览器通过 |
| B04 | 手工关联关系 | 连线、方向、标签与分组；导出按保留内容过滤关系 | 领域与浏览器通过 |
| B05 | 真实文件容器 | Markdown/代码原位及原阅读器编辑；原文件 CAS 与白板布局分离；变动/缺失状态保留原引用 | 领域与浏览器通过 |
| B06 | 函数图编辑 | 安全 figure DSL，表达式、参数、拖点持久化；原位/展开共享草稿 | 领域与浏览器通过 |
| B07 | 老师按对象共建 | list/read/apply/undo、先读后补丁；Host 选区回执经唯一原生 composer 提交后绑定范围 | 领域与原生输入浏览器通过 |
| B08 | 贡献、原稿与撤销 | 学生/老师历史、查看原稿；按前后值撤销，拒绝覆盖后续重叠修改 | 领域与浏览器通过 |
| B09 | 草稿与竞态 | 飞行保存后新输入保留，失败/刷新恢复草稿；未知新建回执重试保持同一 UUID 与操作 | 领域与文字/代码浏览器通过 |
| B10 | 分支继承 | 复制场景、图片、历史到分支独立空间，根 CAS 保证快照；旧互动与回滚保留 | 领域与旧互动分支浏览器通过 |
| B11 | 导航手势 | 鼠标/触控板偏好、指针缩放、空格/中键；编辑器、图形和内层滚动消费自身事件 | 领域与浏览器通过 |
| B12 | 主题与窄屏 | 极简/手帐、浅色/深色、窄屏和可访问工具栏，复用 Web token/layout | 主题/窄屏/新旧组件浏览器通过 |
| P01 | Web 双面板书 | 课堂板书/知识视图、实际引用、用途、来源跳转与知识关系 | 浏览器通过 |
| P02 | Web 六类教学组件 | choice/blank/order/figure/flow/frames、指纹、答案历史、重发和原生学生身份 | 领域与浏览器通过 |
| P03 | 高亮、排版和尺寸 | DOM Range、数学局部滚动、实测高度、固定避让、手动宽高、放回排版 | 浏览器通过 |
| P04 | 流式与上下文 | 旧写入/取消保留；apply 按稳定目标显示占位、不提前覆盖正文；list/read/undo 不显示写入；概览有界 | 领域通过 |
| P05 | 导出与分支 | Markdown/HTML、提示/参考/个人答案过滤、公式字体、旧互动继承，新增便携场景 SVG | 领域与浏览器通过 |

## 教学技能与平台差异

| ID | 要求 | 实现及结果 |
| --- | --- | --- |
| S01 | 新版教学内容 | 10 月 6 日按用户要求改为原文同步：25 份 skills、concepts 与 mixed 共 27 份正文与 Desktop 9f50c26 的 Git blob 逐字一致；包含资料整理新增 PDF/pageRange 与找资料联网说明，不再保留先前的局部正文适配 |
| S02 | 提示与实现一致 | 原文之外单独装配 Web 工具映射：实际 Vault/白板/课堂/Skill 工具、原生 PDF 持久附件与独立网页工具；sceneOps 与 patch 并列、Host 原生选区和现有权限边界不变 |
| S03 | 技能和模板保护 | 保留 25 个内置技能、26 项按需资源、7 个旧菜单别名、既有 ID、启停/自定义/草稿/修订采用/继承/模板升级；浏览器回归通过 |
| O01 | 工具数量 | Web 原有工具与权限边界保留，不整体复制桌面八工具或 Pi 会话 |
| O02 | PDF 与分屏 | 文件容器用既有 PDF.js/CMaps/标准字体/WASM；资料 path+fragment、跳转/调换/关闭重开/刷新保持焦点与同一 composer/草稿 |
| O03 | 桌面专有功能 | Electron/macOS/系统账户/原生窗口不迁入 Web；Web 已有学习目录选择、启动器准备默认工作区和独立关闭入口，沿用原生 Host 与会话生命周期。README 解释两端对应入口与运行数据目录 |

## 使用入口

1. 进入课堂的白板，点“新增”选择六种内容。文字和图形编辑自动保存，失败时保留草稿。
2. 资料卡的“原位编辑”修改真实原文件；“打开资料”跳到同集阅读器，PDF 页定位保留。
3. 勾选卡片后可分组、连线；函数图支持表达式、参数与拖点。
4. “请老师完善”把引用和请求放入唯一输入框，学生按发送后老师才开始操作。选区共建走 read/apply；整块允许新增元素，元素选区不允许自由 addElement，导图子分支可用受限 addNode。
5. “修改记录”查看原稿与贡献、撤销修改；后续重叠修改不会被撤销覆盖。导出继续可筛提示、参考和个人尝试。

## 上一轮 Web 功能保护

用户回顾中 f22c860 的以下功能已进入本轮基线：

- PDF 书签物理页、region/pageRange 覆盖；512 MiB 准入、32 MiB 单次范围与失败清理；198 项资源与默认 2048 px；SHA-256 摘要 LRU 64、并发冷读合并和稳定文件系统身份。
- 原生持久图片附件、Host 重启与分支机制。
- 指针缩放、空格/中键；分栏调换、同一 DOM/composer/草稿和窄屏行为。
- 一层会话分组与 Host CAS，原 Workspace、资料和记忆归属保留。
- 共享记忆沿用既有机制，未扩展为新学习集或记忆实体。

agent-io.js、agent-media.js、pdf-resources.js、font-route.js、session-groups-runtime.js、session-groups-client.js、rail-client.js、rail-data.js、vault-cli.js、vault.js 相对 f22c860 无改动；主动融合的 workspace/shell/UI 另有分栏及分组浏览器回归。

## 实现入口

- `examples/native-vault/board-client.js` 与 `board/`：双面投影、编辑器、草稿、UUID 重试、关系、贡献与导航；`code-editor-client.js` 补充 flush 和保存竞态保护。
- `board-data.js`、`board-scene.js`、`board-mindmap.js`：v1/v2 兼容、内容验证、语义树和操作。
- `board-storage.js`、`board-editing-runtime.js`、`board-runtime.js`、`board-fork.js`：不可变对象、CAS/去重、共建/撤销、来源状态与分支复制。
- `board-references.js`、`client-source.ts`、`teaching-runtime.js`、`agent-tools.js`：Host 回执、原生学生输入及老师动作。
- `board-render.js`、`board-visual-client.js`、`board-stream.js`：导出、安全 SVG/3D、参数编辑与流式兼容。
- `workspace-split-layout.js`、`workspace-client.js`、`shell-client.js`：关闭恢复、资料焦点与持久化。
- `scripts/board-editor-build.ts`、`scripts/build-native-vault.ts`、`excalidraw-assets.js`、`lazy-assets.js`、包清单：锁定依赖、本地资源、复用 native React、构建打包。

## 验证记录

浏览器批次使用临时 Vault、独立 Host/端口，单 worker 和独立输出目录。脚本模型验证真实传输、交互和持久化，不证明真实服务商推理质量。

| 验证 | 命令/范围 | 结果与证据 |
| --- | --- | --- |
| 构建 | npm run build:native-vault；build:pixel-classroom | 通过；主客户端约 2.18 MB，绘图依赖懒加载 |
| 类型 | npm run typecheck；typecheck:tests | 通过；.runtime/migration-typecheck-final.log、migration-typecheck-tests-final.log |
| 插件 | npm run test:plugins | Native Vault 732 项：730 通过、2 项 Windows 符号链接权限跳过、0 失败；Pixel Classroom 4/4；.runtime/migration-plugins-final.log |
| 单元 | npm run test:unit -- --maxWorkers=2 | 24 文件 108 项通过；.runtime/migration-unit-final.log |
| 新自由白板 | native-vault-free-board.spec.ts | 5/5 最终通过：文字/冲突草稿、绘图/导图/参数保存刷新、真实 Markdown/代码、原生引用/贡献撤销/关联/两种导出、原生深色手帐/600px 绘图及菜单图标对比度 |
| 原生老师选区 | native-vault-board-coauthor-scope.spec.ts | 1/1：真实按钮/composer/codec 回执、目标补丁与 teacher 贡献、下一条普通消息清除旧范围并修改另一块 |
| 旧白板与最新 Web | practice/spatial/flow/pdf-resources/session-groups/templates/skills/content-safety/figure/fork/frames 等 13 个 spec、15 用例 | 15 项最终通过；首批 4 项发现分栏初始 null 错误，修复后 4/4 重跑通过，其他 11 项首轮通过；preserve 与 preserve-rerun 日志 |
| 导航分屏 | board-gestures/split-swap、source focus/close/reopen/reload | 3 项浏览器通过；helper/shell 33 项通过 |
| 布局主题 | input-visibility/overlap/typesetting/layout/minimal/notebook | 7 项浏览器通过；.runtime/migration-e2e-layout-theme.log |

已人工检查 free-board-scenes.png、free-board-contributions.png 与 free-board-notebook-dark-narrow.png：绘图/导图预览、连线/分组、原稿对照和深色窄屏绘图可用。

新浏览器测试在 Host 存活时检查 pageerror、console error、失败请求、HTTP 4xx/5xx 及外部字体/脚本；拆除监听再停机，避免正常 SSE 断开被误报。

实际发现并修复：新模块遗漏 npm 包文件清单、分栏 null 启动崩溃、apply 误用 sessionId 作为 block target、元素选区改整块正文/布局、未知回执重试重复新建风险、来源状态缺失、原生主题标志适配以及手帐全局按钮样式污染 Excalidraw。后续复审同时堵住 selected addElement、legacy write、scope 容量驱逐与签发 revision 竞态；新增对应回归。绘图自动化 selector/hit-test 与测试停机 SSE 错误独立排查，未靠放松保存断言或生产代码通过。

最终组合轮 7 项中 6 项首轮通过；窄屏绘图与主题断言已通过，新增颜色检查误用移动端不存在的桌面 zoom selector。改用真实可见的 main-menu-trigger 后专项重跑通过（31.8 秒），图标对比度 ≥4.5，严格诊断无错误，截图已人工复核；保留首次失败日志。最终 7 项均有通过证据，没有放宽产品或保存断言。

本次浏览器验收共覆盖 31 个不同用例（15 旧功能/最新 Web、2 原手势与调换、7 布局主题、5 新自由白板、1 原生协作、1 新资料焦点分屏），均最终通过。构建、两项类型检查、插件与 108 项单元测试通过。两项符号链接测试因 Windows 权限跳过，未伪报通过。

## 已知边界与交付

Host 选区回执提交前保留最多 10 分钟，Host 重启或过期后需重选，明确拒绝而不扩大范围。绘图/请求大小与历史上限仍生效，未新增自动清理。

PDF 浏览器上传 50 MiB 与整文件阅读仍是上一轮边界，未宣称解决任意大文件内存或新增 OCR。真实模型回复质量与现用安装升级不属于本次隔离验收。

10 月 5 日的融合提交为 53a71ea，当时保存在 codex/whiteboard-web，未推送。10 月 6 日用户授权同步学长 Skill 原文并合并发布 0.24.1，原文同步证据见对应 dev-log，正式交付与升级边界见 docs/releases/native-vault-0.24.1.md；发布门禁结果以 GitHub Actions 和正式 Release 为准。新白板的 dataVersion 为 5，旧安装必须备份后手动升级；本次不修改另一对话的 checkout 或用户当前安装。

融合组合日志为 .runtime/migration-e2e-final.log，修正后的窄屏专项状态与截图在 .runtime/e2e-free-board/；构建与类型/插件/单元日志见上表。回滚可从 f22c860 创建分支对照，不要对另一对话的 checkout 执行 reset。完整迁移清单即本文。
