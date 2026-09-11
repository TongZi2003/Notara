# G0 前置审查：rc.2 生成器的 npm 声明识别

日期：2026-09-11。审查者：协调 Codex。状态：**允许下面限定的构建期修正；G0 仍未 PASS**。

在独立 npm 工程内，Host 的 strict tsc 已通过，调用正式 `WorkspaceTypertGenerator(root).generate(['@studyforge/host'], ['host'])` 却失败：

```text
TypertAnalysisError: typert(host): @studyforge/host publishes Remote artifacts but has no Remote methods
```

第一轮配置定位先解决了本项目 aggregate 未继承 NodeNext/路径映射导致的 checker 崩溃，保留在 `.runtime/p02-build-second.log`。上述失败来自配置修正后的第二轮生成器运行（`.runtime/p02-build-third.log`）。

官方提交 `fb2c4b9e698e30edb738bca4cf0618587db7d203` 的 `packages/typert/generator/src/analyzer.ts::isTypeMetaSymbol` 仅接受两种身份：在 aggregate 中登记为协议源码包，或声明位于同名 ambient module 内。真实 npm `dsh-typert-protocol/lib/types/index.d.ts` 满足二者之外的正常外部包身份，所以同时漏认 `Remote` 与 `TypertRemoteService`。同文件已有 `externalModuleIdentityForFile`，其他类型引用已使用它识别 npm 依赖。

依据计划“上游补丁先交 Codex 裁决”与本轮用户允许 inline 返工，接受以下最小修正：在该判断中复用已有的 npm 包身份识别，且仅接受精确包名 `@deepseek-ai/dsh-typert-protocol`。不修改 runtime、api-remotes、工具签名、生成的 codecs 或调用者判断；不手写 Remote descriptors，不复制第二套声明。保留官方 npm SRI，另记录原文件/修正后 SHA-256；安装时只接受这两个已知摘要，未知内容立即失败。

实施验收：原版重现失败 → 修正后官方生成器生成真实 artifacts → strict build/typecheck → 相同输入重复生成无 diff → npm ci 后补丁可重复恢复 → 真实 Host/Client 调用、卸载失败及恢复。任何一项欠缺，不可宣称 G0 通过。修正只写本实施 worktree 的 npm 依赖，不触碰旧 DSH checkout 或其他工作区。
