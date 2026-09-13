# 学习主线与对话首页证据

2026-09-13，主Agent inline执行。全部测试为独立数据根/随机端口，未向用户课堂发送夹具。Node v24.13.0，锁定DSH 0.1.5-rc.2；没有升级依赖。代码和交接见 `../../../../docs/dev-log/2026-09-13-DSH-learning-flow-implementation.md`。

| 证据 | 结果 | 说明 |
|---|---|---|
| learning-build-release.log | PASS（退出0） | 最后一次首页读取失败恢复修复后正式build |
| learning-types-release.log | PASS（退出0） | 测试类型检查 |
| learning-final-contracts.log | PASS | 84项原有同源JSON schema检查；新增DTO沿自己的Zod与Remote类型 |
| learning-final-unit.log | PASS 109/109 | 16文件全量单元；learning-regression-unit保留首次文案断言失败 |
| learning-regression-integration.log | 初次42通过/5失败 | 7个文件47个不同用例；缺省study:undefined被原生记录拒绝 |
| learning-final-integration.log | PASS 22/22 | guided-learning 2、mixed-route 18、content-history 2；修复后重跑，含活跃接续课 |
| learning-content-versions-final.log | PASS 2/2 | 补充旧版/新版与scout卡片局部历史场景后定向通过 |
| learning-regression-e2e.log | PASS 4/4 | 首页、内容课堂关联、书籍工作台、课堂资料脑图 |
| learning-final-e2e.log | PASS 2/2 | 最终代码的首页读取失败恢复、原生首条拒绝/接受、内容回跳 |
| learning-flow-deploy.log | FAIL ESRCH | 旧64004进程不存在；在任何写入前停止，不是已部署 |
| learning-preview-update.log | 文件摘要一致 | 新空白预览客户端更新，数据保留；匿名请求401为原生认证，已认证浏览器确认连接 |
| home-centered-input.png | 目检PASS | 1280×900，标题/原生输入/下方双入口 |
| home-narrow.png | 目检PASS | 500×800白纸窄屏 |
| content-classroom-links.png | 目检PASS | 覆盖与真实课堂引用入口 |

集成最终47个不同用例由7文件的最终结果合并：native-route-binding 3、native-delegation 5、guided-learning 2、content-history 2、mixed-route 18、skeleton 10、close-handoff-v2 7。重复运行不累加；初次失败不能从记录里删除。

## 可复跑命令

从`dsh/`运行，使用锁定依赖：

```sh
export PATH=/Users/yangrundong/.nvm/versions/node/v24.13.0/bin:$PATH
npm run build
npm run typecheck:tests
npm run check:contracts
npm run test:unit
npm run test:integration -- tests/integration/guided-learning.test.ts tests/integration/content-history.test.ts tests/integration/native-delegation.test.ts tests/integration/native-route-binding.test.ts tests/integration/mixed-route.test.ts tests/integration/skeleton.test.ts tests/integration/close-handoff-v2.test.ts
npm run test:e2e -- tests/e2e/conversation-home.spec.ts tests/e2e/content-history.spec.ts tests/e2e/book-workspace.spec.ts tests/e2e/lesson-materials-mindmap.spec.ts
```

## 验证边界

- 模拟模型用于原生协议接线；真实模型诊断充分性、跨书选材/叙述质量、学习效果未验收。标准live环境无DEEPSEEK_API_KEY，BLOCKED；没有读取/搬运用户真实凭据。
- 首页与关系界面的截图不能证明全部附件、多目标并发或大规模历史性能；这些组合没有完整专项验证。
- 100页书、预读20页、采用5页、未确认细化、固定版本/重启、card局部活动边界由原生集成覆盖，不把读取或收课当掌握。
- 旧临时根缺失原因未知。用户授权空白重启后，新空间在项目`.runtime/preview-tmp/`，浏览器已打开58354且显示已连接；出现模型密钥提示后选择稍后配置，未发送测试消息。
- 未附实际运行时配置、原生认证链接或API密钥；日志复制前做了凭据形状扫描。
