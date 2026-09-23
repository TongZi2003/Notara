# 教室像素视图与 DSH 状态接线

工作树：`codex/notara-vault-clean`，保留已有改动。Native Vault 源码版本 0.12.3；伴随插件 `@notara/pixel-classroom` 0.2.0。

## 最终边界

用户最终明确：像素教室只是教室的一种视图。`ClassroomView` 内增加「列表／像素」，共用真实课堂状态和操作，没有新增顶层分页或子代理生命周期。用户在浏览器恢复后决定能用则保留；最终已将 Native Vault 0.12.3 与像素视图插件 0.2.0 装入长期实例 `57093`，保留原七个会话和旧快照。

## 改动锚点

- `examples/pixel-classroom/upstream/provenance.json`：Pixel Agents 1.4.1，commit `3537e140c2094761beae748592aeb92ece8edfdd`，MIT。原版 core、webview-ui 源码与美术本地复用；95 个源码/许可证文件与87个素材曾与拉取版本逐字节核对。上游文件不改，构建时只替换 transport 解析入口；保留 LICENSE。
- `src/ClassroomApp.tsx`：使用上游 `OfficeState`、`OfficeCanvas`、`useEditorActions`、寻路与家具编辑。`src/classroom-layout.ts` 提供教室场景。修正 DPR 下初始缩放过小。实时模式只显示现有老师与解题者；模拟播放、目标重写和上下文百分比不进入实时模式。
- `examples/native-vault/client-source.ts` 的工作区注册声明 `notara.classroom.view`，遵守槽位所有权；`classroom-client.js` 的 `ClassroomView` 负责视图选择和同一数据快照，`openAnalysis`、`stop` 与设置保存继续为唯一操作入口。
- `examples/pixel-classroom/client.js`：iframe 注册为教室的 `pixel` 视图。消息桥校验来源、origin 与每个会话的 channel，操作时核对最新任务资格，离开视图后拒绝操作。父页面用原生 `useSession` 和已存在的教室读取推送状态，没有新增完整对话读取或模型请求。
- `src/live-classroom.tsx`：连接心跳、实时状态与任务入口。完整材料、解法、轨迹仍由用户点开原生子会话查看；画布不自动载入隐藏正文。
- `examples/pixel-classroom/index.js`：在 DSH 的 `webServer` 注册同源静态路由；不另开监听端口。`scripts/build-pixel-classroom.ts` 用仓库现有 esbuild 构建引擎与素材。
- `scripts/dev-native-vault.ts` 的 `VaultOptions.pixelClassroom` 仅供隔离实例首次装入插件。`scripts/pixel-classroom.ts` 通过公共隔离入口启动 DSH + Vault + 合成模型。长期实例不能靠该选项自动修改，仍须显式升级快照/装配。

## 验证

Node v24.19.0，全部使用仓库锁定依赖。

- PASS，确定性：`node --test examples/native-vault/classroom-client.test.js examples/native-vault/client-bindings.test.js examples/pixel-classroom/plugin.test.js examples/pixel-classroom/bridge.test.js`，21/21。覆盖真实课堂字段投影、原生入口未解析标识符、静态路由路径/方法/同源框架、仅教室子槽注册、快照桥、跨来源/跨会话/过期任务/隐藏状态操作拒绝。
- PASS，静态：`node node_modules/typescript/bin/tsc -p examples/pixel-classroom/tsconfig.json` 与 `git diff --check`。
- PASS，构建：`scripts/build-pixel-classroom.ts` 与 `scripts/build-native-vault.ts`（最终结果见本轮工具输出）。
- 浏览器部分证据：原版像素场景、播放/角色选择/目标编辑曾在独立 Demo 中检查。第一版独立顶层分页在 Edge 复现 `props.renderSlot is not a function`；确认是跨槽位所有权错误，随后删除该接法，最终改为工作区自有教室子槽。上述旧 Demo 的观察不能代替最终实时视图验收。
- 首轮中断：隔离探针首次因 `materials` 错传字符串而被合同拒绝，改为数组后重试；用户报告 Edge 崩溃后停止验证，没有以探针启动代替端到端通过。
- PASS，最终浏览器：用户继续后只启动一个隔离实例，确认「教室」内实时像素视图与空态。安装长期实例后，用已有真实课堂记录核对两项任务（完成、失败）：列表/像素状态一致；选择解题者显示其真实配置与待命状态；「查看分析」打开原生一次性只读子会话，再通过父课堂导航返回；与原生对话分屏后仍显示同一组任务，关闭分屏恢复完整画布。
- PASS，运行时只读：新进程返回页面和像素路由 HTTP 200，启动模块图包含像素插件；七个原会话仍在，旧任务的 `solverTask` 仍绑定正确的原生父子身份。
- 控制台：最终页面没有 error；四条 warning 均为同源 iframe 同时启用 `allow-scripts` 和 `allow-same-origin` 的浏览器提示。iframe 是本插件受控代码，未把它当作不可信内容的隔离边界。
- 未运行：本像素视图中创建新任务后的运行→完成/停止浏览器流程、最终插件版家具保存/刷新恢复。列表复用与桥接资格由确定性测试覆盖，但不冒充上述交互实测。任务时间文案继承现有列表的“从启动时间至今”，不是模型计费时长。
- 未运行：付费模型、真实教学质量和用户学习数据迁移。

## 运行与回滚

用户报告 Edge 崩溃后停止所有 Edge 操作和当时临时服务（独立 Demo 49956/50889；隔离 DSH 54379/59293/50561）。用户之后要求继续，检查系统内存可用百分比48%，再启动唯一隔离实例59732；最终该实例也已停止。

升级前确认57093无运行中任务，源码与其0.12.2安装快照只有 `classroom-client.js`、`client-source.ts`、生成的 `client.js`、`package.json` 四个顶层文件不同。复制新冻结快照，保留旧包，更新两处托管链接、preset根和追加插件装配，然后通过 `scripts/vault.ts --no-open` 恢复同一数据根与端口。没有修改用户Vault正文、模型凭据或提交课堂消息。

当前数据根：`/Users/yangrundong/.notara/vault-runtime`。快照为 `vault-plugin-0.12.3` 与 `pixel-classroom-plugin-0.2.0`；备份目录 `pre-pixel-classroom-1790080095013` 保存原patch与链接目标；旧 `vault-plugin-0.12.2` 完整保留。需要回滚时先确认无任务，停止该实例，恢复备份patch和链接，再从同一入口启动；不删数据根。最终Edge停在原服务的教室像素视图。
