# 卡片工作流更新与交接

## 目标与改动

在 `codex/notara-vault-clean` 实现用户确认的三段卡片：tags页头、内容、参考理解、学生理解；题目叶子原则上一题一卡，同类题挂无复习周期的topic父节点。完整原题可检索，原文参考答案保留并优先，模型补充及疑点分清，学生理解无真实表达则留空。

- `resources/vault-teaching` 的base、solver、备课/资料整理/数学/锦囊/Vault工作流及manifest同步更新，清除旧模板与“只引用不写正文”的冲突指导。
- `solver-runtime.js` / `solver-policy.js`：独立生成上限默认32768，用户可配置；自动匹配选择支持的较高推理等级。预算耗尽明确失败，不返回截断答案为成功产物。
- `solver-sources.js`：最多4个PDF embed，Host按当前工作区和revision读取原页、保存原生图像附件交给零工具独立子会话；不给子代理额外读写权限。
- `classroom-client.js`：教室设置支持独立生成上限。
- `templates` / `graph.js` / `pdf.js` / `vault.js`：新三段模板与生成入口、父节点/搜索、未转写区域诚实标记、精确匹配旧内置模板的升级；不改写已有卡片。
- `conversation-file-navigation.js` / `workspace-client.js`：原生对话产物提及/chip接入资产分屏，保留资产未保存守卫与原生composer。

## 验证与限制

- 单元层：卡片合同、solver、教室、导航、剧本、媒体相关50项曾全通过；随后新增预算耗尽分支与早期模板兼容并再次运行，结果在本机 `.runtime/card-workflow-unit.log`。
- Host集成：Node v24.19.0 下 `vitest run --config vitest.integration.config.ts tests/integration/native-vault-solver.test.ts` 12/12通过。最终改动后重跑“实际收到原页图像”用例通过：真实子请求含图像、32768/49152预算、旧revision拒绝。
- 构建通过，pack清单包含solver-policy/solver-sources。默认shell Node23最初触发Node>=24前置拒绝，切换内置Node24后通过。
- 测试typecheck仍有5项非本次修改文件的错误：teaching-rounds、tool-disclosure、journey；没有宣称全仓通过。
- 浏览器：Edge刷新后发现持久化实例仍指向0.11.2冻结快照，因此该次点击仍打开侧栏。随后已将0.12.1安装为新的独立快照并更新两处托管软链接及预设根，保留旧快照、数据和session。用户要求自己测试，已停止浏览器验收。**最终新版导航UI未验收**，不可将旧页面的行为当作新版证据。
- 新e2e用例使用真实native write产物及文件提及，不注入替身DOM；本轮未运行。真实模型的数学质量与产卡行为未重跑，原17张卡未改写。

## 服务交接

用户要求停止验收后，只完成恢复服务所需的快照安装与启动。版本0.12.1；固定地址 `http://127.0.0.1:57093/`；持久化数据根 `~/.notara/vault-runtime`。不要删除旧根别名或任何用户数据。后续页面效果由用户自己测试。
