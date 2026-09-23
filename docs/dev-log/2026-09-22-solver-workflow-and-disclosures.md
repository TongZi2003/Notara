# 子代理工作流与教师内容折叠

工作树：`codex/notara-vault-clean`；版本：`@notara/vault-native` 0.12.2。保留工作树已有改动，不修改实际卡片、路线或课堂正文。

## 改动

- `resources/vault-teaching/{base,persona,solver}.md`、备课/资料整理 Skill 与 manifest：拆卡通常逐题 `draft`，一次交付独立研究、自检及可保存三段草稿；主教师负责检查、组织与保存，最后集中归纳父节点。`solve` 保留单题研究，`plan` 只安排课程，`review` 只处理明确疑点。取消必须先由父教师解完再交给助手整理的指导，不固定串行四种任务。保留完整可检索题面、原解依据、必要推导与真实学生理解。
- `solver-runtime.js`：原生 loop 把坏JSON保留成字符串，原先进入 exact() 后只返回泛化错误。现在区分坏JSON/重复字符串编码/对象字段/数组项，返回字段位置与修正方式，不自动猜测修复或泄露正文。任务耗尽时记录 failureCode 和规范请求哈希；同一用户输入下、相同任务材料与有效路由预算不再次启动。新用户输入、缩小材料/任务、配置预算变化仍可运行。取消、零工具、父子隔离、独立预算和原生权限保持原有边界。
- `lesson-script.js`：teacherBlocks 支持 `<details><summary>教师参考</summary>` 同行写法及整块单行写法，仍排除代码、注释与仅提到标签的正文；共享阶段目录解析器同步识别教师块。
- `live-preview.js`：卡片/专题/锦囊的 `## 参考理解`（兼容教师理解）默认折叠。展开后使用同一只读Markdown渲染，保留数学、链接与媒体；资产页可显式编辑，路线只读面不出现编辑按钮。折叠是视图状态，不改写Markdown。
- `live-preview.test.js`：焦点相关既有用例通过 `EditorView.focusChangeEffect` facet 模拟真实focus事件，不改产品焦点门控。`lesson-data.test.js` 更新空锦囊模板的旧断言，验证空条件为null、填写三级“何时想起”后可召回。
- `scripts/fixtures/vault-test-model.ts`：仅测试适配器增加 rawArguments，覆盖真实原生transport传入非法JSON的路径。

## 验证

使用内置 Node v24.19.0，命令中的执行器来自本仓库 node_modules，没有新拉取依赖。

- PASS：`node --test examples/native-vault/solver-runtime.test.js examples/native-vault/live-preview.test.js examples/native-vault/lesson-script.test.js examples/native-vault/teaching-context.test.js examples/native-vault/lesson-data.test.js`，62/62。先复现2项新runtime失败，再实现并通过；旧focus和空模板断言经当前合同修正。
- PASS：`node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/native-vault-solver.test.ts`，13/13。临时DSH_HOME、随机端口、测试模型；覆盖原生参数失败→修正→唯一draft子会话、原页图像与预算、父历史隔离、模型配置、取消/重启与可检查性。没有真实模型付费调用。
- PASS：`node node_modules/@playwright/test/cli.js test tests/e2e/native-vault-fold.spec.ts --reporter=line`。真实Chromium/隔离实例验证资产路线文档、卡片参考理解、显式编辑后收起且原文件不变、路线总述及课程说明的只读展开、零console/pageerror。扩充路线用例时首次因展开总述挤出画布导致点击超时，改为检查总述后收起并居中再点节点，最终11.4秒通过；没有用force点击绕过可见性。
- PASS：`node node_modules/tsx/dist/cli.mjs scripts/build-native-vault.ts`；JSON清单解析、`git diff --check`。
- FAIL（既有）：`node node_modules/typescript/bin/tsc -p tsconfig.tests.json --noEmit` 仍有5项错误，位于 teaching-rounds、tool-disclosure、journey；本轮修改的fixture/spec没有新增诊断。未声称全仓类型检查通过。
- 未运行：真实模型的新拆卡轨迹、数学质量与费用对比。提示词工作流改善仍需真实任务确认，确定性测试仅证明接线及护栏。

## 本地服务

- 用户现用 `http://127.0.0.1:57093/`，数据根 `~/.notara/vault-runtime`。
- 确认本实例无正在运行任务、进程cwd正确后，将0.12.2装为新的冻结快照，更新两处托管链接与preset根；旧快照及配置备份保留，不改已有Vault内容。
- 初次启动发现新快照缺少旧快照使用的node_modules链接，导致ERR_MODULE_NOT_FOUND；补上同一锁定依赖目录链接后恢复。不是模型网络失败。
- 恢复后只读HTTP连接成功，7个原会话仍可列出；检查当前安装版号0.12.2和6个关键运行文件，与刚验证的构建逐字节一致。页面刷新加载新版UI；没有自动提交课堂消息或触发模型。
- 浏览器证据为隔离合成材料，位于 `test-results/native-vault-fold-teacher--c215c-s-and-still-opens-on-demand/`。未读取或修改用户实际文档来制造验收结果。
