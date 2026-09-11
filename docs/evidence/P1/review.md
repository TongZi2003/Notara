# G1：最小事实基础与原生能力接线

2026-09-12；主Agent审查P1.1–P1.5。固定DSH0.1.5-rc.2、B@3831987；P0/G0接受状态保持。

**G1 PASS，允许进入P2。** 计划明确允许外部账号不可用单列BLOCKED，故本结论不包含真实搜索/真实模型教学能力通过。

| 检查 | 结果 | 证据 |
|---|---|---|
| 同源schema、Host身份、Clock、空/混合材料与学情最低形状 | PASS，14单测/13份合同 | p14-p15-unit.log、p14-p15-contracts.log；P1.2交接 |
| 单记录条件版本/幂等、真实跨进程写锁、发布前后SIGKILL恢复 | PASS，6集成 | p14-p15-integration.log；P1.3交接 |
| native Remote/fs/grep/作品引用/软链/撤权；原生stale；真实preset子授权 | PASS，7集成 | access-binding.test.ts；p14-p15-integration.log |
| 原生动态prompt/Skill、spawn/fork/structured result/continuable在途取消 | PASS，7集成，可控模型 | native-capability-wiring.test.ts；p14-p15-integration.log |
| Host/Client装卸、原生Markdown预览、HMR、窄屏 | PASS，2浏览器 | p14-p15-browser.log |
| 生产及测试strict TS、build | PASS | p14-p15-typecheck.log、p14-p15-test-types-final.log、p14-p15-build.log |
| 官方web provider装配、匿名HTTP真实读取 | PASS，2项 | p14-p15-live.log（example.com HTTP200与实际内容/截断） |
| 真实搜索后fetch、真实模型prompt更新和子任务 | BLOCKED，2项未运行 | 缺DEEPSEEK_API_KEY；live日志明确skip原因；不使用备用OpenCode key |

原生能力差额已明确：workspace cwd不是授权，Host从native lookup传session范围、从tools执行上下文传同一绑定；creation引用仅明确文件。原生fs observation policy与LocalFileSystem保持写入观察/版本语义。原生worker-thread代码执行不是安全边界，学习/制作拒绝run_code和任意shell。原生subagent standing composition会继承，parent直接scoped prompt不等于完整子任务prompt，P7据此配置。

独立审查未找到可复现P1/P2错误；主Agent保留制作省略搜索path拒绝回归（native实际cwd仍是完整workspace）。没有重建web/subagent/prompt/session管理器。一次安装误填group版本被ERESOLVE拒绝后恢复锁定1.0.2；现有所有锁包version/resolved/SRI/依赖边未变化。新增SDK补丁只补官方subagent声明图的两行类型import，摘要锁定且严格检查；P0构建补丁保留。

未提前接受：P2学生课堂、P3来源、P5多对象确认/复习、P6组织改径、P7教学/收课、P8包发布事务。下一步P2.1，用户总授权仍是P1–P7。
