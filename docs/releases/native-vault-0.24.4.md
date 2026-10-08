# Notara 0.24.4 · 长对话保护与历史回读

0.24.4 增加长对话预算保护、分层摘要和本课堂历史原文检索，并修复 ChatGPT 重放与远控模型设置。发行流程将在 `v0.24.4` 标签的发布门禁通过后提供安装 ZIP、Windows 免安装包及校验清单；资产生成后可从 [GitHub 0.24.4 发布页](https://github.com/TongZi2003/Notara/releases/tag/v0.24.4) 下载：

- `notara-0.24.4.zip`：Windows 快捷安装包。
- `notara-portable-0.24.4-win-x64.zip`：Windows x64 免安装包。
- `notara-portable-0.24.4-win-x64.zip.sha256`：免安装包 SHA-256 校验值。
- `notara-update.json`：安装 ZIP 的版本、兼容性和 SHA-256 更新清单。

## 长对话保护

- 教师在完整请求组装后检查输入预算，保护最新学生消息，再通过一个原生压缩事务整理旧历史。明确的上下文溢出可有界恢复；认证、网络等失败仍如实返回。不会清空课堂来绕过失败。
- 默认软保留在小型旧范围被完整移除仍无法达到规划目标时，可扩大到更大的合法旧范围；显式 retention 不覆盖。最新真实 user 消息与完整工具配对受保护，原文保留与摘要请求次数上限不变。
- 内置固定版本的 Billion-context/acp-kernel 纯核心，分层摘要保留当前目标、条件、更正、待办与来源。模型网络请求、凭据、课堂权限和压缩提交继续由 DSH/Notara 管理。
- 压缩前把本课堂规范原文归档到本机私有目录。教师可按需搜索、分页回读压缩前的对话与普通工具记录，也支持小数和数字编号。
- 检索调用及其配对回执保留原文，搜索时排除它们，避免重复检索内容挤占真正的原始记录。重启、分支、删除和取消均按原生课堂身份处理。
- 优化大量历史记录的删除清理开销；保留已提交的删除标记、分批取消和重启续清理机制，其他课堂仍可独立保留。
- 续课与摘要规则分开记录题目布置、学生实际作答、教师评价和独立掌握。新增深化要求与原任务分开；旧待办须结合后来的原始回应重新核对。

## ChatGPT 与远控修复

- ChatGPT 流式响应按最终输出条目保留真实文本与工具调用。空或不完整的完成事件不覆盖已经收到的内容；不适用的旧重放记录回退到规范历史。
- HTTP 和流式错误中的上下文溢出采用一致分类，持久失败记录只保留安全的状态码与请求标识。
- 修复远控页面合并脚本里的连接模块识别，让受信任 HTTPS 远控页面正确进入模型设置。旧浏览器缓存可经 `/login` 清理后重新登录。
- Chromium 品牌检查通过（1/1）：初始 HTML 与 Web App manifest 标题为 Notara「拾页」，课堂页标题保留“课堂名称 — Notara「拾页」”前缀；重命名和刷新后均正确，未发生 page error。
- 发布包携带 Billion 固定源码、摘要清单与原始许可证，安装和更新时可以按锁定输入重新构建；不把整个 vendor 缓存目录打入发布包。

## 验证范围与限制

`0.24.4-dev.2` 在官方 DeepSeek 接入上完成一组 12 轮合成课堂测试。三次计划压缩和四次自动压缩均提交成功，计划来源覆盖完整；模型自主搜索并完整回读了早期原话“绿色标签，0.037厘米”。

该轨迹仍出现两处任务完成状态误判：把未作答题目记成答过，以及在学生补出解释后仍沿用旧待办。因此这次 12 轮测试的任务完成状态结果为第 5/12 轮失败。后续通用状态与来源提示增强只通过确定性 smoke，尚未用真实模型复验其效果，不能称长期教学质量全部通过。一次合成课堂也不能代表检索可靠率或完整费用。

2026-10-08 发布冒烟通过：160 项单元测试、3 项真实 Host 上下文集成、2 项 Chromium 页面测试，以及 1 项下载更新包后安装、重启并保留课堂和文件的集成测试。源码与测试类型检查通过。测试数据均为隔离的合成资料。

另一次全量本机门禁通过：插件测试共 973 项，971 项通过、2 项跳过、0 项失败（Vault 969 项中 967 项通过、2 项跳过；Pixel 4 项通过），包含九万条历史记录删除、中断及 SQL 失败恢复；单元测试为 42 个文件、198 项通过；源码与测试类型检查均通过。此处全量门禁、上面的发布冒烟，以及功能列表中的 Chromium 品牌检查（1/1）分别记录，不合并相加，以免重复计数。

Windows 90,001 条历史记录删除压力的同机临时目录对照发现，使用系统 `TEMP`/`TMP` 时超出默认30秒期限；同 VM、同 fixture 和断言改用 `runner.temp` 后，删除耗时4,189ms，3/3项测试通过。Windows GitHub Actions 中只有历史删除压力fixture与独立门禁使用 runner 临时目录；其余测试、构建、依赖安装、打包及产品归档位置不变，沙箱测试保留原有ACL父路径。[对照任务](https://github.com/TongZi2003/Notara/actions/runs/37801843552)因第一步系统临时目录检查失败，整体仍为失败，第二步 runner 临时目录检查通过。这项结果只覆盖专项压力检查；正式发布仍由完整 Windows/Linux 门禁验证。

本轮发布门禁诊断还修正了三处测试夹具/接缝：PDF 合成测试未声明图像定价，触发 32768 的未知价格失败；现在通过精确 mock route 声明 256 的非零图像价格，不改变真实 provider。冷启动时，原生 system 新 series 按当前 GUI origin 重整，同时严格核对旧 non-system 节点与 wire prefix，同 series full prefix 仍严格匹配。长程 fixture 按精确 requestId 跟踪原生 terminal，不再从请求数量推测回合完成，失效工具结果不会冒充本轮结果。

此前一轮本机专项为3类集成检查4/4通过、单元测试43个文件201/201通过；新增事务回归核对默认软保留扩展和显式保留不扩展。随后一次全量 Windows 集成（38个文件）为36通过、1失败、1跳过；测试结果为145通过、1失败、1跳过，唯一失败是更新安装遇到锁心跳竞态并触发回滚。`proper-lockfile` 在正常 unlock 后迟到的 heartbeat `stat` 得到 `ENOENT`，并被上报为 `ECOMPROMISED`。`vault-root-lock.ts` 仅在锁路径确为当前实例所拥有且已开始 release 时忽略该迟到回调；活跃 owner 的 compromise 仍正常报错。

此前版本的锁模块单元测试5项、更新安装定向集成3/3（217.13秒）和迁移/持久化专项2文件6/6（48.97秒）均通过；更新用例中的故意启动失败用于验证回滚。随后新增 `scripts/vault-owned-launcher.ts` 并接入 `vault-supervisor`：IPC ready 时保存准确的 Host PID、parent PID、auth URL 与原始字节。stop 只有在 Host 和 worker 都退出且启动代次仍匹配时，才通过正常 runtime root lock 清理自身 stale launcher；foreign launcher、新代次、存活进程和 `EPERM` 均保留，锁争用最多等待15秒。父监督器覆盖 hard kill 后子进程来不及清理的情形；`taskkill` 返回 root-not-found 不作为进程树全部停止的证明。

该 launcher 的 pure unit 共8/8通过；新增4项覆盖默认终止遇到 `EPERM` 或进程仍存活、Host 已退出但 parent worker 仍存活、runtime root lock 等待15秒到期，以及 IPC capture 不匹配时拒绝清理。本机 recovery 集成1项通过，用时55.56秒，包含最终 `SIGKILL` 崩溃并保留原有 origin、session、sentinel 与 turn 断言。源码与测试 TypeScript 检查通过。新增更新 fixture 输出 phase、毫秒耗时与归档字节诊断；Windows CI 仅该 fixture 使用 `RUNNER_TEMP`，`NOTARA_TEST_UPDATE_STORAGE=system` 用于同 VM 对照，不修改全局 `TEMP`/`TMP` 或产品数据目录。手动 workflow [windows-update-check.yml](../../.github/workflows/windows-update-check.yml) 将在同一 VM 比较 system-temp 单安装与 runner-temp 的完整更新3项加 recovery1项，沿用240秒期限。

随后本机更新安装定向集成 `npm run test:integration -- tests/integration/native-vault-updates.test.ts` 为1文件3/3通过，用时218.85秒；覆盖正常安装保留课堂与文件，以及故意启动失败后的自动回滚。该次运行使用旧 Vitest console 输出版本，没有可用的逐阶段计时，故不列阶段耗时。正式 workflow [run 37814513349](https://github.com/TongZi2003/Notara/actions/runs/37814513349) 的 Linux 检查通过（全集成134通过、13项平台跳过；E2E 87通过、1项既有跳过，约21.1分钟），Windows 有3项失败，集中在 recovery 与 updates。新手动同机云端对照尚未运行；该版更新专项本机通过不代表 Windows 门禁通过。0.24.4 尚未发布。

调整后[Windows 文件IO专项复核](https://github.com/TongZi2003/Notara/actions/runs/37804992632)26/26通过：历史压力端到端3,450ms，PDF范围拒绝与后续读取恢复233ms，原Low-token权限读写196ms。PDF防挂检查仍保留5秒，只将大文件准备与首次哈希移到计时外；其他文件测试继续使用系统临时目录。这些专项检查与上面的全量本机门禁分别记录。

确定性模型测试只验证接线和状态行为，不代替真实模型语义验收。本轮未增加真实 API 调用，也没有升级用户正式实例。

搜索和每次回读均有上限；未命中不能证明某事从未发生。思考与附件不作为归档检索正文。原始对话保留在本机不意味着每轮发送全部历史，模型仍可能误判摘要或检索证据。

## 下载与升级

本版保持数据格式 Version 5，安装与更新不会迁移课堂数据。已有兼容版本可在「设置 → 更新」检查，并在课堂空闲时重启更新。手动换程序目录仍须先停止服务，保留运行根和学习目录备份，按[安装说明](../install.md)执行升级。

Windows x64 用户可使用上述免安装包；Windows 快捷安装包需完整解压后运行 `install-notara.cmd`。下载资产由 0.24.4 正式发布流程生成并上传，当前说明列出预期文件名，不表示这些资产已生成。固定上游版本和许可见 [vendor/billion-context](../../vendor/billion-context/README.md)。
