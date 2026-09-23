# 教学写入审批服从原生权限

## 用户确认与根因

用户先要求去掉额外的必须批准门，随后明确为“只需要写入操作需要批准，然后被原生权限机制 override”。最终保留文件/课堂写操作的默认审批，原生完全权限覆盖这层额外要求；Bash 只沿用原生沙箱与审批决定。

此前教师会话的 `tools/pre-execute` 不区分当前权限模式，把 write/edit/bash 和课堂写工具一律改为 ask。用户会话实际选择了 `danger-full-access`；原生该预设的审批策略为 never，因此额外 ask 会直接 rejected，PDF 页读取经 Bash 也被连带拒绝。

## 改动锚点

- `agent-tools.js / installAgentTools`：只对 write/edit 与 `VAULT_WRITE_TOOLS` 增加默认审批；使用原生 `sandboxPolicy.resolve({session})` 判断完全权限并服从它。已有 native deny/ask 保持原样，子代理零工具限制仍优先生效。Bash 不做字符串分类，也不统一 ask。
- `resources/vault-teaching/base.md`、`skills/vault-workflow.md`：说明当前权限的优先级、Bash 的原生执行边界，以及不要把关闭审批弹窗笼统说成没有文件权限。
- `agent-io.js`：澄清内部写入能力在原生权限允许或本次批准后取得，不改变 CAS/作用域规则。
- `agent-tools.test.js`：覆盖默认文件写审批、普通 Bash、完全权限覆盖、原生拒绝和子代理限制。
- `native-vault-teaching.test.ts`：补真实 Host 完全权限回归；PDF 不应因教学层额外弹窗。顺带修正旧 glob 断言取错装配请求（工具结果在第二次模型请求中）。
- Native Vault 升至 0.11.2。当前规则同步到 AGENTS 与工具迁移文档。

## 验证与发布

- PASS：新增条件修复前两例失败，修复后 `node --test examples/native-vault/agent-tools.test.js` 4/4。
- PASS：`npm run test:integration -- tests/integration/native-vault-teaching.test.ts -t '完全权限|原生 glob|原生 write/edit'`，3/3 选中测试通过。使用临时 DSH_HOME、真实 DSH Host/文件系统/原生工具、合成模型；验证实际 PDF 页读取、真实卡片落盘、默认写批准与拒绝不落盘、未读保护及过期版本 CAS。
- PASS：启动测试时 `build:native-vault` 完成；`git diff --check`。
- 已更新原 `57093` 持久实例：复制新 `vault-plugin-0.11.2`，等待空闲后停止本实例、切换登记，再通过 `npm run vault -- --no-open` 启动。未改用户当前权限选择，未重置 home 或移动学习资料。
- PASS：实际安装快照版本 0.11.2、权限源码与仓库一致；升级前浏览器 Cookie 仍返回 200。
- 未运行：真实模型继续用户那批 15 张卡片的流程；没有替用户创建这些卡片，也没有假称第 5–7 页已读完。
- 边界：任意 Bash 是否弹窗由原生策略决定，不承诺所有 shell 文件写入都会被语义识别为写操作；教学层没有新增命令解析器或另一套批准开关。
