# DSH / StudyForge Native

这是 StudyForge 的 DSH 原生插件与课堂运行时。仓库从项目根独立运行，包含 contracts、domain、host、client、示例插件和分层验证。

## 环境

- Node.js `>=24.0.0`（版本以 `.nvmrc` 和 `package.json` 为准）
- npm 与提交的 `package-lock.json`
- DSH 及其插件依赖必须保持同一锁定 rc 版本

## 常用命令

```bash
npm ci --no-audit --no-fund
npm run build
npm run check:contracts
npm run typecheck
npm run typecheck:tests
npm run test:unit -- <文件>
npm run test:integration -- <文件>
npm run test:e2e -- <文件>
```

需要启动隔离 web 实例时使用：

```bash
npm run dev:isolated
```

启动器会创建独立的临时 `DSH_HOME`、课堂目录和随机端口。不要把真实用户目录、凭据或共享服务用于测试。

## 试用

给非开发者本机试用（数据可重复启动、不丢课堂）：

```bash
npm ci --no-audit --no-fund
npm run build
npm run trial            # 数据落在 ./.trial/；可选参数：数据目录、--port <n>
```

打开终端打印的 URL（内含本机登录 token），首次进入按引导配置模型——需要试用者自己的 DeepSeek API key。学习记录、课堂和插件数据都保存在 `.trial/` 里，重启继续。

上游明确拒绝 `0.0.0.0` 绑定（会把执行能力暴露到网络）。局域网试用走 SSH 隧道：`ssh -L 3080:127.0.0.1:3080 <试用机>`。

当前有效的迁移合同、基线和 Notara 设计保存在 [`docs/migration/`](docs/migration/README.md)；运行时、UI 和验收证据保存在 [`docs/`](docs/) 下。
