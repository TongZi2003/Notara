# 0.24.4 撤回记录与后续修复入口

> 状态：公开发布与安装资产已撤回，推荐安装版本为 0.24.3，机制修复尚未继续。本文记录全部版本改动、产品缺陷、历史验证和回退边界；完整191文件清单及14提交记录附于文末。历史 CI 通过不代表真实长程课堂验收通过。用户运行记录、账号、个人路径和课堂内容不属于公开文档。

## 撤回事实

- 版本：`v0.24.4`，标签指向 `07ec6dba9a3e7212bd766381062fc5f0efc15e68`；基线：`v0.24.3`，提交 `ffd28cec620b7d172263ff65b3387d7de846b038`。该范围为 14 个提交、191 个文件、31,580 行新增和127行删除，包含产品、构建、测试、CI、许可和文档变化，并非单一功能提交。
- 发布：2026-10-09 02:28:33（北京时间）。2026-10-09 08:22 后按用户要求转为 draft；08:24:25 四项 Release 资产删除完成，GitHub Release ID `407141565`。公开 latest 已核对为 `v0.24.3`。
- 回退范围：Native WebUI 与独立 Electron 桌面端分别管理，回退 WebUI 不应替换 Electron 的桌面或开始菜单入口。
- `v0.24.4` tag/提交仍作为源码与证据锚点保留，不等于公开可下载版本。之后修复应基于明确分支另行提交，不能改写本记录中的历史事实。
- Release 的四个安装/清单资产已逐项删除，当前资产列表为空；原公开元数据、四个资产的校验副本和完整性验证回执保留于本机私有工作证据目录，不重新上传。

## 实际问题与证据等级

### 压缩缺陷

压缩过程中可能以 `summary is not smaller than the shadowed content` 失败，即摘要的分帧 token 估算未小于所替换内容。之前成功提交一段压缩，也不保证同一回合后续的压缩尝试成功。不能由该错误直接推断数据丢失，也不能用自动化通过结果覆盖它。后续需在合成课堂复现，核对预算、范围选择与摘要事务结果；真实运行诊断仅保留在本机私有目录，不公开原始课堂、截图、请求标识或凭据。

### 真实模型长程验收失败

官方 DeepSeek 真实模型 12 轮课堂：3 次计划压缩和 4 次自动压缩的结构提交、来源覆盖及早期原文自主搜索/回读均 PASS；但教学任务第 5/12 轮语义 FAIL，模型把尚未作答的题目记成已作答，后来继续沿用旧待办。后来调整的提示规则只做了 deterministic smoke，未使用真实模型复验。结构完整与检索命中不能代表教学语义正确或长程连续性通过。

更早的提案试验也出现模型重复调用 `history_search`，消耗额外请求后仍误答。检索有上限、未命中不是“从未发生”的证明；思考和附件不属于当前归档检索正文。不要声称召回率、成本或真实课堂可靠性已经通过验收。

## 0.24.4 相对基线的完整改动记录

### 固定 Billion-context 源码与构建链

在 `vendor/billion-context/` 引入固定的 billion-context `0.1.187`（上游 commit `d4de8d44e047cbb84dd225f27c4b0f669b79e554`）及嵌入的 acp-kernel `0.0.105`。`upstream-lock.json` 对上游文件记录 SHA-256，`LICENSE`、`kernel/LICENSE` 保留许可与归属。`scripts/build-billion-kernel.ts` 和 `scripts/billion-kernel-entry.mjs` 从固定源码构建选定纯核心导出；`build-native-vault.ts`、`build-vault-release.ts`、`dev-native-vault.ts`、`migrate-vault-runtime.ts` 和 release/postinstall 路径接入该构建输入。设计上不加载上游网络代理、launcher、自动更新器或全局 kernel 状态，模型网络、凭据、课堂授权、压缩提交仍归 DSH/Notara 管理。风险是 vendor 源、锁文件、构建 patch 和依赖导出彼此耦合；后续更改需核 SHA、许可、产物内容及干净构建。

### 预算规划、原生压缩与上下文错误恢复

新增 `context-budget.js`、`context-budget-plan.js`、`compaction.js` 及 `context-memory*.js`/`context-memory-span.js`。在完整请求组装后评估输入预算，保护最新真实 user 消息及完整工具调用/结果配对，必要时通过 DSH 原生 range、锁、持久摘要和 surface replace 事务压缩旧历史。默认软保留策略在小旧范围完全移除仍达不到目标时可扩展到更大的合法旧范围，显式 retention 不扩展。分层/quoted JSON 数据摘要需保留目标、条件、更正、待办、来源与工具关系。显式上下文溢出可有界拆分重试，认证、网络等其他错误应原样失败，不能靠清空课堂恢复。

摘要引擎的同一压缩操作共用最多32个摘要模型调用额度（归并/重试也计入），每个摘要请求的 `maxTokens` 上限为8192；自动预算协调器另有每 step 最多4次整理/恢复及 pressure/overflow 限制，不能把这些数字合并成一个产品长程上限。`scripts/patch-compaction-target.ts` 补丁锁定 SDK 的自动压缩压力目标，使其观察当前 pending model selection；`scripts/patch-context-request.ts` 调整上下文请求路径。风险/未决点：本机错误 `summary is not smaller...` 尚无根因；真实模型教学进度失败；压缩事务成功不能证明语义摘要正确。后续应查清小摘要与 shadowed range 的分帧 token 估算相等时是否应作为无进展、失败或安全回退，并确认失败路径不会提交半成品/丢失原文。

### 本机私有历史、原文检索与生命周期

新增 `context-history*.js`：归档 record/evidence、规范编码、store、worker、client、tools、transport、search policy、host binding、批处理和 lifecycle 测试。压缩前将当前课堂规范原文持久化在本机私有目录，仅教师通过 `exec.agent.session` 绑定本课堂，并沿用原生权限调用 `history_search`/`history_read`；搜索与分页读取均有界。原生记录包含普通工具调用/回执，思考与附件不进入检索正文；检索自身的调用/配对回执在归档中保留原文但搜索时排除，避免自指结果挤占证据。支持数字、小数、编号候选，候选仍需核验原始编码范围。记录按原生课堂身份处理重启、分支、删除、取消；删除先以 FULL 同步提交持久 tombstone，再做可幂等分批物理清理，取消或 SQL 异常恢复 FULL，启动可续清理，其他课堂隔离。

后续维护修正了 Windows 慢盘清理预算：以 SQLite `octet_length` 查询列字节数避免为预算读取 overflow 正文，保留 secure_delete 和每批 256 KiB/128 块/4096 特征及默认端到端30秒期限。只让历史删除压力 fixture 使用 runner scratch storage，不改全局 TEMP/TMP、ACL 或产品数据/归档路径。Windows 同 VM 证据：系统 temp 对照超时后清理103.7秒；runner temp 端到端4.23秒，三项压力/中断/SQL失败恢复检查通过。这是 fixture 存储位置对照，不代表产品数据路径性能。

风险：原文属于敏感课堂数据；本机保留不是每轮发送全部原文。搜索上限/候选策略可能漏召回，分页和回执有长度限制；删除的逻辑墓碑优先于物理回收。回滚 WebUI 时不得删除或迁移用户运行根、课堂数据库、私有原文档案或 tombstone；恢复旧版后数据能否读取应在副本上确认。

### 教学连续性规则与 ChatGPT 重放/错误分类

`teacher-preset.js`、`context-memory-kernel.js` 与 prompt/compaction 测试增加对题目布置、学生实际作答、教师评价、独立掌握的区分；新深化要求与原任务分开，旧待办需结合后续原始回应重新核对。真实 DeepSeek 第5轮失败证明结构化来源未充分约束语义判定，后加规则仅 deterministic smoke，尚未真实复验。

`chatgpt-provider.js` 改为以最终 `response.output_item.done` 的顺序内容收集 assistant 文本与工具调用，空或不完整的 completion/output 不覆盖已收内容；仅匹配同账号/模型且与可见文本和工具调用相符的旧输出可重放，不适用的 0.24.3 空重放回退至规范原生历史。HTTP 和 SSE 错误按 code/type/message 一致识别上下文溢出，失败持久记录仅留安全状态码与 requestId，不存上游私密原文，不按目录模型名猜容量。`agent-tools.js`、client 及测试同步调用/结果匹配行为。风险是上游事件变体、断流或工具输出不完整仍需回归，错误脱敏不可放宽。

### 远控连接、浏览器 branding

`remote-access-proxy.ts` 与 patch/tests 修复合并脚本的连接模块识别，使受信任 HTTPS 远控页面可进入模型设置；旧缓存需经 `/login` 清理后重登。`patch-product-branding.ts`、`patch-layout.ts` 及 E2E 把网页初始标题、manifest、课堂页改为 Notara「拾页」，课堂页仍保留课堂名；Chromium 检查 1/1 通过。属于 Native Vault WebUI 行为，与独立 Electron 桌面端分别管理。

### root lock heartbeat 与监督器 launcher 回收

`vault-root-lock.ts` 只在精确 lockPath 由当前实例持有且 release 已开始时忽略迟到 heartbeat stat；活跃 owner 的 `ECOMPROMISED` 仍报告。root helper 连接手工 `upgradeVaultPersistent`、`relocateVaultRuntime`。新增 `vault-owned-launcher.ts` 并接入 `vault-supervisor.ts`：IPC ready 保存准确 Host PID、parent PID、auth URL 和原始字节；仅在 Host 和 worker 均退出、generation 仍匹配且持有正常 runtime root lock 时清理本次遗留 launcher。`EPERM`、目标仍存活、Host 已死但 parent worker 仍活、generation/capture 不匹配均保留记录；锁等待最多15秒。`taskkill` 返回 root-not-found 不证明进程树完全退出。风险是 Windows 进程/锁竞态，回滚时不得清理仍运行的外部 launcher 或放宽 owner 校验。

### 测试、fixtures、CI 与工程文档

新增 unit/integration/E2E/manual fixtures 覆盖预算、native checkpoints/turns、连续压缩与历史检索、浏览器标题和远控模型、launcher/root lock、release build、更新/恢复、删除压力等。变更也包括 `agent-io.test.js` 的 PDF 大 fixture 失败期限隔离（先建36MB PDF 并首次 hash，再单独5秒断言范围拒绝、源/revision不变和后续读者恢复）；mock image fixture 仅对精确的合成测试路由采用非零价格与256视觉tokens，真实服务商定价行为不变；desktop sync/git-bash/recovery/update 测试按新的 callId 区分本轮工具结果；release fixture、cache-prefix 重启断言与测试 worker 数/超时策略调整。CI 新增 `.github/workflows/archive-pressure-check.yml` 和 `.github/workflows/windows-update-check.yml`，并改动 release workflow。README、安装说明、AGENTS 和 release notes 记录版本功能、固定上游、Windows storage 证据及验证限制。

这些测试大量证明确定性边界与局部回归；它们不能代替真实长程模型的语义验收，也不能推导用户截图根因。

## 已有验证记录（按证据类别）

正式 [run `37820917138`](https://github.com/TongZi2003/Notara/actions/runs/37820917138)：resolve、Windows、Linux、release 均 success。汇总计数：Linux integration 134 pass、13 platform skip；E2E 87 pass、1 skip；Windows unit 211；archive pressure 3；CLI 16；install/desktop 18；update/recovery 4；portable start 1。它们证明对应 runner 和 fixtures 上的断言通过，不证明用户真实长程教学成功。真实 DeepSeek 12 轮结果见上文，不能并入 PASS 总数。

Release 前置或专项记录还有：launcher unit 8/8、Host recovery 1/1（55.56秒）、本机 update install/rollback 3/3（218.85秒）、源码与测试 TypeScript 检查通过；Chromium title 1/1。Windows runner-temp update/recovery 对照 4/4（137.25秒），release archive pressure 的三项检查 4.23秒。正式 run 计数和专项记录如口径不同，保留各自原始 workflow/log，不要相加为一个覆盖所有行为的数字。

## 回滚边界与下一次修复顺序

1. 保留本文件、tag `v0.24.4`、commit `07ec6dba...` 与 CI run；公开只记录产品缺陷和发布资产状态，用户截图与诊断原件仅在本机私有目录保存。Native WebUI 与独立 Electron 桌面端分别管理。
2. 用户恢复修复工作后，复现截图失败前先记录版本、provider/model、turn/request id、压缩策略、各消息 framed token 估算、shadowed range、摘要请求/结果和原生提交事务状态；屏蔽密钥与私有文本。先在可丢弃副本/合成课堂复现，确认原始课堂和归档保持完整。本次撤回任务不运行付费 API测试或新发布；后续测试沿用用户明确授权的范围。
3. 分别处理机械错误（summary 与 shadowed 内容估算相等）和语义失败（题目是否作答、任务/待办状态）。前者定义安全的无进展恢复/拒绝规则并验证失败原子性；后者用带盲评标准的真实课堂轨迹复验，不能把来源存在等同于模型正确理解来源。
4. 对明确修复做最小测试与真实模型回归，再跑相关 CI；只有复现根因、回归通过且用户真实场景验收后，才重新决定版本和发布。不要把 v0.24.4 的旧发布资产或旧 CI 绿灯用作重新发布授权。

## 发行资产撤回与回退说明

2026-10-09（以下时间均为北京时间）08:24:25，Release 最后一次资产删除完成。四个安装/清单资产的原始身份如下，当前均已删除：

| 原资产 | 字节数 | 原始 SHA-256 |
| --- | ---: | --- |
| `notara-0.24.4.zip` | 85,127,193 | `71aa98bec3bb5c27a1120d7731b1d4d4379db54bee9d05d82a5c1bcb2568b044` |
| `notara-portable-0.24.4-win-x64.zip` | 420,866,287 | `3fec30645f222b874a17c1c2d00f123ff717e794bda72247e56b7e48983515b5` |
| `notara-portable-0.24.4-win-x64.zip.sha256` | 101 | `de375b35d2a08039db2a5b81fa6b0fc9fc0ee47052912bb368568dde1556a431` |
| `notara-update.json` | 244 | `459e654ea99d2a73b12735f44183ae236aae6eb1af11407fc75e6dd3db148e0f` |

推荐回退至 [0.24.3 的公开正式包](https://github.com/TongZi2003/Notara/releases/tag/v0.24.3)：便携 ZIP 420,450,675字节，SHA-256 `796a5e8eafb9408f6975202e0ffc3c15361d5ff5a38ff3b67e4dbbac1217896e`。发行包 CRC/长度检验46658项通过；包内插件/便携清单版本为0.24.3。

匿名联网复核：公开 latest API 返回 `v0.24.3`，`v0.24.4` Release tag API 返回404，原0.24.4便携安装包下载返回404。由于保留源码标签，GitHub 的 tag 页面本身仍可能返回200并提供自动生成的 Source code；这些源码附件不是已撤下的发行安装包，不能据此认为本版仍可安装。

回退时先正常停止 WebUI 并完整备份当前数据，不能用升级前的旧数据覆盖最新课堂。从0.24.3程序目录执行原运行根的 `vault:upgrade`，保留0.24.4插件快照，按升级器合同清除 managed code 指针，再更新 WebUI 入口。数据完整性、版本和启动状态须在本机核对，具体账号、路径、端口、课堂清单和运行状态不写入公开文档。

0.24.3 不提供0.24.4新增的历史原文检索。已经写入原生会话的摘要仍可能继续显示，代码回退不会自动展开被压缩的历史；私有原文 SQLite、原生会话及0.24.4旧插件快照都保留供后续核查。不为此次回退清除模型目录缓存、更新代码缓存或浏览器学习状态。现有浏览器页面需要刷新后加载0.24.3的客户端。

本次只记录发行撤回与回退边界；压缩机制修复和新的发行版本尚未完成。


## 完整提交与逐文件清单

本附录固定比较公开历史标签 `v0.24.3..v0.24.4`，不混入本次撤回文档提交或本机入口操作。状态 `A` 为新增，`M` 为修改；行数来自 `git diff --numstat`，仅表示源码文本规模，不表示功能数量或风险等级。

### 14个提交（按历史顺序）

| 提交 | 原始标题 |
| --- | --- |
| `812bb204b973742f7f0599a3ab089373737253c6` | feat: release Notara 0.24.4 with context continuity and browser branding |
| `fd74befe73f91c70a80579d1227feae1655a59a5` | fix: bound durable history cleanup cost on slow Windows storage |
| `1797f39814780ceffdae5fb81abe213af0e8c8c5` | fix: avoid reading archive bodies for cleanup budgets and bound test workers |
| `3589d3fd7d6b3ea6ae8827aee7feaffd2bdbda33` | test: profile remaining tombstoned history cleanup on Windows |
| `278f7ff52536e7e3383e4e81ac3dc823c1f07af5` | test: compare archive cleanup across Windows temporary volumes |
| `022e3b4e95399e6602a4e9a5c9dfeac40a24c1be` | fix: use runner scratch storage for Windows release test databases |
| `5518990ee6352903262260149f5baeaf1507b5c2` | docs: link the Windows storage comparison to its public evidence |
| `ac22a370078cebe34ec2e04356d679852b9d62fd` | fix: confine runner scratch storage to archive pressure fixtures |
| `2f535877be47f7d61b9316d3894a2f5421544bd5` | test: isolate PDF range failure deadline from large fixture preparation |
| `57324a5d26046ea0708dfa11ff6b4b91ecb8644f` | docs: record verified Windows archive PDF and permission regressions |
| `0227e50d7af9d6359948fca854b27d50ba9a9bdf` | fix: recover oversized retained tool spans and observe actual native turns |
| `f0f3227c6d14343f6243097043e775917df2faea` | fix: ignore root lock heartbeats only after owned release begins |
| `6fac03aeb0a7ed38a6faa5eacd860c53155243bf` | fix: reclaim stopped launcher records and diagnose Windows updates |
| `07ec6dba9a3e7212bd766381062fc5f0efc15e68` | docs: finalize verified v0.24.4 changes and validation limits |

### 191个变更文件

| 状态 | 文件 | 新增行 | 删除行 |
| --- | --- | ---: | ---: |
| M | `.gitattributes` | 2 | 0 |
| A | `.github/workflows/archive-pressure-check.yml` | 23 | 0 |
| M | `.github/workflows/release.yml` | 10 | 2 |
| A | `.github/workflows/windows-update-check.yml` | 32 | 0 |
| M | `.gitignore` | 2 | 0 |
| M | `AGENTS.md` | 27 | 0 |
| M | `README.md` | 27 | 6 |
| M | `docs/install.md` | 4 | 2 |
| A | `docs/releases/native-vault-0.24.4.md` | 44 | 0 |
| M | `examples/native-vault/agent-io.test.js` | 15 | 15 |
| M | `examples/native-vault/agent-tools.js` | 6 | 4 |
| M | `examples/native-vault/agent-tools.test.js` | 1 | 1 |
| M | `examples/native-vault/chatgpt-provider.js` | 92 | 14 |
| M | `examples/native-vault/chatgpt-provider.test.js` | 111 | 9 |
| M | `examples/native-vault/client.js` | 2 | 2 |
| A | `examples/native-vault/compaction.js` | 578 | 0 |
| A | `examples/native-vault/compaction.test.js` | 353 | 0 |
| A | `examples/native-vault/context-budget-plan.js` | 125 | 0 |
| A | `examples/native-vault/context-budget.js` | 150 | 0 |
| A | `examples/native-vault/context-budget.test.js` | 332 | 0 |
| A | `examples/native-vault/context-history-batch.test.js` | 147 | 0 |
| A | `examples/native-vault/context-history-binding.test.js` | 144 | 0 |
| A | `examples/native-vault/context-history-client.js` | 248 | 0 |
| A | `examples/native-vault/context-history-client.test.js` | 72 | 0 |
| A | `examples/native-vault/context-history-delete-pressure.test.js` | 184 | 0 |
| A | `examples/native-vault/context-history-evidence-native.test.js` | 355 | 0 |
| A | `examples/native-vault/context-history-evidence.js` | 58 | 0 |
| A | `examples/native-vault/context-history-evidence.test.js` | 110 | 0 |
| A | `examples/native-vault/context-history-host-adversarial.test.js` | 173 | 0 |
| A | `examples/native-vault/context-history-host-native.test.js` | 229 | 0 |
| A | `examples/native-vault/context-history-lifecycle.test.js` | 177 | 0 |
| A | `examples/native-vault/context-history-record-store.test.js` | 62 | 0 |
| A | `examples/native-vault/context-history-record.js` | 227 | 0 |
| A | `examples/native-vault/context-history-record.test.js` | 296 | 0 |
| A | `examples/native-vault/context-history-search-native.test.js` | 259 | 0 |
| A | `examples/native-vault/context-history-search-policy.js` | 13 | 0 |
| A | `examples/native-vault/context-history-search-store.test.js` | 214 | 0 |
| A | `examples/native-vault/context-history-store.js` | 624 | 0 |
| A | `examples/native-vault/context-history-tools.js` | 125 | 0 |
| A | `examples/native-vault/context-history-tools.test.js` | 143 | 0 |
| A | `examples/native-vault/context-history-transport.test.js` | 169 | 0 |
| A | `examples/native-vault/context-history-worker.js` | 30 | 0 |
| A | `examples/native-vault/context-history-worker.test.js` | 131 | 0 |
| A | `examples/native-vault/context-history.js` | 345 | 0 |
| A | `examples/native-vault/context-memory-kernel.js` | 197 | 0 |
| A | `examples/native-vault/context-memory-kernel.test.js` | 61 | 0 |
| A | `examples/native-vault/context-memory-span-native.test.js` | 167 | 0 |
| A | `examples/native-vault/context-memory-span.js` | 176 | 0 |
| A | `examples/native-vault/context-memory-span.test.js` | 150 | 0 |
| A | `examples/native-vault/context-memory-tiers.js` | 78 | 0 |
| A | `examples/native-vault/context-memory-tiers.test.js` | 81 | 0 |
| A | `examples/native-vault/context-memory.js` | 36 | 0 |
| A | `examples/native-vault/context-memory.test.js` | 158 | 0 |
| M | `examples/native-vault/index.js` | 2 | 0 |
| M | `examples/native-vault/package.json` | 24 | 1 |
| M | `examples/native-vault/session-deletion-runtime.js` | 4 | 1 |
| M | `examples/native-vault/session-deletion-runtime.test.js` | 71 | 3 |
| M | `examples/native-vault/teacher-preset.js` | 1 | 1 |
| M | `examples/native-vault/tool-rows-client.js` | 2 | 0 |
| M | `examples/native-vault/tool-rows-client.test.js` | 13 | 0 |
| A | `scripts/billion-kernel-entry.mjs` | 8 | 0 |
| A | `scripts/build-billion-kernel.ts` | 34 | 0 |
| M | `scripts/build-native-vault.ts` | 9 | 0 |
| M | `scripts/build-vault-release.ts` | 3 | 1 |
| M | `scripts/dev-native-vault.ts` | 1 | 2 |
| M | `scripts/fixtures/vault-test-model.ts` | 30 | 2 |
| M | `scripts/migrate-vault-runtime.ts` | 2 | 2 |
| A | `scripts/patch-compaction-target.ts` | 89 | 0 |
| A | `scripts/patch-context-request.ts` | 58 | 0 |
| M | `scripts/patch-layout.ts` | 3 | 0 |
| A | `scripts/patch-product-branding.ts` | 36 | 0 |
| M | `scripts/patch-sdk.ts` | 6 | 0 |
| M | `scripts/remote-access-proxy.ts` | 9 | 1 |
| M | `scripts/test-plugins.mjs` | 3 | 1 |
| A | `scripts/vault-owned-launcher.ts` | 108 | 0 |
| M | `scripts/vault-root-lock.ts` | 18 | 1 |
| M | `scripts/vault-supervisor.ts` | 11 | 4 |
| A | `tests/e2e/native-vault-context-history.spec.ts` | 72 | 0 |
| A | `tests/e2e/native-vault-product-title.spec.ts` | 41 | 0 |
| A | `tests/e2e/native-vault-remote-models.spec.ts` | 205 | 0 |
| A | `tests/fixtures/context-continuity-scenario.ts` | 138 | 0 |
| M | `tests/fixtures/vault-http.ts` | 50 | 8 |
| A | `tests/fixtures/vault-native-checkpoints.ts` | 118 | 0 |
| A | `tests/fixtures/vault-native-turns.ts` | 241 | 0 |
| M | `tests/fixtures/vault-update-release.ts` | 16 | 5 |
| M | `tests/integration/native-vault-cache-prefix.test.ts` | 25 | 18 |
| A | `tests/integration/native-vault-context-budget.test.ts` | 94 | 0 |
| A | `tests/integration/native-vault-context-history.test.ts` | 170 | 0 |
| A | `tests/integration/native-vault-continuity.test.ts` | 181 | 0 |
| M | `tests/integration/native-vault-desktop-sync.test.ts` | 2 | 1 |
| M | `tests/integration/native-vault-git-bash.test.ts` | 4 | 1 |
| M | `tests/integration/native-vault-recovery.test.ts` | 4 | 4 |
| M | `tests/integration/native-vault-updates.test.ts` | 17 | 12 |
| A | `tests/manual/context-continuity.ts` | 202 | 0 |
| M | `tests/unit/build-vault-release.test.ts` | 27 | 1 |
| A | `tests/unit/compaction-target-patch.test.ts` | 59 | 0 |
| A | `tests/unit/context-request-patch.test.ts` | 32 | 0 |
| M | `tests/unit/remote-access.test.ts` | 26 | 1 |
| A | `tests/unit/vault-native-checkpoints.test.ts` | 89 | 0 |
| A | `tests/unit/vault-native-turns.test.ts` | 190 | 0 |
| A | `tests/unit/vault-owned-launcher.test.ts` | 141 | 0 |
| M | `tests/unit/vault-root-lock.test.ts` | 70 | 1 |
| A | `tests/unit/vault-test-model-image-pricing.test.ts` | 34 | 0 |
| A | `vendor/billion-context/LICENSE` | 57 | 0 |
| A | `vendor/billion-context/README.md` | 7 | 0 |
| A | `vendor/billion-context/kernel/LICENSE` | 57 | 0 |
| A | `vendor/billion-context/kernel/package.json` | 72 | 0 |
| A | `vendor/billion-context/kernel/src/absorb.ts` | 373 | 0 |
| A | `vendor/billion-context/kernel/src/block-map.ts` | 73 | 0 |
| A | `vendor/billion-context/kernel/src/boundaries.ts` | 427 | 0 |
| A | `vendor/billion-context/kernel/src/cache-report.ts` | 730 | 0 |
| A | `vendor/billion-context/kernel/src/ccr.ts` | 659 | 0 |
| A | `vendor/billion-context/kernel/src/compress-tools.ts` | 806 | 0 |
| A | `vendor/billion-context/kernel/src/compress.ts` | 2050 | 0 |
| A | `vendor/billion-context/kernel/src/compression-rules.ts` | 137 | 0 |
| A | `vendor/billion-context/kernel/src/config.ts` | 247 | 0 |
| A | `vendor/billion-context/kernel/src/content-store.ts` | 143 | 0 |
| A | `vendor/billion-context/kernel/src/crush.ts` | 1832 | 0 |
| A | `vendor/billion-context/kernel/src/decompress.ts` | 296 | 0 |
| A | `vendor/billion-context/kernel/src/filter/apply.ts` | 106 | 0 |
| A | `vendor/billion-context/kernel/src/filter/index.ts` | 9 | 0 |
| A | `vendor/billion-context/kernel/src/filter/registry.ts` | 25 | 0 |
| A | `vendor/billion-context/kernel/src/filter/types.ts` | 29 | 0 |
| A | `vendor/billion-context/kernel/src/handoff.ts` | 123 | 0 |
| A | `vendor/billion-context/kernel/src/hide-consumed.ts` | 262 | 0 |
| A | `vendor/billion-context/kernel/src/image-compress.ts` | 583 | 0 |
| A | `vendor/billion-context/kernel/src/index.ts` | 412 | 0 |
| A | `vendor/billion-context/kernel/src/instance-reid.ts` | 101 | 0 |
| A | `vendor/billion-context/kernel/src/message-kind.ts` | 15 | 0 |
| A | `vendor/billion-context/kernel/src/nudge-text.ts` | 313 | 0 |
| A | `vendor/billion-context/kernel/src/output-steering.ts` | 320 | 0 |
| A | `vendor/billion-context/kernel/src/packs.ts` | 421 | 0 |
| A | `vendor/billion-context/kernel/src/panel/cache.ts` | 71 | 0 |
| A | `vendor/billion-context/kernel/src/panel/format.ts` | 10 | 0 |
| A | `vendor/billion-context/kernel/src/panel/index.ts` | 6 | 0 |
| A | `vendor/billion-context/kernel/src/panel/panel.ts` | 207 | 0 |
| A | `vendor/billion-context/kernel/src/panel/topic.ts` | 13 | 0 |
| A | `vendor/billion-context/kernel/src/parse-compress-input.ts` | 888 | 0 |
| A | `vendor/billion-context/kernel/src/persist/index.ts` | 23 | 0 |
| A | `vendor/billion-context/kernel/src/persist/state-merge.ts` | 31 | 0 |
| A | `vendor/billion-context/kernel/src/persist/store.ts` | 770 | 0 |
| A | `vendor/billion-context/kernel/src/pipeline.ts` | 52 | 0 |
| A | `vendor/billion-context/kernel/src/prompts.ts` | 99 | 0 |
| A | `vendor/billion-context/kernel/src/protected.ts` | 375 | 0 |
| A | `vendor/billion-context/kernel/src/prune.ts` | 393 | 0 |
| A | `vendor/billion-context/kernel/src/reasoning-pairs.ts` | 102 | 0 |
| A | `vendor/billion-context/kernel/src/rebuild.ts` | 79 | 0 |
| A | `vendor/billion-context/kernel/src/recommend.ts` | 461 | 0 |
| A | `vendor/billion-context/kernel/src/refs.ts` | 141 | 0 |
| A | `vendor/billion-context/kernel/src/render-refs.ts` | 165 | 0 |
| A | `vendor/billion-context/kernel/src/report.ts` | 532 | 0 |
| A | `vendor/billion-context/kernel/src/rules.ts` | 162 | 0 |
| A | `vendor/billion-context/kernel/src/search.ts` | 35 | 0 |
| A | `vendor/billion-context/kernel/src/search/SEARCH.md` | 178 | 0 |
| A | `vendor/billion-context/kernel/src/search/algorithms/bm25.ts` | 54 | 0 |
| A | `vendor/billion-context/kernel/src/search/algorithms/fuzzy.ts` | 51 | 0 |
| A | `vendor/billion-context/kernel/src/search/algorithms/hybrid.ts` | 43 | 0 |
| A | `vendor/billion-context/kernel/src/search/algorithms/semantic.ts` | 112 | 0 |
| A | `vendor/billion-context/kernel/src/search/algorithms/substring.ts` | 33 | 0 |
| A | `vendor/billion-context/kernel/src/search/doc-cache.ts` | 112 | 0 |
| A | `vendor/billion-context/kernel/src/search/index.ts` | 188 | 0 |
| A | `vendor/billion-context/kernel/src/search/registry.ts` | 32 | 0 |
| A | `vendor/billion-context/kernel/src/search/stemmer.ts` | 27 | 0 |
| A | `vendor/billion-context/kernel/src/search/tokenizer.ts` | 123 | 0 |
| A | `vendor/billion-context/kernel/src/search/types.ts` | 109 | 0 |
| A | `vendor/billion-context/kernel/src/segment.ts` | 49 | 0 |
| A | `vendor/billion-context/kernel/src/state.ts` | 86 | 0 |
| A | `vendor/billion-context/kernel/src/surface-config.ts` | 169 | 0 |
| A | `vendor/billion-context/kernel/src/sync.ts` | 101 | 0 |
| A | `vendor/billion-context/kernel/src/tokenize.ts` | 68 | 0 |
| A | `vendor/billion-context/kernel/src/tool-pairs.ts` | 67 | 0 |
| A | `vendor/billion-context/kernel/src/transform-channel.ts` | 14 | 0 |
| A | `vendor/billion-context/kernel/src/truncate-tools.ts` | 127 | 0 |
| A | `vendor/billion-context/kernel/src/truncate.ts` | 30 | 0 |
| A | `vendor/billion-context/kernel/src/turn-integrity.ts` | 212 | 0 |
| A | `vendor/billion-context/kernel/src/types.ts` | 589 | 0 |
| A | `vendor/billion-context/kernel/src/viable.ts` | 13 | 0 |
| A | `vendor/billion-context/kernel/src/wire/anthropic.ts` | 311 | 0 |
| A | `vendor/billion-context/kernel/src/wire/bili-message.ts` | 109 | 0 |
| A | `vendor/billion-context/kernel/src/wire/compress-detect.ts` | 443 | 0 |
| A | `vendor/billion-context/kernel/src/wire/demoted-thinking.ts` | 77 | 0 |
| A | `vendor/billion-context/kernel/src/wire/formats.ts` | 55 | 0 |
| A | `vendor/billion-context/kernel/src/wire/google.ts` | 455 | 0 |
| A | `vendor/billion-context/kernel/src/wire/index.ts` | 12 | 0 |
| A | `vendor/billion-context/kernel/src/wire/message-id.ts` | 58 | 0 |
| A | `vendor/billion-context/kernel/src/wire/mirror.ts` | 292 | 0 |
| A | `vendor/billion-context/kernel/src/wire/openai.ts` | 401 | 0 |
| A | `vendor/billion-context/kernel/src/wire/responses.ts` | 759 | 0 |
| A | `vendor/billion-context/kernel/src/wire/strip-images.ts` | 236 | 0 |
| A | `vendor/billion-context/kernel/src/wire/util.ts` | 23 | 0 |
| A | `vendor/billion-context/upstream-lock.json` | 94 | 0 |
