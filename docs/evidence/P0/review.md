# G0 审查结论：PASS

2026-09-11，Codex接受 **P0.1–P0.3 原生接入基座**。接受代码commit：`a45d9f5749062229f5f96ff3efa3dd989931d9f1`，分支 `codex/dsh-native-migration`，工程 `/Users/yangrundong/Oh-My-Student-dsh-migration/dsh`。本报告随后的提交只登记审查结果，不改变已验证源码。

仅P0完成；P1–P9没有执行。G0证明独立插件/Remote/原生页面接缝可用，不代表学习产品、课堂或发布验收完成。

## 接受范围与版本

| 范围 | 结果与证据 |
|---|---|
| P0.1 可重复基线 | 精确锁定DSH `0.1.5-rc.2` / tag commit `fb2c4b9e698e30edb738bca4cf0618587db7d203`；独立worktree、CLI与Node安装门。官方元数据见 `version-baseline.md` / `../../runtime/upstream-lock.json` |
| P0.2 Host → 生成Remote → Client | 正式Typert generator、`./typert`/`./remote`导出、`ctx.remote.$mount()`、真实浏览器nonce往返；Host卸载返回404且无新增处理，恢复后成功 |
| P0.3 原生页面/预览/生命周期 | 保留AppFrame、设置和原生右栏；原生Markdown显示；刷新单例、真实HMR销毁重挂、配置装卸后默认UI恢复；390px几何与路径显示修正 |
| 隔离与回收 | 每次独占临时home/workspace/插件副本和动态端口；认证脱敏；两条E2E均验证stop幂等、临时root已删除 |

运行环境：macOS，Node24.13.0/npm11.6.2，TS6.0.3，React18.3.1，Playwright1.63.0/Chromium153。`domain`目前只是包边界，没有领域实现。上游源码归档只用来核对API，运行不依赖它或旧DSH脏checkout。

## 新鲜验证

命令工作目录均为上述 `dsh/`，Node PATH显式指向 `/Users/yangrundong/.nvm/versions/node/v24.13.0/bin`。

| 检查 | 命令/证据 | 结果 |
|---|---|---|
| 锁文件重建 | `npm ci --no-audit --no-fund`；556包；`p0-final-ci.log` | PASS，退出0 |
| Host/Client构建 | `npm run build`；`p0-final-build.log` | PASS，退出0 |
| strict类型检查 | `npm run typecheck`；`p0-final-typecheck.log` | PASS，退出0 |
| 正式生成器幂等 | 五个artifact重生前后SHA256一致；`p0-final-generator.json` | PASS |
| 真浏览器 | `npm run test:e2e -- tests/e2e/remote-probe.spec.ts tests/e2e/native-boot.spec.ts` | PASS，退出0，2/2，16.4秒，0 flaky |
| 客户端运行错误 | 两条测试pageerror为空；学生面console warning/error为空 | PASS，见空附件日志 |
| 人工看图 | 三栏、Markdown、卸载默认UI、窄屏 | PASS，合成fixture范围 |
| 真实模型/学生/Windows/托管 | 未运行 | 未接受，不用静态或浏览器证据替代 |

最后一轮测试时间：2026-09-11 21:17（Asia/Shanghai）。完整测试统计 `p0-final-results.json`，运行输出 `p0-final-e2e.log`，Host往返日志 `remote-host-log.log`，原生HMR事件 `native-hmr-diagnostics.json`。

## 审查发现与已修复项

- P0.1：锁定CLI、Node24门禁、临时课堂目录修正，详见P0.1交接。
- P0.2：npm协议声明识别缺口经前置审查后限定修正；DTO非根公共子路径；真实404协议替换错误的预期。保留 `generator-original-failure.log`、`remote-without-host-failure.log`。
- P0.3：Session seat提交顺序、Client包名被`/client`截断、窄屏动画判据/竖排导航、整页预览路径泄露均inline修复；路径的红测试保留在 `p03-path-red.log`。
- 独立只读review检查启动与生命周期，发现临时目录残留和启动异常窗口；主Agent修复并重跑2条E2E。范围与裁决见 `review-notes.md`，不把只读审查当测试PASS。

## 接受的SDK约束

1. **构建期generator有一行受控补丁**：`scripts/patch-sdk.ts`验证原/新SHA256，只补普通npm `dsh-typert-protocol`声明的包身份识别；正式generator仍负责所有codecs。`api-remotes`、运行时及旧checkout未改。升级SDK须重新核验，不能静默沿用补丁。前置裁决见 `generator-pre-review.md`。
2. **Client清单变更需刷新**：rc.2忽略graph帧；已按配置变更→新HTML清单→刷新验收。原位teardown/remount单独由真实rebuilt HMR验证，没有伪造事件或操作私有Loader。
3. **预览路径行是主题适配**：rc.2无公开path-title槽，只隐藏学生面里的重复绝对路径行，保留原生文件名标签和读取协议。这不是文件访问隔离；完整产品错误态/多租户边界尚未验收。
4. 依赖树在本工程内共享，临时快照目前复制Host/Client产物；以后新增本地包的运行期依赖须扩充快照。强杀测试worker、磁盘满故障未注入。

## 证据与交接

- [桌面三栏](three-columns.png)
- [原生Markdown预览](native-markdown-preview.png)
- [390px窄屏](narrow.png)
- [卸载后恢复默认UI](native-ui-restored.png)
- 合同：`../../runtime/remote-contract.md`、`../../runtime/client-slots.md`
- 逐项交接：仓根 `docs/dev-log/2026-09-11-DSH-P0.{1,2,3}.md`

原仓真实数据、长期4877、真实DSH home和旧checkout未操作。并行任务的v2计划/台账改动保留在工作树，本轮提交只接收P0。下一阶段须等用户完善设计并另行启动。
