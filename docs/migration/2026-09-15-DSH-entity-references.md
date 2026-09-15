# 全对话资料引用第一版

用户授权：统一对话中的资料实体引用；正常标题嵌在句子中加下划线，不为引用换行。点击恢复资料工作台、展开真实层级、定位和预览固定版本。查看不表示采用或学过。

## 实际变更

- `packages/contracts/src/entity-reference.ts`：书/原文、章节、题卡、知识四类引用，规范UTF-8编码与严格目标校验。地址不带服务端口、凭据或文件路径，没有第二套引用数据库。
- `host/src/entity-reference-service.ts`、`library-service.ts`：当前查看课堂授权下只读解析；卡/知识读固定版本，目录读固定修订，原文校验真实位置。来源投影剥除quote等非定位字段。
- `host/src/tools/entity-reference-output.ts` 与六组工具、成功回执、帮手：保留首个规范JSON块，附加系统生成的可引用链接。卡枚举补真实版本，仅导航用，不能授予编辑权限。
- `scripts/patch-entity-links.ts`：原生primitives与实际web shell均加专用链接接缝和流式尾部保护；原SHA反向校验、重跑幂等、未知上游拒绝。外部链接、公式、表格和代码继续原生渲染。
- `client/src/materials/entity-reference.ts`、`LessonResources.tsx`、`entity-reference-focus.ts`：恢复工作台、切全库、按身份/完整locator匹配、展开父链、纵横居中、历史临时节点。目录延迟读入导致父链变化时补展开一次，不持续抢用户选择。
- 引用状态下图与预览上下排列，正常关系图布局保留；多来源按钮同步焦点与位置提示，短面板不因最小高度而挤出预览。
- `SourceFragment`、`context-envelope.ts`、`skill-draft.ts`、`source-display.tsx`：学生来源和知识引用保留真实身份/版本；纯文本摘要与思维图标题不露内部编码。大量来源不因新增的30项限制而阻断发送。`entities.link`是模型读取的链接，UI按同一reference打开。

## 验证

| 状态 | 证据 |
|---|---|
| PASS | Node24 `npm run build`、`npm run typecheck:tests` |
| PASS | 16项单元：entity-reference 4、native Markdown 2、focus 2、source-context-codec 3、card-discovery 5 |
| PASS | 3个不同集成场景：entity-references、card-discovery-tools、native-source-context；固定版本、quote投影、坏位置/假课堂/缺失版本拒绝、改名、重启、原生fork继承；导航前后sf_records逐字相同 |
| PASS | 独立原生浏览器实际点击：行内下划线、新旧卡分别定位、多级自动展开、章节第3/4行切换带动焦点、知识固定版预览、关闭工作台后恢复、刷新后重新点旧引用；手帐与现代、802和1154宽度 |
| PASS | 实际原生页面中的公式/表格及完整慢速回复仍可读；半截内部目标隐藏与代码保留由安装后的真实renderer函数单测覆盖 |
| BLOCKED | `npm run test:live -- tests/live/entity-references.test.ts`：独立环境缺DEEPSEEK_API_KEY，1个场景明确跳过，不能算实模通过。用户现有课堂模型是否可用与这个独立测试状态分开 |
| 未运行 | 本轮未完整重跑PDF裁图/Word端到端、复制粘贴往返、切课网络失败注入；不把源码接线等同于这些场景已验 |

初次失败与修复：首轮原生SSR缺浏览器peer，改为执行安装产物真实函数；SDK补丁模板反引号语法修正；新增第二文字块后集成夹具改读首个规范JSON；列表version预期随导航合同调整而保留编辑拒绝；来源链接递归新增后引用数量从2修为3；目录惰性加载/节点高度变化/短面板在实页暴露并修正。各相关检查从最终状态重跑。

只读审查：两名子Agent分别检查Host和前端。采纳来源quote收口、发送边界、同源不同章节的sheet身份问题；拒绝“当前查看者必须绑定原课堂”“同卡同版不应去重”“历史读取没有存在性校验”等不符合实际代码或已确认设计的建议。实现与复验由主Agent完成。

## 运行态与保护

分支 `codex/dsh-native-migration`；原仓/B/4877未触碰。既有9月11日文档及CLAUDE的9增3删保留，不混入本轮提交。独立验证使用临时课堂，未给用户课堂发送测试消息。

58354通过本线程持有的预览runner更新完整四包快照；更新前核查无running课堂，同数据目录同端口恢复，sf_records哈希不变。原生模块、版本和资料不升级。

下一执行入口：用独立凭据运行实模用例，检查自然搜索/普通教学是否正确使用生成链接；旧回复里的纯文字标题仍保持原样。技术示例“literal code”只用于原生代码兼容验收，产品没有新增这个入口。
