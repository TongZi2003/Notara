# v2 基线核验与旧稿撤销清单

核验日期：2026-09-11。产品 B 固定 codex/contract-repair-integration@3831987c0568b66b6b43aacaf999760757922e3c。S/main@4d21a15 停在 9 月 6 日；二者分叉，B 有 119 个 main 没有的提交。app/bin/.pi 比较涉及 207 个文件，不能靠几处文字补丁修正旧计划。

本轮已生成 [66 个源码与测试文件的固定提交清单](BASELINE-SOURCES.json)，包含路径、字节数和 SHA-256。它证明读取了哪个版本，不证明任何产品行为已测试通过；它保留作来源取证附录；v2.3的P1.1用固定git commit验证，不要求继续维护SHA扫描器。

## 证据怎么读

源码以固定提交为准；CLAUDE 顶部最新记录用于发现入口，较早“未实施”段落不能覆盖已经合入的实现。本轮是源码和文档核验，未跑 B 的产品测试。表中测试文件确实存在，供抽取合成行为用例，不在 S 或真实数据上运行。

~~~bash
git -C <历史产品基线仓库> show 3831987:bin/method_schema.py
git -C <历史产品基线仓库> show 3831987:CLAUDE.md
~~~

B 工作树唯一观察到的脏项是已删除的编辑器 swap 文件；不纳入产品基线、不恢复它。本轮不修改 B。R已留下P0 G0 PASS审查，根来自旧 main；后续必须读 B 的固定源码，不能因离 R 近就读错旧合同。

## 已核最新行为

| 当前行为 / 旧稿必须撤销的内容 | 源码锚点（B） | 既有测试参考 | 新任务 |
|---|---|---|---|
| 新学情只写 ability/habit/preference；concept 不再是新写入桶 | bin/memory_schema.py::WRITE_KINDS/json_schema | dev/tests/learner-memory-evidence.sh | P1.2、P7.1 |
| 知识结论、私人教法沉淀与锦囊同身份；自由 body，不分 core/expression，不强制七栏 | bin/method_schema.py::CURRENT_VERSION/tool_schema；bin/method_store.py | dev/tests/knowledge-single-body.sh、knowledge-note-links.sh | P5.2 |
| 本人跨科/跨集读与新增归属分开，导航只默认关注 | bin/record_scope.py；bin/learning_search.py；.pi/skills/teaching/SKILL.md §0 | dev/tests/learning-search-native.sh、learner-memory-scope.sh | P1.4、P4.2 |
| 新建记忆每事务新身份；修订精确 target；偏好原文 Host 绑定，学生自述不当独立作答 | bin/memory_schema.py::json_schema；bin/memory_authoring.py::_public_evidence | dev/tests/memory-preference-statement-r05.sh、memory-evidence-projection-c02.sh | P7.1–P7.2 |
| 人机共同编辑卡/学情/组织/小结/工作台；冲突须重读并合并 | bin/card_authoring.py、memory_authoring.py、learning_structure_authoring.py、handoff_authoring.py、creation_authoring.py | dev/tests/c01-card-editor.mjs、c02-memory-editor.mjs、c03-organization-ui.mjs、c04-handoff-editor.mjs、c05-workbench-ui.mjs | P5–P8 |
| 复习绑定真实作答 occurrence，冻结基线/梯子；晚确认不覆盖较新 schedule | bin/review_evidence.py::bind_evidence/review_effect；bin/review::prepare_stamp | dev/tests/learning-records-native.sh、learning-records-consumers.sh | P1.5、P5.4 |
| 作者正文可有“复习/重写”等标题，不能误解析为系统记录 | bin/asset_state.py；bin/card_authoring.py | dev/tests/asset-model-read-projection-r02.sh | P5.1 |
| 命题 Scout 只收目标/约束，宿主登记普通未学卡并入 deck；学生作答后沿同卡记录 | .pi/extensions/subagent/index.ts；bin/class_outputs.py::created_cards | dev/tests/learning-records-projection.sh；相关隔离命题交接 | P2.5、P7.4 |
| learning/creation 用途、精确 preset/package/grants 由 Host 持久绑定，缺失不默认 learning | bin/execution_profile.py::validate_binding/authorize_runtime | dev/tests/execution-binding.sh、execution-bypass.sh | P1.4、P8 |
| 关页/沉默/空闲不收课；propose_handoff 经学生确认写入并关闭 | bin/class_close.py；.pi/skills/teaching/SKILL.md §12 | dev/tests/class-close-native.sh、class-close-state.sh | P2.4、P7.5 |
| 课后主动讨论仍属原课，不开 r2；回执处理无写工具；不得追回漏记旧检验 | bin/class_close.py；bin/review_evidence.py::recordable_inputs | dev/tests/class-close-incremental.sh、class-close-progress.sh | P7.5 |
| 小结保存后更正产生后继版本；已经接续的课固定其收到的小结版本 | bin/handoff_authoring.py；bin/class_handoff.py::selected_path | dev/tests/handoff-authoring-c04.sh、handoff-free-body.sh | P7.5 |
| 零材料可开课；目标→必要澄清→主动检索本人材料→读正文→路线 | .pi/skills/teaching/SKILL.md、modes/规划.md；app/js/course.js | dev/tests/learning-entry-priority.mjs、route-map.mjs | P2.2、P6.2、P7.3 |
| 学习集是一级紧凑总览→书架；设置按需展开，高级配置解释用途 | app/js/sets.js、router.js；CLAUDE 顶部 3831987 记录 | dev/tests/sidebar-set.mjs；最新学习集总览交接 | P2.2、P6.1 |
| 书籍/章节/页段/散卡直接学习或安排学习，课中选择回原课 | app/js/course.js、screens/book.js、screens/reader.js | dev/tests/learning-entry-priority.mjs | P4.1、P6.2 |
| 排课精确书/计划 target、版本和冻结展示；教师可以提议修改既有集设置/课设置 | bin/learning_structure_authoring.py、organization_meta.py、lesson_authoring.py、confirmations.py | dev/tests/structured-planning-r03.sh、organization-meta-c03.sh、lesson-authoring-c03.sh | P6.3–P6.4 |
| 导学保留材料教学；备课纳入规划；拆书按章保存主轴/知识/卡/路线；上传不自动拆书 | .pi/skills/book-prep/SKILL.md；teaching/modes/导学.md、规划.md | dev/tests/preset-mode-rename.sh；最新按章拆书交接 | P3.4、P7.3 |
| 学生明确要完整讲解时讲清，不强迫答题；检验另看独立表现 | AGENTS.md::讲解与独立检验分开；teaching/SKILL.md | 三个教学 Skill 应用记录（只证明加载） | P7.3 |
| 课堂产出来自真实记录/回执，不建第二输出台账；新题按原题顺序 | bin/class_outputs.py；app/js/class-outputs.js | dev/tests/learning-records-projection.sh、r08-r09-calendar-order.mjs | P2.5、P5.6 |
| Creator 全工作台版本、受限文件能力、独立 author/review、真实预览/check/install | bin/creation_authoring.py、creation_tools.py、creation_preview.py | dev/tests/creation-workspace-version-contract-c05.sh、creation-preview-report.sh | P8.1–P8.3 |
| 课堂图示是 inert 文档+受限 VM，可存模具；探索不自动产生学习事实 | bin/visual_schema.py、visual_molds.py、classroom_visuals.py；app/js/visuals.js | dev/tests/classroom-visual-native.sh、visual-mold-save.sh | P8.4 |

表中描述的是B的历史行为，不是v2.3必须照搬的限制。用户已接受独立审计，下面的新裁决优先。

## 用户在本次迁移中覆盖基线的决定

1. 原生 DSH、统一 TS、空数据、四种主要资料定位、不可变来源版本、选区随发送。
2. 多材料一课。B 的旧 route union 和其文档仍有“一节点一种材料”；它是本次明确要改的点，不能再据源码复活。
3. 未学库存不进入首页提醒。显式计划、实际初学后复习保持。
4. 日常读 Skill；明确要求时完整提示更新，不自动切模式。learning/creation 权限隔离继续保留。
5. 能力卸载保留学生事实；新包布局无需旧协议兼容。
6. DSH原生流式/输入、模型与思考强度、实际token、Raw JSON和本课卡片红笔修订按DSH-NATIVE-EXPERIENCE.md。
7. 首版主题保留、页面精简：单书左原文右逐层脑图/列表，初始仅根，卡详情回原件；原卡片顺序/按书/标签/放射视图保持。
8. 主预设只保留资料整理、诊断分析、苏格拉底授课、头脑风暴拓展、搜索；搜索可为主Agent与subagent。旧活动模式的必要能力归入共享Skill，不把B全部模式菜单照搬。
9. 对话树沿用roadmap和既有日期筛选，新增视图种类另议；日历与日报共用日期查询/Cordis定时，未学排除及未来安排保留。
10. v2.3接受SIMPLIFICATION：取消两对象保存门槛/verifiedAbility、reason必填/minor、global审批和固定重试/裁图次数；教学判断归Skill。学情分类为默认配置，知识仍单独存储。
11. Creator按文件与实际依赖版本编辑，仅check/preview/install使用全作品digest；web/subagent/prompt/Skill/单记录存储复用DSH，不为既有服务命名重复造运行管理器。来源定位/真实版本/必要原子操作仍保留。

## 必须保留的失败边界

B/CLAUDE 的最新报告没有宣称所有自然课堂通过：数学/裁图错误、假引用和裁区反馈、工具误选/重试、真实模型选材质量、Creator 自然流程及部分平台仍有失败或未验。v2 给这些场景明确回归任务，不把它们描述为已经解决。B 的历史兼容/旧迁移测试不复制；其**新系统内部**晚到确认、发生时刻、固定版本和共同编辑语义必须保留。

## P0 衔接

R 的 P0 当前锁定 DSH 0.1.5-rc.2、Node 24.13.0、TS 6.0.3；存在经另一协调 Codex 限定审查的 npm 生成器构建期修正，见 docs/evidence/P0/generator-pre-review.md。generator-pre-review.md是较早的局部审查；截至本轮R HEAD=13b5c2e，后续docs/evidence/P0/review.md已记录G0 PASS。以最终审查为准，不用旧预审状态覆盖它。本轮只引用既有审查，不覆盖P0、package-lock、scripts或packages；P1由用户安排逐项接入。
