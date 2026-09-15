# DSH / StudyForge Native

这是 StudyForge 的 DSH 原生插件与课堂运行时。仓库从项目根独立运行，包含 contracts、domain、host、client、示例插件和分层验证。

## 环境

- Node.js `>=24.0.0`（版本以 `.nvmrc` 和 `package.json` 为准）
- npm 与提交的 `package-lock.json`
- DSH 及其插件依赖必须保持同一锁定 rc 版本

## 常用命令

```bash
npm ci --no-audit --no-fund
npm run check:contracts
npm run typecheck
npm run typecheck:tests
npm run build
npm run test:unit -- <文件>
npm run test:integration -- <文件>
npm run test:e2e -- <文件>
```

需要启动隔离 web 实例时使用：

```bash
npm run dev:isolated
```

启动器会创建独立的临时 `DSH_HOME`、课堂目录和随机端口。不要把真实用户目录、凭据或共享服务用于测试。

当前有效的迁移合同、基线和 Notara 设计保存在 [`docs/migration/`](docs/migration/README.md)；运行时、UI 和验收证据保存在 [`docs/`](docs/) 下。
