# 路线规划与迭代数列样板

## 范围

用户认可先以“迭代数列专题”写完整样板，再完善规划 Skill、路线字段和界面。在 `codex/notara-vault-clean` 实施 Native Vault 0.11.0，保留此前未提交改动；未提交、未合并、未操作实际 Vault 或正在使用的服务。

设计：[路线规划](../migration/2026-09-22-route-planning.md)。样板：`resources/vault-teaching/examples/iterated-sequences.md`，六个主线单元、两个条件补练、一个拓展。样板是课程设计内容蓝本，不是已导入的学生路线，也不冒充原 PDF 的题号或页码。

## 内容与教学流程

- 新增 `notara-route-planning` Skill：终点、起点证据与未知、教学主线、练习梯度、检查与局部调整；按需使用已有高级模型助手 plan/review，不要求固定多代理流程或全面诊断。
- 样板体现候选与收敛的区分、找界的发现过程、完整证明、奇偶与压缩的比较、无方法标签的混合选路和具体延迟回访。Newton 误差阶为条件拓展，提出问题为可选进阶目标。
- 开发期只读审阅后补充：局部代数困难就地处理，不误分流到找界课；记录区间来源与帮助程度；压缩法在课内推导误差递推小引理；连续性增加最小前提检查；提问与延迟回访有具体任务和观察依据。
- `DSH_NOTARA_TEACHING` 由 Host 指向实际安装的教学资源根，规划 Skill 给出可执行的样板读取方式；未读到时不得声称已参考，不把资源路径写成学生 Vault 的材料。

## 实际代码与锚点

- `route-plan.js`：pathway 单一词表，stage/brief/overview 内容校验，节点正文块与修订日志解析。brief 只存 Markdown 正文；元数据写入按已有块位置修改，不移动块间手写文字。完整日志持续保留，无自动截断历史。
- `lesson-data.js#parseRoute/renderRoute/validateRouteNodes`：新增 stage、pathway、prerequisites，区分 sequence/branch/prerequisite；联合关系无环、无悬空、自引用与重复身份。旧路线默认主线；未知持久属性报错而非静默丢失。调用方省略 brief 时保留既有正文，显式空串才清空。
- `file-operations.js#createRouteInVault`：主线默认接上一主线，条件分支必须指定来源，先修由有效下标转为程序身份，材料与剧本检查真实存在。新增 `reviseRouteInVault`：读取真实 revision、全请求校验后一次 CAS 写入；保护已绑定节点、保留课堂和日期，更新未来节点或新增课程；不删除节点，无实际变化不写假日志。
- `vault-cli.js`：新增 route-outline、revise-route；完善 create-route。目录返回真实节点与 revision，不复制规划正文；子项参数帮助和校验共用字段定义，错误给出可执行的修正方向。仍只有四个专用模型工具，普通读写沿原生工具与批准。
- `teaching-runtime.js#routes/routeContext`：路线投影带 overview 与节点 brief，边带路线作用域；每轮只给当前节点的规划、阶段、先修入口。brief 超过6000 Unicode字符时整段延后按原生工具读取，不截断后冒充完整规划。
- `routes-client.js`：默认主线，按需显示条件补练/拓展及阶段筛选；详情展示规划、先修、分支、材料、剧本、开课、小结。路线总述和教师参考折叠；已选先修可定位。修正注入回调接线与分支重复画成课序的问题，不借用其他路线同名节点的关系。
- `client-source.ts#CodeMirrorMarkdown`：新增只读用法，规划正文复用数学、高亮、引用和 details；资产页仍可编辑。路线上的“请老师规划或调整”只把请求与真实文件引用放进当前输入草稿。
- `live-preview.js`：隐藏已闭合的路线节点/日志元数据，不执行 HTML，不吞未闭合标记后的正文。
- 更新 route 模板、base、manifest、workflow、迁移合同与 AGENTS；版本升至0.11.0，发布清单加入 route-plan.js，客户端与资源由既有构建生成。

## 验证记录

- PASS（构建）：`PATH=/Users/yangrundong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run build:native-vault`，客户端 **5,432,964 bytes**；rc.2 Session.append ignorable 接缝检查成功。
- PASS（语法）：12个相关JS源码/测试文件 `node --check`；`client-source.ts` 使用 `node --check --experimental-strip-types`。
- PASS（资源/发布清单）：manifest 15个教法/Skill条目无重复；正文、manifest、base与打包副本一致；数列样板已打包；发布清单文件均存在且包含新解析模块。
- PASS（格式）：`git diff --check`。
- 已准备但未执行：路线正文往返、元数据更新不移动手写正文、省略brief保留、完整日志保留、联合环拒绝、默认主线、绑定节点保护、修订CAS、UI关系投影与元数据隐藏的回归用例。CLI命令清单断言已同步。
- 未运行：单测、集成、E2E、真实浏览器、真实模型课堂和学生体验，遵照用户暂停验收的要求。源码审阅和样板数学检查不构成教学质量达到网课教师水平的证据。

## 运行边界与下一入口

没有重启当前服务或改写安装快照，也没有把样板自动导入用户资料。恢复验收后使用新版本与隔离工作区，先检查创建→读回→面板→开课背景→归档小结→局部调整→重开全过程，尤其是正文、旧课堂和日期的保留；之后再以真实学生表现评估规划取舍与适应性。
