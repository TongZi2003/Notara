# DSH / StudyForge Native

这是 StudyForge 的 DSH 原生插件与课堂运行时。仓库从项目根独立运行，包含 contracts、domain、host、client、示例插件和分层验证。

## 环境

- Node.js `>=24.0.0`（版本以 `.nvmrc` 和 `package.json` 为准）
- npm 与提交的 `package-lock.json`
- DSH 及其插件依赖必须保持同一锁定 rc 版本
- macOS / Linux / Windows 均可运行（Windows 上目录链接自动改用 junction，无需管理员权限）；DSH 自身的 Windows 支持以上游为准，尚未实机验证

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

给试用者的完整安装与启动流程（macOS / Linux / Windows 相同，Windows 用 PowerShell 或 cmd 即可，不需要 bash）：

```bash
git clone <仓库地址> Notara
cd Notara
node --version          # 必须 >= v24
npm ci --no-audit --no-fund
npm run build
npm run trial           # 数据落在 ./.trial/，重启续学；可选：npm run trial -- <数据目录> --port <n>
```

1. 启动成功后浏览器自动打开登录页（`--no-open` 可禁用）；完整 URL（内含本机登录 token）同时打印在终端并写入 `.trial/launcher.json` 的 `authUrl`，脚本包装直接读文件即可，无需解析终端输出。
2. 首次进入按引导配置模型提供方，需要试用者自己的 DeepSeek API key。
3. 装两个日常插件：侧栏 **插件 → 安装插件 → 开发目录**，各填一次仓库内目录的**绝对路径**，「查看安装内容」后「确认安装」：
   - `<仓库>/examples/plugins/math-workbench`（数学工作台）
   - `<仓库>/examples/plugins/worldbook`（教室与世界书）
4. 之后每次试用只需 `npm run trial`；学习记录、课堂、插件固定版本都保存在 `.trial/`。想重置就删掉该目录。**运行中的终端窗口即服务本体，关闭窗口服务即停止**——旧标签页/书签在端口未监听时会显示「无法访问此页面」（ERR_CONNECTION_REFUSED），重新 `npm run trial` 从自动打开的登录页进入。

上游明确拒绝 `0.0.0.0` 绑定（会把执行能力暴露到网络）。局域网试用走 SSH 隧道：`ssh -L 3080:127.0.0.1:3080 <试用机>`。

当前有效的迁移合同、基线和 Notara 设计保存在 [`docs/migration/`](docs/migration/README.md)；运行时、UI 和验收证据保存在 [`docs/`](docs/) 下。
