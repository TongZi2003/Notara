# P0 Remote 接入合同

锁定 DSH `0.1.5-rc.2` / `fb2c4b9e698e30edb738bca4cf0618587db7d203`，Node 24.13.0、npm 11.6.2、TS 6.0.3、React 18.3.1（上游 pnpm-lock.yaml 的实际客户端版本）。后续阶段尚未接受。

## 生成与编译

Host 继承公开 `TypertRemoteService`，构造器 `super(ctx, 'studyforgeProbe')`，`@Remote('inspect')` 声明公开方法。DTO 唯一源在 `@studyforge/contracts/probe`；生成器要求 Remote 边界类型从非根公共子路径导出。Host/Client 使用独立 aggregate；两者继承同一 strict 基座，Host 的本地包路径映射指向真实源代码。

`npm run build`：Host `tsc --build tsconfig.host.json` → 正式 `new WorkspaceTypertGenerator(root).generate(['@studyforge/host'], ['host'])` → Client tsc → 浏览器 CJS factory。生成位置遵从上游：Host 包 `lib/typert.host.{js,d.ts}` 与 `lib/typert.remote-client.{js,d.ts,d.ts.map}`，不手工编辑。manifest 的 `./typert`、`./remote` 与 files 精确列举由生成器自己校验。domain 当前仅有包边界，尚无领域实现。

生成器对 npm 协议声明的识别缺陷已按 `docs/evidence/P0/generator-pre-review.md` 限定修正：`npm ci` 的 postinstall 用 `scripts/patch-sdk.ts` 验证原/新摘要再应用一行修正。只影响构建期 generator；DSH runtime、api-remotes 和生成 codecs 均未修改。

## 原生装配

`dev:isolated` 在系统临时目录新建空 classroom 和 home，清除继承的 DSH/STUDYFORGE 覆盖变量，明确 `DSH_HOME`、关闭遥测，调用锁定 `.bin/dsh web --host 127.0.0.1 --port 0 --no-open`。插件通过正式 home `cordis.patch.yml` 的 insert 行挂载。此文件参与 web profile 原生热重载；`--patch` 附加层不参与热重载。

Client 的 `dsh.client` 标明 `platform: web`、包依赖和立即加载，`./client` 指向构建的 factory。factory 遵循上游 `packages/client/tsdown.client.ts`：`window.__ModuleLoader__.load({id, factory(require)})`，React/JSX/Cordis 使用框架模块表；生成的 descriptor/codec 与普通纯依赖内联。没有引入旧 SPA 或另一套 HTTP/SSE。

Client assembly 用 `await ctx.remote.$mount(contribution)`，随后由声明 `remote`、`remote.studyforgeProbe`、`slots` 的消费插件渲染调用界面。注册 disposer 与子插件都归 Cordis 生命周期。

## 可复验行为

`npm run test:e2e -- tests/e2e/remote-probe.spec.ts` 在真实 DSH + Chromium 中验证：随机 nonce 由 Host 处理并在 Client 一致返回；重复请求 nonce 不同且日志对应；通过 native patch 热卸载 Host 后请求明确失败且 Host 不再被调用；恢复后成功；刷新只有一个入口。没有模型调用。

本版卸载端点返回 HTTP 404，原生 Client 把该传输错误包装为 `gateway/internal`，message 保留 HTTP 404；不是预想的 `gateway/service-unavailable`。测试依据真实协议断言 404 与无 Host 执行，不放宽为任意报错。调试面显示“连接不可用”与原始诊断，P0.3 默认学生面隐藏 probe。

检查入口：`npm ci`、`npm run build`、`npm run typecheck`、`npm run generate:remotes`、`npm run test:e2e`。重复生成五个 artifact SHA-256 一致。浏览器安装：`npx --no-install playwright install chromium`；首次 headless shell 下载遭 ECONNRESET，上游一次重试成功。
