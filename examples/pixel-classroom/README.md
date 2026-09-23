# 教室的像素视图

基于 [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) 的 DSH 原生插件 `@notara/pixel-classroom`。复用其画布、寻路、桌椅和布局编辑能力，为 Native Vault 0.12.3+ 的现有「教室」增加像素视图；不新增顶层分页、课堂或 Agent 生命周期。

0.4.0 提供大肥鱼、GPT、Claude、Kimi、GLM 五种 Q 版像素外观。点击人物，在详情的「外观」中更换；选择按岗位保存在当前浏览器。外观不改变模型与工作分工。角色提供正面、背面、侧面和行走/工作/阅读帧，保留原来的大小、点击范围与寻路。来源见 `public/assets/ai-characters/ATTRIBUTION.md`，生成源图与导入规格见 `art/ai-characters/`。

## 运行

在 DSH 仓库根目录、Node 24+ 下运行：

```sh
npm run pixel-classroom
```

启动一个隔离的 DSH + Vault 实例，并安装像素视图插件。使用隔离目录 `launcher.json` 中的登录入口进入，打开教学会话的「教室」，通过右上角「列表／像素」切换；教室仍可与对话/资产分屏。该实例使用合成模型，不需要 API key。也可以用 `npm run build:pixel-classroom` 单独构建；输出在本目录 `dist/`，不提交生成文件。

启动从 `scripts/dev-isolated.ts` 的 `startVaultIsolated({ pixelClassroom: true, testModel: true })` 进入，使用随机本地端口和独立临时目录。像素视图本身不安装 Claude hooks、不扫描终端或私密会话、不发起模型请求；此命令不修改用户正在运行的 Notara 服务。

## 插件接入

`package.json` 的 `dsh.client` 声明浏览器模块。Host `index.js` 通过 DSH 的 `webServer` 服务提供 `/notara/pixel-classroom/`，不另外监听端口；原生 DSH 的登录鉴权仍生效。Client `client.js` 只注册 `notara.classroom.view`（由 Vault 工作区声明并交给教室渲染），不注册顶层分页。没有对应版本的 Native Vault 时不会出现入口。

已构建的目录可以作为原生插件加入 DSH 的 `cordis.patch.yml`：在现有数组中追加 `{ "insert": [{ "id": "notara-pixel-classroom", "name": "/实际安装目录/pixel-classroom/index.js" }] }`。保留其他配置；Host 加载新模块后刷新浏览器获取教室视图。更新 Native Vault 时须按原有冻结快照升级流程安装新版本。它使用 DSH 原生 Loader，不是旧 StudyForge 的 `.studyforge/plugins` 格式。

## 真实状态与操作

- 列表与像素视图共用 `ClassroomView` 的 `classroom` 读取与原生 `useSession`，不另外轮询完整对话。任务状态、可查看/可停止条件保持一致；显示最近六项记录，与现有列表一致。
- 人物运行状态来自老师的 `SessionSnapshot.running` 与后台任务的真实 `status`。没有独立任务时显示空态；不生成虚构的核验者或模拟用量。
- 点击人物查看任务状态，点击「查看分析（含完整解法）」沿用 `solverTask` 校验与 `sessions.openSubagent` 打开原生记录；「停止任务」「教室设置」直接调用现有教室操作。
- iframe 与父页面双方校验 origin、消息来源窗口和每个会话独立的 channel。父页面再次核对当前任务与操作资格；隐藏、失联或旧会话消息不能触发操作。上下文与解答不自动注入像素画布。
- 切换教室视图不改变任务，刷新重新同步真实状态。保存的家具布局保留；新随机端口不会共享布局。

只有直接访问静态页面、未携带 `mode=live` 时保留离线演示。DSH 插件始终以实时模式打开，不显示播放、返修脚本或模拟上下文百分比。

布局与座位保存在这个浏览器地址自己的 localStorage；同一实例刷新后恢复。重开服务使用新端口时，浏览器不会自动跨地址迁移布局。

## 来源和边界

- 来源版本：Pixel Agents 1.4.1，commit `3537e140c2094761beae748592aeb92ece8edfdd`。
- `upstream/` 保留原版 `core/src` 和 `webview-ui/src`，`public/assets` 除独立的 `ai-characters/` 外是同一提交内的原版素材。新角色不覆盖原始人物 PNG。
- MIT 版权文本保留在 `upstream/LICENSE`，构建后同时放在站点 `/LICENSE`；来源记录见 `upstream/provenance.json`。
- 没有重写原版渲染/编辑引擎。构建时把 transport 入口映射到 `src/transport.ts`；人物绘图缓存映射到 `src/sprite-cache.ts`，仅对登记的角色帧在原来的矩形中绘制细节，其余图块和轮廓仍用上游缓存。
- `src/assets.ts` 复用上游 PNG 解码及资产消息顺序；`src/live-classroom.tsx` 仅接收当前教室的安全状态投影。
- 子会话创建与结果写回仍由老师的 `ask_worker` 和 DSH 原生运行时负责。此插件没有新增模型工具，也没有从画布另行创建子代理或发送提示词的能力。

当前验证边界见 `docs/dev-log/2026-09-22-pixel-classroom.md`：Edge 恢复后已验证空态、真实任务记录、列表/像素切换、原生只读分析导航及对话分屏。没有为了验收发起付费模型调用；运行中任务的停止流程尚未做本视图的浏览器实测。
