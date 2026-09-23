# 指令列表中的教学 Skill

## 用户目标

学生点击现有输入框“指令”即可发现可用 Skill，不需要先知道内部名称。复用原生 Skill 登记与调用，教学资源用 manifest 中的中文名称和用途展示，搜索支持中文和原调用名；选择只准备草稿，不自动发送。用户随后要求折叠学生不常主动使用的 Skill，已纳入本轮。

## 实施前核实

工作树 `/Users/yangrundong/.codex/worktrees/notara-vault-clean/DSH`，分支 `codex/notara-vault-clean`，保留已有未提交修改。前版0.14.1的认知演变规则已经部署；本轮包版本为0.14.2。

`teacher.js / apply` 已从 manifest 登记全部21项（4个教法、17个Skill），均为 userInvocable。原生 `skills/list` 依会话预设取范围并过滤不可由用户调用的项目；Skill真实名称要求ASCII kebab-case，中文只用于展示，不改变真实调用名。

## 实际改动

- `scripts/patch-input-source-filter.ts / patches`：原先按钮只调用 command 来源，而手写 `/` 会查询全部来源。按钮现在合并可用 command/skill 来源，继续经过原生范围过滤；增加仅用于 onPick 的 `refresh` 结果供菜单折叠使用，不进入输入/发送流水线，键盘也只遍历当前可见候选。先逆向归一、核验原版 SHA，再重放补丁，可升级已发布的旧来源过滤接缝。
- `scripts/skill-menu-patch.ts / patchSkillMenu`、`scripts/patch-skill-menu.ts`：从同一 manifest 生成展示名称和折叠名单。候选 name 是中文展示，value 和 lexicon 保持真实 Skill ID；中文标题/说明和原 ID 都能搜索。选择在草稿内补必要空格，确保原生调用词识别成功。未知上游模块拒绝打补丁。
- `resources/vault-teaching/manifest.json / menu`：7项常用功能（资料检索、书籍拆解与资料整理、作文批改、讲义整理、学习经历与方法整理、备课、路线规划）直接展示；4教法、8学科关注、2辅助工作流设置 `menu: more`，合在“更多技能”中。搜索不受折叠限制。普通第三方 Skill 沿用原名和正常展示。
- `scripts/patch-sdk.ts` 与 `scripts/build-native-vault.ts` 接入构建；Native Vault 版本0.14.2。未改变 Skill 正文、模型工具面、权限、会话生命周期或自动注入范围。
- `tests/e2e/native-vault-command-skills.spec.ts` 覆盖初次输入、菜单折叠、中文搜索、键盘选择、草稿、真实Host装配和普通助手隔离；`native-vault-subjects.spec.ts` 的显示断言改用manifest中文名，继续按真实ID搜索。
- `README.md / Native Vault 教学入口` 与 `AGENTS.md / 当前事实源` 同步使用方式。

## 验证与保留的失败

证据目录：`docs/evidence/skill-command-menu/`。本轮使用Node v24.19.0及锁定依赖，浏览器测试来自独立临时Vault和合成模型，没有读取用户API key或发起付费请求。

- PASS，真实可见浏览器：`node node_modules/@playwright/test/cli.js test tests/e2e/native-vault-command-skills.spec.ts --headed`，1/1，见 `browser-folded-final.txt`。断言折叠项不存在于候选列表，展开/收起及Enter操作不修改草稿、不产生请求；发送所选Skill后真实Host请求包含对应完整正文；隐藏的学科Skill可被中文及真实ID搜索；standard预设不出现教学资源或“更多技能”。
- PASS，相关浏览器回归：`native-vault-subjects.spec.ts --headed`，1/1，见 `browser-folded.txt` 内第二个测试；核对学科检索、剧本模板、默认折叠及持久化。控制台与pageerror无异常。
- PASS，2/2补丁单测：`node node_modules/vitest/vitest.mjs run --config vitest.unit.config.ts tests/unit/skill-menu-patch.test.ts`，见 `unit-final.txt`。验证幂等、展示/折叠元数据更新和未知上游拒绝。
- PASS，2/2资源测试：`node --test examples/native-vault/teaching-resources.test.js`，见 `resource-final.txt`；源资源、构建资源、登记与检索一致。
- PASS，根 `tsc --build`（退出0、无输出），两个原生客户端 `node --check`、`git diff --check`、`patch-sdk`重跑及构建。构建与启动再次运行同一幂等补丁。
- PASS，`npm pack --dry-run --json --ignore-scripts`：0.14.2及教学manifest在包中，见 `package-content.json`；未发布远程包。
- 初次红测证明原按钮不含Skill；第一次修正后发现已有草稿后缺空格导致没有加载Skill，已补并实际核对模型请求。扩展standard检查时，测试错误假定RPC创建的空会话会显示在工作区：原生侧栏隐藏非当前空会话，RPC创建也不登记UI工作区成员。改为合成模型形成一轮后展开“未分组”，未改产品的会话逻辑。失败日志保留，不将其算作通过。
- 未运行：全仓测试、真实模型教学质量、真实学生体验。合成模型请求证明加载链路，不证明模型运用Skill的质量。

## 长期服务交付

`http://127.0.0.1:57093/` 已冷启动到0.14.2，数据根 `/Users/yangrundong/.notara/vault-runtime`；发布前两次确认7个会话均空闲，发布后身份摘要一致，仍无运行任务。未修改既有课堂正文、学习资料或模型配置。用户刷新原页面即可使用。

快照 `vault-plugin-0.14.2`；PID20732、launcher PID20722、exec session39041（仅本轮交接状态，操作前重查）。两处Vault链接、preset根和安装manifest一致；记录见 `deployment.json`。

备份 `pre-skill-menu-1790098543443` 保留旧配置、链接、源码及5个原生UI回退文件（已逆向核验原版SHA并恢复0.14.1的过滤补丁）。本轮修改了共享node_modules中的原生UI，单独切回旧Vault快照不等于完整回退；回退时还需恢复这些UI文件和旧补丁接线，防止新构建再次应用0.14.2菜单。回退须先核实实例归属与空闲状态，正常停止后操作，不删除数据根或旧快照。
