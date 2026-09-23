# 五种工作预设与教学编排

## 目标与执行顺序

用户已确认：主教师确认范围、列清单、分配独立任务、轻量审阅并归纳父节点；备课先确定总框架，再逐课完善；新增出题员负责小测与变式。

- [x] 统一五种预设目录和 `ask_worker` 合同；公共规则、角色、选定 Skill 和任务材料分层组装。
- [x] 原生 spawn 保持独立上下文；模型、预算与 none/read 工具能力按预设配置，历史 solver 设置和记录可读取。
- [x] 教室列表与像素视图共用真实任务类型、查看分析和取消；不展示题干答案。
- [x] 更新拆卡、备课、出题与按需核验指令，清除当前教学入口的固定 solver 四模式。
- [x] 验证配置隔离、上下文隔离、原生权限、任务取消/恢复、五预设实际请求与可见界面；记录未运行的真实模型质量层。

## 文件所有权

主任务负责 `solver-runtime.js`、`worker-catalog.js`、教学权限接线、manifest、Host/集成测试及文档；提示词子任务只改 `resources/vault-teaching/`（manifest 除外）；界面子任务只改教室客户端、像素插件源和相关界面测试。保留本工作树已有未提交改动。

## 约束

继续使用 DSH 原生会话、spawn、模型与权限，不引入第二套会话生命周期。正式 Markdown 写回由主教师负责。子任务工具只有 none 或原生 read/glob/grep/read_image，不提供 Bash、写入或嵌套代理。模型默认沿用已有 solver 选择，未配置时仅自动匹配已接入的 gpt-5.6-sol，不静默使用父模型。

交互与模型接线验证使用隔离实例、合成资料和测试模型，不执行付费模型请求。部署时只读长期实例的会话/教室状态，不读取或改写真实课堂正文。

## 验证与交接

版本：Native Vault 0.13.0，Pixel Classroom 0.3.0。Node v24，使用仓库锁定依赖。

- PASS，定向单元/接缝：`node --test examples/native-vault/worker-runtime.test.js examples/native-vault/solver-runtime.test.js examples/native-vault/agent-tools.test.js examples/native-vault/classroom-client.test.js examples/native-vault/client-bindings.test.js examples/native-vault/teaching-runtime.test.js examples/pixel-classroom/bridge.test.js examples/pixel-classroom/plugin.test.js`，最终 53/53。
- PASS，真实 Host、合成模型：`vitest run --config vitest.integration.config.ts tests/integration/native-vault-solver.test.ts`。首轮 12/14；两项旧断言仍检查 draft/solver 字段，更新为 preset/workers 后针对性补测 2/2。五预设的实际人格与 Skill、独立上下文、模型/预算、read 成功、write/递归拒绝、PDF 版本、取消与冷重启均实际覆盖。没有用付费模型评价内容。
- PASS，浏览器：`playwright test tests/e2e/native-vault-classroom.spec.ts --headed`，最终 2/2。配置草稿按岗位隔离、保存及刷新恢复、真实出题任务运行→完成、列表/像素切换与岗位任务过滤、原生子记录回看/返回、取消无迟到结果、多窗口旧草稿拒绝覆盖新设置；收集到的控制台错误为空。快照来源是隔离合成资料。
- PASS，静态与打包：`tsc --build`、`tsc --noEmit -p examples/pixel-classroom/tsconfig.json`、`build-native-vault.ts`、`build-pixel-classroom.ts`、`git diff --check`。`npm pack --dry-run --json --ignore-scripts` 确认 worker-catalog 和6份工作员提示词入包、旧 solver.md 不入包。资源构建先清理生成目录以防已删除的提示词残留。
- FAIL，仓库扩展检查：`tsc -p tsconfig.tests.json` 剩余原有 teaching-rounds/tool-disclosure/journey 三份未改文件中的5处类型错误；本轮新增的 workers 数组访问错误已修复。子任务额外运行全 Native Vault 单测时报告 219/222，失败在未改动的路线修订断言及两个已过时的 Remote 源码位置断言；没有将该扩展运行写成全量通过，本轮未改这些无关测试。
- 未运行：真实模型是否遵循编排、真实题卡/剧本/小测教学质量、付费调用与成本比较。当前每课堂串行一个后台任务，没有新增并发队列。

证据：`docs/evidence/worker-orchestration/` 保存定向单测结果、浏览器结果摘要、配置与像素任务截图。

## 审查与修正

独立审查未发现 P0/P1。修正：教法原则中的写文件指令移回主教师通用工作流；教法用于后台备课设计而非让工作员向学生发问；配置草稿绑定形成时的 revision，轮询不更新其写入依据，冲突可显式载入新设置；取消/暂停/繁忙/空结果有模型可用的下一步说明；模型已接入但推理等级失效时单独说明。另修正像素视图重复显示列表、去掉重复模型清单。

关于损坏 legacy 事件的建议未实施静默回退：旧写入口已校验 revision 与预算，当前没有真实非法旧事件的证据；不能借兼容之名自动改变用户模型或预算。合法旧事件的读取兼容已有单元与冷恢复证据。

## 长期实例与回滚

部署前后确认 `/Users/yangrundong/.notara/vault-runtime` 的57093实例无运行中任务、保留7个原会话。新冻结快照为 `vault-plugin-0.13.0`、`pixel-classroom-plugin-0.3.0`；旧0.12.3/0.2.0保持原样。备份目录 `pre-worker-orchestration-1790087643376` 保存原cordis.patch.yml、链接目标和待装配配置。

确认旧进程归属本worktree的 `scripts/vault.ts --no-open` 后正常停止，原子更新两处托管链接与preset/像素插件路径，再从同一入口恢复原数据根、端口。未改模型凭据、Vault正文或课堂日志。新进程PID75887，exec session33454；交接时仍运行。只读检查 Native Vault版本0.13.0、五种工作预设和像素HTTP200正常。未配置后台模型的旧会话仍明确显示未配置，不替用户选模型。

需回滚时先确认无任务，停止本实例，恢复备份配置与两处原链接，再用同一数据根启动；不删除用户数据根或新任务记录。旧程序不理解新worker事件，回退版本仅恢复旧功能，不承诺显示新版任务。
