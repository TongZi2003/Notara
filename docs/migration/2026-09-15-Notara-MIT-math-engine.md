# Notara MIT 数学工作台首版

## 目标与范围

用户选择尝试 JSXGraph + Cortex Compute Engine；二维与立体几何同轮实现。该阶段在 DSH 迁移分支完成，基于 `8a6f2e0`。只读研究员核对 Cortex 发布版本，独立审查员审查合同与 Host，主 Agent 统一实现。原产品、共享服务和既有用户数据未修改。本轮使用独立测试模型预览。

## 实际改动

- 数学插件 `@notara/math-workbench` 1.2.1。JSXGraph固定1.13.3（选择MIT），Host固定Cortex 0.128.9；npm只新增该包与两个MIT依赖，DSH/Node/TS锁定未变。Cortex按请求在Worker加载，iframe不重复加载CAS。
- `math-scene.ts`：27种构造。二维点线圆、函数、参数/隐式曲线、交点、中点、平行/垂线、角、圆锥曲线；三维点、中点、直线/线段、向量、平面、多边形、球、函数与参数曲面。引用按拓扑顺序创建，循环、悬空、维度不符先拒绝。旧参数u/z继续可读，仅新参数曲面的局部变量u/v禁止与场景参数重名。
- `math-workbench.ts`合同与`LearningWorkbenches`：增量编辑一次验证一次保存，复用已有文档/版本/幂等；历史恢复产生新revision。临时projection绑定revision、对象集合与坐标维度；过期、未打开或尚未绘制返回unavailable。它不是学情或独立学习事实。
- `math-tools.ts`：read_math_scene、edit_math_scene、calculate_math、restore_math_scene；有数学文档时才进入按需目录，主教师权限保持。展示与调用共用输入合同。
- `math-compute*.ts`：独立引擎、900ms合作期限+4s Worker终止、至多两个并发；result/unresolved/undefined/invalid/timeout/busy区分。普通数学语法与画布共用解析器，转换MathJSON；LaTeX走Cortex。求解可能包含复数，未判定不是无解。
- 前端：对象/属性/参数与计算面板放在画布旁，窄栏改抽屉；共享文档、坐标编辑、参数联动、本页撤销/重做、保存与带入对话。公式用MathML展示；来源、确认笔记与ThoughtMap沿原通路。
- 用户追加：虚线矩形按钮开启二维/三维框选，Shift/Ctrl/Command追加选择，对象列表同样支持多选。按当前视图的SVG外接框完整包含选择，点按中心判断；临时选区不写文档。选中提示关联删除数量，Delete/Backspace只在非文本输入时删除，Esc退出。
- `mathRemovalClosure`统一UI和AI的删除规则：只沿反向依赖递归，删点同时删除线、中点及更下游构造；删线不删父点；同批重复提及已连带删除的对象不误报不存在。一次操作对应一次撤销快照，仍走既有版本保存。
- 手帐背景：`.graph-wrap`使用不透明主题纸色、无纸纹背景图，隔断SDK的横线纸；坐标网格和手帐字体保留。
- 离线HTML约1.74MB，保留2MB上限与CSP，不启用eval、网络或表单提交；补KaTeX许可文件。

## 验证

| 项目 | 本轮证据 |
|---|---|
| 构造、依赖、旧参数、编辑、框选判定、Cortex实际计算 | PASS：13个unit；`npm run test:unit -- tests/unit/math-scene.test.ts tests/unit/math-edits.test.ts tests/unit/math-compute.test.ts tests/unit/math-selection.test.ts` |
| 原生工具→写入→读取、过期投影、恢复与重启 | PASS：`tests/integration/math-engine.test.ts`，确定性testModel，不是真实模型教学证据 |
| 笔记确认、阶段、摘要、旧引用、冲突 | PASS：`tests/integration/math-thoughtmap.test.ts` |
| 技能刷新、版本固定、卸载/失败升级 | PASS：`tests/integration/plugin-workbench.test.ts`的2个不同场景；合计4个不同集成场景 |
| 类型与构建 | PASS：`npm run build`、`tsc -p tsconfig.math-plugin.json`、`npm run typecheck:tests` |
| 既有合同 | PASS：`npm run check:contracts`，84个同源schema |
| 浏览器 | PASS：IAB实页；三维z坐标4→5、撤销4/重做5；新曲面首次生成可见SVG；参数联动；sqrt(4)+a在a=2时返回4；加入观察→确认笔记→阶段1；现代/手帐与334px工作台宽度检查 |
| 追加交互与主题 | PASS：新预览中列表Shift多选U/V→同时删除U/V/M/UV→撤销恢复；三维删P1→连带三条棱→撤销恢复，底面与其他点保留；坐标输入Backspace不删图形；484px工作台无横向溢出；手帐html仍有横线图案，画布为`rgb(246,241,227)`且`background-image:none`，截图仅有坐标网格 |
| 独立审查与修复 | 审查找到聚焦观察框误清空重做栈的P2，实页先复现15对象且重做无效；改成首次实际输入才记快照后，1.2.1实页删除15→11、撤销15、聚焦观察框后重做11，再撤销恢复15。无未处理的已核验P1/P2 |

失败与恢复：新增二维/三维合同测试先失败后通过；set-view默认值覆盖省略的相机字段，改无默认局部补丁并回归；Cortex误读sqrt(4)，统一数学语法；沙箱内表单不提交，按钮改直接执行；Surface3D首次无网格，改fullUpdate后才发布投影。初次类型与Remote公开类型边界错误已修正。

实页曾回传覆盖27种类型的36个实例：切线斜率4、UV长度4、三角形面积6、空间中点与线段长度。该批验证暴露曲面首次更新问题，不能仅凭projection的defined断言已经绘制；最终另外验证可见曲面与非空SVG路径。

## 未验收与下一入口

- 真实模型的自然语言选工具、教学及题型覆盖：未运行。预览使用testModel，不用于真实课堂教学验收。
- IAB坐标拖动没有取得可靠成功证据；框选手势同样未验收（输入只聚焦iframe，没有产生可靠的拖拽响应，未将尝试记为PASS）。框选纯几何判定、列表多选/删除/撤销、坐标表单、引擎联动与参数滑块已验证。完整鼠标/触控框选、拖点及Shift高度拖动仍待人工或可靠输入通道验收。
- 未覆盖任意退化几何、大量曲面性能、全部CAS题型或GeoGebra级功能。三维多边形不会拿投影面积冒充空间面积。
- 撤销/重做栈属于本页编辑期；刷新保留已保存场景，历史恢复工具仍可用。未发送引用的刷新限制沿上轮保留。
- 课堂继续固定插件版本，旧数学/几何数据不自动替换。58354未更新本轮Host/插件；59076/1.1.0预览原样保留，新预览复制其revision36的7个对象，不改旧记录。62782在安装1.2.1后新开「数学工作台 · 框选与删除试用」，复制15对象（另8个是本轮新增的空间测试构造）；1.2.0课堂仍保留。运行元数据见`dsh/.runtime/math-selection-ui.json`；认证信息不提交。
- 下一步：真实题目试用构造与增量接口，完成直接拖点；体验确认后部署到原学习预览。

计划：`docs/ui/math-engine-plan.md`。代码锚点：`createMathBoards`、`applyMathEdits`、`inspectMath/publishMath/editMath`、`registerMathTools`、`computeMath`、`PluginLearningRemote.calculateMath`。
