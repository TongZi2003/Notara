# P4：混合材料、选择与来源上下文 Implementation Plan

> **For agentic workers:** 使用superpowers:executing-plans；G3 PASS后执行四项，交G4。

**Goal:** 一课可同时使用原书、卡片和图片，选区及原始定位在发送、保存和回看中一致。
**Architecture:** 课程/消息/产出引用形成只读资料投影，DSH Session右栏拥有标签和active，MessageEnvelope冻结本次上下文。
**Tech Stack:** TS、DSH native message/resource、DOM/PDF坐标适配、Playwright。

## 全局约束
LessonMaterials允许空或混合，表示教学引用而非文件权限。B/app/js/course.js的本课资料体验通过DSH原生标签实现，具体见DSH-PREVIEW.md；读取本人其他集不改变归属，不能把所有打开资源当作学生全部做过。

## P4.1：本课资料投影与原生Session预览
**文件：** packages/domain/src/courses/lesson-resource-projection.ts；packages/host/src/materials/session-resource.ts；packages/client/src/materials/{LessonResources.tsx,native-preview-adapter.ts}；tests/integration/mixed-deck.test.ts；tests/e2e/mixed-deck.spec.ts。
**输入：** 课程初始/明确关联引用、已接受消息来源、P2真实产出、DSH资源/Tab机制及P3.1的resolveForSession；**输出：** LessonResources.read只读投影、NativePreviewAdapter.open/active；P6复用此路径，session-resource.ts在本项仅扩展卡片类型，不重建文件资源解析。

- [ ] 从确认课程引用、已接受消息和真实产出投影本课资料，允许零/混合；不新增由每次打开/关闭驱动的持久deck台账。教学引用顺序保留，同原件多个位置可各自跳转。
- [ ] 打开经resolveForSession和原生openResource；相同kind/contentId默认聚焦已有tab，可用原生分栏比较。当前项用native active，关闭tab不删课程引用；课程关联修改走明确领域动作，不删除原件/旧消息。
- [ ] 新课从入口接教学引用；课中选择带回原课，上传按发起课绑定。顶层openResource只操作已挂载的目标Session，延迟回调用tab.actions或核对真实绑定，不借当前别课，也不调用私有openResourceIn。纯浏览不创建占位课。
- [ ] 卡片注册StudyForge资源/标签类型，保留隐藏答案边界；书/MD/图片仍走官方预览扩展。资料引用刷新可重建，DSH布局刷新重置如实保留；点已保存来源能重新定位。空引用仍能聊天。
- [ ] 测同课PDF+卡+MD三个native标签、重复打开聚焦、分栏、A/B切换、旧tab异步回调、刷新后由引用重开、课中带回、首发失败保留与旧版本。浏览/切tab零消息。
- [ ] 运行 npm run test:integration -- tests/integration/mixed-deck.test.ts、npm run test:e2e -- tests/e2e/mixed-deck.spec.ts、typecheck；提交。

## P4.2：本地学习查询与原生web
**文件：** packages/domain/src/materials/learning-search.ts；packages/host/src/tools/search-tools.ts（本地领域查询）；packages/client/src/materials/MaterialPicker.tsx；现有结果区需要混合展示时追加临时URL/对象行适配；tests/integration/global-learning-search.test.ts；tests/integration/search-sources.test.ts。
**参考：** B/bin/learning_search.py；P1.5原生web接线与SIMPLIFICATION。
**输入：** 本人材料/卡/知识读侧、原生web_search/web_fetch/ctx.web；**输出：** 本地对象ref和版本定位，外网直接沿原生结果结构。
**依赖边界：** P5前以合法卡/知识fixture测试；P5保存后补真实写后检索。
- [ ] 本地默认查材料、卡正文/卡背、知识；学情需明确目的，不拿空memory当无库存。可用原生glob/grep/read时复用，学习对象语义才补窄查询。
- [ ] 外网直接用P1.5已验原生web/provider，不新建统一SearchService、外网EntityRef、readState或重复错误/截断协议。主搜索和子搜索共用实际工具注册。
- [ ] 搜索片段与fetch/read的实际内容/范围如实保留，相关性、是否进一步阅读归Skill。外部URL导入前不是MaterialVersion，已有资料引用不丢version/locator。
- [ ] 本人跨集/跨科读正常，默认focus只影响排序/建议；真实授权覆盖grep subprocess/文件Remote，不能只靠cwd。对外查询不附带无关父课/学情全文。
- [ ] 模拟外部provider失败仍展示本地命中；本地缺目录/无命中/截断/拒绝给实际原因。任何结果不自动导入、制卡或记复习。
- [ ] 测同名跨科、卡背/知识命中、未归集、外网URL与本地来源并列、实际fetch失败/截断、越权路径；原生结果不得被展示适配丢掉出处。
- [ ] 运行 npm run test:integration -- tests/integration/global-learning-search.test.ts、npm run test:integration -- tests/integration/search-sources.test.ts、access回归/typecheck；实际web配置缺口继续标BLOCKED，P7/P9验真实主子搜索。

## P4.3：四类选择与发送冻结
**文件：** packages/client/src/materials/{selection-store.ts,anchors/pdf.ts,anchors/image.ts,anchors/text.ts,anchors/docx.ts}；packages/host/src/runtime/context-envelope.ts；packages/client/src/classroom/ContextPreview.tsx；tests/unit/source-locators-v2.test.ts；tests/e2e/selection-message.spec.ts。
**输入：** P3索引、SourceAnchor、P2唯一send入口；**输出：** capture/clear/snapshot，完整MessageEnvelope进入DSH真实历史。

- [ ] PDF反算crop/rotation/zoom，图片按EXIF规范方向，MD/代码/文本DOM映射原始行列，DOCX映射part/block/offset；跨页/块拆多anchor。
- [ ] 参数包括0/90/180/270度、缩放、滚动、中文emoji、重复段落/表格。持久化不用CSS像素或显示页号；容差明确到规范坐标1e-4。
- [ ] 发送selection优先，否则取native active tab与其renderer报告的位置；无active来源不伪造当前位置，多窗格不默认全发。卡由Host解析当前/实际证据版本和来源；学生可移除本次引用，浏览/框选不发送。
- [ ] 来源扩展挂到原生composer序列化/引用codec，与native submission同一snapshot冻结；发送后换页/换课不变历史，失败恢复沿native输入服务，不新建发送器。真实已接受message可按需查询为E；使用该依据时才保存引用。
- [ ] 用鼠标/DOM Range真实选择生成locator，不能测试直接喂预设anchor充当capture。检查DSH读回有内容、version、locator；图片内容块和持久引用分开。
- [ ] 运行 npm run test:unit -- tests/unit/source-locators-v2.test.ts、npm run test:e2e -- tests/e2e/selection-message.spec.ts、native-input回归/typecheck；提交。

## P4.4：原位回跳与版本失效处理
**文件：** packages/domain/src/materials/resolve-anchor.ts；packages/client/src/materials/{SourceLink.tsx,source-navigation.ts}；tests/integration/anchor-version.test.ts；tests/e2e/source-roundtrip.spec.ts。
**输入：** MaterialService、selection adapters；**输出：** resolve/open/highlight，后续卡/知识/计划及P6.6书籍左阅读区复用。

- [ ] 从消息/卡/课程引用点击，通过同一native资源路径打开正确版本；导航参数走公开扩展并自行验证locator，不把源码line当PDF页码。标题改名不改identity，v2不替换v1；刷新原生布局重置后仍能按已保存锚重开。
- [ ] 删除/损坏/未授权与locator失效返回不同可行动结果；不能静默跳当前版/第一个同文段。
- [ ] source-navigation接明确preview target：课堂走原生resource/tab；资料页走P3同一renderer的本地挂载。两种入口共用版本/坐标校验，不强行把书籍卡来源弹到课堂右栏。
- [ ] 更换来源是显式选择新位置再确认保存；旧消息不被追溯改绑。多来源能逐项回跳。
- [ ] 测四格式“选区→发送→重启→回跳”，PDF旋转、DOCX重复表格、未归集和混合deck；比较原件bytes和高亮。
- [ ] 运行 npm run test:integration -- tests/integration/anchor-version.test.ts、npm run test:e2e -- tests/e2e/source-roundtrip.spec.ts、P4回归/typecheck/build；交G4。
**G4：** 原文定位真实往返、混合课堂和选区消息成立；P5再以实际普通卡/锦囊验证相同来源路径。
