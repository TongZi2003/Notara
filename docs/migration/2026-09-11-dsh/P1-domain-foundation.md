# P1：最小事实基础与原生能力联通 Implementation Plan

> **For agentic workers:** 使用superpowers:executing-plans逐任务执行。G0已由原流程审查，本阶段不重做P0。用户已接受精简审计，旧计划内部结构不再是验收目标。

**Goal:** 建立真正需要的身份/版本/写入保障，并提前验证DSH可接走的能力。
**Architecture:** 原生Session、storage、web、subagents、skills/systemPrompt为基础；StudyForge只补学习对象和实际授权差额。
**Tech Stack:** P0锁定DSH/TS/Node，Vitest、Playwright与真实模型分层。

## 全局约束
读总计划、CONTRACTS、SIMPLIFICATION。B固定3831987；R旧bin/app/.pi不作产品合同源。空新数据，不导入旧格式。不为文件清单创建空服务，新增文件可并入已有同职责文件并记录映射。

## P1.1：接收正确基线与P0成果
**文件：** 仓库根目录/AGENTS.md（相对R）；docs/runtime/product-baseline.md；根据P0已有脚本添加所需测试配置。
**输入：** R的G0审查、B固定commit、当前用户裁决；**输出：** 一份短基线/范围记录与近目录规则。
- [ ] 读取R状态、实际DSH/Node/package版本与P0生成器修正，记录接受commit，不覆盖其代码或锁文件。
- [ ] 用git cat-file/git show验证3831987可读，记录B与R职责；BASELINE-SOURCES.json保留为历史取证附录，不再强制新建源码SHA扫描器或重复维护66文件清单。
- [ ] 近目录AGENTS明确新用户精简裁决优先：不恢复两对象阈值、minor门槛、全树编辑版本、全输入证据表；身份/来源/确认/复习实际结果仍需正确。
- [ ] 建立contracts/domain/host/client实际目录映射，复用P0测试启动fixture；只添加本阶段需要的Vitest配置。
- [ ] 运行git cat-file -e 3831987c0568b66b6b43aacaf999760757922e3c（在B）及仓库根目录的npm run typecheck；仅接线变化影响P0时复跑其原生boot测试。记录命令与结果后提交。

## P1.2：同源schema与最小字段
**文件：** packages/contracts/src/{core,materials,lesson-materials,evidence,execution,knowledge,memory,index}.ts；packages/domain/src/{clock,ids}.ts；scripts/check-contracts.ts；tests/unit/contracts-v2.test.ts。
**输入：** CONTRACTS；**输出：** 领域schema/推导TS/工具JSON schema，无重复手写原生SDK类型。
- [ ] 定义SourceAnchor、混合/空LessonMaterials、卡/知识/学情最小内容；保留题面/答案/系统历史分离和Knowledge单body。
- [ ] 学情分类是可配置字符串，默认ability/habit/preference；分类不提供存储权限。适用范围默认通用或subjects，不引入unresolved状态机。知识内容另有KnowledgeRecord，不创建concept知识桶。
- [ ] 身份/真实时间/版本由Host提供；每个修改对象只用一个适用VersionToken。五教学选项来自P7配置，删除BuiltinTeachingPresetId领域枚举。
- [ ] tests直接过validator：混合来源/空材料合法，过界locator、伪账号、错误对象类型拒绝；一次观察/自定义学情分类可存，不验证“两对象才准保存”。
~~~ts
expect(LessonMaterialsSchema.parse({materials:[]})).toEqual({materials:[]});
expect(memoryWithOneRealObservation.body).toContain('本题');
expect(memoryWithOneRealObservation).not.toHaveProperty('verifiedAbility');
~~~
变量用真实schema fixture创建，不能只检查手写对象绕过validator；Clock可注入now及workspace时区。
- [ ] 运行 npm run test:unit -- tests/unit/contracts-v2.test.ts、npm run check:contracts、npm run typecheck；提交。

## P1.3：原生单记录存储与具体原子操作
**文件：** packages/domain/src/storage/record-store.ts；tests/integration/storage-v2.test.ts；tests/fixtures/storage-child.ts；docs/runtime/storage-decisions.md；workspace写者接线并入现有Host入口。
**输入：** storage-domain/storage-json、领域schema和VersionToken；**输出：** RecordStore.read/update，实际多对象操作清单和各自提交策略。
- [ ] 一张卡的内容、必要历史、operation去重关联放一个可原子更新记录，复用原生update/持久发布；不要重写原生临时文件、fsync或所有读写通用journal。
- [ ] 用同卡陈旧版本、丢响应后同op重试、发布前/后进程退出验证无覆盖/重复；读取损坏报错而不初始化空数据。
- [ ] 前后内容revision与真实actor/session/operation保全，红笔不依赖Git是否提交。查询/设置/投影不强行走多对象事务。
- [ ] 列清实际跨对象操作：骨架改径连带卡、确认关联效果、包发布。逐项记录能否合为单记录，不能合并的只在P5/P6/P8对应写者实现窄提交/恢复；拒绝“以后可能用到”作为通用引擎理由。
- [ ] 原生无跨进程锁/跨表事务。两真实进程尝试同workspace写时，证明owner层拒绝或正确串行；按实际Host入口选择最小独占机制，不用进程内Map冒充。
- [ ] 运行 npm run test:integration -- tests/integration/storage-v2.test.ts、typecheck；交付单卡故障证据及多对象差额，不提前宣称整包事务已完成。

## P1.4：原生composition与学生范围
**文件：** packages/domain/src/access/execution-binding.ts；packages/host/src/access/context.ts；tests/integration/access-binding.test.ts。
**输入：** DSH真实会话/composition/tool policy、已授权workspace；**输出：** HostContext和原生缺少的学生/作品/引用授权。
- [ ] learning/creation采用明确composition；五种教学配置共用learning工具，临时改prompt不改composition或扩权。不为五种选项各复制grants与权限流程。
- [ ] 本人跨科/跨集读取正常，导航只是默认关注；适用范围由教学内容判断，明确通用偏好可保存，不额外请求global审批。
- [ ] 原生workspaceFiles/tool-fs及subprocess grep的实际读取路径都核对：cwd不等于授权目录。限定学生根或选定作品/reference，避免旁路；不要只检查自己生成的file URI。
- [ ] creation保留作品与已授予材料范围，单文件版本用原生observation能力；共享包和其他学生数据不可因为模型提示变化而开放。
- [ ] 测两个workspace同名资源、本人跨科、目标来源归属、坏绑定、creation越界及原生Remote/grep直接调用；把数据归属错误与教学适用范围选择分开。
- [ ] 运行 npm run test:integration -- tests/integration/access-binding.test.ts、typecheck；提交。

## P1.5：提前验证web、子Agent、prompt与文件接缝
**文件：** packages/host/src/native-capabilities.ts（有实际教学转换才保留代码）；scripts/test-live.ts；vitest.live.config.ts；tests/integration/native-capability-wiring.test.ts；tests/live/native-capabilities.test.ts；docs/runtime/native-capabilities.md。
**输入：** P0真实runtime、已安装原生web/subagent/skills/systemPrompt/storage/fs版本；**输出：** 经证据核验的接线配置和实际差额，后续阶段直接消费，不重建各自管理器。
- [ ] 照SIMPLIFICATION官方来源使用ctx.web/web_search/web_fetch；记录provider装配与可用性。一次真实搜索→fetch保留实际URL/截断；无外部配置标BLOCKED，不编模拟成功。
- [ ] 原生ctx.subagents一次创建/结果、continuable追加/取消、outputSchema；核父子身份和实际继承prompt/tools/resources。搜索、命题、制作只是配置差异，角色规则不拥有第二生命周期。
- [ ] 注册动态systemPrompt.section和原生Skill provider；同一真实会话改教学选择/临时要求，下一次prepared request反映变化。原生agent-presets只适合空会话切composition，不能拿它冒充同课切教法。
- [ ] 最小文件fixture验证原生read-before-edit/stale guard及授权backend；明确原生fs-sandbox读权限与产品需求的差额，不预设必须再实现一套文件工具。
- [ ] 使用真实DSH加可控模型验确定性装配；live验证至少一条真实搜索和子任务/提示更新，分别记录失败原因，不用“安装包存在”作功能PASS。
- [ ] 运行 npm run test:integration -- tests/integration/native-capability-wiring.test.ts、npm run test:live -- tests/live/native-capabilities.test.ts、check:contracts/typecheck/build；交G1。

**G1：** 最小schema/实际写入与授权通过，原生组合差额已明确。外部账户不可用可以单列BLOCKED并继续无关开发，但相关搜索/真实模型功能在后续最终验收前不能标PASS。没有P1.5接线证据，不允许P4/P7猜API后自建替代系统。
